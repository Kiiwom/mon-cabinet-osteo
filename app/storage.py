"""Local persistence and transactional billing for Mon Cabinet d'Ostéo."""
import base64
import contextlib
import csv
import datetime as dt
import io
import json
import re
import sqlite3
import unicodedata
import uuid
from pathlib import Path


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def uid():
    return uuid.uuid4().hex


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def fold(value):
    return "".join(c for c in unicodedata.normalize("NFD", str(value).lower()) if unicodedata.category(c) != "Mn")


def text(value, limit=100000):
    if not isinstance(value, str) or len(value) > limit:
        raise Problem("Texte invalide ou trop long.")
    return value.strip()


def date(value):
    try:
        return dt.date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise Problem("Date invalide.")


def integer(value, lo, hi, label="Valeur"):
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise Problem(f"{label} doit être compris entre {lo} et {hi}.")
    return value


def money_lines(lines):
    if not isinstance(lines, list) or not 1 <= len(lines) <= 30:
        raise Problem("Ajoutez au moins une prestation.")
    result = []
    for line in lines:
        label = text(line.get("label", ""), 300)
        if not label:
            raise Problem("Le libellé de prestation est obligatoire.")
        qty = integer(line.get("quantity"), 1, 100, "Quantité")
        cents = integer(line.get("unit_cents"), 0, 10000000, "Prix en centimes")
        result.append({"label": label, "quantity": qty, "unit_cents": cents})
    return result


BASE_FIELDS = [
    {"key": "motif", "label": "Motif de consultation", "kind": "textarea"},
    {"key": "anamnesis", "label": "Anamnèse", "kind": "textarea"},
]
DATA_TABLES = ("patients", "consultations", "antecedents", "invoices", "payments", "audit", "attachments", "import_runs", "source_records", "migration_links", "legacy_documents", "legacy_payments", "accounting_edits")
DEFAULTS = {
    "migration": {"state": "none", "reserved_numbers": {}},
    "practice": {"name": "", "address": "", "postal": "", "city": "", "email": "", "phone": "", "siret": "", "rpps": "", "footer": "", "tax_note": ""},
    "billing": {"format": "{AA}-{MM}-{N}", "padding": 0, "initial_sequence": 1, "initial_year": dt.date.today().year, "default_cents": 5500, "default_label": "Consultation d’ostéopathie"},
    "templates": [{"id": "adult", "name": "Adulte", "fields": BASE_FIELDS}, {"id": "pregnancy", "name": "Grossesse", "fields": BASE_FIELDS}, {"id": "baby", "name": "Nourrisson", "fields": BASE_FIELDS}],
}


class Store:
    def __init__(self, directory, demo=False):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "cabinet.sqlite3"
        self.demo = demo
        with self.db() as c:
            c.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS patients (
                  id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
                  birth_date TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '',
                  phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
                  postal TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', occupation TEXT NOT NULL DEFAULT '',
                  activities TEXT NOT NULL DEFAULT '', shared_notes TEXT NOT NULL DEFAULT '',
                  important_notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
                  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS consultations (
                  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), date TEXT NOT NULL,
                  motif TEXT NOT NULL DEFAULT '', anamnesis TEXT NOT NULL DEFAULT '', followup TEXT NOT NULL DEFAULT '',
                  billable INTEGER NOT NULL DEFAULT 1, template_id TEXT NOT NULL,
                  fields TEXT NOT NULL, custom TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS consultations_patient ON consultations(patient_id,date);
                CREATE TABLE IF NOT EXISTS antecedents (
                  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
                  category TEXT NOT NULL, label TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
                  since TEXT NOT NULL DEFAULT '', important INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS attachments (
                  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
                  name TEXT NOT NULL, mime TEXT NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS invoices (
                  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
                  consultation_id TEXT REFERENCES consultations(id), kind TEXT NOT NULL DEFAULT 'invoice',
                  status TEXT NOT NULL DEFAULT 'draft', number TEXT UNIQUE, year INTEGER, sequence INTEGER,
                  date TEXT NOT NULL, recipient TEXT NOT NULL, practice TEXT NOT NULL, lines TEXT NOT NULL,
                  total_cents INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '',
                  related_id TEXT REFERENCES invoices(id), corrected_by TEXT REFERENCES invoices(id),
                  reason TEXT NOT NULL DEFAULT '', payment_snapshot TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
                  UNIQUE(year,sequence));
                CREATE UNIQUE INDEX IF NOT EXISTS active_consultation_invoice ON invoices(consultation_id)
                  WHERE kind='invoice' AND status IN ('draft','issued') AND consultation_id IS NOT NULL;
                CREATE TABLE IF NOT EXISTS payments (
                  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
                  cents INTEGER NOT NULL CHECK(cents>=0), method TEXT NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audit (
                  id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL,
                  before_json TEXT, after_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS import_runs (
                  id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS source_records (
                  import_id TEXT NOT NULL REFERENCES import_runs(id), table_name TEXT NOT NULL, ordinal INTEGER NOT NULL,
                  payload TEXT NOT NULL, PRIMARY KEY(import_id,table_name,ordinal));
                CREATE TABLE IF NOT EXISTS migration_links (
                  source TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, local_id TEXT NOT NULL,
                  PRIMARY KEY(source,kind,source_id));
                CREATE TABLE IF NOT EXISTS legacy_documents (
                  id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES import_runs(id),
                  ordinal INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(import_id,ordinal));
                CREATE TABLE IF NOT EXISTS legacy_payments (
                  id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES import_runs(id), ordinal INTEGER NOT NULL,
                  invoice_id TEXT REFERENCES legacy_documents(id), payload TEXT NOT NULL, UNIQUE(import_id,ordinal));
                CREATE TABLE IF NOT EXISTS accounting_edits (
                  kind TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL,
                  payload TEXT NOT NULL, PRIMARY KEY(kind,entity_id));
                PRAGMA user_version=4;
            """)
            for key, value in DEFAULTS.items():
                c.execute("INSERT OR IGNORE INTO settings VALUES (?,?)", (key, dump(value)))

    @contextlib.contextmanager
    def db(self, write=False):
        c = sqlite3.connect(self.path, timeout=15)
        c.row_factory = sqlite3.Row
        c.create_function("fold", 1, fold)
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA busy_timeout=15000")
        try:
            if write:
                c.execute("BEGIN IMMEDIATE")
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    def log(self, c, kind, entity, after, before=None):
        c.execute("INSERT INTO audit(at,kind,entity_id,before_json,after_json) VALUES (?,?,?,?,?)", (now(), kind, entity, dump(before) if before is not None else None, dump(after)))

    def one(self, c, table, key):
        # table names are supplied only by application code.
        row = c.execute(f"SELECT * FROM {table} WHERE id=?", (key,)).fetchone()
        if not row:
            raise Problem("Cet élément n’existe plus.", 404)
        return dict(row)

    def config(self, c=None):
        if c is None:
            with self.db() as conn:
                return self.config(conn)
        return {r["key"]: json.loads(r["value"]) for r in c.execute("SELECT * FROM settings")}

    def settings(self, body):
        current = self.config()
        if "practice" in body:
            current["practice"] = {k: text(body["practice"].get(k, ""), 2000) for k in DEFAULTS["practice"]}
        if "billing" in body:
            b = body["billing"]
            fmt = text(b.get("format", ""), 60)
            if "{N}" not in fmt or not ("{AA}" in fmt or "{AAAA}" in fmt):
                raise Problem("Le format doit contenir {N} et {AA} ou {AAAA}.")
            if not re.fullmatch(r"(?:[A-Za-z0-9 _./-]|\{(?:AA|AAAA|MM|N)\})+", fmt) or fmt.count("{N}") != 1:
                raise Problem("Format invalide. Variables autorisées : {AA}, {AAAA}, {MM}, {N}.")
            current["billing"] = {"format": fmt, "padding": integer(b.get("padding", 0), 0, 8), "initial_sequence": integer(b.get("initial_sequence", 1), 1, 99999999), "initial_year": current["billing"].get("initial_year", dt.date.today().year), "default_cents": integer(b.get("default_cents", 5500), 0, 10000000), "default_label": text(b.get("default_label", "Consultation"), 300)}
        if "templates" in body:
            templates = body["templates"]
            if not isinstance(templates, list) or not 1 <= len(templates) <= 20:
                raise Problem("Conservez au moins un formulaire.")
            checked = []
            for t in templates:
                if not t.get("name") or not re.fullmatch(r"[a-zA-Z0-9_-]{1,60}", t.get("id", "")):
                    raise Problem("Nom ou identifiant du formulaire invalide.")
                fields = []
                for f in t.get("fields", []):
                    if f.get("key") in ("motif", "anamnesis"):
                        continue
                    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,60}", f.get("key", "")) or f.get("kind") not in ("textarea", "text", "checkbox", "select"):
                        raise Problem("Champ de formulaire invalide.")
                    fields.append({"key": f["key"], "kind": f["kind"], "label": text(f.get("label", "Champ"), 150), "options": [text(x, 100) for x in f.get("options", [])][:40]})
                if len(fields) > 30 or len({f["key"] for f in fields}) != len(fields):
                    raise Problem("Trop de champs ou identifiants dupliqués.")
                checked.append({"id": t["id"], "name": text(t["name"], 100), "fields": BASE_FIELDS + fields})
            if len({t["id"] for t in checked}) != len(checked):
                raise Problem("Les formulaires doivent avoir des identifiants différents.")
            current["templates"] = checked
        with self.db(True) as c:
            before = self.config(c)
            for k, v in current.items():
                c.execute("UPDATE settings SET value=? WHERE key=?", (dump(v), k))
            self.log(c, "settings", "cabinet", current, before)
        return current

    PATIENT_FIELDS = ["first_name", "last_name", "birth_date", "gender", "phone", "email", "address", "postal", "city", "occupation", "activities", "shared_notes", "important_notes"]

    def save_patient(self, body, key=None):
        with self.db(True) as c:
            before = self.one(c, "patients", key) if key else None
            if before and body.get("version") != before["version"]:
                raise Problem("Cette fiche a changé dans un autre onglet. Copiez votre texte puis rechargez la fiche.", 409)
            values = {k: text(body.get(k, before[k] if before else ""), 100000 if "notes" in k else 1000) for k in self.PATIENT_FIELDS}
            if (not before or "first_name" in body or "last_name" in body) and (not values["first_name"] or not values["last_name"]):
                raise Problem("Le nom et le prénom sont obligatoires.")
            if (not before or "birth_date" in body) and values["birth_date"]:
                date(values["birth_date"])
                if values["birth_date"] > dt.date.today().isoformat():
                    raise Problem("La date de naissance est dans le futur.")
            if (not before or "email" in body) and values["email"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values["email"]):
                raise Problem("L’adresse email est invalide.")
            if values["gender"] not in ("", "F", "M", "X"):
                raise Problem("Civilité invalide.")
            if before:
                c.execute("UPDATE patients SET " + ",".join(f"{k}=?" for k in values) + ",version=version+1,updated_at=? WHERE id=?", (*values.values(), now(), key))
            else:
                key = uid()
                c.execute("INSERT INTO patients(id," + ",".join(values) + ",created_at,updated_at) VALUES (" + ",".join("?" for _ in range(len(values)+3)) + ")", (key, *values.values(), now(), now()))
            after = self.one(c, "patients", key)
            self.log(c, "patient.updated" if before else "patient.created", key, after, before)
            return after

    def patients(self, query="", include_archived=False):
        terms = fold(query).split()
        where, args = [], []
        for term in terms[:8]:
            where.append("fold(last_name||' '||first_name||' '||phone||' '||email||' '||city) LIKE ? ESCAPE '\\'")
            args.append("%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        with self.db() as c:
            rows = c.execute("SELECT p.*, (SELECT MAX(date) FROM consultations WHERE patient_id=p.id) last_visit, (SELECT COUNT(*) FROM consultations WHERE patient_id=p.id) visits FROM patients p WHERE " + ("1=1" if include_archived else "archived=0") + (" AND " + " AND ".join(where) if where else "") + " ORDER BY last_name COLLATE NOCASE,first_name LIMIT 500", args)
            return [dict(r) for r in rows]

    def patient(self, key):
        with self.db() as c:
            p = self.one(c, "patients", key)
            p["consultations"] = [self.decode_consult(dict(r)) for r in c.execute("SELECT * FROM consultations WHERE patient_id=? ORDER BY date DESC,created_at DESC", (key,))]
            billed = {r[0] for r in c.execute("SELECT local_id FROM migration_links WHERE kind='billed_consultation'")}
            for consultation in p["consultations"]:
                consultation["legacy_billed"] = consultation["id"] in billed
            p["antecedents"] = [dict(r) for r in c.execute("SELECT * FROM antecedents WHERE patient_id=? ORDER BY important DESC,created_at DESC", (key,))]
            p["attachments"] = [dict(r) for r in c.execute("SELECT id,name,mime,length(content) size,created_at FROM attachments WHERE patient_id=? ORDER BY created_at DESC", (key,))]
            p["invoices"] = self.invoices(c, key)
            return p

    def decode_consult(self, row):
        row["fields"] = json.loads(row["fields"])
        row["custom"] = json.loads(row["custom"])
        row["billable"] = bool(row["billable"])
        return row

    def save_consult(self, body, key=None):
        with self.db(True) as c:
            before = self.one(c, "consultations", key) if key else None
            if before and body.get("version") != before["version"]:
                raise Problem("La consultation a changé dans un autre onglet. Copiez votre texte puis rechargez.", 409)
            if before:
                values = {k: text(body.get(k, before[k])) for k in ("motif", "anamnesis", "followup")}
                values["billable"] = int(bool(body.get("billable", before["billable"])))
                if not values["billable"] and c.execute("SELECT 1 FROM invoices WHERE consultation_id=? AND status IN ('draft','issued')", (key,)).fetchone():
                    raise Problem("Une facture est liée à cette séance. Supprimez son brouillon pour désactiver Facturer ; une facture émise conserve son lien de facturation.")
                custom = body.get("custom", json.loads(before["custom"]))
                if not isinstance(custom, dict) or len(dump(custom)) > 100000:
                    raise Problem("Champs complémentaires invalides.")
                values["custom"] = dump(custom)
                c.execute("UPDATE consultations SET " + ",".join(f"{k}=?" for k in values) + ",version=version+1,updated_at=? WHERE id=?", (*values.values(), now(), key))
            else:
                pid = body.get("patient_id")
                self.one(c, "patients", pid)
                templates = self.config(c)["templates"]
                template = next((t for t in templates if t["id"] == body.get("template_id")), templates[0])
                key = uid()
                c.execute("INSERT INTO consultations(id,patient_id,date,template_id,fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", (key, pid, date(body.get("date", dt.date.today().isoformat())), template["id"], dump(template["fields"]), now(), now()))
            after = self.one(c, "consultations", key)
            self.log(c, "consultation.updated" if before else "consultation.created", key, after, before)
            return self.decode_consult(after)

    def add_antecedent(self, body):
        pid, key = body.get("patient_id"), uid()
        label = text(body.get("label", ""), 300)
        if not label:
            raise Problem("Indiquez l’antécédent.")
        with self.db(True) as c:
            self.one(c, "patients", pid)
            c.execute("INSERT INTO antecedents VALUES (?,?,?,?,?,?,?,?)", (key, pid, text(body.get("category", "Autre"), 100), label, text(body.get("detail", "")), text(body.get("since", ""), 100), int(bool(body.get("important"))), now()))
            result = self.one(c, "antecedents", key)
            self.log(c, "antecedent.created", key, result)
            return result

    def remove_antecedent(self, key):
        with self.db(True) as c:
            before = self.one(c, "antecedents", key)
            c.execute("DELETE FROM antecedents WHERE id=?", (key,))
            self.log(c, "antecedent.deleted", key, {}, before)
        return {"ok": True}

    def add_attachment(self, body):
        name = Path(text(body.get("name", "document"), 200).replace("\\", "/")).name
        allowed = {".pdf", ".png", ".jpg", ".jpeg", ".txt", ".docx", ".xlsx", ".mp3", ".m4a"}
        if Path(name).suffix.lower() not in allowed:
            raise Problem("Format accepté : PDF, image, texte, DOCX, XLSX ou audio MP3/M4A.")
        try:
            data = base64.b64decode(body.get("content", ""), validate=True)
        except (ValueError, TypeError):
            raise Problem("Le fichier n’a pas pu être lu.")
        if not 0 < len(data) <= 10*1024*1024:
            raise Problem("La taille du fichier doit être comprise entre 1 octet et 10 Mo.")
        key = uid()
        with self.db(True) as c:
            self.one(c, "patients", body.get("patient_id"))
            c.execute("INSERT INTO attachments VALUES (?,?,?,?,?,?)", (key, body["patient_id"], name, "application/octet-stream", data, now()))
            self.log(c, "attachment.created", key, {"name": name, "size": len(data)})
        return {"id": key, "name": name}

    def invoice_row(self, c, row):
        r = dict(row)
        for key in ("recipient", "practice", "lines", "payment_snapshot"):
            r[key] = json.loads(r[key])
        r["paid_cents"] = c.execute("SELECT COALESCE(SUM(cents),0) FROM payments WHERE invoice_id=?", (r["id"],)).fetchone()[0]
        r["payments"] = [dict(p) for p in c.execute("SELECT * FROM payments WHERE invoice_id=?", (r["id"],))]
        return r

    def invoices(self, c=None, patient_id=None):
        if c is None:
            with self.db() as conn:
                return self.invoices(conn, patient_id)
        rows = c.execute("SELECT * FROM invoices" + (" WHERE patient_id=?" if patient_id else "") + " ORDER BY date DESC,created_at DESC,sequence DESC", (patient_id,) if patient_id else ())
        result = [self.invoice_row(c, r) for r in rows]
        if patient_id is None:
            from accounting_mcl import invoices
            result.extend(invoices(c))
            result.sort(key=lambda r: (r['date'], r.get('number') or ''), reverse=True)
        return result

    def invoice(self, key):
        with self.db() as c:
            return self.invoice_row(c, self.one(c, "invoices", key))

    def recipient(self, value):
        result = {k: text(value.get(k, ""), 1000) for k in ("first_name", "last_name", "gender", "address", "postal", "city", "email")}
        if not result["last_name"]:
            raise Problem("Le nom du destinataire est obligatoire.")
        if result["gender"] not in ("", "F", "M", "X"):
            raise Problem("Civilité invalide.")
        return result

    def draft(self, body, key=None):
        with self.db(True) as c:
            previous = self.one(c, "invoices", key) if key else None
            if previous and previous["status"] != "draft":
                raise Problem("Utilisez Corriger pour une facture émise.", 409)
            consult = self.one(c, "consultations", previous["consultation_id"] if previous else body.get("consultation_id"))
            if c.execute("SELECT 1 FROM migration_links WHERE kind='billed_consultation' AND local_id=?", (consult["id"],)).fetchone():
                raise Problem("Cette séance a déjà été facturée dans MonCabinetLibéral. Son historique financier est conservé pour la suite de la migration.", 409)
            if not consult["billable"]:
                raise Problem("Activez Facturer dans cette consultation pour préparer une facture.")
            patient = self.one(c, "patients", consult["patient_id"])
            config = self.config(c)
            recipient = self.recipient(body.get("recipient", json.loads(previous["recipient"]) if previous else patient))
            lines = money_lines(body.get("lines", json.loads(previous["lines"]) if previous else [{"label": config["billing"]["default_label"], "quantity": 1, "unit_cents": config["billing"]["default_cents"]}]))
            total = sum(l["quantity"] * l["unit_cents"] for l in lines)
            day = date(body.get("date", previous["date"] if previous else dt.date.today().isoformat()))
            comment = text(body.get("comment", previous["comment"] if previous else ""), 5000)
            if previous:
                c.execute("UPDATE invoices SET date=?,recipient=?,practice=?,lines=?,total_cents=?,comment=? WHERE id=?", (day, dump(recipient), dump(config["practice"]), dump(lines), total, comment, key))
            else:
                existing = c.execute("SELECT * FROM invoices WHERE consultation_id=? AND status IN ('draft','issued')", (consult["id"],)).fetchone()
                if existing:
                    return self.invoice_row(c, existing)
                key = uid()
                c.execute("INSERT INTO invoices(id,patient_id,consultation_id,date,recipient,practice,lines,total_cents,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (key, patient["id"], consult["id"], day, dump(recipient), dump(config["practice"]), dump(lines), total, comment, now()))
            self.log(c, "invoice.draft", key, {"total_cents": total, "recipient": recipient}, previous)
            return self.invoice_row(c, self.one(c, "invoices", key))

    def next_number(self, c, day):
        year = int(day[:4])
        b = self.config(c)["billing"]
        last = c.execute("SELECT MAX(sequence),MAX(date) FROM invoices WHERE year=?", (year,)).fetchone()
        if last[1] and day < last[1]:
            raise Problem("Cette date précède une facture déjà émise dans l’année. Vérifiez l’ordre chronologique.", 409)
        seq = last[0]+1 if last[0] is not None else (b["initial_sequence"] if year == b.get("initial_year", dt.date.today().year) else 1)
        reserved = self.config(c).get("migration", {}).get("reserved_numbers", {}).get(str(year), {})
        if reserved.get("last_date") and day < reserved["last_date"]:
            raise Problem("Cette date précède une facture de l’historique MonCabinetLibéral.", 409)
        seq = max(seq, reserved.get("max_sequence", 0)+1)
        for event in c.execute("SELECT before_json FROM audit WHERE kind='invoice.renumbered'"):
            old = json.loads(event[0])
            if old["year"] == year:
                seq = max(seq, old["sequence"]+1)
        number = b["format"].replace("{AAAA}", str(year)).replace("{AA}", day[2:4]).replace("{MM}", day[5:7]).replace("{N}", str(seq).zfill(b["padding"]))
        return number, year, seq

    def issue(self, key, body):
        with self.db(True) as c:
            row = self.one(c, "invoices", key)
            if row["status"] != "draft":
                # Safe retry: never allocate a second number or payment.
                return self.invoice_row(c, row)
            practice = self.config(c)["practice"]
            if not all(practice[k] for k in ("name", "address", "postal", "city", "siret", "rpps")):
                raise Problem("Complétez le nom, l’adresse, le SIRET et le RPPS du cabinet dans les paramètres avant émission.")
            number, year, seq = self.next_number(c, row["date"])
            method = body.get("method", "")
            if method not in ("Espèces", "Chèque", "CB", "En attente"):
                raise Problem("Choisissez un moyen de paiement.")
            c.execute("UPDATE invoices SET status='issued',number=?,year=?,sequence=?,practice=? WHERE id=?", (number, year, seq, dump(practice), key))
            if method != "En attente" and row["total_cents"]:
                c.execute("INSERT INTO payments VALUES (?,?,?,?,?,?)", (uid(), key, row["total_cents"], method, row["date"], now()))
            c.execute("UPDATE invoices SET payment_snapshot=? WHERE id=?", (dump([dict(p) for p in c.execute("SELECT * FROM payments WHERE invoice_id=?", (key,))]), key))
            self.log(c, "invoice.issued", key, {"number": number, "method": method, "total_cents": row["total_cents"]})
            return self.invoice_row(c, self.one(c, "invoices", key))

    def pay(self, key, body):
        with self.db(True) as c:
            row = self.invoice_row(c, self.one(c, "invoices", key))
            if row["status"] != "issued" or row["kind"] != "invoice":
                raise Problem("Cette facture ne peut pas recevoir de règlement.")
            remaining = row["total_cents"] - row["paid_cents"]
            if remaining <= 0:
                return row
            method = body.get("method")
            if method not in ("Espèces", "Chèque", "CB"):
                raise Problem("Moyen de paiement invalide.")
            c.execute("INSERT INTO payments VALUES (?,?,?,?,?,?)", (uid(), key, remaining, method, dt.date.today().isoformat(), now()))
            c.execute("UPDATE invoices SET payment_snapshot=? WHERE id=?", (dump([dict(p) for p in c.execute("SELECT * FROM payments WHERE invoice_id=?", (key,))]), key))
            self.log(c, "payment.created", key, {"method": method, "cents": remaining})
            return self.invoice_row(c, self.one(c, "invoices", key))

    def delete_draft(self, key):
        with self.db(True) as c:
            row = self.one(c, "invoices", key)
            if row["status"] != "draft":
                raise Problem("Seul un brouillon peut être supprimé.")
            c.execute("DELETE FROM invoices WHERE id=?", (key,))
            self.log(c, "invoice.draft.deleted", key, {}, row)
        return {"ok": True}

    def correct(self, key, body):
        field = body.get("field")
        if field not in ("last_name", "first_name", "address", "postal", "city", "gender"):
            raise Problem("Choisissez le champ à corriger.")
        value = text(body.get("value", ""), 1000)
        reason = text(body.get("reason", "Correction des coordonnées"), 1000)
        with self.db(True) as c:
            old = self.one(c, "invoices", key)
            if old["corrected_by"]:
                return {"invoice": self.invoice_row(c, self.one(c, "invoices", old["corrected_by"])), "already_done": True}
            if old["status"] != "issued" or old["kind"] != "invoice":
                raise Problem("Seule une facture émise peut être corrigée ici.")
            rec = json.loads(old["recipient"])
            if rec.get(field) == value:
                raise Problem("La valeur est identique ; aucune correction nécessaire.")
            rec[field] = value
            rec = self.recipient(rec)
            day = dt.date.today().isoformat()
            credit_id, replacement_id = uid(), uid()
            # A credit balances the historical original; only the replacement remains active.
            num, year, seq = self.next_number(c, day)
            c.execute("INSERT INTO invoices(id,patient_id,kind,status,number,year,sequence,date,recipient,practice,lines,total_cents,comment,related_id,reason,created_at) VALUES (?,?, 'credit','issued',?,?,?,?,?,?,?,?,?,?,?,?)", (credit_id, old["patient_id"], num, year, seq, day, old["recipient"], old["practice"], old["lines"], -old["total_cents"], "Correction de " + old["number"], key, reason, now()))
            c.execute("UPDATE invoices SET status='replaced' WHERE id=?", (key,))
            num2, year2, seq2 = self.next_number(c, day)
            c.execute("INSERT INTO invoices(id,patient_id,consultation_id,kind,status,number,year,sequence,date,recipient,practice,lines,total_cents,comment,related_id,reason,created_at) VALUES (?,?,?,'invoice','issued',?,?,?,?,?,?,?,?,?,?,?,?)", (replacement_id, old["patient_id"], old["consultation_id"], num2, year2, seq2, day, dump(rec), old["practice"], old["lines"], old["total_cents"], old["comment"], key, reason, now()))
            c.execute("UPDATE payments SET invoice_id=? WHERE invoice_id=?", (replacement_id, key))
            c.execute("UPDATE invoices SET corrected_by=? WHERE id=?", (replacement_id, key))
            c.execute("UPDATE invoices SET payment_snapshot=? WHERE id=?", (old["payment_snapshot"], replacement_id))
            self.log(c, "invoice.corrected", key, {"credit_id": credit_id, "replacement_id": replacement_id, "field": field, "value": value, "reason": reason}, {"recipient": json.loads(old["recipient"]), "number": old["number"]})
            return {"invoice": self.invoice_row(c, self.one(c, "invoices", replacement_id)), "credit": self.invoice_row(c, self.one(c, "invoices", credit_id))}

    def dashboard(self):
        today = dt.date.today().isoformat()
        with self.db() as c:
            totals = {"patients": c.execute("SELECT COUNT(*) FROM patients WHERE archived=0").fetchone()[0], "consultations": c.execute("SELECT COUNT(*) FROM consultations").fetchone()[0], "today": c.execute("SELECT COUNT(*) FROM consultations WHERE date=?", (today,)).fetchone()[0], "receipts_cents": c.execute("SELECT COALESCE(SUM(cents),0) FROM payments").fetchone()[0]}
            pending = [dict(r) for r in c.execute("SELECT co.id,co.patient_id,co.date,co.motif,p.first_name,p.last_name FROM consultations co JOIN patients p ON p.id=co.patient_id WHERE billable=1 AND NOT EXISTS (SELECT 1 FROM migration_links ml WHERE ml.kind='billed_consultation' AND ml.local_id=co.id) AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.consultation_id=co.id AND i.status IN ('draft','issued')) ORDER BY co.date DESC")]
            recent = [dict(r) for r in c.execute("SELECT co.id,co.patient_id,co.date,co.motif,p.first_name,p.last_name FROM consultations co JOIN patients p ON p.id=co.patient_id ORDER BY co.updated_at DESC LIMIT 12")]
            monthly = [dict(r) for r in c.execute("SELECT substr(date,1,7) month,COUNT(*) count FROM consultations GROUP BY month ORDER BY month DESC LIMIT 12")]
            payments = [dict(r) for r in c.execute("SELECT substr(date,1,7) month,SUM(cents) cents FROM payments GROUP BY month ORDER BY month DESC LIMIT 12")]
            methods = [dict(r) for r in c.execute("SELECT method,SUM(cents) cents FROM payments GROUP BY method")]
            return {"totals": totals, "pending": pending, "recent": recent, "monthly": monthly, "payments": payments, "methods": methods}

    def history(self, entity):
        with self.db() as c:
            return [dict(r) for r in c.execute("SELECT id,at,kind,before_json,after_json FROM audit WHERE entity_id=? ORDER BY id DESC LIMIT 100", (entity,))]

    def renumber(self, key, body):
        number = text(body.get("number", ""), 60)
        reason = text(body.get("reason", ""), 1000)
        if not reason:
            raise Problem("Indiquez le motif du changement de numéro.")
        with self.db(True) as c:
            row = self.one(c, "invoices", key)
            if row["status"] != "issued" or row["kind"] != "invoice":
                raise Problem("Choisissez une facture active et émise.")
            if number == row["number"]:
                return self.invoice_row(c, row)
            b = self.config(c)["billing"]
            fixed = b["format"].replace("{AAAA}", row["date"][:4]).replace("{AA}", row["date"][2:4]).replace("{MM}", row["date"][5:7])
            match = re.fullmatch(re.escape(fixed).replace(re.escape("{N}"), r"([0-9]+)"), number)
            if not match:
                raise Problem("Le numéro doit respecter le format choisi et la date de cette facture.")
            seq = integer(int(match[1]), 1, 99999999)
            reserved = self.config(c).get("migration", {}).get("reserved_numbers", {}).get(str(row["year"]), {})
            if seq <= reserved.get("max_sequence", 0):
                raise Problem("Ce compteur est réservé à l’historique MonCabinetLibéral.", 409)
            if fixed.replace("{N}", str(seq).zfill(b["padding"])) != number:
                raise Problem("Le nombre de chiffres ne correspond pas au format choisi.")
            if c.execute("SELECT 1 FROM invoices WHERE id<>? AND (number=? OR (year=? AND sequence=?))", (key, number, row["year"], seq)).fetchone():
                raise Problem("Conflit : ce numéro ou ce compteur est déjà utilisé.", 409)
            for change in c.execute("SELECT before_json FROM audit WHERE kind='invoice.renumbered'"):
                old = json.loads(change[0])
                if old["number"] == number or (old["year"] == row["year"] and old["sequence"] == seq):
                    raise Problem("Ce numéro figure déjà dans l’historique d’une facture.", 409)
            conflict = c.execute("SELECT number FROM invoices WHERE id<>? AND year=? AND ((date<? AND sequence>=?) OR (date>? AND sequence<=?))", (key, row["year"], row["date"], seq, row["date"], seq)).fetchone()
            if conflict:
                raise Problem("Conflit d’ordre chronologique avec le document "+conflict[0]+".", 409)
            c.execute("UPDATE invoices SET number=?,sequence=? WHERE id=?", (number, seq, key))
            self.log(c, "invoice.renumbered", key, {"number": number, "sequence": seq, "reason": reason}, {"number": row["number"], "year": row["year"], "sequence": row["sequence"]})
            return self.invoice_row(c, self.one(c, "invoices", key))

    def export_json(self):
        with self.db() as c:
            c.execute("BEGIN")
            result = {"format": "mon-cabinet-osteo", "version": 1, "exported_at": now(), "settings": self.config(c)}
            for table in DATA_TABLES:
                rows = [dict(r) for r in c.execute(f"SELECT * FROM {table}")]
                if table == "attachments":
                    for row in rows:
                        row["content"] = base64.b64encode(row["content"]).decode()
                result[table] = rows
            return result

    def encrypted_backup(self, password):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
        import os
        if not isinstance(password, str) or len(password) < 12:
            raise Problem("Choisissez une phrase de sauvegarde d’au moins 12 caractères.")
        salt, nonce = os.urandom(16), os.urandom(12)
        key = Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(password.encode())
        header = b"MCO-BACKUP-1\n"
        return header + salt + nonce + AESGCM(key).encrypt(nonce, dump(self.export_json()).encode(), header)

    def restore_backup(self, blob, password):
        """Restore an authenticated snapshot into an empty cabinet, atomically."""
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
        header = b"MCO-BACKUP-1\n"
        if not blob.startswith(header) or len(blob) < len(header)+44:
            raise Problem("Ce fichier n’est pas une sauvegarde du cabinet.")
        offset = len(header)
        salt, nonce = blob[offset:offset+16], blob[offset+16:offset+28]
        key = Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(password.encode())
        try:
            data = json.loads(AESGCM(key).decrypt(nonce, blob[offset+28:], header))
        except (InvalidTag, ValueError):
            raise Problem("Phrase incorrecte ou sauvegarde endommagée.")
        if data.get("format") != "mon-cabinet-osteo" or data.get("version") != 1:
            raise Problem("Version de sauvegarde non reconnue.")
        tables = DATA_TABLES
        with self.db(True) as c:
            if any(c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables):
                raise Problem("La restauration nécessite un cabinet vide. Choisissez un nouveau dossier.", 409)
            c.execute("PRAGMA defer_foreign_keys=ON")
            for table in tables:
                columns = [row[1] for row in c.execute(f"PRAGMA table_info({table})")]
                for row in data.get(table, []):
                    if set(row) != set(columns):
                        raise Problem("Structure de sauvegarde invalide.")
                    if table == "attachments":
                        row["content"] = base64.b64decode(row["content"], validate=True)
                    c.execute(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", [row[k] for k in columns])
            for k in DEFAULTS:
                c.execute("UPDATE settings SET value=? WHERE key=?", (dump(data["settings"].get(k, DEFAULTS[k])), k))
            if c.execute("PRAGMA foreign_key_check").fetchone():
                raise Problem("Les liens de la sauvegarde sont incohérents.")
        return {"patients": len(data["patients"]), "consultations": len(data["consultations"])}

    def csv(self):
        out = io.StringIO(newline="")
        w = csv.writer(out, delimiter=";")
        w.writerow(["Date", "Facture", "Client", "Moyen", "Montant EUR"])
        with self.db() as c:
            for row in c.execute("SELECT p.date,p.method,p.cents,i.number,i.recipient FROM payments p JOIN invoices i ON i.id=p.invoice_id ORDER BY p.date,i.sequence"):
                r = json.loads(row["recipient"])
                client = r["last_name"] + " " + r["first_name"]
                if client[:1] in ("=", "+", "-", "@"):
                    client = "'" + client
                w.writerow([row["date"], row["number"], client, row["method"], f"{row['cents']/100:.2f}".replace(".", ",")])
        return b"\xef\xbb\xbf" + out.getvalue().encode()
