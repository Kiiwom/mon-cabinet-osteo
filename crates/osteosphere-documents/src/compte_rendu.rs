//! Compte rendu de séance PDF, à l'en-tête du cabinet : les champs choisis du modèle de la séance,
//! texte mis en forme compris (intertitres, listes, gras, italique, souligné).

use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_core::modeles::{Champ, Definition, TypeChamp};
use osteosphere_core::numerotation::Date;
use osteosphere_core::patients::FichePatient;
use osteosphere_core::seances::{self, Seance, TypeSeance};
use serde_json::{Map, Value, json};

use crate::entete::entete_praticien;
use crate::facture::ErreurDocument;
use crate::monde;

const MODELE: &str = include_str!("modeles/compte_rendu.typ");

/// Ce qu'il faut pour composer le compte rendu.
pub struct DemandeCompteRendu<'a> {
    pub praticien: &'a IdentiteCabinet,
    pub patient: &'a FichePatient,
    pub seance: &'a Seance,
    /// La version du modèle qu'utilise la séance.
    pub definition: &'a Definition,
    /// Champs imprimés ; `None` : ceux que le modèle marque « imprimé » et qui sont remplis.
    pub champs: Option<&'a [String]>,
    /// `AAAA-MM-JJ` : la date portée au bas du compte rendu.
    pub aujourdhui: &'a str,
}

fn nombre(n: f64) -> String {
    if n.fract() == 0.0 { format!("{n:.0}") } else { format!("{n}").replace('.', ",") }
}

/// Un nœud de l'éditeur, prêt à imprimer : choix retenus et blancs deviennent du texte, le reste est
/// laissé tel quel ; ce qui ne s'imprime pas disparaît.
fn preparer(noeud: &Value) -> Option<Value> {
    let attribut = |nom: &str| noeud.get("attrs").and_then(|a| a.get(nom));
    let marques = noeud.get("marks").cloned();
    let texte = |t: String| {
        let mut n = json!({ "type": "text", "text": t });
        if let Some(m) = &marques {
            n["marks"] = m.clone();
        }
        n
    };
    match noeud.get("type").and_then(Value::as_str)? {
        "text" => Some(texte(noeud.get("text").and_then(Value::as_str).unwrap_or_default().to_owned())),
        "hardBreak" => Some(json!({ "type": "hardBreak" })),
        "blanc" => attribut("valeur").and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(|v| texte(v.to_owned())),
        "choix" => {
            let options: Vec<&str> = attribut("options").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
            let retenus: Vec<&str> = attribut("retenus")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|r| r.as_u64().and_then(|rang| options.get(rang as usize).copied()).or_else(|| r.as_str()))
                .collect();
            match retenus.as_slice() {
                [] => None,
                [seul] => Some(texte((*seul).to_owned())),
                [debut @ .., dernier] => Some(texte(format!("{} et {dernier}", debut.join(", ")))),
            }
        }
        genre @ ("paragraph" | "heading" | "bulletList" | "orderedList" | "listItem" | "doc") => {
            let enfants: Vec<Value> = noeud.get("content").and_then(Value::as_array).into_iter().flatten().filter_map(preparer).collect();
            let mut copie = Map::new();
            copie.insert("type".into(), json!(genre));
            copie.insert("content".into(), Value::Array(enfants));
            Some(Value::Object(copie))
        }
        _ => None,
    }
}

/// La section d'un champ, ou `None` s'il n'a rien à imprimer.
fn section(champ: &Champ, valeur: Option<&Value>) -> Option<Value> {
    let libelle = champ.libelle.trim();
    let texte = |t: String| (!t.trim().is_empty()).then(|| json!({ "genre": "texte", "libelle": libelle, "texte": t.trim() }));
    let valeur = valeur?;
    match champ.type_champ {
        TypeChamp::TexteEnrichi => match valeur {
            Value::Object(_) => {
                if seances::texte_de(valeur).trim().is_empty() {
                    return None;
                }
                let blocs = preparer(valeur)?.get("content").cloned().unwrap_or(Value::Array(Vec::new()));
                Some(json!({ "genre": "riche", "libelle": libelle, "blocs": blocs }))
            }
            autre => texte(seances::texte_de(autre)),
        },
        TypeChamp::TexteCourt | TypeChamp::Liste => texte(seances::texte_de(valeur)),
        TypeChamp::Cases => texte(valeur.as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")),
        TypeChamp::CasePrecision => {
            if !valeur.get("coche").and_then(Value::as_bool).unwrap_or(false) {
                return None;
            }
            let precision = valeur.get("precision").and_then(Value::as_str).unwrap_or_default().trim();
            texte(if precision.is_empty() { "Oui".into() } else { format!("Oui : {precision}") })
        }
        TypeChamp::Curseur | TypeChamp::Nombre => {
            let n = valeur.as_f64()?;
            let unite = if champ.unite.is_empty() { String::new() } else { format!("\u{a0}{}", champ.unite) };
            match (champ.type_champ, champ.max) {
                (TypeChamp::Curseur, Some(max)) => texte(format!("{}\u{a0}/\u{a0}{}{unite}", nombre(n), nombre(max))),
                _ => texte(format!("{}{unite}", nombre(n))),
            }
        }
        TypeChamp::Date => {
            let d = valeur.as_str()?;
            texte(Date::lire(d).map(|d| d.en_toutes_lettres()).unwrap_or_else(|_| d.to_owned()))
        }
        TypeChamp::Mesures => {
            let taille = valeur.get("taille").and_then(Value::as_f64);
            let poids = valeur.get("poids").and_then(Value::as_f64);
            let mut parties = Vec::new();
            if let Some(t) = taille {
                parties.push(format!("Taille {}\u{a0}cm", nombre(t)));
            }
            if let Some(p) = poids {
                parties.push(format!("Poids {}\u{a0}kg", nombre(p)));
            }
            if let (Some(t), Some(p)) = (taille, poids)
                && t > 30.0
            {
                let imc = (p / (t / 100.0).powi(2) * 10.0).round() / 10.0;
                parties.push(format!("IMC {}", nombre(imc)));
            }
            texte(parties.join(" · "))
        }
        TypeChamp::Intertitre | TypeChamp::ResumePrecedent | TypeChamp::Dessin => None,
    }
}

/// Un champ proposé au choix du praticien avant d'imprimer.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ChampImprimable {
    pub id: String,
    pub libelle: String,
    /// Le champ a quelque chose à imprimer dans cette séance.
    pub rempli: bool,
    /// Coché d'office : le modèle le marque « imprimé » et il est rempli.
    pub par_defaut: bool,
}

/// Les champs de la séance qu'on peut imprimer, dans l'ordre du modèle (intertitres exclus).
pub fn champs_imprimables(definition: &Definition, seance: &Seance) -> Vec<ChampImprimable> {
    definition
        .champs
        .iter()
        .filter(|c| !matches!(c.type_champ, TypeChamp::Intertitre | TypeChamp::ResumePrecedent | TypeChamp::Dessin))
        .map(|c| {
            let rempli = section(c, seance.saisie.valeurs.get(&c.id)).is_some();
            ChampImprimable { id: c.id.clone(), libelle: c.libelle.trim().to_owned(), rempli, par_defaut: rempli && c.imprimer }
        })
        .collect()
}

/// Les champs du modèle à imprimer, tels que le praticien les a choisis.
pub fn champs_par_defaut(definition: &Definition, seance: &Seance) -> Vec<String> {
    definition
        .champs
        .iter()
        .filter(|c| c.imprimer && c.type_champ != TypeChamp::Intertitre && section(c, seance.saisie.valeurs.get(&c.id)).is_some())
        .map(|c| c.id.clone())
        .collect()
}

fn vue(demande: &DemandeCompteRendu) -> Result<Value, ErreurDocument> {
    let praticien = demande.praticien.verifier().map_err(|e| ErreurDocument::Donnee(e.to_string()))?;
    let seance = demande.seance;
    let choisis = match demande.champs {
        Some(champs) => champs.to_vec(),
        None => champs_par_defaut(demande.definition, seance),
    };

    // Un intertitre ne s'imprime que s'il précède au moins une section imprimée.
    let mut sections: Vec<Value> = Vec::new();
    let mut intertitre: Option<Value> = None;
    for champ in &demande.definition.champs {
        if champ.type_champ == TypeChamp::Intertitre {
            intertitre = Some(json!({ "genre": "intertitre", "libelle": champ.libelle.trim() }));
            continue;
        }
        if !choisis.contains(&champ.id) {
            continue;
        }
        if let Some(s) = section(champ, seance.saisie.valeurs.get(&champ.id)) {
            if let Some(i) = intertitre.take() {
                sections.push(i);
            }
            sections.push(s);
        }
    }

    let (jour, heure) = seance.saisie.debut.split_once('T').unwrap_or((seance.saisie.debut.as_str(), ""));
    let date_seance = Date::lire(jour).map_err(|e| ErreurDocument::Donnee(e.to_string()))?;
    let genre = match seance.saisie.type_seance {
        TypeSeance::Premiere => "première séance",
        TypeSeance::Suivi => "séance de suivi",
        TypeSeance::Urgence => "séance en urgence",
    };
    let mut sous_titre = format!("Séance du {}", date_seance.en_toutes_lettres());
    if !heure.is_empty() {
        sous_titre.push_str(&format!(" à {}", heure.replace(':', "\u{a0}h\u{a0}")));
    }
    sous_titre.push_str(&format!(" · {genre}"));
    if !seance.saisie.titre.trim().is_empty() {
        sous_titre.push_str(&format!(" · {}", seance.saisie.titre.trim()));
    }

    let patient = demande.patient;
    let naissance = match patient.naissance.as_deref().and_then(|n| Date::lire(n).ok()) {
        Some(n) => {
            let ne = match patient.sexe.as_str() {
                "F" => "Née",
                "M" => "Né",
                _ => "Né(e)",
            };
            let mut age = date_seance.annee() - n.annee();
            if (date_seance.mois(), date_seance.jour()) < (n.mois(), n.jour()) {
                age -= 1;
            }
            format!("{ne} le {} ({age} an{})", n.en_toutes_lettres(), if age > 1 { "s" } else { "" })
        }
        None => String::new(),
    };

    let aujourdhui = Date::lire(demande.aujourdhui).map_err(|e| ErreurDocument::Donnee(e.to_string()))?.en_toutes_lettres();
    let lieu_date = if praticien.ville.is_empty() { format!("Le {aujourdhui}") } else { format!("{}, le {aujourdhui}", praticien.ville) };
    let profession = if praticien.profession.is_empty() { "Ostéopathe".to_owned() } else { praticien.profession.clone() };
    let mut pied = format!("Compte rendu confidentiel · {} {}", praticien.prenom, praticien.nom);
    if !praticien.rpps.is_empty() {
        pied.push_str(&format!(" · RPPS {}", praticien.rpps));
    }

    Ok(json!({
        "titre": "COMPTE RENDU DE SÉANCE",
        "sous_titre": sous_titre,
        "praticien": entete_praticien(&praticien, false),
        "patient": format!("{} {}", patient.prenom.trim(), patient.nom.trim()),
        "naissance": naissance,
        "sections": sections,
        "lieu_date": lieu_date,
        "signataire": format!("{} {}", praticien.prenom, praticien.nom),
        "profession": profession,
        "pied": pied,
    }))
}

pub fn compte_rendu_pdf(demande: &DemandeCompteRendu) -> Result<Vec<u8>, ErreurDocument> {
    Ok(monde::pdf(MODELE, vue(demande)?.to_string())?)
}

/// Les pages en SVG, pour l'aperçu à l'écran : la même mise en page que le PDF.
pub fn compte_rendu_svg(demande: &DemandeCompteRendu) -> Result<Vec<String>, ErreurDocument> {
    Ok(monde::svg(MODELE, vue(demande)?.to_string())?)
}

#[cfg(test)]
mod tests {
    use osteosphere_core::seances::{Facturation, SaisieSeance};

    use super::*;

    fn champ(id: &str, type_champ: TypeChamp, libelle: &str) -> Champ {
        Champ {
            id: id.into(),
            type_champ,
            libelle: libelle.into(),
            visible: true,
            obligatoire: false,
            imprimer: true,
            role: String::new(),
            options: Vec::new(),
            min: Some(0.0),
            max: Some(10.0),
            pas: None,
            unite: String::new(),
        }
    }

    fn exemple() -> (IdentiteCabinet, FichePatient, Seance, Definition) {
        let praticien = IdentiteCabinet {
            prenom: "Alexandre".into(),
            nom: "Roux".into(),
            adresse: "12 place de la Halle".into(),
            code_postal: "47150".into(),
            ville: "Lacapelle-Biron".into(),
            siret: "12345678900012".into(),
            rpps: "10000000000".into(),
            ..Default::default()
        };
        let patient = FichePatient { sexe: "F".into(), nom: "Martin".into(), prenom: "Camille".into(), naissance: Some("1988-03-14".into()), ..Default::default() };
        let mut valeurs = Map::new();
        valeurs.insert(
            "motif".into(),
            json!({ "type": "doc", "content": [
                { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Lombalgie" }] },
                { "type": "paragraph", "content": [
                    { "type": "text", "text": "Douleur ", "marks": [{ "type": "bold" }] },
                    { "type": "choix", "attrs": { "options": ["droite", "gauche"], "multiple": false, "retenus": [0] } },
                    { "type": "text", "text": " *depuis* " },
                    { "type": "blanc", "attrs": { "indication": "durée", "valeur": "3 jours" } }
                ]},
                { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Après un déménagement #1" }] }] }] }
            ]}),
        );
        valeurs.insert("douleur".into(), json!(6));
        valeurs.insert("mesures".into(), json!({ "taille": 168, "poids": 61.5 }));
        valeurs.insert("notes".into(), json!("Note privée"));
        let definition = Definition {
            champs: vec![
                champ("titre", TypeChamp::Intertitre, "Anamnèse"),
                champ("motif", TypeChamp::TexteEnrichi, "Motif de consultation"),
                champ("douleur", TypeChamp::Curseur, "Douleur avant"),
                champ("vide", TypeChamp::TexteCourt, "Champ vide"),
                champ("titre2", TypeChamp::Intertitre, "Examen"),
                champ("mesures", TypeChamp::Mesures, "Mesures"),
                Champ { imprimer: false, ..champ("notes", TypeChamp::TexteCourt, "Notes privées") },
            ],
        };
        let seance = Seance {
            id: "s1".into(),
            patient_id: "p1".into(),
            saisie: SaisieSeance {
                debut: "2026-10-06T14:30".into(),
                modele_id: "m".into(),
                modele_version: 1,
                type_seance: TypeSeance::Premiere,
                titre: String::new(),
                importante: false,
                valeurs,
                facturation: Facturation::AFacturer,
                commentaire_gratuit: String::new(),
            },
            importee: false,
            supprimee_le: None,
            cree_le: 0,
            modifie_le: 0,
        };
        (praticien, patient, seance, definition)
    }

    #[test]
    fn imprime_les_champs_remplis_et_choisis() {
        let (praticien, patient, seance, definition) = exemple();
        assert_eq!(champs_par_defaut(&definition, &seance), ["motif", "douleur", "mesures"]);
        let demande = DemandeCompteRendu { praticien: &praticien, patient: &patient, seance: &seance, definition: &definition, champs: None, aujourdhui: "2026-10-08" };
        let v = vue(&demande).unwrap();
        let libelles: Vec<&str> = v["sections"].as_array().unwrap().iter().map(|s| s["libelle"].as_str().unwrap()).collect();
        assert_eq!(libelles, ["Anamnèse", "Motif de consultation", "Douleur avant", "Examen", "Mesures"]);
        assert_eq!(v["sections"][2]["texte"], "6\u{a0}/\u{a0}10");
        assert_eq!(v["sections"][4]["texte"], "Taille 168\u{a0}cm · Poids 61,5\u{a0}kg · IMC 21,8");
        assert_eq!(v["naissance"], "Née le 14 mars 1988 (38 ans)");
        assert_eq!(v["sous_titre"], "Séance du 6 octobre 2026 à 14\u{a0}h\u{a0}30 · première séance");
        // Le choix retenu et le blanc deviennent du texte ; la mise en forme reste.
        let paragraphe = &v["sections"][1]["blocs"][1]["content"];
        assert_eq!(paragraphe[0]["marks"][0]["type"], "bold");
        assert_eq!(paragraphe[1]["text"], "droite");
        assert_eq!(paragraphe[3]["text"], "3 jours");

        // Seulement le motif : l'intertitre « Examen » disparaît avec ses champs.
        let choix = ["motif".to_owned()];
        let seul = vue(&DemandeCompteRendu { champs: Some(&choix), ..demande }).unwrap();
        assert_eq!(seul["sections"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn compose_le_pdf_sans_interpreter_le_texte() {
        let (praticien, patient, seance, definition) = exemple();
        let demande = DemandeCompteRendu { praticien: &praticien, patient: &patient, seance: &seance, definition: &definition, champs: None, aujourdhui: "2026-10-08" };
        let pdf = compte_rendu_pdf(&demande).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
        let pages = compte_rendu_svg(&demande).unwrap();
        assert_eq!(pages.len(), 1);
        assert!(pages[0].starts_with("<svg"));
    }
}
