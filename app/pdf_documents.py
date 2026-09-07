"""PDF generation entirely on the local machine."""
import io
from html import escape
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

FONT = "Helvetica"
if Path("C:/Windows/Fonts/arial.ttf").exists():
    pdfmetrics.registerFont(TTFont("Cabinet", "C:/Windows/Fonts/arial.ttf"))
    FONT = "Cabinet"


def euros(cents):
    return f"{cents/100:,.2f}".replace(",", " ").replace(".", ",") + " €"


def pdf_base(title, demo=False):
    target = io.BytesIO()
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.fontName = FONT
        if hasattr(style, "fontSize"):
            style.leading = max(style.fontSize*1.45, 13)
    styles.add(ParagraphStyle("Right", parent=styles["BodyText"], alignment=TA_RIGHT))
    doc = SimpleDocTemplate(target, pagesize=(210*mm, 297*mm), rightMargin=20*mm, leftMargin=20*mm, topMargin=18*mm, bottomMargin=22*mm, title=title, author="Mon Cabinet d’Ostéo")
    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont(FONT, 8)
        canvas.setFillColor(colors.HexColor("#61717b"))
        canvas.drawString(20*mm, 12*mm, "Document de démonstration — aucune prestation réelle" if demo else title)
        canvas.drawRightString(190*mm, 12*mm, str(document.page))
        canvas.restoreState()
    return target, doc, styles, footer


def para(text, style):
    return Paragraph(escape(str(text or "")).replace("\n", "<br/>"), style)


def invoice_pdf(invoice, related=None, demo=False):
    title = ("AVOIR N°" if invoice["kind"] == "credit" else "FACTURE N°") + (invoice["number"] or "BROUILLON")
    target, doc, styles, footer = pdf_base(title, demo)
    p, r = invoice["practice"], invoice["recipient"]
    story = [para(p["name"] or "Cabinet à renseigner", styles["Title"]), para("\n".join(x for x in (p["address"], p["postal"]+" "+p["city"], p["phone"], p["email"]) if x), styles["BodyText"]), Spacer(1, 10*mm), para(title, styles["Heading1"]), para("Date d’émission : " + invoice["date"][8:10]+"/"+invoice["date"][5:7]+"/"+invoice["date"][:4], styles["BodyText"])]
    if invoice["status"] == "draft":
        story.append(para("BROUILLON — document non émis", styles["Heading2"]))
    if invoice["status"] == "replaced":
        story.append(para("Document original remplacé — conservé pour historique", styles["BodyText"]))
    if related:
        label = "Avoir correspondant à la facture " if invoice["kind"] == "credit" else "Facture corrigée, liée à la facture "
        story.append(para(label + related["number"] + " du " + related["date"], styles["BodyText"]))
    civil = {"F": "Mme ", "M": "M. "}.get(r.get("gender"), "")
    recipient = civil + r["first_name"] + " " + r["last_name"]
    story.extend([Spacer(1, 8*mm), para(recipient, styles["Heading2"]), para("\n".join(x for x in (r["address"], r["postal"]+" "+r["city"]) if x.strip()), styles["BodyText"]), Spacer(1, 10*mm)])
    sign = -1 if invoice["kind"] == "credit" else 1
    rows = [[para("Prestation", styles["BodyText"]), para("Qté", styles["BodyText"]), para("Prix", styles["Right"]), para("Total", styles["Right"])]]
    for line in invoice["lines"]:
        rows.append([para(line["label"], styles["BodyText"]), para(line["quantity"], styles["BodyText"]), para(euros(sign*line["unit_cents"]), styles["Right"]), para(euros(sign*line["unit_cents"]*line["quantity"]), styles["Right"])])
    table = Table(rows, colWidths=[94*mm, 15*mm, 28*mm, 33*mm], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), colors.HexColor("#eaf1f0")), ("VALIGN", (0,0), (-1,-1), "TOP"), ("BOTTOMPADDING", (0,0), (-1,-1), 12), ("TOPPADDING", (0,0), (-1,-1), 10), ("LINEBELOW", (0,0), (-1,0), .5, colors.HexColor("#b7ccc7"))]))
    story.extend([table, Spacer(1, 6*mm), para("Total : " + euros(invoice["total_cents"]), styles["Heading2"])])
    if invoice["kind"] == "invoice":
        paid = sum(p["cents"] for p in invoice["payment_snapshot"])
        if paid:
            methods = ", ".join(p["method"] for p in invoice["payment_snapshot"])
            story.append(para("Règlement reçu : " + euros(paid) + " · " + methods, styles["BodyText"]))
        story.append(para("Reste à régler : " + euros(max(0, invoice["total_cents"]-paid)), styles["BodyText"]))
    for content in (p.get("tax_note"), invoice["comment"], p.get("footer")):
        if content:
            story.extend([Spacer(1, 4*mm), para(content, styles["BodyText"])])
    story.extend([Spacer(1, 10*mm), para("SIRET : " + p.get("siret", "") + "  ·  RPPS : " + p.get("rpps", ""), styles["BodyText"])])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return target.getvalue()


def consultation_pdf(patient, consultation, practice, demo=False):
    title = "Compte-rendu de consultation"
    target, doc, styles, footer = pdf_base(title, demo)
    story = [para(practice["name"] or "Mon Cabinet d’Ostéo", styles["Title"]), para(title, styles["Heading1"]), para(patient["first_name"]+" "+patient["last_name"]+" — "+consultation["date"], styles["Heading2"])]
    for name, value in [("Motif", consultation["motif"]), ("Anamnèse", consultation["anamnesis"]), ("Notes / antécédents — état actuel du dossier", patient["shared_notes"]), ("Pour le prochain rendez-vous", consultation["followup"])]:
        if value:
            story.extend([para(name, styles["Heading2"]), para(value, styles["BodyText"])])
    for f in consultation["fields"]:
        if f["key"] in ("motif", "anamnesis"):
            continue
        value = consultation["custom"].get(f["key"], "")
        if value:
            story.extend([para(f["label"], styles["Heading2"]), para("Oui" if value is True else value, styles["BodyText"])])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return target.getvalue()
