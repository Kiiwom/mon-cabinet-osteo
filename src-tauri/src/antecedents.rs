//! Commandes des antécédents : formulaire de rubriques, liste par patient, enregistrement, suppression.

use std::sync::Arc;

use osteosphere_core::antecedents::{self, Antecedent, CategorieAntecedents, SaisieAntecedent};
use tauri::State;

use crate::demarrage::{EtatCabinet, message};

#[tauri::command]
pub fn formulaire_antecedents(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<CategorieAntecedents>, String> {
    etat.avec_base(|base| antecedents::formulaire(base).map_err(message))
}

#[tauri::command]
pub fn lister_antecedents(etat: State<'_, Arc<EtatCabinet>>, patient_id: String) -> Result<Vec<Antecedent>, String> {
    etat.avec_base(|base| antecedents::lister(base, &patient_id).map_err(message))
}

#[tauri::command]
pub fn enregistrer_antecedent(
    etat: State<'_, Arc<EtatCabinet>>,
    patient_id: String,
    id: Option<String>,
    saisie: SaisieAntecedent,
) -> Result<Antecedent, String> {
    etat.avec_base(|base| antecedents::enregistrer(base, &patient_id, id.as_deref(), &saisie).map_err(message))
}

#[tauri::command]
pub fn supprimer_antecedent(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    etat.avec_base(|base| antecedents::supprimer(base, &id).map_err(message))
}
