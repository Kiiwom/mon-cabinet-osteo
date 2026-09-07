import concurrent.futures
import datetime as dt
import email
import json
import re
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"app"))
from storage import Store, Problem
from server import make_server
from pdf_documents import invoice_pdf, consultation_pdf


class CabinetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="cabinet-test-")
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(Path(self.tmp.name)/"source", demo=True)
        self.store.settings({"practice": {"name":"Cabinet FICTIF", "address":"1 rue Fictive", "postal":"75000", "city":"Paris", "siret":"DEMO", "rpps":"DEMO", "email":"cabinet@example.com"}})
        self.patient = self.store.save_patient({"first_name":"Éloïse", "last_name":"EXEMPLE", "email":"exemple@example.com"})

    def draft(self, day=None):
        co = self.store.save_consult({"patient_id":self.patient["id"]})
        body = {"consultation_id":co["id"]}
        if day: body["date"] = day
        return self.store.draft(body)

    def test_shared_notes_and_conflict(self):
        p = self.store.save_patient({"version":1, "shared_notes":"Notes persistantes"}, self.patient["id"])
        self.assertEqual(self.store.patient(p["id"])["shared_notes"], "Notes persistantes")
        with self.assertRaises(Problem) as caught:
            self.store.save_patient({"version":1, "shared_notes":"Écrasement"}, p["id"])
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(len(self.store.patients("eloise exemple")), 1)

    def test_facturer_off_is_not_pending(self):
        co = self.store.save_consult({"patient_id":self.patient["id"]})
        self.store.save_consult({"version":co["version"], "billable":False, "motif":"Séance conservée"},co["id"])
        self.assertEqual(self.store.dashboard()["pending"], [])
        with self.assertRaises(Problem): self.store.draft({"consultation_id":co["id"]})
        self.assertEqual(self.store.patient(self.patient["id"])["consultations"][0]["motif"], "Séance conservée")

    def test_annual_sequence_and_month(self):
        year = dt.date.today().year
        b = self.store.config()["billing"]
        b["initial_sequence"] = 1744
        self.store.settings({"billing":b})
        for day, expected in [(f"{year}-09-01",f"{year%100:02}-09-1744"),(f"{year}-10-01",f"{year%100:02}-10-1745"),(f"{year+1}-01-01",f"{(year+1)%100:02}-01-1")]:
            inv = self.store.issue(self.draft(day)["id"], {"method":"CB"})
            self.assertEqual(inv["number"],expected)
        with self.assertRaises(Problem): self.store.issue(self.draft(f"{year}-08-01")["id"],{"method":"CB"})

    def test_correction_preserves_money_and_other_fields(self):
        draft = self.draft()
        original = self.store.issue(draft["id"],{"method":"Chèque"})
        again = self.store.issue(draft["id"],{"method":"CB"})
        self.assertEqual(original["number"],again["number"])
        result = self.store.correct(original["id"],{"field":"last_name","value":"PARENT FICTIF"})
        replacement = result["invoice"]
        self.assertEqual(replacement["recipient"]["last_name"],"PARENT FICTIF")
        self.assertEqual(replacement["lines"],original["lines"])
        self.assertEqual(replacement["recipient"]["first_name"],original["recipient"]["first_name"])
        self.assertEqual(replacement["paid_cents"],5500)
        self.assertEqual(result["credit"]["total_cents"],-5500)
        self.assertEqual(self.store.dashboard()["totals"]["receipts_cents"],5500)
        self.assertEqual(sum(i["total_cents"] for i in self.store.invoices()),5500)
        self.assertEqual(self.store.invoice(original["id"])["payment_snapshot"],original["payment_snapshot"])
        self.assertEqual(self.store.correct(original["id"],{"field":"last_name","value":"PARENT FICTIF"})["invoice"]["id"],replacement["id"])
        self.assertEqual(len(self.store.invoices()),3)

    def test_pay_and_number_allocation_concurrent(self):
        drafts = [self.draft() for _ in range(6)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda d:self.store.issue(d["id"],{"method":"En attente"}), drafts))
        self.assertEqual(len(set(i["number"] for i in results)),6)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _:self.store.pay(results[0]["id"],{"method":"Espèces"}),range(4)))
        self.assertEqual(self.store.dashboard()["totals"]["receipts_cents"],5500)

    def test_custom_form_snapshot(self):
        config=self.store.config()
        config["templates"][0]["fields"].append({"key":"sleep","label":"Sommeil","kind":"textarea"})
        self.store.settings(config)
        co=self.store.save_consult({"patient_id":self.patient["id"]})
        config["templates"][0]["fields"].pop()
        self.store.settings(config)
        self.assertIn("sleep",[f["key"] for f in self.store.patient(self.patient["id"])["consultations"][0]["fields"]])

    def test_renumber_conflicts_and_reserved_history(self):
        one=self.store.issue(self.draft()["id"],{"method":"CB"})
        two=self.store.issue(self.draft()["id"],{"method":"CB"})
        prefix=one["number"].rsplit("-",1)[0]+"-"
        with self.assertRaises(Problem): self.store.renumber(two["id"],{"number":one["number"],"reason":"Conflit"})
        self.store.renumber(two["id"],{"number":prefix+"9","reason":"Test de reprise"})
        self.store.renumber(two["id"],{"number":prefix+"7","reason":"Autre correction"})
        with self.assertRaises(Problem): self.store.renumber(one["id"],{"number":prefix+"2","reason":"Numéro historique réservé"})
        self.assertEqual(self.store.issue(self.draft()["id"],{"method":"CB"})["sequence"],10)
        self.assertEqual(self.store.dashboard()["totals"]["receipts_cents"],16500)
        self.assertEqual(self.store.history(two["id"])[0]["kind"],"invoice.renumbered")

    def test_renumber_chronological_conflict(self):
        year=dt.date.today().year
        first=self.store.issue(self.draft(f"{year}-01-01")["id"],{"method":"CB"})
        self.store.issue(self.draft(f"{year}-02-01")["id"],{"method":"CB"})
        with self.assertRaises(Problem) as caught:
            self.store.renumber(first["id"],{"number":f"{year%100:02}-01-3","reason":"Mauvais ordre"})
        self.assertEqual(caught.exception.status,409)

    def test_backup_restore_and_tampering(self):
        original=self.store.issue(self.draft()["id"],{"method":"CB"})
        self.store.correct(original["id"],{"field":"address","value":"Adresse fictive corrigée"})
        self.store.add_attachment({"patient_id":self.patient["id"],"name":"exemple.txt","content":"RmFjdGljZQ=="})
        blob=self.store.encrypted_backup("phrase de test très longue")
        target=Store(Path(self.tmp.name)/"restored")
        with self.assertRaises(Problem): target.restore_backup(blob,"incorrecte")
        self.assertEqual(target.patients(),[])
        result=target.restore_backup(blob,"phrase de test très longue")
        self.assertEqual(result["patients"],1)
        self.assertEqual(target.dashboard()["totals"],self.store.dashboard()["totals"])
        for table in ("patients","invoices","payments","audit","attachments"):
            self.assertEqual(target.export_json()[table],self.store.export_json()[table])
        with self.assertRaises(Problem): target.restore_backup(blob,"phrase de test très longue")
        with self.assertRaises(Problem): Store(Path(self.tmp.name)/"damaged").restore_backup(blob[:-1]+bytes([blob[-1]^1]),"phrase de test très longue")

    def test_pdf_and_invalid_format(self):
        inv=self.store.issue(self.draft()["id"],{"method":"CB"})
        pdf=invoice_pdf(inv,None,True)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf),3000)
        patient=self.store.patient(self.patient["id"])
        self.assertTrue(consultation_pdf(patient,patient["consultations"][0],self.store.config()["practice"],True).startswith(b"%PDF"))
        billing=self.store.config()["billing"]
        billing["format"]="{AA}-{MM}-{N}{bad}"
        with self.assertRaises(Problem): self.store.settings({"billing":billing})


class HTTPTests(unittest.TestCase):
    def test_browser_contract_and_mail_attachment(self):
        with tempfile.TemporaryDirectory(prefix="cabinet-http-") as directory:
            server=make_server(directory,0,True)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                url=f"http://127.0.0.1:{server.server_port}"
                def request(path,body=None,headers=None):
                    req=urllib.request.Request(url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers or {})
                    return urllib.request.urlopen(req)
                page=request("/").read().decode()
                token=re.search(r'name="cabinet-token" content="([^"]+)"',page)[1]
                with self.assertRaises(urllib.error.HTTPError) as error: request("/api/patients",{}, {"Content-Type":"application/json"})
                self.assertEqual(error.exception.code,403)
                with self.assertRaises(urllib.error.HTTPError) as error: request("/api/bootstrap",headers={"Host":"malicious.test"})
                self.assertEqual(error.exception.code,403)
                headers={"Content-Type":"application/json","X-Cabinet-Token":token}
                patient=json.load(request("/api/patients"))[0]
                consult=json.load(request("/api/patients/"+patient["id"]))["consultations"][0]
                inv=json.load(request("/api/invoices",{"consultation_id":consult["id"]},headers))
                inv=json.load(request("/api/invoices/"+inv["id"]+"/issue",{"method":"CB"},headers))
                eml=request("/api/invoices/"+inv["id"]+"/email").read()
                message=email.message_from_bytes(eml)
                self.assertEqual(message["X-Unsent"],"1")
                attachments=[p for p in message.walk() if p.get_content_type()=="application/pdf"]
                self.assertEqual(len(attachments),1)
                self.assertTrue(attachments[0].get_payload(decode=True).startswith(b"%PDF"))
                self.assertIsNone(request("/api/invoices/"+inv["id"]+"/pdf?inline=1").headers.get("Content-Disposition"))
            finally:
                server.shutdown();server.server_close();thread.join()

if __name__=="__main__": unittest.main()
