//! Commandes de la facturation : prestations, factures et avoirs, règlements, recettes, PDF.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use osteosphere_core::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use osteosphere_core::facturation::{
    self, EtatFacture, EvenementFacture, Facture, LigneFacture, LigneRecette, Nature, ReglagesNumerotation, ResumeFacture,
    SaisieFacture, SaisieReglement,
};
use osteosphere_core::prestations::{self, Prestation, SaisiePrestation};
use osteosphere_core::seances::{self, ResumeSeance};
use osteosphere_documents::{Filigrane, facture_pdf, facture_svg};
use tauri::State;

use crate::demarrage::{EtatCabinet, message};

#[tauri::command]
pub fn lister_prestations(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<Prestation>, String> {
    etat.avec_base(|base| prestations::lister(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_prestation(etat: State<'_, Arc<EtatCabinet>>, id: Option<String>, saisie: SaisiePrestation) -> Result<Prestation, String> {
    etat.avec_base(|base| prestations::enregistrer(base, id.as_deref(), &saisie).map_err(message))
}

#[tauri::command]
pub fn reglages_numerotation(etat: State<'_, Arc<EtatCabinet>>) -> Result<ReglagesNumerotation, String> {
    etat.avec_base(|base| facturation::reglages(base).map_err(message))
}

#[tauri::command]
pub fn enregistrer_reglages_numerotation(
    etat: State<'_, Arc<EtatCabinet>>,
    reglages: ReglagesNumerotation,
) -> Result<ReglagesNumerotation, String> {
    etat.avec_base(|base| facturation::enregistrer_reglages(base, &reglages).map_err(message))
}

/// Numéro qu'aurait la prochaine facture émise à cette date, sans le réserver.
#[tauri::command]
pub fn numero_suivant(etat: State<'_, Arc<EtatCabinet>>, date: String) -> Result<String, String> {
    etat.avec_base(|base| facturation::numero_suivant(base, &date).map(|n| n.numero).map_err(message))
}

#[tauri::command]
pub fn lire_facture(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::lire(base, &id).map_err(message))
}

#[tauri::command]
pub fn creer_facture(etat: State<'_, Arc<EtatCabinet>>, saisie: SaisieFacture) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::creer_brouillon(base, &saisie).map_err(message))
}

#[tauri::command]
pub fn modifier_facture(etat: State<'_, Arc<EtatCabinet>>, id: String, saisie: SaisieFacture) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::modifier_brouillon(base, &id, &saisie).map_err(message))
}

#[tauri::command]
pub fn annoter_facture(etat: State<'_, Arc<EtatCabinet>>, id: String, commentaire: String) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::annoter(base, &id, &commentaire).map_err(message))
}

#[tauri::command]
pub fn supprimer_brouillon(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    etat.avec_base(|base| facturation::supprimer_brouillon(base, &id).map_err(message))
}

#[tauri::command]
pub fn emettre_facture(etat: State<'_, Arc<EtatCabinet>>, id: String, date: String) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::emettre(base, &id, &date).map_err(message))
}

#[tauri::command]
pub fn facturer_seance(
    etat: State<'_, Arc<EtatCabinet>>,
    seance_id: String,
    lignes: Vec<LigneFacture>,
    reglement: Option<SaisieReglement>,
    date: String,
) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::facturer_seance(base, &seance_id, &lignes, reglement.as_ref(), &date).map_err(message))
}

/// Émet en une fois les factures de plusieurs séances, avec la prestation proposée par défaut.
/// S'arrête à la première séance qui échoue : les précédentes restent facturées.
#[tauri::command]
pub fn facturer_seances(
    etat: State<'_, Arc<EtatCabinet>>,
    seances: Vec<String>,
    reglement: Option<SaisieReglement>,
    date: String,
) -> Result<Vec<Facture>, String> {
    etat.avec_base(|base| {
        let prestation = prestations::par_defaut(base)
            .map_err(message)?
            .ok_or("Créez d'abord une prestation dans Paramètres › Prestations et numérotation.")?;
        let ligne = LigneFacture {
            prestation_id: Some(prestation.id.clone()),
            designation: prestation.designation().to_owned(),
            quantite: 1,
            prix_unitaire_centimes: prestation.saisie.tarif_centimes,
            reduction_centimes: 0,
        };
        seances
            .iter()
            .map(|seance| {
                let reglement = reglement.clone().map(|r| SaisieReglement { montant_centimes: ligne.prix_unitaire_centimes, ..r });
                facturation::facturer_seance(base, seance, std::slice::from_ref(&ligne), reglement.as_ref(), &date).map_err(message)
            })
            .collect()
    })
}

#[tauri::command]
pub fn corriger_facture(etat: State<'_, Arc<EtatCabinet>>, id: String, saisie: SaisieFacture, date: String) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::corriger(base, &id, &saisie, &date).map_err(message))
}

#[tauri::command]
pub fn annuler_facture(etat: State<'_, Arc<EtatCabinet>>, id: String, date: String) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::annuler(base, &id, &date).map_err(message))
}

#[tauri::command]
pub fn ajouter_reglement(etat: State<'_, Arc<EtatCabinet>>, facture_id: String, saisie: SaisieReglement) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::ajouter_reglement(base, &facture_id, &saisie).map_err(message))
}

#[tauri::command]
pub fn modifier_reglement(etat: State<'_, Arc<EtatCabinet>>, id: String, saisie: SaisieReglement) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::modifier_reglement(base, &id, &saisie).map_err(message))
}

#[tauri::command]
pub fn supprimer_reglement(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Facture, String> {
    etat.avec_base(|base| facturation::supprimer_reglement(base, &id).map_err(message))
}

#[tauri::command]
pub fn lister_factures(etat: State<'_, Arc<EtatCabinet>>, du: String, au: String) -> Result<Vec<ResumeFacture>, String> {
    etat.avec_base(|base| facturation::lister(base, &du, &au).map_err(message))
}

#[tauri::command]
pub fn factures_en_attente(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<ResumeFacture>, String> {
    etat.avec_base(|base| facturation::en_attente(base).map_err(message))
}

#[tauri::command]
pub fn factures_patient(etat: State<'_, Arc<EtatCabinet>>, patient_id: String) -> Result<Vec<ResumeFacture>, String> {
    etat.avec_base(|base| facturation::du_patient(base, &patient_id).map_err(message))
}

#[tauri::command]
pub fn facture_de_seance(etat: State<'_, Arc<EtatCabinet>>, seance_id: String) -> Result<Option<Facture>, String> {
    etat.avec_base(|base| facturation::de_la_seance(base, &seance_id).map_err(message))
}

#[tauri::command]
pub fn historique_facture(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Vec<EvenementFacture>, String> {
    etat.avec_base(|base| facturation::historique(base, &id).map_err(message))
}

#[tauri::command]
pub fn recettes(etat: State<'_, Arc<EtatCabinet>>, du: String, au: String) -> Result<Vec<LigneRecette>, String> {
    etat.avec_base(|base| facturation::recettes(base, &du, &au).map_err(message))
}

#[tauri::command]
pub fn seances_a_facturer(etat: State<'_, Arc<EtatCabinet>>) -> Result<Vec<ResumeSeance>, String> {
    etat.avec_base(|base| seances::lister_a_facturer(base).map_err(message))
}

/// La facture et l'identité qui s'y imprime : celle gardée à l'émission, celle du jour pour un brouillon.
fn a_imprimer(etat: &EtatCabinet, id: &str) -> Result<(Facture, IdentiteCabinet, Option<Filigrane>), String> {
    let (facture, actuelle) = etat.avec_base(|base| {
        let facture = facturation::lire(base, id).map_err(message)?;
        let actuelle: IdentiteCabinet = base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default();
        Ok((facture, actuelle))
    })?;
    if facture.importee {
        return Err("Facture importée de MonCabinetLibéral : son PDF d'origine est dans votre ancien logiciel.".into());
    }
    let filigrane = (facture.etat == EtatFacture::Brouillon).then_some(Filigrane::Brouillon);
    let praticien = facture.praticien.clone().unwrap_or(actuelle);
    Ok((facture, praticien, filigrane))
}

fn pdf_de(etat: &EtatCabinet, id: &str) -> Result<(Facture, Vec<u8>), String> {
    let (facture, praticien, filigrane) = a_imprimer(etat, id)?;
    let pdf = facture_pdf(&facture, &praticien, filigrane).map_err(message)?;
    Ok((facture, pdf))
}

async fn en_arriere_plan<T: Send + 'static>(travail: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(travail).await.map_err(message)?
}

/// Les pages de la facture en SVG, pour l'aperçu dans l'application.
#[tauri::command]
pub async fn apercu_facture(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<Vec<String>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (facture, praticien, filigrane) = a_imprimer(&etat, &id)?;
        facture_svg(&facture, &praticien, filigrane).map_err(message)
    })
    .await
}

/// Montre le fichier dans le gestionnaire de fichiers. Sans gestionnaire de fichiers disponible,
/// le fichier reste écrit et son chemin s'affiche : ce n'est pas une erreur.
fn montrer(chemin: &Path) {
    if let Err(erreur) = tauri_plugin_opener::reveal_item_in_dir(chemin) {
        log::warn!("impossible de montrer {} : {erreur}", chemin.display());
    }
}

/// Retire d'un nom de fichier les caractères refusés par Windows.
fn nom_de_fichier(texte: &str) -> String {
    texte
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .to_owned()
}

/// `Documents/Osteosphere/Factures/2026/Facture 2026-10-1772 - Camille Martin.pdf`
fn chemin_pdf(dossier: &Path, facture: &Facture) -> PathBuf {
    let annee = facture.date_emission.as_deref().and_then(|d| d.get(..4)).unwrap_or("Brouillons");
    let nature = if facture.nature == Nature::Avoir { "Avoir" } else { "Facture" };
    let numero = facture.numero.clone().unwrap_or_else(|| "brouillon".into());
    let nom = facture.saisie.destinataire.nom_complet();
    dossier.join("Factures").join(annee).join(nom_de_fichier(&format!("{nature} {numero} - {nom}.pdf")))
}

fn enregistrer(etat: &EtatCabinet, id: &str) -> Result<(Facture, PathBuf), String> {
    let (facture, pdf) = pdf_de(etat, id)?;
    let chemin = chemin_pdf(etat.dossier_documents(), &facture);
    if let Some(parent) = chemin.parent() {
        std::fs::create_dir_all(parent).map_err(message)?;
    }
    std::fs::write(&chemin, pdf).map_err(message)?;
    Ok((facture, chemin))
}

/// Range le PDF dans Documents › Osteosphere › Factures et le montre dans son dossier.
#[tauri::command]
pub async fn enregistrer_facture_pdf(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<String, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (_, chemin) = enregistrer(&etat, &id)?;
        montrer(&chemin);
        Ok(chemin.display().to_string())
    })
    .await
}

/// Ouvre le PDF dans le lecteur de l'ordinateur, pour l'imprimer.
#[tauri::command]
pub async fn imprimer_facture(etat: State<'_, Arc<EtatCabinet>>, id: String) -> Result<(), String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (_, chemin) = enregistrer(&etat, &id)?;
        tauri_plugin_opener::open_path(&chemin, None::<&str>).map_err(message)
    })
    .await
}

fn encoder_url(texte: &str) -> String {
    texte
        .bytes()
        .map(|o| match o {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (o as char).to_string(),
            _ => format!("%{o:02X}"),
        })
        .collect()
}

/// Prépare un email au patient dans la messagerie de l'ordinateur et montre le PDF à joindre :
/// une adresse « mailto » ne peut pas porter de pièce jointe.
#[tauri::command]
pub async fn preparer_email_facture(etat: State<'_, Arc<EtatCabinet>>, id: String, email: String) -> Result<String, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let (facture, chemin) = enregistrer(&etat, &id)?;
        let praticien = facture.praticien.clone().unwrap_or_default();
        let nature = if facture.nature == Nature::Avoir { "Avoir" } else { "Facture" };
        let numero = facture.numero.clone().unwrap_or_default();
        let sujet = format!("{nature} n° {numero}");
        let corps = format!(
            "Bonjour,\n\nVeuillez trouver ci-joint votre {} n° {numero}.\n\nBien cordialement,\n{} {}\n",
            nature.to_lowercase(),
            praticien.prenom,
            praticien.nom
        );
        let adresse = format!("mailto:{}?subject={}&body={}", encoder_url(email.trim()), encoder_url(&sujet), encoder_url(&corps));
        montrer(&chemin);
        tauri_plugin_opener::open_url(adresse, None::<&str>).map_err(message)?;
        Ok(chemin.display().to_string())
    })
    .await
}

/// Écrit un export (CSV, texte) dans Documents › Osteosphere › Exports et le montre.
#[tauri::command]
pub async fn exporter_fichier(etat: State<'_, Arc<EtatCabinet>>, nom: String, contenu: String) -> Result<String, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let dossier = etat.dossier_documents().join("Exports");
        std::fs::create_dir_all(&dossier).map_err(message)?;
        let chemin = dossier.join(nom_de_fichier(&nom));
        std::fs::write(&chemin, contenu).map_err(message)?;
        montrer(&chemin);
        Ok(chemin.display().to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noms_de_fichier_et_adresses() {
        assert_eq!(nom_de_fichier("Facture 2026/10 - Martin: «A»?.pdf"), "Facture 2026-10 - Martin- «A»-.pdf");
        assert_eq!(encoder_url("n° 1 & ?"), "n%C2%B0%201%20%26%20%3F");
    }
}
