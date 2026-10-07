//! Commandes des modèles de consultation : liste, versions passées, enregistrement, modèle par défaut.

use std::sync::Arc;

use osteosphere_core::modeles::{self, Definition, Modele, SaisieModele};
use tauri::State;

use crate::demarrage::{EtatCabinet, message};

#[tauri::command]
pub fn lister_modeles(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<Modele>, String> {
    etat.avec_base(|base| modeles::lister(base).map_err(message))
}

#[tauri::command]
pub fn lire_version_modele(etat: State<'_, Arc<EtatCabinet>>, id: String, version: i64) -> Result<Definition, String> {
    etat.avec_base(|base| modeles::lire_version(base, &id, version).map_err(message))
}

#[tauri::command]
pub fn enregistrer_modele(etat: State<'_, Arc<EtatCabinet>>, id: Option<String>, saisie: SaisieModele) -> Result<Modele, String> {
    etat.avec_base(|base| modeles::enregistrer(base, id.as_deref(), &saisie).map_err(message))
}

#[tauri::command]
pub fn definir_modele_par_defaut(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Modele, String> {
    etat.avec_base(|base| modeles::definir_par_defaut(base, &id).map_err(message))
}
