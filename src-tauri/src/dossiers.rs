//! Commandes du dossier entier : proches et destinataire des factures, fusion, effacement,
//! historique des modifications, dossier PDF pour une demande d'accès.

use std::path::PathBuf;
use std::sync::Arc;

use osteosphere_core::base::Base;
use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_core::dossiers::{self, BilanEffacement, ContenuDossier, Modification};
use osteosphere_core::familles::{self, Proche};
use osteosphere_core::patients::{FichePatient, Patient};
use osteosphere_core::{antecedents, documents, facturation, groupes, modeles, patients, seances};
use osteosphere_documents::{DemandeDossier, RubriquesDossier, SeanceDuDossier, dossier_pdf, dossier_svg};
use tauri::State;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};
use crate::facturation::{montrer, nom_de_fichier};

#[tauri::command]
pub fn proches_patient(etat: State<'_, Arc<EtatCabinet>>, patient_id: String) -> Result<Vec<Proche>, String> {
    etat.avec_base(|base| familles::proches(base, &patient_id).map_err(message))
}

#[tauri::command]
pub fn lier_proche(etat: State<'_, Arc<EtatCabinet>>, patient_id: String, proche_id: String, lien: String) -> Result<Vec<Proche>, String> {
    etat.avec_base(|base| familles::lier(base, &patient_id, &proche_id, &lien).map_err(message))
}

#[tauri::command]
pub fn delier_proche(etat: State<'_, Arc<EtatCabinet>>, patient_id: String, proche_id: String) -> Result<Vec<Proche>, String> {
    etat.avec_base(|base| familles::delier(base, &patient_id, &proche_id).map_err(message))
}

#[tauri::command]
pub fn definir_payeur(etat: State<'_, Arc<EtatCabinet>>, patient_id: String, payeur: Option<String>) -> Result<Patient, String> {
    etat.avec_base(|base| familles::definir_payeur(base, &patient_id, payeur.as_deref()).map_err(message))
}

#[tauri::command]
pub fn contenu_dossier(etat: State<'_, Arc<EtatCabinet>>, patient_id: String) -> Result<ContenuDossier, String> {
    etat.avec_base(|base| dossiers::contenu(base, &patient_id).map_err(message))
}

#[tauri::command]
pub fn fusionner_dossiers(etat: State<'_, Arc<EtatCabinet>>, garde_id: String, absorbe_id: String, fiche: FichePatient) -> Result<Patient, String> {
    etat.avec_base(|base| dossiers::fusionner(base, &garde_id, &absorbe_id, &fiche).map_err(message))
}

#[tauri::command]
pub fn effacer_dossier(etat: State<'_, Arc<EtatCabinet>>, patient_id: String) -> Result<BilanEffacement, String> {
    etat.avec_base(|base| dossiers::effacer(base, &patient_id).map_err(message))
}

#[tauri::command]
pub fn historique_dossier(etat: State<'_, Arc<EtatCabinet>>, patient_id: String, limite: u32, avant: Option<i64>) -> Result<Vec<Modification>, String> {
    etat.avec_base(|base| dossiers::historique(base, &patient_id, limite.min(500), avant).map_err(message))
}

fn aujourdhui() -> String {
    osteosphere_core::horloge::paris(osteosphere_core::base::maintenant()).0.to_string()
}

/// Compose le dossier avec les rubriques et les séances choisies ; rend aussi le nom du patient.
fn composer<T>(base: &Base, patient_id: &str, rubriques: &RubriquesDossier, rendu: impl FnOnce(&DemandeDossier) -> Result<T, String>) -> Result<(T, String), String> {
    let patient = patients::lire(base, patient_id).map_err(message)?;
    let antecedents = antecedents::lister(base, patient_id).map_err(message)?;
    let formulaire = antecedents::formulaire(base).map_err(message)?;
    let proches = familles::proches(base, patient_id).map_err(message)?;
    let groupes = groupes::lister(base).map_err(message)?;
    let mut choisies = Vec::new();
    for id in &rubriques.seances {
        let seance = seances::lire(base, id).map_err(message)?;
        if seance.patient_id != patient_id || seance.supprimee_le.is_some() {
            continue;
        }
        let definition = modeles::lire_version(base, &seance.saisie.modele_id, seance.saisie.modele_version).map_err(message)?;
        choisies.push((seance, definition));
    }
    // Les séances dans l'ordre du temps, la première en tête.
    choisies.sort_by(|a, b| a.0.saisie.debut.cmp(&b.0.saisie.debut));
    let du_dossier: Vec<SeanceDuDossier> = choisies.iter().map(|(seance, definition)| SeanceDuDossier { seance, definition }).collect();
    let documents = documents::lister(base, patient_id).map_err(message)?;
    let factures = facturation::du_patient(base, patient_id).map_err(message)?;
    let praticien: IdentiteCabinet = base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default();
    let habillage = crate::documents::habillage(base)?;
    let jour = aujourdhui();
    let demande = DemandeDossier {
        praticien: &praticien,
        patient: &patient,
        rubriques,
        antecedents: &antecedents,
        formulaire: &formulaire,
        proches: &proches,
        groupes: &groupes,
        seances: &du_dossier,
        documents: &documents,
        factures: &factures,
        aujourdhui: &jour,
        habillage: &habillage,
    };
    let resultat = rendu(&demande)?;
    Ok((resultat, format!("{} {}", patient.fiche.prenom.trim(), patient.fiche.nom.trim())))
}

/// Les pages en SVG, pour l'aperçu.
#[tauri::command]
pub async fn apercu_dossier_pdf(etat: State<'_, Arc<EtatCabinet>>, patient_id: String, rubriques: RubriquesDossier) -> Result<Vec<String>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || etat.avec_base(|base| composer(base, &patient_id, &rubriques, |d| dossier_svg(d).map_err(message))).map(|(pages, _)| pages)).await
}

/// `Documents/Osteosphere/Dossiers/Dossier 2026-10-08 - Camille Martin.pdf`, sans écraser un dossier déjà rangé.
fn chemin_pdf(etat: &EtatCabinet, nom: &str) -> PathBuf {
    let dossier = etat.dossier_documents().join("Dossiers");
    let base = nom_de_fichier(&format!("Dossier {} - {nom}", aujourdhui()));
    (1..).map(|rang| dossier.join(if rang == 1 { format!("{base}.pdf") } else { format!("{base} ({rang}).pdf") })).find(|c| !c.exists()).unwrap_or_else(|| dossier.join(format!("{base}.pdf")))
}

/// Range le PDF dans Documents › Osteosphere › Dossiers, puis le montre ou l'ouvre dans le lecteur du système.
#[tauri::command]
pub async fn enregistrer_dossier_pdf(etat: State<'_, Arc<EtatCabinet>>, patient_id: String, rubriques: RubriquesDossier, ouvrir: bool) -> Result<String, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let chemin = etat.avec_base(|base| {
            let (pdf, nom) = composer(base, &patient_id, &rubriques, |d| dossier_pdf(d).map_err(message))?;
            let chemin = chemin_pdf(&etat, &nom);
            if let Some(parent) = chemin.parent() {
                std::fs::create_dir_all(parent).map_err(message)?;
            }
            std::fs::write(&chemin, &pdf).map_err(message)?;
            Ok(chemin)
        })?;
        if ouvrir {
            tauri_plugin_opener::open_path(&chemin, None::<&str>).map_err(message)?;
        } else {
            montrer(&chemin);
        }
        Ok(chemin.display().to_string())
    })
    .await
}
