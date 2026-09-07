import argparse
import datetime as dt
import json
import mimetypes
import os
import secrets
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from email.message import EmailMessage
from email.policy import SMTP
from urllib.parse import urlparse, parse_qs, quote

from storage import Store, Problem, dump
from pdf_documents import invoice_pdf, consultation_pdf

ROOT = Path(__file__).resolve().parent
VERSION = "0.4.0"


def default_data_dir():
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()/".local"/"share"))) / "MonCabinetOsteo"


def seed_demo(store):
    if store.patients():
        return
    store.settings({"practice": {"name": "Camille Martin — cabinet de démonstration", "address": "10 rue de Démonstration", "postal": "75000", "city": "Paris", "siret": "DEMONSTRATION", "rpps": "DEMONSTRATION", "footer": "Document fictif destiné à tester le logiciel."}})
    p = store.save_patient({"first_name": "Alex", "last_name": "EXEMPLE", "birth_date": "1987-04-12", "occupation": "Travail sur écran — exemple fictif", "shared_notes": "Dossier de démonstration. Aucun patient réel.\nAntécédents à compléter pendant l’anamnèse.", "important_notes": "Exemple : préférences du patient à relire avant la séance."})
    co = store.save_consult({"patient_id": p["id"]})
    store.save_consult({"version": co["version"], "motif": "Exemple de motif de consultation", "anamnesis": "Zone de saisie libre pour l’anamnèse.\nCes informations sont fictives."}, co["id"])


def make_server(data_dir, port=8765, demo=False):
    store = Store(data_dir, demo)
    if demo:
        seed_demo(store)
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        server_version = "MonCabinetLocal"

        def log_message(self, fmt, *args):
            # No patient identifiers or request bodies in application logs.
            pass

        def respond(self, status, body, content_type="application/json; charset=utf-8", filename=None):
            if not isinstance(body, bytes):
                body = dump(body).encode() if content_type.startswith("application/json") else body.encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if filename:
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename, safe=""))
            self.end_headers()
            self.wfile.write(body)

        def guard(self, writing=False):
            expected = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if self.headers.get("Host") not in expected:
                raise Problem("Hôte non autorisé.", 403)
            if writing:
                if self.headers.get("X-Cabinet-Token") != token:
                    raise Problem("Session expirée : rechargez la page.", 403)
                origin = self.headers.get("Origin")
                if origin and origin not in {"http://"+h for h in expected}:
                    raise Problem("Origine non autorisée.", 403)
                if not self.headers.get("Content-Type", "").startswith("application/json"):
                    raise Problem("Format de requête invalide.", 415)

        def body(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 15*1024*1024:
                    raise Problem("Requête trop volumineuse ou vide.", 413)
                result = json.loads(self.rfile.read(length))
                if not isinstance(result, dict):
                    raise ValueError()
                return result
            except (ValueError, UnicodeDecodeError):
                raise Problem("Les données transmises sont invalides.")

        def do_GET(self):
            try:
                self.guard()
                parsed = urlparse(self.path)
                path = parsed.path
                if path == "/":
                    page = (ROOT/"web"/"index.html").read_text("utf-8").replace("__TOKEN__", token)
                    return self.respond(200, page, "text/html; charset=utf-8")
                if path in ("/app.js", "/mcl.js", "/style.css", "/icon.svg"):
                    p = ROOT/"web"/path[1:]
                    return self.respond(200, p.read_bytes(), {".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".svg":"image/svg+xml"}[p.suffix])
                if path == "/api/health":
                    return self.respond(200, {"app":"mon-cabinet-osteo", "version":VERSION, "demo":demo})
                if path == "/api/bootstrap":
                    return self.respond(200, {"version":VERSION, "demo":demo, "data_dir":str(store.directory), "settings":store.config(), "dashboard":store.dashboard()})
                if path == "/api/patients":
                    query=parse_qs(parsed.query)
                    return self.respond(200, store.patients(query.get("q", [""])[0], query.get("archived")==["1"]))
                parts = path.strip("/").split("/")
                if len(parts)==3 and parts[:2]==["api","patients"]:
                    return self.respond(200, store.patient(parts[2]))
                if path == "/api/invoices":
                    return self.respond(200, store.invoices())
                if path in ("/api/migration/accounting", "/api/migration/orphans", "/api/export/mcl-payments.csv", "/api/export/mcl-corrected.csv"):
                    import accounting_mcl
                    with store.db() as c:
                        if path == "/api/migration/accounting": return self.respond(200, accounting_mcl.summary(c))
                        if path == "/api/migration/orphans": return self.respond(200, accounting_mcl.orphans(c))
                        if path == "/api/export/mcl-corrected.csv": return self.respond(200, accounting_mcl.export_working(c), "text/csv; charset=utf-8", "reglements-MCL-retenus.csv")
                        return self.respond(200, accounting_mcl.export(c), "text/csv; charset=utf-8", "reglements-source-MCL.csv")
                if path == "/api/dashboard":
                    return self.respond(200, store.dashboard())
                if len(parts)==3 and parts[:2]==["api","history"]:
                    return self.respond(200, store.history(parts[2]))
                if path == "/api/export/receipts.csv":
                    return self.respond(200, store.csv(), "text/csv; charset=utf-8", "recettes-cabinet.csv")
                if len(parts)==4 and parts[:2]==["api","invoices"] and parts[3]=="pdf":
                    inv=store.invoice(parts[2]); related=store.invoice(inv["related_id"]) if inv["related_id"] else None
                    return self.respond(200, invoice_pdf(inv, related, demo), "application/pdf", None if parse_qs(parsed.query).get("inline")==["1"] else (inv["number"] or "brouillon")+".pdf")
                if len(parts)==4 and parts[:2]==["api","invoices"] and parts[3]=="email":
                    inv=store.invoice(parts[2])
                    if inv["status"]!="issued" or inv["kind"]!="invoice":
                        raise Problem("Préparez l’email depuis une facture active et émise.")
                    related=store.invoice(inv["related_id"]) if inv["related_id"] else None
                    message=EmailMessage(policy=SMTP)
                    message["X-Unsent"]="1"
                    if inv["recipient"]["email"]: message["To"]=inv["recipient"]["email"]
                    if inv["practice"]["email"]: message["From"]=inv["practice"]["email"]
                    message["Subject"]="Votre facture n°"+inv["number"]
                    message.set_content("Bonjour,\n\nVeuillez trouver ci-joint votre facture.\n\nBien cordialement,\n"+inv["practice"]["name"])
                    message.add_attachment(invoice_pdf(inv,related,demo),maintype="application",subtype="pdf",filename="facture-"+inv["number"]+".pdf")
                    return self.respond(200,message.as_bytes(),"message/rfc822","facture-"+inv["number"]+".eml")
                if len(parts)==4 and parts[:2]==["api","consultations"] and parts[3]=="pdf":
                    with store.db() as c:
                        co=store.decode_consult(store.one(c,"consultations",parts[2]))
                    return self.respond(200, consultation_pdf(store.patient(co["patient_id"]), co, store.config()["practice"], demo), "application/pdf", "compte-rendu-"+co["date"]+".pdf")
                if len(parts)==3 and parts[:2]==["api","attachments"]:
                    with store.db() as c:
                        attachment=store.one(c,"attachments",parts[2])
                    return self.respond(200, attachment["content"], "application/octet-stream", attachment["name"])
                raise Problem("Page introuvable.",404)
            except Problem as error:
                self.respond(error.status,{"error":str(error)})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                print(type(error).__name__, file=sys.stderr, flush=True)
                self.respond(500,{"error":"Une erreur locale est survenue. Vos données déjà enregistrées sont conservées."})

        def do_POST(self):
            try:
                self.guard(True)
                body=self.body(); path=urlparse(self.path).path
                parts=path.strip("/").split("/")
                if len(parts)==4 and parts[:2]==['api','accounting']:
                    import accounting_mcl
                    result=accounting_mcl.edit_record(store,parts[2],parts[3],body)
                elif path=="/api/settings": result=store.settings(body)
                elif path=="/api/patients": result=store.save_patient(body)
                elif len(parts)==3 and parts[:2]==["api","patients"]: result=store.save_patient(body,parts[2])
                elif path=="/api/consultations": result=store.save_consult(body)
                elif len(parts)==3 and parts[:2]==["api","consultations"]: result=store.save_consult(body,parts[2])
                elif path=="/api/antecedents": result=store.add_antecedent(body)
                elif len(parts)==4 and parts[:2]==["api","antecedents"] and parts[3]=="delete": result=store.remove_antecedent(parts[2])
                elif path=="/api/attachments": result=store.add_attachment(body)
                elif path=="/api/invoices": result=store.draft(body)
                elif len(parts)==3 and parts[:2]==["api","invoices"]: result=store.draft(body,parts[2])
                elif len(parts)==4 and parts[:2]==["api","invoices"]:
                    actions={"issue":store.issue,"pay":store.pay,"correct":store.correct,"renumber":store.renumber}
                    if parts[3]=="delete": result=store.delete_draft(parts[2])
                    elif parts[3] in actions: result=actions[parts[3]](parts[2],body)
                    else: raise Problem("Action inconnue.",404)
                elif path=="/api/backup":
                    return self.respond(200,store.encrypted_backup(body.get("password")),"application/octet-stream","cabinet-"+dt.date.today().isoformat()+".mco")
                else: raise Problem("Action inconnue.",404)
                self.respond(200,result)
            except Problem as error:
                self.respond(error.status,{"error":str(error)})
            except sqlite3.IntegrityError:
                self.respond(409,{"error":"Cette opération crée un doublon ou un conflit. Actualisez la liste avant de réessayer."})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                print(type(error).__name__,file=sys.stderr,flush=True)
                self.respond(500,{"error":"L’opération n’a pas abouti. Aucune modification partielle n’a été conservée."})

    server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
    server.daemon_threads=True
    return server


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--data-dir",type=Path,default=default_data_dir())
    parser.add_argument("--port",type=int,default=8765)
    parser.add_argument("--demo",action="store_true")
    args=parser.parse_args()
    if "onedrive" in str(args.data_dir.resolve()).lower():
        parser.error("La base doit être placée hors de OneDrive.")
    server=make_server(args.data_dir,args.port,args.demo)
    print(f"Mon Cabinet d’Ostéo — http://127.0.0.1:{server.server_port}",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
