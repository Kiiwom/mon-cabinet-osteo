//! Commandes des pièces jointes : ajout par la fenêtre du système ou par glisser-déposer, aperçu,
//! ouverture dans une autre application, copie, corbeille.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use osteosphere_core::documents::{self, Document, TAILLE_MAX};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};

/// Efface les copies en clair laissées par « Ouvrir » ; une erreur est seulement notée.
pub fn effacer_copies_ouvertes(dossier: &Path) {
    if dossier.exists()
        && let Err(erreur) = std::fs::remove_dir_all(dossier)
    {
        log::warn!("copies de documents non effacées dans {} : {erreur}", dossier.display());
    }
}

#[tauri::command]
pub fn lister_documents(etat: State<'_, Arc<EtatCabinet>>, patient_id: String) -> Result<Vec<Document>, String> {
    etat.avec_base(|base| documents::lister(base, &patient_id).map_err(message))
}

#[derive(Serialize)]
pub struct AjoutDocuments {
    ajoutes: Vec<Document>,
    /// Un message par fichier refusé (trop gros, illisible…) ; les autres sont ajoutés.
    erreurs: Vec<String>,
}

/// Ajoute des fichiers du disque (choisis ou déposés) au dossier, et à la séance si elle est donnée.
#[tauri::command]
pub async fn ajouter_documents(
    etat: State<'_, Arc<EtatCabinet>>,
    patient_id: String,
    seance_id: Option<String>,
    chemins: Vec<String>,
) -> Result<AjoutDocuments, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let mut ajout = AjoutDocuments { ajoutes: Vec::new(), erreurs: Vec::new() };
        for chemin in &chemins {
            let chemin = PathBuf::from(chemin);
            let nom = chemin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Document".into());
            let lecture = std::fs::metadata(&chemin).and_then(|m| {
                if m.is_dir() {
                    Err(std::io::Error::other("c'est un dossier, pas un fichier"))
                } else if m.len() > TAILLE_MAX as u64 {
                    Err(std::io::Error::other("dépasse 30 Mo : gardez-le dans un dossier de l'ordinateur"))
                } else {
                    std::fs::read(&chemin)
                }
            });
            match lecture {
                Ok(octets) => match etat.avec_base(|base| documents::ajouter(base, &patient_id, seance_id.as_deref(), &nom, &octets).map_err(message)) {
                    Ok(document) => ajout.ajoutes.push(document),
                    Err(erreur) => ajout.erreurs.push(erreur),
                },
                Err(erreur) => ajout.erreurs.push(format!("« {nom} » : {erreur}")),
            }
        }
        Ok(ajout)
    })
    .await
}

/// Fenêtre du système pour choisir un ou plusieurs fichiers ; vide si le praticien annule.
#[tauri::command]
pub async fn choisir_documents(app: AppHandle) -> Result<Vec<String>, String> {
    en_arriere_plan(move || {
        let fichiers = app.dialog().file().set_title("Ajouter des documents au dossier").blocking_pick_files().unwrap_or_default();
        Ok(fichiers.into_iter().filter_map(|f| f.into_path().ok()).map(|p| p.display().to_string()).collect())
    })
    .await
}

/// Le contenu brut, pour l'aperçu dans l'application (images, PDF).
#[tauri::command]
pub async fn contenu_document(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Response, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || etat.avec_base(|base| documents::contenu(base, &id).map_err(message)).map(|(_, octets)| Response::new(octets))).await
}

#[tauri::command]
pub fn modifier_document(etat: State<'_, Arc<EtatCabinet>>, id: String, nom: String, seance_id: Option<String>) -> Result<Document, String> {
    etat.avec_base(|base| documents::modifier(base, &id, &nom, seance_id.as_deref()).map_err(message))
}

#[tauri::command]
pub fn supprimer_document(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    etat.avec_base(|base| documents::supprimer(base, &id).map_err(message))
}

#[tauri::command]
pub fn restaurer_document(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Document, String> {
    etat.avec_base(|base| documents::restaurer(base, &id).map_err(message))
}

#[tauri::command]
pub fn corbeille_documents(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<Document>, String> {
    etat.avec_base(|base| documents::corbeille(base).map_err(message))
}

/// Ouvre le document dans l'application du système : une copie en clair est écrite pour cela, et
/// effacée à la prochaine ouverture ou à la fermeture du cabinet.
#[tauri::command]
pub async fn ouvrir_document(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (document, octets) = etat.avec_base(|base| documents::contenu(base, &id).map_err(message))?;
        // Un sous-dossier par document : deux documents du même nom ne s'écrasent pas.
        let dossier = etat.dossier_copies().join(&document.id);
        std::fs::create_dir_all(&dossier).map_err(message)?;
        let chemin = dossier.join(&document.nom);
        std::fs::write(&chemin, octets).map_err(message)?;
        tauri_plugin_opener::open_path(&chemin, None::<&str>).map_err(message)
    })
    .await
}

/// Enregistre une copie du document là où le praticien le choisit ; `None` s'il annule.
#[tauri::command]
pub async fn enregistrer_copie_document(app: AppHandle, etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Option<String>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (document, octets) = etat.avec_base(|base| documents::contenu(base, &id).map_err(message))?;
        let Some(cible) = app.dialog().file().set_title("Enregistrer une copie").set_file_name(&document.nom).blocking_save_file() else {
            return Ok(None);
        };
        let cible = cible.into_path().map_err(message)?;
        std::fs::write(&cible, octets).map_err(message)?;
        Ok(Some(cible.display().to_string()))
    })
    .await
}
