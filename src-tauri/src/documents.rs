//! Commandes des documents : facture d'essai, pour vérifier la mise en page et les mentions.

use std::sync::Arc;

use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_documents::{Filigrane, exemple, facture_pdf};
use tauri::State;
use tauri::ipc::Response;

use crate::demarrage::{EtatCabinet, message};

/// Facture d'essai : identité du cabinet, patiente et numéro fictifs, filigrane « ESSAI ».
/// Aucun numéro n'est réservé : la numérotation réelle n'avance pas.
fn facture_essai(etat: &EtatCabinet, date: &str) -> Result<Vec<u8>, String> {
    let praticien: IdentiteCabinet =
        etat.avec_base(|base| Ok(base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default()))?;
    osteosphere_core::numerotation::Date::lire(date).map_err(message)?;
    facture_pdf(&exemple(date), &praticien, Some(Filigrane::Essai)).map_err(message)
}

async fn produire(etat: &State<'_, Arc<EtatCabinet>>, date: String) -> Result<Vec<u8>, String> {
    let etat = Arc::clone(etat);
    tauri::async_runtime::spawn_blocking(move || facture_essai(&etat, &date)).await.map_err(message)?
}

/// Le PDF en binaire, pour l'aperçu dans l'application.
#[tauri::command]
pub async fn facture_essai_pdf(etat: State<'_, Arc<EtatCabinet>>, date: String) -> Result<Response, String> {
    Ok(Response::new(produire(&etat, date).await?))
}

/// Ouvre la facture d'essai dans le lecteur PDF de l'ordinateur.
#[tauri::command]
pub async fn ouvrir_facture_essai(etat: State<'_, Arc<EtatCabinet>>, date: String) -> Result<(), String> {
    let pdf = produire(&etat, date).await?;
    let chemin = std::env::temp_dir().join("osteosphere-facture-essai.pdf");
    std::fs::write(&chemin, pdf).map_err(message)?;
    tauri_plugin_opener::open_path(&chemin, None::<&str>).map_err(message)
}
