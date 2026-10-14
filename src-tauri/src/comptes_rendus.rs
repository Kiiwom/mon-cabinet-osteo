//! Commandes du compte rendu de séance : champs proposés, aperçu, PDF enregistré ou imprimé.

use std::path::PathBuf;
use std::sync::Arc;

use osteosphere_core::base::Base;
use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_core::seances::Seance;
use osteosphere_core::{documents, modeles, patients, seances};
use osteosphere_documents::{ChampImprimable, DemandeCompteRendu, champs_imprimables, compte_rendu_pdf, compte_rendu_svg};
use tauri::State;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};
use crate::facturation::{montrer, nom_de_fichier};

fn aujourdhui() -> String {
    osteosphere_core::horloge::paris(osteosphere_core::base::maintenant()).0.to_string()
}

/// Compose le compte rendu de la séance avec les champs choisis : rend le PDF, la séance et le nom du patient.
fn composer<T>(base: &Base, seance_id: &str, champs: &[String], rendu: impl FnOnce(&DemandeCompteRendu) -> Result<T, String>) -> Result<(T, Seance, String), String> {
    let seance = seances::lire(base, seance_id).map_err(message)?;
    let patient = patients::lire(base, &seance.patient_id).map_err(message)?;
    let definition = modeles::lire_version(base, &seance.saisie.modele_id, seance.saisie.modele_version).map_err(message)?;
    let praticien: IdentiteCabinet = base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default();
    let habillage = crate::documents::habillage(base)?;
    let jour = aujourdhui();
    let demande =
        DemandeCompteRendu { praticien: &praticien, patient: &patient.fiche, seance: &seance, definition: &definition, champs: Some(champs), aujourdhui: &jour, habillage: &habillage };
    let resultat = rendu(&demande)?;
    let nom = format!("{} {}", patient.fiche.prenom.trim(), patient.fiche.nom.trim());
    Ok((resultat, seance, nom))
}

#[tauri::command]
pub fn champs_compte_rendu(etat: State<'_, Arc<EtatCabinet>>, seance_id: String) -> Result<Vec<ChampImprimable>, String> {
    etat.avec_base(|base| {
        let seance = seances::lire(base, &seance_id).map_err(message)?;
        let definition = modeles::lire_version(base, &seance.saisie.modele_id, seance.saisie.modele_version).map_err(message)?;
        Ok(champs_imprimables(&definition, &seance))
    })
}

/// Les pages en SVG, pour l'aperçu.
#[tauri::command]
pub async fn apercu_compte_rendu(etat: State<'_, Arc<EtatCabinet>>, seance_id: String, champs: Vec<String>) -> Result<Vec<String>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || etat.avec_base(|base| composer(base, &seance_id, &champs, |d| compte_rendu_svg(d).map_err(message))).map(|(pages, _, _)| pages))
        .await
}

/// `Documents/Osteosphere/Comptes rendus/2026/Compte rendu 2026-10-06 - Camille Martin.pdf`, sans écraser un compte rendu déjà rangé.
fn chemin_pdf(etat: &EtatCabinet, seance: &Seance, nom: &str) -> PathBuf {
    let jour = seance.saisie.debut.get(..10).unwrap_or("séance");
    let dossier = etat.dossier_documents().join("Comptes rendus").join(jour.get(..4).unwrap_or("Autres"));
    let base = nom_de_fichier(&format!("Compte rendu {jour} - {nom}"));
    (1..).map(|rang| dossier.join(if rang == 1 { format!("{base}.pdf") } else { format!("{base} ({rang}).pdf") })).find(|c| !c.exists()).unwrap_or_else(|| dossier.join(format!("{base}.pdf")))
}

fn enregistrer(etat: &EtatCabinet, seance_id: &str, champs: &[String], joindre: bool) -> Result<PathBuf, String> {
    etat.avec_base(|base| {
        let (pdf, seance, nom) = composer(base, seance_id, champs, |d| compte_rendu_pdf(d).map_err(message))?;
        let chemin = chemin_pdf(etat, &seance, &nom);
        if let Some(parent) = chemin.parent() {
            std::fs::create_dir_all(parent).map_err(message)?;
        }
        std::fs::write(&chemin, &pdf).map_err(message)?;
        if joindre {
            let fichier = chemin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Compte rendu.pdf".into());
            documents::ajouter(base, &seance.patient_id, Some(&seance.id), &fichier, &pdf).map_err(message)?;
        }
        Ok(chemin)
    })
}

/// Range le PDF dans Documents › Osteosphere › Comptes rendus et le montre ; `joindre` l'ajoute aussi
/// aux documents de la séance, dans le dossier chiffré.
#[tauri::command]
pub async fn enregistrer_compte_rendu(etat: State<'_, Arc<EtatCabinet>>, seance_id: String, champs: Vec<String>, joindre: bool) -> Result<String, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let chemin = enregistrer(&etat, &seance_id, &champs, joindre)?;
        montrer(&chemin);
        Ok(chemin.display().to_string())
    })
    .await
}

/// Ouvre le PDF dans le lecteur du système, d'où il s'imprime.
#[tauri::command]
pub async fn imprimer_compte_rendu(etat: State<'_, Arc<EtatCabinet>>, seance_id: String, champs: Vec<String>) -> Result<(), String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let chemin = enregistrer(&etat, &seance_id, &champs, false)?;
        tauri_plugin_opener::open_path(&chemin, None::<&str>).map_err(message)
    })
    .await
}
