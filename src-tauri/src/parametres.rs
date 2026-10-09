//! Commandes des paramètres du cabinet : identité et mentions imprimées sur les factures, accueil,
//! préférences de saisie et mots fréquents.

use std::sync::Arc;

use osteosphere_core::accueil::{self, Accueil};
use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_core::preferences::{self, Preferences};
use osteosphere_core::vocabulaire;
use tauri::State;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};

/// Assez de mots pour un vocabulaire de cabinet, peu pour la mémoire de l'interface.
const MOTS_FREQUENTS: usize = 5_000;

#[tauri::command]
pub fn identite_cabinet(etat: State<'_, Arc<EtatCabinet>>) -> Result<IdentiteCabinet, String> {
    etat.avec_base(|base| Ok(base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default()))
}

/// Les factures déjà émises gardent l'identité de leur jour d'émission.
#[tauri::command]
pub fn enregistrer_identite_cabinet(etat: State<'_, Arc<EtatCabinet>>, identite: IdentiteCabinet) -> Result<IdentiteCabinet, String> {
    let identite = identite.verifier().map_err(message)?;
    etat.avec_base(|base| {
        let avant: Option<IdentiteCabinet> = base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?;
        base.ecrire_parametre(PARAMETRE_IDENTITE, &identite).map_err(message)?;
        let json = |v: &IdentiteCabinet| serde_json::to_string(v).ok();
        base.journaliser("cabinet.identite", PARAMETRE_IDENTITE, avant.as_ref().and_then(json).as_deref(), json(&identite).as_deref())
            .map_err(message)?;
        Ok(identite)
    })
}

#[tauri::command]
pub fn accueil(etat: State<'_, Arc<EtatCabinet>>) -> Result<Accueil, String> {
    etat.avec_base(|base| accueil::lire(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_accueil(etat: State<'_, Arc<EtatCabinet>>, accueil: Accueil) -> Result<Accueil, String> {
    etat.avec_base(|base| accueil::enregistrer(base, &accueil).map_err(message))
}

#[tauri::command]
pub fn preferences(etat: State<'_, Arc<EtatCabinet>>) -> Result<Preferences, String> {
    etat.avec_base(|base| preferences::lire(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_preferences(etat: State<'_, Arc<EtatCabinet>>, preferences: Preferences) -> Result<Preferences, String> {
    etat.avec_base(|base| preferences::enregistrer(base, &preferences).map_err(message))
}

/// Le vocabulaire du praticien, pour proposer la fin des mots ; vide si la préférence est coupée.
#[tauri::command]
pub async fn mots_frequents(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<String>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        etat.avec_base(|base| {
            if !preferences::lire(base).map_err(message)?.mots_frequents {
                return Ok(Vec::new());
            }
            vocabulaire::mots_frequents(base, MOTS_FREQUENTS).map_err(message)
        })
    })
    .await
}
