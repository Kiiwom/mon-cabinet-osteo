//! Commandes des dossiers patients : liste, lecture, création, modification, archives, statuts et groupes.

use std::sync::Arc;

use osteosphere_core::groupes::{self, Groupe, SaisieGroupe};
use osteosphere_core::patients::{self, FichePatient, Patient, ResumePatient, StatutSaisi};
use tauri::State;

use crate::demarrage::{EtatCabinet, message};

#[tauri::command]
pub fn lister_patients(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<ResumePatient>, String> {
    etat.avec_base(|base| patients::lister(base).map_err(message))
}

#[tauri::command]
pub fn lire_patient(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Patient, String> {
    etat.avec_base(|base| patients::lire(base, &id).map_err(message))
}

#[tauri::command]
pub fn creer_patient(etat: State<'_, Arc<EtatCabinet>>, fiche: FichePatient) -> Result<Patient, String> {
    etat.avec_base(|base| patients::creer(base, &fiche).map_err(message))
}

#[tauri::command]
pub fn modifier_patient(etat: State<'_, Arc<EtatCabinet>>, id: String, fiche: FichePatient) -> Result<Patient, String> {
    etat.avec_base(|base| patients::modifier(base, &id, &fiche).map_err(message))
}

#[tauri::command]
pub fn archiver_patient(etat: State<'_, Arc<EtatCabinet>>, id: String, archive: bool) -> Result<Patient, String> {
    etat.avec_base(|base| patients::archiver(base, &id, archive).map_err(message))
}

#[tauri::command]
pub fn statuts_patients(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<String>, String> {
    etat.avec_base(|base| patients::statuts(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_statuts(etat: State<'_, Arc<EtatCabinet>>, statuts: Vec<StatutSaisi>) -> Result<Vec<String>, String> {
    etat.avec_base(|base| patients::enregistrer_statuts(base, &statuts).map_err(message))
}

#[tauri::command]
pub fn lister_groupes(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<Groupe>, String> {
    etat.avec_base(|base| groupes::lister(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_groupe(etat: State<'_, Arc<EtatCabinet>>, id: Option<String>, saisie: SaisieGroupe) -> Result<Groupe, String> {
    etat.avec_base(|base| groupes::enregistrer(base, id.as_deref(), &saisie).map_err(message))
}

#[tauri::command]
pub fn supprimer_groupe(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    etat.avec_base(|base| groupes::supprimer(base, &id).map_err(message))
}
