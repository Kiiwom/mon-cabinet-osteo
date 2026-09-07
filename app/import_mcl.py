"""Initial MCL migration. Exact source rows stay local alongside mapped records."""
import argparse
import collections
import contextlib
import csv
import datetime as dt
import hashlib
import html
import io
import json
import re
import shutil
import uuid
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
from storage import Store, Problem, BASE_FIELDS, dump, now

REQUIRED = {"view_patient.csv": {"id", "nom", "prenom", "statut", "date_naissance", "remarques_antecedents", "remarques"},
            "rdv.csv": {"rdv_id", "rdv_patient", "rdv_start", "etat_facturation", "facturation_possible"},
            "consultation_champ.csv": {"consultation_id", "champ_id", "champ_libelle", "champ_type", "valeur"}}

def local_id(kind, source_id):
    return uuid.uuid5(uuid.NAMESPACE_URL, "moncabinetliberal/"+kind+"/"+source_id).hex

def plain(value):
    value = html.unescape(value or "")
    if re.search(r"</?(?:p|div|br|span|strong|em|ul|li)\b", value, re.I):
        from html.parser import HTMLParser
        class TextParser(HTMLParser):
            def __init__(self): super().__init__(); self.parts=[]
            def handle_data(self, data): self.parts.append(data)
            def handle_starttag(self, tag, attrs):
                if tag in ("p","div","br","li"): self.parts.append("\n")
            def handle_endtag(self, tag):
                if tag in ("p","div","li"): self.parts.append("\n")
        parser=TextParser();parser.feed(value);value="".join(parser.parts)
    return value.strip()

def mcl_date(value, full=False):
    if not value: return ""
    if not re.fullmatch(r"\d{8}(?:\d{4}(?:\d{2})?)?",value):
        raise Problem("Un format de date MCL n’est pas reconnu ; import interrompu.")
    fmt = {8:"%Y%m%d",12:"%Y%m%d%H%M",14:"%Y%m%d%H%M%S"}[len(value)]
    try: parsed=dt.datetime.strptime(value,fmt)
    except ValueError: raise Problem("Une date MCL est invalide ; import interrompu.")
    return parsed.isoformat(timespec="seconds") if full else parsed.date().isoformat()

def load_archive(path):
    path=Path(path)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    tables={}; cabinet_ids=set()
    with ZipFile(path) as z:
        if sum(f.file_size for f in z.infolist()) > 512*1024*1024:
            raise Problem("Archive trop volumineuse pour cet import.")
        for entry in z.infolist():
            p=PurePosixPath(entry.filename)
            if p.is_absolute() or ".." in p.parts:
                raise Problem("Chemin d’archive invalide.")
            if not entry.filename.endswith(".csv"): continue
            if p.name in tables: raise Problem("Plusieurs cabinets ou fichiers homonymes : séparation nécessaire.")
            text=z.read(entry).decode("utf-8-sig")
            reader=csv.DictReader(io.StringIO(text),delimiter=";")
            if p.name in REQUIRED and not REQUIRED[p.name].issubset(reader.fieldnames or []):
                raise Problem("Colonnes MCL manquantes dans "+p.name)
            rows=list(reader)
            if any(None in r or any(v is None for v in r.values()) for r in rows):
                raise Problem("Lignes CSV mal formées dans "+p.name)
            tables[p.name]=rows
            cabinet_ids.update(r["id_cabinet"] for r in rows if r.get("id_cabinet"))
    if not REQUIRED.keys() <= tables.keys(): raise Problem("L’archive ne contient pas tous les fichiers patients et consultations attendus.")
    if len(cabinet_ids)!=1: raise Problem("L’import nécessite les données d’un seul cabinet.")
    source=next(iter(cabinet_ids))
    return digest,source,tables

def prepare(path):
    fingerprint,source,tables=load_archive(path)
    patients=tables["view_patient.csv"]; appointments=tables["rdv.csv"]; fields=tables["consultation_champ.csv"]
    pids={r["id"] for r in patients}; rids={r["rdv_id"] for r in appointments}
    if len(pids)!=len(patients) or len(rids)!=len(appointments): raise Problem("Identifiants patients ou rendez-vous dupliqués.")
    if any(r["rdv_patient"] not in pids for r in appointments): raise Problem("Un rendez-vous désigne un patient absent de l’archive.")
    if any(r["patient_id"] not in pids for r in tables.get("antecedent_patient.csv",[])): raise Problem("Un antécédent désigne un patient absent.")
    for r in patients:
        for k in ("date_naissance","created","updated"): mcl_date(r.get(k,""))
    for r in appointments: mcl_date(r["rdv_start"])
    grouped=collections.defaultdict(list)
    for row in fields: grouped[row["consultation_id"]].append(row)
    orphan_ids=set(grouped)-rids
    reserved={}
    for row in tables.get("facture.csv",[]):
        number=row.get("facture_numero","")
        match=re.fullmatch(r"(\d{4})-(\d{2})-(\d+)",number)
        if not match: raise Problem("Un numéro historique ne suit pas le format attendu ; vérification nécessaire.")
        year,_,seq=match.groups()
        day=mcl_date(row.get("facture_date_finalisation") or row.get("facture_created"))
        old=reserved.setdefault(year,{"max_sequence":0,"last_date":""})
        old["max_sequence"]=max(old["max_sequence"],int(seq));old["last_date"]=max(old["last_date"],day)
    summary={"source":"MonCabinetLibéral","fingerprint":fingerprint,"tables":{k:len(v) for k,v in tables.items()},
             "patients":len(patients),"active_patients":sum(r["statut"]=="1" for r in patients),
             "archived_patients":sum(r["statut"]!="1" for r in patients),"consultations":len(set(grouped)&rids),
             "antecedents":len(tables.get("antecedent_patient.csv",[])),"unlinked_consultations":len(orphan_ids),
             "unlinked_field_rows":sum(len(grouped[k]) for k in orphan_ids),"reserved_numbers":reserved,
             "financial_history":"source_preserved_not_reconciled","attachments":"not_in_archive"}
    return source,tables,grouped,summary

def import_archive(path, directory, apply=False):
    source,tables,grouped,summary=prepare(path)
    if not apply: return summary
    directory=Path(directory).resolve()
    if "onedrive" in str(directory).lower(): raise Problem("Le dossier de données doit être hors de OneDrive.")
    store=Store(directory)
    run_id=local_id("import",summary["fingerprint"])
    with store.db() as c:
        if c.execute("SELECT 1 FROM import_runs WHERE fingerprint=?",(summary["fingerprint"],)).fetchone():
            return {**summary,"already_imported":True}
        if c.execute("SELECT COUNT(*) FROM patients").fetchone()[0] or c.execute("SELECT COUNT(*) FROM import_runs").fetchone()[0]:
            raise Problem("Cette première migration nécessite un cabinet vide. Aucune fiche existante ne sera remplacée.")
    imports=directory/"imports";imports.mkdir(exist_ok=True)
    backup=imports/"avant-import.sqlite3"
    # SQLite's backup API includes committed WAL contents in a coherent snapshot.
    import sqlite3
    with store.db() as c:
        with contextlib.closing(sqlite3.connect(backup)) as destination: c.backup(destination)
    archive_copy=imports/("mcl-"+summary["fingerprint"][:16]+".zip")
    shutil.copyfile(path,archive_copy)
    with store.db(True) as c:
        if c.execute("SELECT COUNT(*) FROM patients").fetchone()[0]: raise Problem("Le cabinet a changé pendant la préparation. Import annulé.")
        c.execute("INSERT INTO import_runs VALUES (?,?,?,?)",(run_id,summary["fingerprint"],now(),dump(summary)))
        for table,rows in tables.items():
            c.executemany("INSERT INTO source_records VALUES (?,?,?,?)",((run_id,table,i,dump(r)) for i,r in enumerate(rows)))
        for p in tables["view_patient.csv"]:
            pid=local_id(source+"/patient",p["id"])
            values={k:"" for k in Store.PATIENT_FIELDS}
            values.update(first_name=plain(p["prenom"]),last_name=plain(p["nom"]),birth_date=mcl_date(p.get("date_naissance","")),gender={"f":"F","m":"M","indefini":"X"}.get(p.get("sexe"),""),
                          phone=plain(p.get("telephone1") or p.get("telephone2")),email=plain(p.get("email")),address="\n".join(plain(p.get(k)) for k in ("adresse1","adresse2") if p.get(k)),
                          postal=plain(p.get("code_postal")),city=plain(p.get("ville")),occupation=plain(p.get("profession")),activities=plain(p.get("activites")),
                          shared_notes=plain(p.get("remarques_antecedents")),important_notes=plain(p.get("remarques")))
            created=mcl_date(p.get("created",""),True) or now();updated=mcl_date(p.get("updated",""),True) or created
            c.execute("INSERT INTO patients(id,"+",".join(values)+",archived,created_at,updated_at) VALUES ("+",".join("?" for _ in range(len(values)+4))+")",(pid,*values.values(),int(p["statut"]!="1"),created,updated))
            c.execute("INSERT INTO migration_links VALUES (?,?,?,?)",(source,"patient",p["id"],pid))
        for ap in tables["rdv.csv"]:
            original=ap["rdv_id"]
            if original not in grouped: continue
            co_id=local_id(source+"/consultation",original); pid=local_id(source+"/patient",ap["rdv_patient"])
            form=list(BASE_FIELDS);custom={};motifs=[]
            for index,f in enumerate(grouped[original]):
                value=plain(f["valeur"])
                if f["champ_libelle"].strip().lower()=="motif de consultation": motifs.append(value)
                else:
                    key="mcl_"+local_id("field",f["champ_id"]+"/"+str(index))
                    form.append({"key":key,"label":f["champ_libelle"],"kind":"textarea"});custom[key]=value
            day=mcl_date(ap["rdv_start"]);created=mcl_date(ap.get("rdv_created") or ap["rdv_start"],True)
            c.execute("INSERT INTO consultations(id,patient_id,date,motif,anamnesis,followup,billable,template_id,fields,custom,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                      (co_id,pid,day,"\n\n".join(motifs),"",plain(ap.get("rdv_comment")),int(ap["facturation_possible"]=="1"),"mcl_import",dump(form),dump(custom),created,created))
            c.execute("INSERT INTO migration_links VALUES (?,?,?,?)",(source,"consultation",original,co_id))
            if ap["etat_facturation"]=="facture":
                c.execute("INSERT INTO migration_links VALUES (?,?,?,?)",(source,"billed_consultation",original,co_id))
        for index,a in enumerate(tables.get("antecedent_patient.csv",[])):
            value=html.unescape(a.get("valeur", ""));detail=plain(a.get("remarques"))
            try:
                obj=json.loads(value)
                if isinstance(obj,dict): value=plain(obj.get("texte",""))
            except ValueError: pass
            detail="\n".join(x for x in (plain(value),detail) if x)
            start=mcl_date(a.get("date_start",""));end=mcl_date(a.get("date_end",""))
            since=(start+(" → "+end if end else "")+(" · en cours" if a.get("en_cours")=="1" else ""))
            c.execute("INSERT INTO antecedents VALUES (?,?,?,?,?,?,?,?)",(local_id(source+"/antecedent",str(index)),local_id(source+"/patient",a["patient_id"]),plain(a.get("famille_antecedent_libelle")) or "Autre",plain(a.get("antecedent_libelle")) or "Antécédent importé",detail,since,int(a.get("important")=="1"),now()))
        migration={"state":"patients_imported","reserved_numbers":summary["reserved_numbers"],"summary":summary,"imported_at":now()}
        c.execute("UPDATE settings SET value=? WHERE key='migration'",(dump(migration),))
        store.log(c,"migration.completed",run_id,summary)
        if c.execute("PRAGMA foreign_key_check").fetchone(): raise Problem("Un lien importé est invalide : transaction annulée.")
    (imports/"rapport-import.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    return {**summary,"imported":True}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Contrôler puis importer les patients MCL dans un cabinet local vide.")
    parser.add_argument("archive",type=Path);parser.add_argument("--data-dir",type=Path);parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if args.apply and not args.data_dir: parser.error("--data-dir est nécessaire avec --apply")
    try: print(json.dumps(import_archive(args.archive,args.data_dir,args.apply),ensure_ascii=False,indent=2))
    except (Problem,ValueError,OSError) as error: parser.exit(1,str(error)+"\n")
