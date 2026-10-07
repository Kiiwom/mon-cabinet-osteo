//! Commandes des documents : facture d'essai du prototype.

use std::sync::Arc;

use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_core::numerotation::{Date, EtatAnnee, FormatNumero, prochain_numero};
use osteosphere_documents::{Destinataire, Facture, LigneFacture, Reglement, facture_pdf};
use tauri::State;
use tauri::ipc::Response;

use crate::demarrage::{EtatCabinet, message};

/// Facture d'essai : identité du cabinet, patiente et numéro fictifs, filigrane « ESSAI ».
/// Aucun numéro n'est réservé : la numérotation réelle n'avance pas.
fn facture_essai(etat: &EtatCabinet, date: &str) -> Result<Vec<u8>, String> {
    let praticien: IdentiteCabinet =
        etat.avec_base(|base| Ok(base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default()))?;
    let jour = Date::lire(date).map_err(message)?;
    let numero = prochain_numero(&FormatNumero::default(), jour, &EtatAnnee::default(), 1).map_err(message)?.numero;
    let facture = Facture {
        numero,
        date_emission: date.to_owned(),
        date_seance: Some(date.to_owned()),
        praticien,
        destinataire: Destinataire {
            civilite: "Mme".into(),
            prenom: "Camille".into(),
            nom: "Martin".into(),
            adresse: "12 rue des Tilleuls".into(),
            code_postal: "47500".into(),
            ville: "Fumel".into(),
        },
        lignes: vec![LigneFacture {
            designation: "Consultation d’ostéopathie".into(),
            quantite: 1,
            prix_unitaire_centimes: 5500,
        }],
        reglements: vec![Reglement { moyen: "carte".into(), date: date.to_owned(), montant_centimes: 5500 }],
        commentaire: "Facture d’essai : patiente et numéro fictifs.".into(),
        essai: true,
    };
    facture_pdf(&facture).map_err(message)
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
