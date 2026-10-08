//! Dossier du patient en PDF, à l'en-tête du cabinet, pour répondre à une demande d'accès : les
//! rubriques et les séances choisies par le praticien.

use osteosphere_core::antecedents::{Antecedent, CategorieAntecedents};
use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_core::documents::Document;
use osteosphere_core::facturation::{EtatFacture, Nature, ResumeFacture};
use osteosphere_core::familles::Proche;
use osteosphere_core::groupes::Groupe;
use osteosphere_core::modeles::{Definition, TypeChamp};
use osteosphere_core::numerotation::Date;
use osteosphere_core::patients::Patient;
use osteosphere_core::seances::Seance;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::compte_rendu::{intitule_seance, naissance_et_age, preparer, section};
use crate::entete::entete_praticien;
use crate::facture::ErreurDocument;
use crate::format::euros;
use crate::habillage::Habillage;
use crate::monde;

const MODELE: &str = include_str!("modeles/dossier.typ");

/// Les rubriques choisies par le praticien.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct RubriquesDossier {
    pub identite: bool,
    pub profil: bool,
    pub notes_importantes: bool,
    pub remarques: bool,
    pub antecedents: bool,
    pub proches: bool,
    pub documents: bool,
    pub factures: bool,
    /// Les séances imprimées, par identifiant.
    pub seances: Vec<String>,
}

pub struct SeanceDuDossier<'a> {
    pub seance: &'a Seance,
    /// La version du modèle qu'utilise la séance.
    pub definition: &'a Definition,
}

/// Ce qu'il faut pour composer le dossier ; les séances sont celles à imprimer, dans l'ordre voulu.
pub struct DemandeDossier<'a> {
    pub praticien: &'a IdentiteCabinet,
    pub patient: &'a Patient,
    pub rubriques: &'a RubriquesDossier,
    pub antecedents: &'a [Antecedent],
    pub formulaire: &'a [CategorieAntecedents],
    pub proches: &'a [Proche],
    pub groupes: &'a [Groupe],
    pub seances: &'a [SeanceDuDossier<'a>],
    pub documents: &'a [Document],
    pub factures: &'a [ResumeFacture],
    /// `AAAA-MM-JJ`.
    pub aujourdhui: &'a str,
    pub habillage: &'a Habillage,
}

const MOIS: [&str; 12] = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/// « 2009 », « mars 2009 » ou « 14 mars 2009 ».
fn date_partielle(texte: &str) -> String {
    let parties: Vec<&str> = texte.split('-').collect();
    match parties.as_slice() {
        [annee, mois] => match mois.parse::<usize>().ok().and_then(|m| MOIS.get(m.wrapping_sub(1))) {
            Some(nom) => format!("{nom} {annee}"),
            None => texte.to_owned(),
        },
        [_, _, _] => Date::lire(texte).map(|d| d.en_toutes_lettres()).unwrap_or_else(|_| texte.to_owned()),
        _ => texte.to_owned(),
    }
}

/// « Fracture · poignet G · 2009 », « Traitement longue durée · lévothyroxine · depuis 2015 ».
fn antecedent_en_texte(a: &Antecedent) -> String {
    let s = &a.saisie;
    let mut parties = vec![s.rubrique.trim().to_owned()];
    if !s.precision.trim().is_empty() {
        parties.push(s.precision.trim().to_owned());
    }
    match (&s.debut, &s.fin) {
        (Some(debut), Some(fin)) => parties.push(format!("de {} à {}", date_partielle(debut), date_partielle(fin))),
        (Some(debut), None) if s.en_cours => parties.push(format!("depuis {}, en cours", date_partielle(debut))),
        (Some(debut), None) => parties.push(date_partielle(debut)),
        (None, _) if s.en_cours => parties.push("en cours".into()),
        _ => {}
    }
    let mut texte = parties.join(" · ");
    if s.important {
        texte.push_str(" (important)");
    }
    texte
}

/// Un texte mis en forme (document de l'éditeur) ou un texte simple d'avant.
fn texte_libre(libelle: &str, contenu: &str) -> Option<Value> {
    let contenu = contenu.trim();
    if contenu.is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(contenu) {
        Ok(document @ Value::Object(_)) if document.get("type").and_then(Value::as_str) == Some("doc") => {
            if osteosphere_core::seances::texte_de(&document).trim().is_empty() {
                return None;
            }
            let blocs = preparer(&document)?.get("content").cloned().unwrap_or(Value::Array(Vec::new()));
            Some(json!({ "genre": "riche", "libelle": libelle, "blocs": blocs }))
        }
        _ => Some(json!({ "genre": "texte", "libelle": libelle, "texte": contenu })),
    }
}

fn lignes(paires: Vec<(&str, String)>) -> Option<Value> {
    let gardees: Vec<Value> = paires.into_iter().filter(|(_, v)| !v.trim().is_empty()).map(|(l, v)| json!([l, v.trim()])).collect();
    (!gardees.is_empty()).then(|| json!({ "genre": "lignes", "lignes": gardees }))
}

fn oui(vrai: bool) -> String {
    if vrai { "oui".into() } else { String::new() }
}

fn date_longue(texte: &Option<String>) -> String {
    texte.as_deref().map(date_partielle).unwrap_or_default()
}

fn rubrique(sections: &mut Vec<Value>, titre: &str, contenu: Vec<Option<Value>>) {
    let contenu: Vec<Value> = contenu.into_iter().flatten().collect();
    if !contenu.is_empty() {
        sections.push(json!({ "genre": "rubrique", "libelle": titre }));
        sections.extend(contenu);
    }
}

fn vue(demande: &DemandeDossier) -> Result<Value, ErreurDocument> {
    let praticien = demande.praticien.verifier().map_err(|e| ErreurDocument::Donnee(e.to_string()))?;
    let aujourdhui = Date::lire(demande.aujourdhui).map_err(|e| ErreurDocument::Donnee(e.to_string()))?;
    let p = &demande.patient.fiche;
    let r = demande.rubriques;
    let mut sections: Vec<Value> = Vec::new();

    if r.identite {
        let adresse = [p.adresse.trim(), p.complement_adresse.trim(), format!("{} {}", p.code_postal.trim(), p.ville.trim()).trim(), p.pays.trim()]
            .into_iter()
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        let sexe = match p.sexe.as_str() {
            "F" => "Femme",
            "M" => "Homme",
            _ => "",
        };
        rubrique(
            &mut sections,
            "Identité et coordonnées",
            vec![lignes(vec![
                ("Nom", p.nom.clone()),
                ("Nom de naissance", p.nom_naissance.clone()),
                ("Prénom", p.prenom.clone()),
                ("Sexe", sexe.into()),
                ("Date de naissance", date_longue(&p.naissance)),
                ("Adresse", adresse),
                ("Portable", p.portable.clone()),
                ("Téléphone fixe", p.fixe.clone()),
                ("Email", p.email.clone()),
            ])],
        );
    }
    if r.profil {
        let feminin = p.sexe == "F";
        let lateralite = match p.lateralite.as_str() {
            "droitier" if feminin => "droitière",
            "droitier" => "droitier",
            "gaucher" if feminin => "gauchère",
            "gaucher" => "gaucher",
            "ambidextre" => "ambidextre",
            _ => "",
        };
        let groupes: Vec<&str> = demande.groupes.iter().filter(|g| p.groupes.contains(&g.id)).map(|g| g.nom.as_str()).collect();
        rubrique(
            &mut sections,
            "Profil et suivi",
            vec![lignes(vec![
                ("Profession ou scolarité", p.profession.clone()),
                ("Retraite", oui(p.retraite)),
                ("Situation familiale", p.situation_familiale.clone()),
                ("Enfants", p.enfants.map(|n| n.to_string()).unwrap_or_default()),
                ("Latéralité", lateralite.into()),
                ("Activités", p.activites.clone()),
                ("Médecin traitant", p.medecin_traitant.clone()),
                ("Autres thérapeutes", p.autres_therapeutes.clone()),
                ("Mobilité réduite", oui(p.mobilite_reduite)),
                ("Statut", p.statut.clone()),
                ("Groupes", groupes.join(", ")),
                ("Consentement recueilli le", date_longue(&p.consentement_le)),
            ])],
        );
    }
    if r.notes_importantes {
        rubrique(&mut sections, "Notes importantes", vec![texte_libre("Allergie, contre-indication, précaution", &p.notes_importantes)]);
    }
    if r.antecedents {
        let mut contenu: Vec<Option<Value>> = demande
            .formulaire
            .iter()
            .map(|categorie| {
                let elements: Vec<String> = demande.antecedents.iter().filter(|a| a.saisie.categorie == categorie.cle).map(antecedent_en_texte).collect();
                (!elements.is_empty()).then(|| json!({ "genre": "liste", "libelle": categorie.libelle, "elements": elements }))
            })
            .collect();
        let hors_formulaire: Vec<String> =
            demande.antecedents.iter().filter(|a| !demande.formulaire.iter().any(|c| c.cle == a.saisie.categorie)).map(antecedent_en_texte).collect();
        if !hors_formulaire.is_empty() {
            contenu.push(Some(json!({ "genre": "liste", "libelle": "Autres antécédents", "elements": hors_formulaire })));
        }
        contenu.push(texte_libre("Remarques sur les antécédents", &p.remarques_antecedents));
        rubrique(&mut sections, "Antécédents", contenu);
    }
    if r.remarques {
        rubrique(&mut sections, "Remarques générales", vec![texte_libre("Remarques", &p.remarques)]);
    }
    if r.proches {
        let elements: Vec<String> = demande
            .proches
            .iter()
            .map(|proche| {
                let lien = match (proche.lien.as_str(), proche.sexe.as_str()) {
                    ("parent", "F") => "mère",
                    ("parent", "M") => "père",
                    ("parent", _) => "parent",
                    ("enfant", "F") => "fille",
                    ("enfant", "M") => "fils",
                    ("enfant", _) => "enfant",
                    ("conjoint", "F") => "conjointe",
                    ("conjoint", _) => "conjoint",
                    (_, "F") => "sœur",
                    (_, "M") => "frère",
                    _ => "frère ou sœur",
                };
                let factures = if proche.recoit_les_factures { ", reçoit les factures" } else { "" };
                format!("{} {} ({lien}{factures})", proche.prenom.trim(), proche.nom.trim())
            })
            .collect();
        rubrique(&mut sections, "Proches", vec![(!elements.is_empty()).then(|| json!({ "genre": "liste", "libelle": "", "elements": elements }))]);
    }
    for (rang, s) in demande.seances.iter().enumerate() {
        if rang == 0 {
            sections.push(json!({ "genre": "rubrique", "libelle": "Séances" }));
        }
        let (_, intitule) = intitule_seance(s.seance)?;
        sections.push(json!({ "genre": "seance", "libelle": intitule }));
        let mut intertitre: Option<Value> = None;
        let mut vide = true;
        for champ in &s.definition.champs {
            if champ.type_champ == TypeChamp::Intertitre {
                intertitre = Some(json!({ "genre": "intertitre", "libelle": champ.libelle.trim() }));
                continue;
            }
            if let Some(contenu) = section(champ, s.seance.saisie.valeurs.get(&champ.id)) {
                if let Some(i) = intertitre.take() {
                    sections.push(i);
                }
                sections.push(contenu);
                vide = false;
            }
        }
        if vide {
            sections.push(json!({ "genre": "texte", "libelle": "", "texte": "Rien de noté pour cette séance." }));
        }
    }
    if r.documents {
        let elements: Vec<String> = demande
            .documents
            .iter()
            .filter(|d| d.supprime_le.is_none())
            .map(|d| {
                let (jour, _, _) = osteosphere_core::horloge::paris(d.ajoute_le);
                format!("{} · ajouté le {}", d.nom, jour.en_toutes_lettres())
            })
            .collect();
        rubrique(&mut sections, "Documents du dossier", vec![(!elements.is_empty()).then(|| json!({ "genre": "liste", "libelle": "", "elements": elements }))]);
    }
    if r.factures {
        let elements: Vec<String> = demande
            .factures
            .iter()
            .filter(|f| f.etat != EtatFacture::Brouillon)
            .map(|f| {
                let nature = if f.nature == Nature::Avoir { "Avoir" } else { "Facture" };
                let date = f.date_emission.as_deref().map(date_partielle).unwrap_or_default();
                let annulee = if f.etat == EtatFacture::Annulee { " (annulée)" } else { "" };
                format!("{nature} {} du {date} : {}{annulee}", f.numero.as_deref().unwrap_or(""), euros(f.total_centimes))
            })
            .collect();
        rubrique(&mut sections, "Factures", vec![(!elements.is_empty()).then(|| json!({ "genre": "liste", "libelle": "", "elements": elements }))]);
    }

    let lieu_date = if praticien.ville.is_empty() { format!("Le {}", aujourdhui.en_toutes_lettres()) } else { format!("{}, le {}", praticien.ville, aujourdhui.en_toutes_lettres()) };
    let profession = if praticien.profession.is_empty() { "Ostéopathe".to_owned() } else { praticien.profession.clone() };
    let mut pied = format!("Dossier confidentiel de {} {} · {} {}", p.prenom.trim(), p.nom.trim(), praticien.prenom, praticien.nom);
    if !praticien.rpps.is_empty() {
        pied.push_str(&format!(" · RPPS {}", praticien.rpps));
    }
    Ok(json!({
        "habillage": demande.habillage.vue(),
        "titre": "DOSSIER DU PATIENT",
        "sous_titre": format!("Copie établie le {}", aujourdhui.en_toutes_lettres()),
        "praticien": entete_praticien(&praticien, false),
        "patient": format!("{} {}", p.prenom.trim(), p.nom.trim()),
        "naissance": naissance_et_age(p, &aujourdhui),
        "sections": sections,
        "lieu_date": lieu_date,
        "signataire": format!("{} {}", praticien.prenom, praticien.nom),
        "profession": profession,
        "pied": pied,
    }))
}

pub fn dossier_pdf(demande: &DemandeDossier) -> Result<Vec<u8>, ErreurDocument> {
    Ok(monde::pdf(MODELE, vue(demande)?.to_string(), &demande.habillage.fichiers())?)
}

/// Les pages en SVG, pour l'aperçu à l'écran.
pub fn dossier_svg(demande: &DemandeDossier) -> Result<Vec<String>, ErreurDocument> {
    Ok(monde::svg(MODELE, vue(demande)?.to_string(), &demande.habillage.fichiers())?)
}

#[cfg(test)]
mod tests {
    use osteosphere_core::antecedents::SaisieAntecedent;
    use osteosphere_core::patients::FichePatient;

    use super::*;

    fn praticien() -> IdentiteCabinet {
        IdentiteCabinet {
            prenom: "Alexandre".into(),
            nom: "Roux".into(),
            profession: "Ostéopathe D.O.".into(),
            adresse: "12 place de la Halle".into(),
            code_postal: "47150".into(),
            ville: "Lacapelle-Biron".into(),
            siret: "12345678900012".into(),
            rpps: "10000000000".into(),
            ..Default::default()
        }
    }

    fn patient() -> Patient {
        Patient {
            id: "p".into(),
            fiche: FichePatient {
                sexe: "F".into(),
                nom: "Martin".into(),
                prenom: "Camille".into(),
                naissance: Some("1988-03-14".into()),
                ville: "Fumel".into(),
                code_postal: "47500".into(),
                profession: "Infirmière".into(),
                notes_importantes: "Allergie aux AINS".into(),
                remarques: r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Préfère le soir"}]}]}"#.into(),
                ..Default::default()
            },
            archive: false,
            factures_a: None,
            cree_le: 0,
            modifie_le: 0,
        }
    }

    fn antecedent(rubrique: &str, debut: Option<&str>, en_cours: bool) -> Antecedent {
        Antecedent {
            id: rubrique.into(),
            patient_id: "p".into(),
            saisie: SaisieAntecedent {
                categorie: "medicaux".into(),
                rubrique: rubrique.into(),
                precision: "lévothyroxine".into(),
                debut: debut.map(str::to_owned),
                en_cours,
                ..Default::default()
            },
        }
    }

    #[test]
    fn compose_les_rubriques_choisies_seulement() {
        let (praticien, patient) = (praticien(), patient());
        let antecedents = [antecedent("Traitement longue durée", Some("2015-03"), true)];
        let formulaire = [CategorieAntecedents { cle: "medicaux".into(), libelle: "Médicaux".into(), rubriques: Vec::new() }];
        let rubriques = RubriquesDossier { identite: true, antecedents: true, remarques: true, ..Default::default() };
        let habillage = Habillage::default();
        let demande = DemandeDossier {
            praticien: &praticien,
            patient: &patient,
            rubriques: &rubriques,
            antecedents: &antecedents,
            formulaire: &formulaire,
            proches: &[],
            groupes: &[],
            seances: &[],
            documents: &[],
            factures: &[],
            aujourdhui: "2026-10-08",
            habillage: &habillage,
        };
        let v = vue(&demande).unwrap();
        let rubriques: Vec<&str> = v["sections"].as_array().unwrap().iter().filter(|s| s["genre"] == "rubrique").map(|s| s["libelle"].as_str().unwrap()).collect();
        assert_eq!(rubriques, ["Identité et coordonnées", "Antécédents", "Remarques générales"]);
        assert_eq!(v["naissance"], "Née le 14 mars 1988 (38 ans)");
        let medicaux = v["sections"].as_array().unwrap().iter().find(|s| s["libelle"] == "Médicaux").unwrap();
        assert_eq!(medicaux["elements"][0], "Traitement longue durée · lévothyroxine · depuis mars 2015, en cours");
        let remarques = v["sections"].as_array().unwrap().iter().find(|s| s["libelle"] == "Remarques").unwrap();
        assert_eq!(remarques["genre"], "riche");
        // Les notes importantes n'ont pas été choisies.
        assert!(!v.to_string().contains("AINS"));

        let pdf = dossier_pdf(&demande).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(dossier_svg(&demande).unwrap().len(), 1);
    }

    #[test]
    fn ecrit_les_dates_partielles() {
        assert_eq!(date_partielle("2009"), "2009");
        assert_eq!(date_partielle("2009-03"), "mars 2009");
        assert_eq!(date_partielle("2009-03-14"), "14 mars 2009");
    }
}
