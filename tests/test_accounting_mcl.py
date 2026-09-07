import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from storage import Store, Problem, dump
from accounting_mcl import integrate, summary, orphans, export, cents, working_records, edit_record, export_working


class HistoricalAccountingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='historical-accounting-test-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.store=Store(self.root/'cabinet')
        def document(id, total='55', balance='0', state='enregistree', family='factures', origin=''):
            return dict(id_facture=id,facture_famille=family,facture_etat=state,facture_montant_ttc=total,
                facture_balance=balance,facture_numero='2025-01-'+id,facture_date_finalisation='20250102120000',
                facture_created='20250101120000',facture_client='DESTINATAIRE FICTIF',facture_origine=origin,
                facture_commentaire='',facture_paiement='payee')
        def payment(id, amount='55', method='CB', destination='facture'):
            return dict(paiement_facture=id,paiement_destination=destination,paiement_montant=amount,
                paiement_moyen=method,paiement_date='20250102',paiement_date_encaissement='20250203',
                paiement_commentaire='=TEST INERTE',paiement_montant_total=amount)
        self.tables={'facture.csv':[document('1',state='annulee'),document('2','-55',family='avoirs',origin='1'),
                                   document('3',balance='5'),document('4')],
            'paiement.csv':[payment('1'),payment('1',method='Avoir'),payment('1','-10','Espèces'),
                            payment('3','50'),payment('4'),payment('4'),payment('op','1',destination='operation')],
            'rdv.csv':[{'rdv_id':'known'}],
            'consultation_champ.csv':[{'consultation_id':'orphan','champ_libelle':'Motif','valeur':'Texte fictif\nà identifier'},
                                     {'consultation_id':'known','champ_libelle':'Motif','valeur':'Déjà rattaché'}]}
        with self.store.db(True) as c:
            c.execute('INSERT INTO import_runs VALUES (?,?,?,?)',('run','fingerprint','2025-01-01','{}'))
            for table,rows in self.tables.items():
                for ordinal,r in enumerate(rows): c.execute('INSERT INTO source_records VALUES (?,?,?,?)',('run',table,ordinal,dump(r)))
            c.execute("UPDATE settings SET value=? WHERE key='migration'",(dump({'state':'patients_imported','reserved_numbers':{},'summary':{}}),))

    def test_exact_rows_balances_cancellation_and_idempotence(self):
        self.assertEqual(integrate(self.store.directory)['documents'],4)
        with self.store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM legacy_documents').fetchone()[0],0)
        result=integrate(self.store.directory,True)
        self.assertEqual(result['payments'],7);self.assertEqual(result['identical_rows'],1)
        self.assertEqual(result['years'][0],dict(year='2025',documents=4,total_cents=11000,settled_cents=10500,balance_cents=500))
        self.assertEqual(len(result['discrepancies']),1);self.assertEqual(result['discrepancies'][0]['discrepancy_cents'],5500)
        self.assertEqual(len(result['standalone_payments']),1)
        self.assertTrue(integrate(self.store.directory,True)['already_imported'])
        self.assertEqual(len(self.store.invoices()),4)
        with self.store.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM payments').fetchone()[0],0)
            self.assertFalse(c.execute('PRAGMA foreign_key_check').fetchall())
            docs=self.store.invoices(c);self.assertEqual(sum(d['total_cents'] for d in docs),11000)
            cancelled=next(d for d in docs if d['source_id']=='1');self.assertEqual(cancelled['paid_cents'],0)
            self.assertIn(-1000,[p['cents'] for p in cancelled['payments']])

    def test_backup_export_and_orphan_content(self):
        integrate(self.store.directory,True)
        restored=Store(self.root/'restored')
        restored.restore_backup(self.store.encrypted_backup('phrase de test suffisamment longue'),'phrase de test suffisamment longue')
        with restored.db() as c:
            self.assertEqual(summary(c)['payments'],7)
            self.assertEqual(orphans(c),[{'source_id':'orphan','fields':[{'label':'Motif','value':'Texte fictif\nà identifier'}]}])
            rows=list(csv.reader(io.StringIO(export(c).decode('utf-8-sig')),delimiter=';'))
            self.assertEqual(len(rows),8);self.assertEqual(rows[1][2],'2025-02-03')
            self.assertEqual(rows[1][-1],"'=TEST INERTE")
            self.assertIn('-10,00',[r[7] for r in rows[1:]])

    def test_invalid_destination_prevents_partial_import(self):
        with self.store.db(True) as c:
            r=dict(self.tables['paiement.csv'][0]);r['paiement_facture']='absent'
            c.execute("UPDATE source_records SET payload=? WHERE table_name='paiement.csv' AND ordinal=0",(dump(r),))
        with self.assertRaises(Problem):integrate(self.store.directory,True)
        with self.store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM legacy_documents').fetchone()[0],0)

    def test_cents_are_exact(self):
        self.assertEqual(cents('0.29'),29);self.assertEqual(cents('-10'),-1000)
        for invalid in ('0.001','NaN','Infinity','abc'):
            with self.assertRaises(Problem):cents(invalid)

    def test_payment_edits_exclusion_restore_and_source_preservation(self):
        integrate(self.store.directory,True)
        with self.store.db() as c:
            original_export=export(c);original_rows=[tuple(r) for r in c.execute('SELECT * FROM legacy_payments')]
            d=next(d for d in working_records(c)[0] if d['source_id']=='4');p=d['payments'][1]
            before=summary(c)['counted_cents']
        edit_record(self.store,'payment',p['id'],{'version':0,'action':'exclude'})
        with self.store.db() as c:
            after=summary(c);self.assertEqual(after['counted_cents'],before-5500)
            self.assertEqual(after['discrepancies'],[])
            self.assertNotIn(p['id'],export_working(c).decode())
            self.assertEqual(export(c),original_export)
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM legacy_payments')],original_rows)
        with self.assertRaises(Problem) as stale:edit_record(self.store,'payment',p['id'],{'version':0,'cents':3000})
        self.assertEqual(stale.exception.status,409)
        edit_record(self.store,'payment',p['id'],{'version':1,'action':'restore'})
        edit_record(self.store,'payment',p['id'],{'version':2,'cents':2900,'method':'Espèces','date':'2025-03-01','collection_date':'2025-03-02','comment':'Correction fictive'})
        with self.store.db() as c:
            self.assertEqual(summary(c)['counted_cents'],before-2600)
            self.assertIn('29,00',export_working(c).decode())
            self.assertIn('2025-03-02',export_working(c).decode())
        edit_record(self.store,'payment',p['id'],{'version':3,'action':'reset'})
        with self.store.db() as c:self.assertEqual(summary(c)['counted_cents'],before)

    def test_manual_inclusion_and_document_exclusion(self):
        integrate(self.store.directory,True)
        with self.store.db() as c:
            docs,ps=working_records(c);p=next(p for p in ps if p['destination']=='operation')
            before=summary(c)['counted_cents'];doc=next(d for d in docs if d['source_id']=='3')
        edit_record(self.store,'payment',p['id'],{'version':0,'included':True})
        edit_record(self.store,'document',doc['id'],{'version':0,'recipient_name':'DESTINATAIRE CORRIGÉ','total_cents':6000,'balance_cents':1000,'date':'2025-04-01'})
        with self.store.db() as c:self.assertEqual(summary(c)['counted_cents'],before+100)
        edit_record(self.store,'document',doc['id'],{'version':1,'action':'exclude'})
        with self.store.db() as c:
            self.assertEqual(summary(c)['counted_cents'],before+100-5000)
            self.assertEqual(len(self.store.invoices(c)),3)
            self.assertEqual(len(summary(c)['excluded_documents']),1)
        edit_record(self.store,'document',doc['id'],{'version':2,'action':'restore'})
        with self.store.db() as c:
            self.assertEqual(summary(c)['counted_cents'],before+100)
            restored=next(d for d in self.store.invoices(c) if d['id']==doc['id'])
            self.assertEqual(restored['recipient']['last_name'],'DESTINATAIRE CORRIGÉ')
            self.assertEqual(restored['total_cents'],6000)

    def test_validation_and_backup_of_corrections(self):
        integrate(self.store.directory,True)
        with self.store.db() as c:
            p=working_records(c)[1][0];doc=working_records(c)[0][0]
        for body in ({'cents':0.5},{'date':'2025-02-30'},{'included':'false'},{'method':'impossible'},{'invoice_id':'unknown'}):
            with self.assertRaises(Problem):edit_record(self.store,'payment',p['id'],{'version':0,**body})
        with self.assertRaises(Problem):edit_record(self.store,'document',doc['id'],{'version':0,'total_cents':2000,'balance_cents':3000})
        edit_record(self.store,'payment',p['id'],{'version':0,'included':True,'cents':-2500})
        restored=Store(self.root/'corrected-restored')
        restored.restore_backup(self.store.encrypted_backup('phrase de sauvegarde pour test'),'phrase de sauvegarde pour test')
        with restored.db() as c:
            p2=working_records(c)[1][0];self.assertEqual(p2['cents'],-2500);self.assertTrue(p2['counted']);self.assertEqual(p2['version'],1)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM audit WHERE kind='accounting.payment.save'").fetchone()[0],1)


if __name__=='__main__':unittest.main()
