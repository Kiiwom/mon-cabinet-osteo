//! Export complet et journal consultable.
//!
//! L'export écrit en clair, dans un dossier choisi, tout ce que contient le cabinet : des CSV
//! lisibles par un tableur et un fichier JSON complet, pour changer de logiciel ou garder une
//! archive. C'est un choix du praticien : contrairement aux sauvegardes, il n'est pas chiffré.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};

use crate::base::{Base, ErreurBase};
use crate::facturation::{self, Facture};
use crate::modeles::{self, Definition};
use crate::seances::{self, Seance};
use crate::{antecedents, fichier, horloge, patients, prestations, trames};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LigneJournal {
    pub id: i64,
    pub le: i64,
    pub action: String,
    pub entite: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurExport {
    #[error("export : {0}")]
    Fichier(#[from] io::Error),
    #[error("export : {0}")]
    Donnees(String),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurExport {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

fn donnees(erreur: impl std::fmt::Display) -> ErreurExport {
    ErreurExport::Donnees(erreur.to_string())
}

/// Les dernières lignes du journal, de la plus récente à la plus ancienne ; `avant` pour la page suivante.
pub fn journal(base: &Base, limite: u32, avant: Option<i64>) -> Result<Vec<LigneJournal>, ErreurExport> {
    let mut requete = base.connexion().prepare("SELECT id, le, action, entite FROM journal WHERE id < ?1 ORDER BY id DESC LIMIT ?2")?;
    let lignes = requete.query_map(rusqlite::params![avant.unwrap_or(i64::MAX), limite.min(500)], |l| {
        Ok(LigneJournal { id: l.get(0)?, le: l.get::<_, String>(1)?.parse().unwrap_or(0), action: l.get(2)?, entite: l.get(3)? })
    })?;
    Ok(lignes.collect::<Result<_, _>>()?)
}

/// CSV lisible par Excel et LibreOffice en français : point-virgule, BOM, guillemets si besoin.
fn csv(entetes: &[&str], lignes: &[Vec<String>]) -> String {
    let cellule = |texte: &str| {
        if texte.contains([';', '"', '\n', '\r']) { format!("\"{}\"", texte.replace('"', "\"\"")) } else { texte.to_owned() }
    };
    let mut sortie = String::from("\u{feff}");
    for ligne in std::iter::once(entetes.iter().map(|e| e.to_string()).collect::<Vec<_>>()).chain(lignes.iter().cloned()) {
        sortie.push_str(&ligne.iter().map(|c| cellule(c)).collect::<Vec<_>>().join(";"));
        sortie.push_str("\r\n");
    }
    sortie
}

fn euros(centimes: i64) -> String {
    format!("{}{},{:02}", if centimes < 0 { "-" } else { "" }, centimes.abs() / 100, centimes.abs() % 100)
}

/// Le contenu d'une séance en texte : « Libellé : valeur », un champ par ligne.
fn contenu_seance(seance: &Seance, definition: Option<&Definition>) -> String {
    let Some(definition) = definition else { return String::new() };
    definition
        .champs
        .iter()
        .filter_map(|champ| {
            let valeur = seance.saisie.valeurs.get(&champ.id)?;
            let texte = match valeur {
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => if *b { "oui".into() } else { "non".into() },
                Value::Array(a) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "),
                Value::Object(o) if o.contains_key("taille") || o.contains_key("poids") => {
                    format!("{} cm, {} kg", o.get("taille").unwrap_or(&Value::Null), o.get("poids").unwrap_or(&Value::Null))
                }
                Value::Object(o) if o.contains_key("coche") => {
                    let precision = o.get("precision").and_then(Value::as_str).unwrap_or_default();
                    if o.get("coche").and_then(Value::as_bool).unwrap_or(false) { format!("oui {precision}").trim().to_owned() } else { String::new() }
                }
                autre => seances::texte_de(autre),
            };
            (!texte.trim().is_empty()).then(|| format!("{} : {}", champ.libelle, texte.trim()))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Écrit l'export complet dans `dossier/Export Osteosphere AAAA-MM-JJ HHhMM` ; rend ce dossier.
pub fn exporter_tout(base: &Base, dossier: &Path, maintenant: i64) -> Result<PathBuf, ErreurExport> {
    let (date, h, m) = horloge::paris(maintenant);
    let cible = dossier.join(format!("Export Osteosphere {date} {h:02}h{m:02}"));
    fs::create_dir_all(&cible)?;

    let resumes = patients::lister(base).map_err(donnees)?;
    let mut fiches = Vec::new();
    let mut tous_antecedents = Vec::new();
    for r in &resumes {
        fiches.push(patients::lire(base, &r.id).map_err(donnees)?);
        tous_antecedents.extend(antecedents::lister(base, &r.id).map_err(donnees)?);
    }
    let noms: std::collections::HashMap<String, String> = fiches.iter().map(|p| (p.id.clone(), format!("{} {}", p.fiche.nom, p.fiche.prenom))).collect();
    let nom = |id: &Option<String>| id.as_ref().and_then(|i| noms.get(i)).cloned().unwrap_or_default();

    let ids_seances: Vec<String> = base.connexion().prepare("SELECT id FROM seances ORDER BY debut")?.query_map([], |l| l.get(0))?.collect::<Result<_, _>>()?;
    let toutes_seances: Vec<Seance> = ids_seances.iter().map(|id| seances::lire(base, id).map_err(donnees)).collect::<Result<_, _>>()?;
    let ids_factures: Vec<String> =
        base.connexion().prepare("SELECT id FROM factures ORDER BY date_emission, annee, sequence")?.query_map([], |l| l.get(0))?.collect::<Result<_, _>>()?;
    let toutes_factures: Vec<Facture> = ids_factures.iter().map(|id| facturation::lire(base, id).map_err(donnees)).collect::<Result<_, _>>()?;
    let liste_modeles = modeles::lister(base).map_err(donnees)?;
    let mut definitions = std::collections::HashMap::new();
    for s in &toutes_seances {
        let cle = (s.saisie.modele_id.clone(), s.saisie.modele_version);
        if !definitions.contains_key(&cle) {
            definitions.insert(cle.clone(), modeles::lire_version(base, &cle.0, cle.1).ok());
        }
    }

    let csv_patients = csv(
        &["Identifiant", "Nom", "Prénom", "Nom de naissance", "Sexe", "Naissance", "Adresse", "Complément", "Code postal", "Ville", "Portable", "Fixe", "Email", "Profession", "Statut", "Notes importantes", "Remarques", "Archivé"],
        &fiches
            .iter()
            .map(|p| {
                let f = &p.fiche;
                vec![
                    p.id.clone(),
                    f.nom.clone(),
                    f.prenom.clone(),
                    f.nom_naissance.clone(),
                    f.sexe.clone(),
                    f.naissance.clone().unwrap_or_default(),
                    f.adresse.clone(),
                    f.complement_adresse.clone(),
                    f.code_postal.clone(),
                    f.ville.clone(),
                    f.portable.clone(),
                    f.fixe.clone(),
                    f.email.clone(),
                    f.profession.clone(),
                    f.statut.clone(),
                    f.notes_importantes.clone(),
                    f.remarques.clone(),
                    if p.archive { "oui".into() } else { String::new() },
                ]
            })
            .collect::<Vec<_>>(),
    );
    let csv_antecedents = csv(
        &["Patient", "Catégorie", "Rubrique", "Précision", "Début", "Fin", "En cours", "Important"],
        &tous_antecedents
            .iter()
            .map(|a| {
                let s = &a.saisie;
                vec![
                    nom(&Some(a.patient_id.clone())),
                    s.categorie.clone(),
                    s.rubrique.clone(),
                    s.precision.clone(),
                    s.debut.clone().unwrap_or_default(),
                    s.fin.clone().unwrap_or_default(),
                    if s.en_cours { "oui".into() } else { String::new() },
                    if s.important { "oui".into() } else { String::new() },
                ]
            })
            .collect::<Vec<_>>(),
    );
    let csv_seances = csv(
        &["Date", "Patient", "Modèle", "Type", "Titre", "Facturation", "À la corbeille", "Contenu"],
        &toutes_seances
            .iter()
            .map(|s| {
                let modele = liste_modeles.iter().find(|m| m.id == s.saisie.modele_id).map(|m| m.nom.clone()).unwrap_or_default();
                let definition = definitions.get(&(s.saisie.modele_id.clone(), s.saisie.modele_version)).and_then(Option::as_ref);
                vec![
                    s.saisie.debut.replace('T', " "),
                    nom(&Some(s.patient_id.clone())),
                    modele,
                    serde_json::to_value(s.saisie.type_seance).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default(),
                    s.saisie.titre.clone(),
                    serde_json::to_value(s.saisie.facturation).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default(),
                    if s.supprimee_le.is_some() { "oui".into() } else { String::new() },
                    contenu_seance(s, definition),
                ]
            })
            .collect::<Vec<_>>(),
    );
    let csv_factures = csv(
        &["Numéro", "Nature", "État", "Émise le", "Patient", "Destinataire", "Désignation", "Total (€)", "Réglé (€)", "Reste (€)", "Origine", "Importée"],
        &toutes_factures
            .iter()
            .map(|f| {
                vec![
                    f.numero.clone().unwrap_or_else(|| "brouillon".into()),
                    serde_json::to_value(f.nature).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default(),
                    serde_json::to_value(f.etat).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default(),
                    f.date_emission.clone().unwrap_or_default(),
                    nom(&f.saisie.patient_id),
                    f.saisie.destinataire.nom_complet(),
                    f.saisie.lignes.iter().map(|l| l.designation.clone()).collect::<Vec<_>>().join(" + "),
                    euros(f.total_centimes),
                    euros(f.regle_centimes),
                    euros(f.reste_centimes),
                    f.origine.as_ref().map(|o| o.numero.clone()).unwrap_or_default(),
                    if f.importee { "oui".into() } else { String::new() },
                ]
            })
            .collect::<Vec<_>>(),
    );
    let csv_reglements = csv(
        &["Encaissé le", "Facture", "Moyen", "Montant (€)", "Référence", "Payé par", "Commentaire"],
        &toutes_factures
            .iter()
            .flat_map(|f| {
                f.reglements.iter().map(move |r| {
                    vec![
                        r.saisie.encaisse_le.clone(),
                        f.numero.clone().unwrap_or_default(),
                        r.saisie.moyen.texte().to_owned(),
                        euros(r.saisie.montant_centimes),
                        r.saisie.reference.clone(),
                        r.saisie.payeur.clone(),
                        r.saisie.commentaire.clone(),
                    ]
                })
            })
            .collect::<Vec<_>>(),
    );

    let parametres: Vec<(String, String)> =
        base.connexion().prepare("SELECT cle, valeur FROM parametres ORDER BY cle")?.query_map([], |l| Ok((l.get(0)?, l.get(1)?)))?.collect::<Result<_, _>>()?;
    let complet = json!({
        "logiciel": "Osteosphere",
        "format": 1,
        "exporte_le": maintenant,
        "parametres": parametres.iter().map(|(c, v)| (c.clone(), serde_json::from_str::<Value>(v).unwrap_or(Value::Null))).collect::<serde_json::Map<_, _>>(),
        "patients": fiches,
        "antecedents": tous_antecedents,
        "modeles": liste_modeles,
        "seances": toutes_seances,
        "prestations": prestations::lister(base).map_err(donnees)?,
        "factures": toutes_factures,
        "trames": trames::lister(base).map_err(donnees)?,
    });

    for (nom_fichier, contenu) in [
        ("patients.csv", csv_patients.into_bytes()),
        ("antecedents.csv", csv_antecedents.into_bytes()),
        ("seances.csv", csv_seances.into_bytes()),
        ("factures.csv", csv_factures.into_bytes()),
        ("reglements.csv", csv_reglements.into_bytes()),
        ("osteosphere.json", serde_json::to_vec_pretty(&complet).map_err(donnees)?),
    ] {
        fichier::ecrire_atomiquement(&cible.join(nom_fichier), &contenu)?;
    }
    Ok(cible)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;
    use crate::patients::FichePatient;

    #[test]
    fn exporte_tout_en_csv_et_json() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        modeles::installer_modeles_fournis(&base).unwrap();
        let p = patients::creer(&base, &FichePatient { nom: "Martin".into(), prenom: "Camille; dite \"Cam\"".into(), ..Default::default() }).unwrap();
        let modele = modeles::lister(&base).unwrap().remove(0);
        let mut saisie = seances::SaisieSeance { debut: "2026-10-06T14:30".into(), modele_id: modele.id, modele_version: modele.version, ..Default::default() };
        saisie.valeurs.insert("motif".into(), json!("Lombalgie basse"));
        saisie.valeurs.insert("douleur_avant".into(), json!(6));
        seances::creer(&base, &p.id, &saisie).unwrap();

        let cible = exporter_tout(&base, dossier.path(), 1_791_397_800).unwrap();
        assert!(cible.ends_with("Export Osteosphere 2026-10-07 20h30"));
        let patients_csv = fs::read_to_string(cible.join("patients.csv")).unwrap();
        assert!(patients_csv.starts_with("\u{feff}Identifiant;Nom;Prénom"));
        assert!(patients_csv.contains("\"Camille; dite \"\"Cam\"\"\""));
        let seances_csv = fs::read_to_string(cible.join("seances.csv")).unwrap();
        assert!(seances_csv.contains("2026-10-06 14:30"));
        assert!(seances_csv.contains("Motif de consultation : Lombalgie basse"));
        let complet: Value = serde_json::from_slice(&fs::read(cible.join("osteosphere.json")).unwrap()).unwrap();
        assert_eq!(complet["patients"][0]["nom"], "Martin");
        assert_eq!(complet["seances"][0]["valeurs"]["douleur_avant"], 6);

        let lignes = journal(&base, 2, None).unwrap();
        assert_eq!(lignes.len(), 2);
        assert_eq!(lignes[0].action, "seance.creee");
        let suite = journal(&base, 10, Some(lignes[1].id)).unwrap();
        assert!(suite.iter().all(|l| l.id < lignes[1].id));
    }
}
