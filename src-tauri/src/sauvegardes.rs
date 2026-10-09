//! Commandes des sauvegardes, de la restauration, de la sécurité, de l'export complet et du journal.

use std::path::PathBuf;
use std::sync::Arc;

use osteosphere_core::base::maintenant;
use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_SAUVEGARDES, PreferencesSauvegarde};
use osteosphere_core::cle_de_secours::CleDeSecours;
use osteosphere_core::export::{self, LigneJournal};
use osteosphere_core::facturation;
use osteosphere_core::sauvegardes::{self, Apercu, DerniereSauvegarde, EXTENSION, FichierSauvegarde};
use osteosphere_core::verrouillage::{self, EtatVerrouillage};
use osteosphere_session::SessionOrdinateur;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

use crate::demarrage::{EtatCabinet, Restauration, Session, en_arriere_plan, message};

#[derive(Serialize)]
pub struct EtatSauvegardes {
    preferences: PreferencesSauvegarde,
    /// Le dossier réellement utilisé : celui choisi, sinon celui proposé.
    dossier: String,
    derniere: Option<DerniereSauvegarde>,
    /// Dernière erreur de la sauvegarde automatique, s'il y en a eu une depuis l'ouverture.
    erreur: Option<String>,
}

fn etat_sauvegardes(etat: &EtatCabinet) -> Result<EtatSauvegardes, String> {
    etat.avec_base(|base| {
        let preferences: PreferencesSauvegarde = base.lire_parametre(PARAMETRE_SAUVEGARDES).map_err(message)?.unwrap_or_default();
        Ok(EtatSauvegardes {
            dossier: etat.dossier_sauvegardes(&preferences).display().to_string(),
            derniere: sauvegardes::derniere(base).map_err(message)?,
            erreur: etat.erreur_sauvegarde.lock().map_err(message)?.clone(),
            preferences,
        })
    })
}

#[tauri::command]
pub fn etat_des_sauvegardes(etat: State<'_, Arc<EtatCabinet>>) -> Result<EtatSauvegardes, String> {
    etat_sauvegardes(&etat)
}

#[tauri::command]
pub fn enregistrer_preferences_sauvegarde(
    etat: State<'_, Arc<EtatCabinet>>,
    preferences: PreferencesSauvegarde,
) -> Result<EtatSauvegardes, String> {
    let preferences = preferences.verifier().map_err(message)?;
    etat.avec_base(|base| base.ecrire_parametre(PARAMETRE_SAUVEGARDES, &preferences).map_err(message))?;
    etat_sauvegardes(&etat)
}

#[tauri::command]
pub async fn sauvegarder_maintenant(etat: State<'_, Arc<EtatCabinet>>) -> Result<FichierSauvegarde, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let fichier = etat.avec_base(|base| etat.sauvegarder(base))?;
        *etat.erreur_sauvegarde.lock().map_err(message)? = None;
        Ok(fichier)
    })
    .await
}

#[tauri::command]
pub async fn lister_sauvegardes(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<FichierSauvegarde>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let dossier = PathBuf::from(etat_sauvegardes(&etat)?.dossier);
        sauvegardes::lister(&dossier).map_err(message)
    })
    .await
}

/// Choix d'un fichier par la fenêtre du système : « sauvegarde » ou « import » (export MonCabinetLibéral).
#[tauri::command]
pub async fn choisir_fichier(app: AppHandle, sorte: String) -> Result<Option<String>, String> {
    en_arriere_plan(move || {
        let dialogue = app.dialog().file();
        let dialogue = match sorte.as_str() {
            "sauvegarde" => dialogue.set_title("Choisir une sauvegarde Osteosphere").add_filter("Sauvegarde Osteosphere", &[EXTENSION]),
            "import" => dialogue.set_title("Choisir l’export de MonCabinetLibéral").add_filter("Export MonCabinetLibéral (zip)", &["zip"]),
            "trames" => dialogue.set_title("Choisir un fichier de trames").add_filter("Trames (json)", &["json"]),
            "modele" => dialogue.set_title("Choisir un fichier de modèle de consultation").add_filter("Modèle de consultation (json)", &["json"]),
            _ => dialogue,
        };
        Ok(dialogue.blocking_pick_file().and_then(|f| f.into_path().ok()).map(|p| p.display().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn choisir_dossier(app: AppHandle) -> Result<Option<String>, String> {
    en_arriere_plan(move || {
        Ok(app.dialog().file().set_title("Choisir le dossier des sauvegardes").blocking_pick_folder().and_then(|f| f.into_path().ok()).map(|p| p.display().to_string()))
    })
    .await
}

/// Déchiffre et vérifie la sauvegarde avec la clé de secours, sans rien remplacer : rend son contenu.
#[tauri::command]
pub async fn apercu_restauration(etat: State<'_, Arc<EtatCabinet>>, chemin: String, cle: String) -> Result<Apercu, String> {
    let etat = Arc::clone(&etat);
    let cle = Zeroizing::new(cle);
    en_arriere_plan(move || {
        let secours = CleDeSecours::lire(&cle).map_err(message)?;
        let (entete, cle, copie, apercu) =
            sauvegardes::ouvrir(&PathBuf::from(chemin), &secours, etat.cabinet().dossier()).map_err(message)?;
        *etat.restauration.lock().map_err(message)? = Some(Restauration { entete, cle, copie });
        Ok(apercu)
    })
    .await
}

/// Remplace les données du cabinet par la sauvegarde vérifiée. L'ancienne base est mise de côté.
#[tauri::command]
pub async fn confirmer_restauration(etat: State<'_, Arc<EtatCabinet>>) -> Result<IdentiteCabinet, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let restauration = etat.restauration.lock().map_err(message)?.take().ok_or("Choisissez d’abord la sauvegarde à restaurer.")?;
        etat.restaurer(restauration)
    })
    .await
}

#[tauri::command]
pub fn annuler_restauration(etat: State<'_, Arc<EtatCabinet>>) -> Result<(), String> {
    if let Some(restauration) = etat.restauration.lock().map_err(message)?.take() {
        sauvegardes::effacer_copie(&restauration.copie).map_err(message)?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Securite {
    mot_de_passe_actif: bool,
    /// Faux si la session ne peut pas protéger la clé (Linux sans trousseau).
    session_protegee: bool,
    systeme: &'static str,
    /// Verrouillage après inactivité et code court : réglés même sans mot de passe, appliqués avec lui.
    verrouillage: EtatVerrouillage,
}

#[tauri::command]
pub async fn securite(etat: State<'_, Arc<EtatCabinet>>) -> Result<Securite, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        Ok(Securite {
            mot_de_passe_actif: etat.cabinet().mot_de_passe_actif().map_err(message)?,
            session_protegee: SessionOrdinateur::protection_disponible(),
            systeme: std::env::consts::OS,
            verrouillage: etat.avec_base(|base| verrouillage::etat(base).map_err(message))?,
        })
    })
    .await
}

/// Minutes d'inactivité avant le verrouillage automatique : aucune sans mot de passe ou si « jamais ».
#[tauri::command]
pub fn verrouillage_automatique(etat: State<'_, Arc<EtatCabinet>>) -> Result<Option<u32>, String> {
    if !etat.cabinet().mot_de_passe_actif().map_err(message)? {
        return Ok(None);
    }
    etat.avec_base(|base| Ok(verrouillage::lire(base).map_err(message)?.inactivite_minutes))
}

#[tauri::command]
pub fn regler_verrouillage_automatique(etat: State<'_, Arc<EtatCabinet>>, minutes: Option<u32>) -> Result<EtatVerrouillage, String> {
    etat.avec_base(|base| verrouillage::regler_inactivite(base, minutes).map_err(message))
}

#[tauri::command]
pub async fn definir_code_court(etat: State<'_, Arc<EtatCabinet>>, code: String) -> Result<(), String> {
    let etat = Arc::clone(&etat);
    let code = Zeroizing::new(code);
    en_arriere_plan(move || etat.avec_ouvert(|ouvert| etat.cabinet().definir_code_court(ouvert, &code).map_err(message))).await
}

#[tauri::command]
pub fn retirer_code_court(etat: State<'_, Arc<EtatCabinet>>) -> Result<(), String> {
    etat.avec_base(|base| verrouillage::retirer_code_court(base).map_err(message))
}

#[tauri::command]
pub async fn definir_mot_de_passe(etat: State<'_, Arc<EtatCabinet>>, mot_de_passe: String) -> Result<(), String> {
    let etat = Arc::clone(&etat);
    let mot_de_passe = Zeroizing::new(mot_de_passe);
    en_arriere_plan(move || {
        if mot_de_passe.chars().count() < 8 {
            return Err("Choisissez un mot de passe d’au moins 8 caractères.".into());
        }
        etat.avec_ouvert(|ouvert| etat.cabinet().definir_mot_de_passe(ouvert, &mot_de_passe).map_err(message))
    })
    .await
}

#[tauri::command]
pub async fn retirer_mot_de_passe(etat: State<'_, Arc<EtatCabinet>>) -> Result<(), String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || etat.avec_ouvert(|ouvert| etat.cabinet().retirer_mot_de_passe(ouvert, &Session).map_err(message))).await
}

#[derive(Serialize)]
pub struct Verrouille {
    /// Vrai si le code court rouvrira le cabinet.
    code_court: bool,
}

/// Verrouille le cabinet : la base est fermée, le mot de passe ou le code court sera demandé.
#[tauri::command]
pub async fn verrouiller(etat: State<'_, Arc<EtatCabinet>>) -> Result<Verrouille, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        if !etat.cabinet().mot_de_passe_actif().map_err(message)? {
            return Err("Sans mot de passe, utilisez le verrouillage de votre ordinateur.".into());
        }
        Ok(Verrouille { code_court: etat.verrouiller()? })
    })
    .await
}

#[tauri::command]
pub async fn exporter_tout(etat: State<'_, Arc<EtatCabinet>>) -> Result<String, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let dossier = etat.dossier_documents().join("Exports");
        let cible = etat.avec_base(|base| export::exporter_tout(base, &dossier, maintenant()).map_err(message))?;
        // Les PDF des factures et des avoirs émis, rangés comme dans Documents › Osteosphere › Factures.
        let emises = etat.avec_base(|base| facturation::lister(base, "1900-01-01", "2999-12-31").map_err(message))?;
        for resume in emises.iter().filter(|f| f.numero.is_some() && !f.importee) {
            match crate::facturation::pdf_de(&etat, &resume.id) {
                Ok((facture, pdf)) => {
                    let chemin = crate::facturation::chemin_pdf(&cible, &facture);
                    if let Some(parent) = chemin.parent() {
                        std::fs::create_dir_all(parent).map_err(message)?;
                    }
                    std::fs::write(&chemin, pdf).map_err(message)?;
                }
                Err(erreur) => log::warn!("PDF de la facture {:?} non exporté : {erreur}", resume.numero),
            }
        }
        if let Err(erreur) = tauri_plugin_opener::open_path(&cible, None::<&str>) {
            log::warn!("impossible d'ouvrir {} : {erreur}", cible.display());
        }
        Ok(cible.display().to_string())
    })
    .await
}

#[tauri::command]
pub fn journal(etat: State<'_, Arc<EtatCabinet>>, limite: u32, avant: Option<i64>) -> Result<Vec<LigneJournal>, String> {
    etat.avec_base(|base| export::journal(base, limite, avant).map_err(message))
}
