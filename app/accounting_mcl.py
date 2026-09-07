"""Historical accounting with reversible local corrections over immutable sources."""
import argparse
import collections
import contextlib
import csv
import io
import json
import sqlite3
from decimal import Decimal, InvalidOperation
from pathlib import Path

from import_mcl import local_id, mcl_date, plain
from storage import Problem, Store, dump, now, date, text, integer


def cents(value):
    try:
        amount = Decimal(value or '0') * 100
        if not amount.is_finite() or amount != amount.to_integral_value():
            raise ValueError()
        return int(amount)
    except (InvalidOperation, ValueError):
        raise Problem('Montant MCL invalide : import interrompu.')


def source_tables(c, import_id):
    tables = collections.defaultdict(list)
    for r in c.execute('SELECT table_name,ordinal,payload FROM source_records WHERE import_id=? ORDER BY ordinal', (import_id,)):
        tables[r['table_name']].append((r['ordinal'], json.loads(r['payload'])))
    return tables


def prepare(c, run):
    tables = source_tables(c, run['id'])
    documents = {}; payments = []; duplicates = collections.Counter()
    for ordinal, r in tables['facture.csv']:
        sid = r['id_facture']
        if sid in documents or r['facture_famille'] not in ('factures', 'avoirs') or r['facture_etat'] not in ('enregistree', 'annulee'):
            raise Problem('Document comptable MCL ambigu : import interrompu.')
        credit = r['facture_famille'] == 'avoirs'
        status = 'replaced' if r['facture_etat'] == 'annulee' else 'issued'
        total = cents(r['facture_montant_ttc']); balance = cents(r['facture_balance'])
        documents[sid] = dict(id=local_id(run['id']+'/invoice', sid), ordinal=ordinal,
            source_id=sid, legacy=True, number=r['facture_numero'], kind='credit' if credit else 'invoice',
            status=status, date=mcl_date(r['facture_date_finalisation'] or r['facture_created']),
            recipient={'last_name':plain(r['facture_client']), 'first_name':''},
            total_cents=total, balance_cents=balance, paid_cents=total-balance if not credit and status=='issued' else 0,
            origin_source_id=r['facture_origine'], comment=plain(r['facture_commentaire']), payments=[],
            source_state=r['facture_etat'], source_payment_state=r['facture_paiement'])
    if len({d['number'] for d in documents.values()}) != len(documents):
        raise Problem('Numéros historiques dupliqués : import interrompu.')
    for ordinal, r in tables['paiement.csv']:
        dest=r['paiement_destination']; parent=documents.get(r['paiement_facture']) if dest=='facture' else None
        if dest not in ('facture','operation') or (dest=='facture' and parent is None):
            raise Problem('Destination de règlement MCL inconnue.')
        exact=dump(r); duplicates[exact]+=1
        p=dict(id=local_id(run['id']+'/payment', str(ordinal)), ordinal=ordinal,
               invoice_id=parent['id'] if parent else None, cents=cents(r['paiement_montant']),
               method=r['paiement_moyen'], date=mcl_date(r['paiement_date']),
               collection_date=mcl_date(r['paiement_date_encaissement']), destination=dest,
               destination_id=r['paiement_facture'], comment=plain(r['paiement_commentaire']),
               declared_total_cents=cents(r['paiement_montant_total']), identical_previous=duplicates[exact]>1)
        payments.append(p)
        if parent: parent['payments'].append(p)
    for d in documents.values():
        origin=d['origin_source_id']
        if origin and origin not in documents: raise Problem('Avoir sans document d’origine dans l’export.')
        d['related_id']=documents[origin]['id'] if origin else None
        d['payment_rows_cents']=sum(p['cents'] for p in d['payments'] if p['method']!='Avoir')
        d['discrepancy_cents']=d['payment_rows_cents']-d['paid_cents'] if d['kind']=='invoice' and d['status']=='issued' else 0
    return list(documents.values()),payments


def integrate(directory, apply=False):
    store=Store(directory)
    with store.db() as c:
        runs=[dict(r) for r in c.execute('SELECT * FROM import_runs')]
        if len(runs)!=1: raise Problem('Un import patient MCL unique doit précéder la comptabilité.')
        run=runs[0]
        if c.execute('SELECT 1 FROM legacy_documents WHERE import_id=?', (run['id'],)).fetchone():
            return {'already_imported':True, **summary(c)}
        documents,payments=prepare(c,run)
        result={'documents':len(documents),'payments':len(payments),'discrepancies':sum(bool(d['discrepancy_cents']) for d in documents)}
        if not apply: return result
        backup=store.directory/'imports'/'avant-import-comptabilite.sqlite3'
        backup.parent.mkdir(exist_ok=True)
        if backup.exists(): raise Problem('Une sauvegarde avant import existe déjà ; vérifiez la reprise avant de relancer.')
        with contextlib.closing(sqlite3.connect(backup)) as target: c.backup(target)
    with store.db(True) as c:
        for d in documents:
            c.execute('INSERT INTO legacy_documents VALUES (?,?,?,?)', (d['id'],run['id'],d['ordinal'],dump(d)))
        for p in payments:
            c.execute('INSERT INTO legacy_payments VALUES (?,?,?,?,?)',(p['id'],run['id'],p['ordinal'],p['invoice_id'],dump(p)))
        migration=store.config(c)['migration'];migration['state']='accounting_imported'
        migration['summary']['financial_history']='imported_with_review_flags'
        migration['accounting']=result; migration['accounting_imported_at']=now()
        c.execute('UPDATE settings SET value=? WHERE key=?',(dump(migration),'migration'))
        store.log(c,'migration.accounting',run['id'],result)
        if c.execute('PRAGMA foreign_key_check').fetchone(): raise Problem('Liens incohérents : import annulé.')
        return summary(c)


def working_records(c):
    docs=[json.loads(r[0]) for r in c.execute('SELECT payload FROM legacy_documents')]
    ps=[json.loads(r[0]) for r in c.execute('SELECT payload FROM legacy_payments ORDER BY ordinal')]
    edits={(r['kind'],r['entity_id']):dict(r) for r in c.execute('SELECT * FROM accounting_edits')}
    parents={d['id']:d for d in docs}
    for kind, rows in [('document',docs),('payment',ps)]:
        for r in rows:
            original=json.loads(dump(r));original.pop('payments',None)
            edit=edits.get((kind,r['id']))
            r.update(json.loads(edit['payload']) if edit else {})
            r['version']=edit['version'] if edit else 0
            r['original']=original;r.setdefault('excluded',False)
            if kind=='document':
                r['payments']=[]
                r['paid_cents']=r['total_cents']-r['balance_cents'] if r['kind']=='invoice' and r['status']=='issued' else 0
    for p in ps:
        parent=parents.get(p['invoice_id'])
        default_include=bool(parent and parent['kind']=='invoice' and parent['status']=='issued' and p['method']!='Avoir')
        p['included']=p.get('included',default_include)
        p['parent_excluded']=bool(parent and parent['excluded'])
        p['counted']=p['included'] and not p['excluded'] and not p['parent_excluded']
        p['number']=parent['number'] if parent else 'Opération sans facture'
        p['client']=parent['recipient']['last_name'] if parent else ''
        if parent:parent['payments'].append(p)
    for d in docs:
        d['payment_rows_cents']=sum(p['cents'] for p in d['payments'] if not p['excluded'] and p['method']!='Avoir')
        d['counted_cents']=sum(p['cents'] for p in d['payments'] if p['counted'])
        d['discrepancy_cents']=d['counted_cents']-d['paid_cents'] if not d['excluded'] and d['kind']=='invoice' and d['status']=='issued' else 0
    return docs,ps


def invoices(c):
    return [d for d in working_records(c)[0] if not d['excluded']]


def edit_record(store, kind, key, body):
    if kind not in ('document','payment'):raise Problem('Type de ligne inconnu.')
    with store.db(True) as c:
        records=working_records(c)[0 if kind=='document' else 1]
        current=next((r for r in records if r['id']==key),None)
        if current is None:raise Problem('Ligne comptable introuvable.',404)
        version=integer(body.get('version'),0,100000000,'Version')
        if version!=current['version']:raise Problem('Cette ligne a changé dans un autre onglet. Fermez puis rouvrez-la avant de recommencer.',409)
        old=c.execute('SELECT payload FROM accounting_edits WHERE kind=? AND entity_id=?',(kind,key)).fetchone()
        patch=json.loads(old[0]) if old else {}
        action=body.get('action','save')
        if action=='reset':patch={}
        elif action in ('exclude','restore'):patch['excluded']=action=='exclude'
        elif action=='save':
            allowed={'date','comment','cents','method','collection_date','included'} if kind=='payment' else {'date','comment','total_cents','balance_cents','recipient_name'}
            if set(body)-allowed-{'version','action'}:raise Problem('Champ de correction inconnu.')
            for field in allowed & body.keys():
                value=body[field]
                if field in ('date','collection_date'):value=date(value) if value or field=='date' else ''
                elif field in ('cents','total_cents','balance_cents'):value=integer(value,-100000000,100000000,'Montant en centimes')
                elif field=='included':
                    if not isinstance(value,bool):raise Problem('Choix de comptabilisation invalide.')
                elif field=='method':
                    if value not in ('CB','Chèque','Espèces','Virement','Avoir','Autre'):raise Problem('Moyen de paiement invalide.')
                else:value=text(value,1000 if field=='recipient_name' else 100000)
                if field=='recipient_name':
                    if not value:raise Problem('Le destinataire est obligatoire.')
                    patch['recipient']={'first_name':'','last_name':value}
                else:patch[field]=value
            if kind=='document':
                total=patch.get('total_cents',current['total_cents']);balance=patch.get('balance_cents',current['balance_cents'])
                if current['kind']=='invoice' and (total<0 or not 0<=balance<=total):raise Problem('Le reste à régler doit être compris entre zéro et le montant de la facture.')
                if current['kind']=='credit' and (total>0 or balance!=0):raise Problem('Un avoir doit avoir un montant négatif ou nul et un reste à régler nul.')
        else:raise Problem('Action inconnue.')
        version=current['version']+1
        c.execute('INSERT INTO accounting_edits VALUES (?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET version=excluded.version,payload=excluded.payload',(kind,key,version,dump(patch)))
        store.log(c,'accounting.'+kind+'.'+action,key,{'version':version,'changes':patch},{'version':current['version'],'changes':json.loads(old[0]) if old else {}})
        return {'id':key,'version':version}


def summary(c):
    all_docs,ps=working_records(c);docs=[d for d in all_docs if not d['excluded']]
    years={}
    for d in docs:
        y=years.setdefault(d['date'][:4],dict(year=d['date'][:4],documents=0,total_cents=0,settled_cents=0,balance_cents=0))
        y['documents']+=1;y['total_cents']+=d['total_cents'];y['settled_cents']+=d['paid_cents']
        if d['kind']=='invoice' and d['status']=='issued': y['balance_cents']+=d['balance_cents']
    return dict(documents=len(docs),payments=len(ps),years=sorted(years.values(),key=lambda x:x['year']),
                discrepancies=[d for d in docs if d['discrepancy_cents']],
                standalone_payments=[p for p in ps if not p['invoice_id']],
                identical_rows=sum(p['identical_previous'] for p in ps),
                raw_payment_cents=sum(p['original']['cents'] for p in ps),
                counted_cents=sum(p['cents'] for p in ps if p['counted']),
                counted_payments=sum(p['counted'] for p in ps),
                payments_rows=ps,excluded_documents=[d for d in all_docs if d['excluded']])


def orphans(c):
    results=[]
    for run in c.execute('SELECT id FROM import_runs').fetchall():
        tables=source_tables(c,run['id']); rdvs={r['rdv_id'] for _,r in tables['rdv.csv']}
        groups=collections.defaultdict(list)
        for _,r in tables['consultation_champ.csv']:
            if r['consultation_id'] not in rdvs:
                groups[r['consultation_id']].append({'label':r['champ_libelle'],'value':plain(r['valeur'])})
        results.extend({'source_id':k,'fields':v} for k,v in sorted(groups.items()))
    return results


def export(c):
    out=io.StringIO(newline='');w=csv.writer(out,delimiter=';')
    w.writerow(['Ligne source','Date paiement','Date encaissement','Document','Destination','État document','Moyen','Montant EUR','Ligne identique précédente','Commentaire'])
    docs={d['id']:d for d in [json.loads(r[0]) for r in c.execute('SELECT payload FROM legacy_documents')]}
    def safe(value):
        value=str(value)
        return "'"+value if value[:1] in '=+-@' else value
    for r in c.execute('SELECT payload FROM legacy_payments ORDER BY ordinal'):
        p=json.loads(r[0]);d=docs.get(p['invoice_id'],{})
        w.writerow([p['ordinal'],p['date'],p['collection_date'],safe(d.get('number','')),p['destination'],d.get('source_state',''),safe(p['method']),format(Decimal(p['cents'])/100,'.2f').replace('.',','),'oui' if p['identical_previous'] else '',safe(p['comment'])])
    return b'\xef\xbb\xbf'+out.getvalue().encode()


def export_working(c):
    out=io.StringIO(newline='');w=csv.writer(out,delimiter=';')
    w.writerow(['Date paiement','Date encaissement','Document','Destinataire','Moyen','Montant EUR','Commentaire','Référence locale'])
    def safe(v):return "'"+v if v and v[:1] in '=+-@' else v
    for p in sorted(working_records(c)[1],key=lambda p:(p['collection_date'] or p['date'],p['ordinal'])):
        if p['counted']:
            w.writerow([p['date'],p['collection_date'],safe(p['number']),safe(p['client']),safe(p['method']),format(Decimal(p['cents'])/100,'.2f').replace('.',','),safe(p['comment']),p['id']])
    return b'\xef\xbb\xbf'+out.getvalue().encode()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=Path,required=True);parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();result=integrate(args.data_dir,args.apply)
    print(dump({k:(len(v) if k in ('discrepancies','standalone_payments','payments_rows','excluded_documents') and isinstance(v,list) else v) for k,v in result.items()}))
