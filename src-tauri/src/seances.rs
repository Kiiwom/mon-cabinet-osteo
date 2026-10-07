//! Commandes des séances : création, lecture, enregistrement au fil de la saisie, listes, corbeille.

use std::sync::Arc;

use osteosphere_core::seances::{self, ResumeSeance, SaisieSeance, Seance};
use tauri::State;

use crate::demarrage::{EtatCabinet, message};

#[tauri::command]
pub fn creer_seance(etat: State<'_, Arc<EtatCabinet>>, patient_id: String, saisie: SaisieSeance) -> Result<Seance, String> {
    etat.avec_base(|base| seances::creer(base, &patient_id, &saisie).map_err(message))
}

#[tauri::command]
pub fn lire_seance(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Seance, String> {
    etat.avec_base(|base| seances::lire(base, &id).map_err(message))
}

#[tauri::command]
pub fn enregistrer_seance(etat: State<'_, Arc<EtatCabinet>>, id: String, saisie: SaisieSeance) -> Result<Seance, String> {
    etat.avec_base(|base| seances::enregistrer(base, &id, &saisie).map_err(message))
}

#[tauri::command]
pub fn lister_seances_patient(etat: State<'_, Arc<EtatCabinet>>, patient_id: String) -> Result<Vec<ResumeSeance>, String> {
    etat.avec_base(|base| seances::lister_patient(base, &patient_id).map_err(message))
}

#[tauri::command]
pub fn lister_seances_periode(etat: State<'_, Arc<EtatCabinet>>, du: String, au: String) -> Result<Vec<ResumeSeance>, String> {
    etat.avec_base(|base| seances::lister_periode(base, &du, &au).map_err(message))
}

#[tauri::command]
pub fn supprimer_seance(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    etat.avec_base(|base| seances::supprimer(base, &id).map_err(message))
}

#[tauri::command]
pub fn restaurer_seance(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Seance, String> {
    etat.avec_base(|base| seances::restaurer(base, &id).map_err(message))
}

#[tauri::command]
pub fn corbeille_seances(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<ResumeSeance>, String> {
    etat.avec_base(|base| seances::corbeille(base).map_err(message))
}
