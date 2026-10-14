//! Commandes des documents : présentation (logo, signature, couleur) et facture d'essai, pour
//! vérifier la mise en page et les mentions.

use std::sync::Arc;

use osteosphere_core::base::Base;
use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_core::mise_en_page::{self, MiseEnPage, QuelleImage, TAILLE_MAX_IMAGE};
use osteosphere_documents::{Filigrane, Habillage, exemple, facture_pdf, facture_svg};
use tauri::ipc::Response;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};

/// Logo, signature et couleur tels que choisis dans Paramètres › Cabinet.
pub(crate) fn habillage(base: &Base) -> Result<Habillage, String> {
    Ok(Habillage {
        mise_en_page: mise_en_page::lire(base).map_err(message)?,
        logo: mise_en_page::lire_image(base, QuelleImage::Logo).map_err(message)?,
        signature: mise_en_page::lire_image(base, QuelleImage::Signature).map_err(message)?,
    })
}

#[tauri::command]
pub fn mise_en_page(etat: State<'_, Arc<EtatCabinet>>) -> Result<MiseEnPage, String> {
    etat.avec_base(|base| mise_en_page::lire(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_mise_en_page(etat: State<'_, Arc<EtatCabinet>>, mise_en_page: MiseEnPage) -> Result<MiseEnPage, String> {
    etat.avec_base(|base| mise_en_page::enregistrer(base, &mise_en_page).map_err(message))
}

/// Le logo ou la signature enregistrés, en octets ; vide s'il n'y en a pas.
#[tauri::command]
pub fn image_documents(etat: State<'_, Arc<EtatCabinet>>, quelle: QuelleImage) -> Result<Response, String> {
    let image = etat.avec_base(|base| mise_en_page::lire_image(base, quelle).map_err(message))?;
    Ok(Response::new(image.map(|i| i.octets).unwrap_or_default()))
}

/// Fenêtre du système pour choisir le logo ou la signature ; `false` si le praticien annule.
#[tauri::command]
pub async fn choisir_image_documents(app: AppHandle, etat: State<'_, Arc<EtatCabinet>>, quelle: QuelleImage) -> Result<bool, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let titre = match quelle {
            QuelleImage::Logo => "Choisir le logo du cabinet",
            QuelleImage::Signature => "Choisir l'image de votre signature",
        };
        let choix = app.dialog().file().set_title(titre).add_filter("Image PNG ou JPEG", &["png", "jpg", "jpeg"]).blocking_pick_file();
        let Some(chemin) = choix.and_then(|f| f.into_path().ok()) else {
            return Ok(false);
        };
        let taille = std::fs::metadata(&chemin).map_err(message)?.len();
        if taille > TAILLE_MAX_IMAGE as u64 {
            return Err("L'image dépasse 2 Mo : réduisez-la avant de l'ajouter.".into());
        }
        let octets = std::fs::read(&chemin).map_err(message)?;
        etat.avec_base(|base| mise_en_page::enregistrer_image(base, quelle, &octets).map_err(message))?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub fn supprimer_image_documents(etat: State<'_, Arc<EtatCabinet>>, quelle: QuelleImage) -> Result<(), String> {
    etat.avec_base(|base| mise_en_page::supprimer_image(base, quelle).map_err(message))
}

/// Facture d'essai : identité du cabinet, patiente et numéro fictifs, filigrane « ESSAI ».
/// Aucun numéro n'est réservé : la numérotation réelle n'avance pas.
fn essai(etat: &EtatCabinet, date: &str) -> Result<(IdentiteCabinet, Habillage), String> {
    osteosphere_core::numerotation::Date::lire(date).map_err(message)?;
    etat.avec_base(|base| Ok((base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default(), habillage(base)?)))
}

/// Les pages de la facture d'essai en SVG, pour l'aperçu dans l'application.
#[tauri::command]
pub async fn apercu_facture_essai(etat: State<'_, Arc<EtatCabinet>>, date: String) -> Result<Vec<String>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (praticien, habillage) = essai(&etat, &date)?;
        facture_svg(&exemple(&date), &praticien, Some(Filigrane::Essai), &habillage).map_err(message)
    })
    .await
}

/// Ouvre la facture d'essai dans le lecteur PDF de l'ordinateur.
#[tauri::command]
pub async fn ouvrir_facture_essai(etat: State<'_, Arc<EtatCabinet>>, date: String) -> Result<(), String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (praticien, habillage) = essai(&etat, &date)?;
        let pdf = facture_pdf(&exemple(&date), &praticien, Some(Filigrane::Essai), &habillage).map_err(message)?;
        let chemin = std::env::temp_dir().join("osteosphere-facture-essai.pdf");
        std::fs::write(&chemin, pdf).map_err(message)?;
        tauri_plugin_opener::open_path(&chemin, None::<&str>).map_err(message)
    })
    .await
}
