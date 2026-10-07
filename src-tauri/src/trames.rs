//! Commandes des trames : liste, enregistrement, suppression, caractère d'appel.

use std::sync::Arc;

use osteosphere_core::cabinet::{CaractereTrames, PARAMETRE_TRAMES};
use osteosphere_core::trames::{self, SaisieTrame, Trame};
use tauri::State;

use crate::demarrage::{EtatCabinet, message};

#[tauri::command]
pub fn lister_trames(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<Trame>, String> {
    etat.avec_base(|base| trames::lister(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_trame(
    etat: State<'_, Arc<EtatCabinet>>,
    id: Option<String>,
    saisie: SaisieTrame,
) -> Result<Trame, String> {
    etat.avec_base(|base| trames::enregistrer(base, id.as_deref(), &saisie).map_err(message))
}

#[tauri::command]
pub fn supprimer_trame(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    etat.avec_base(|base| trames::supprimer(base, &id).map_err(message))
}

#[tauri::command]
pub fn noter_utilisation_trame(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    etat.avec_base(|base| trames::noter_utilisation(base, &id).map_err(message))
}

#[tauri::command]
pub fn caractere_trames(etat: State<'_, Arc<EtatCabinet>>) -> Result<CaractereTrames, String> {
    etat.avec_base(|base| Ok(base.lire_parametre(PARAMETRE_TRAMES).map_err(message)?.unwrap_or_default()))
}
