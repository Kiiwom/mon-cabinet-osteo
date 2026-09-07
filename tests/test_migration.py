import csv
import datetime as dt
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"app"))
from import_mcl import import_archive, local_id, mcl_date
from storage import Store, Problem

class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="mcl-test-");self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.archive=self.root/"fictif.zip";self.destination=self.root/"cabinet"
        self.tables={
            "view_patient.csv":[{"id_cabinet":"cabinet_fictif","id":"p1","nom":"EXEMPLE","prenom":"Élodie","statut":"1","date_naissance":"19850203","remarques_antecedents":"Notes historiques du patient","remarques":"Préférence fictive","sexe":"f","created":"20240101120000","updated":"20250102150000","email":"ancienne adresse invalide"},
                                {"id_cabinet":"cabinet_fictif","id":"p2","nom":"ARCHIVÉ","prenom":"Alex","statut":"0","date_naissance":"","remarques_antecedents":"","remarques":"","sexe":"indefini","created":"20240101120000","updated":"","email":""}],
            "rdv.csv":[{"id_cabinet":"cabinet_fictif","rdv_id":"r1","rdv_patient":"p1","rdv_start":"202501021430","etat_facturation":"facture","facturation_possible":"1","rdv_created":"20250101120000","rdv_comment":"Suite fictive"},
                       {"id_cabinet":"cabinet_fictif","rdv_id":"r2","rdv_patient":"p2","rdv_start":"202501031000","etat_facturation":"","facturation_possible":"0","rdv_created":"20250101120000","rdv_comment":""}],
            "consultation_champ.csv":[{"consultation_id":"r1","champ_id":"motif","champ_libelle":"Motif de consultation","champ_type":"textarea","valeur":"Motif historique"},
                                      {"consultation_id":"r1","champ_id":"traitement","champ_libelle":"Traitements","champ_type":"textarea","valeur":"Traitement fictif ; retour\nà la ligne"},
                                      {"consultation_id":"r2","champ_id":"motif","champ_libelle":"Motif de consultation","champ_type":"textarea","valeur":"Ancienne consultation"},
                                      {"consultation_id":"sans_rdv","champ_id":"motif","champ_libelle":"Motif de consultation","champ_type":"textarea","valeur":"À rattacher, ne pas deviner"}],
            "facture.csv":[{"facture_numero":f"{dt.date.today().year}-01-41","facture_date_finalisation":f"{dt.date.today().year}0102120000","facture_created":f"{dt.date.today().year}0102120000"}],
            "antecedent_patient.csv":[{"patient_id":"p1","valeur":"{&quot;checked&quot;:&quot;1&quot;,&quot;texte&quot;:&quot;Détail fictif&quot;}","remarques":"Complément","famille_antecedent_libelle":"Médical","antecedent_libelle":"Exemple","date_start":"20200101","date_end":"","en_cours":"1","important":"1"}]
        }
        self.write_archive()

    def write_archive(self):
        with ZipFile(self.archive,"w") as z:
            for name,rows in self.tables.items():
                out=io.StringIO(newline="");writer=csv.DictWriter(out,fieldnames=list(rows[0]),delimiter=";");writer.writeheader();writer.writerows(rows)
                z.writestr("cabinet_fictif/"+name,out.getvalue().encode("utf-8-sig"))

    def test_preview_has_no_database_side_effect(self):
        result=import_archive(self.archive,self.destination)
        self.assertFalse(self.destination.exists())
        self.assertEqual((result["active_patients"],result["archived_patients"],result["consultations"],result["unlinked_consultations"]),(1,1,2,1))

    def test_mapping_archives_dates_notes_and_idempotence(self):
        result=import_archive(self.archive,self.destination,True);store=Store(self.destination)
        self.assertEqual(len(store.patients()),1);self.assertEqual(len(store.patients(include_archived=True)),2)
        p=store.patient(local_id("cabinet_fictif/patient","p1"));co=p["consultations"][0]
        self.assertEqual(p["birth_date"],"1985-02-03");self.assertEqual(p["gender"],"F")
        self.assertEqual(p["shared_notes"],"Notes historiques du patient")
        self.assertEqual(p["important_notes"],"Préférence fictive")
        self.assertEqual(co["date"],"2025-01-02");self.assertEqual(co["motif"],"Motif historique")
        self.assertIn("Traitement fictif ; retour\nà la ligne",co["custom"].values())
        self.assertTrue(co["legacy_billed"]);self.assertEqual(store.dashboard()["pending"],[])
        with self.assertRaises(Problem):store.draft({"consultation_id":co["id"]})
        self.assertEqual(p["antecedents"][0]["detail"],"Détail fictif\nComplément")
        # An old malformed email must not prevent saving new clinical notes.
        store.save_patient({"version":p["version"],"shared_notes":"Nouvelles notes"},p["id"])
        self.assertTrue(import_archive(self.archive,self.destination,True)["already_imported"])
        self.assertEqual(len(store.patients(include_archived=True)),2)
        with store.db() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM source_records").fetchone()[0],sum(len(v) for v in self.tables.values()))
            self.assertFalse(c.execute("PRAGMA foreign_key_check").fetchall())
            self.assertEqual(store.next_number(c,dt.date.today().isoformat())[2],42)

    def test_restore_preserves_migration_sources_and_reservations(self):
        import_archive(self.archive,self.destination,True);store=Store(self.destination)
        blob=store.encrypted_backup("phrase de sauvegarde fictive")
        target=Store(self.root/"restaure");target.restore_backup(blob,"phrase de sauvegarde fictive")
        self.assertEqual(target.export_json()["source_records"],store.export_json()["source_records"])
        self.assertEqual(target.config()["migration"],store.config()["migration"])
        self.assertEqual(target.dashboard()["pending"],[])

    def test_missing_patient_refuses_before_import(self):
        self.tables["rdv.csv"][0]["rdv_patient"]="introuvable";self.write_archive()
        with self.assertRaises(Problem):import_archive(self.archive,self.destination,True)
        self.assertFalse(self.destination.exists())

    def test_existing_cabinet_is_not_overwritten(self):
        store=Store(self.destination);store.save_patient({"first_name":"Déjà","last_name":"PRÉSENT"})
        with self.assertRaises(Problem):import_archive(self.archive,self.destination,True)
        self.assertEqual(len(store.patients()),1)

    def test_date_and_zip_path_validation(self):
        self.assertEqual(mcl_date("202609071030"),"2026-09-07")
        with self.assertRaises(Problem):mcl_date("20260230")
        with ZipFile(self.archive,"a") as z:z.writestr("../patient.csv","a;b\n")
        with self.assertRaises(Problem):import_archive(self.archive,self.destination)

if __name__=="__main__":unittest.main()
