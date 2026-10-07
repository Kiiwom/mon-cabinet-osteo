//! Commandes des paramètres du cabinet : identité et mentions imprimées sur les factures.

use std::sync::Arc;

use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use tauri::State;

use crate::demarrage::{EtatCabinet, message};

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
