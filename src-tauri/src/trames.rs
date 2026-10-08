//! Commandes des trames : liste, enregistrement, suppression, caractère d'appel, échange en fichier.

use std::path::Path;
use std::sync::Arc;

use osteosphere_core::base::maintenant;
use osteosphere_core::cabinet::{CaractereTrames, PARAMETRE_TRAMES};
use osteosphere_core::horloge;
use osteosphere_core::trames::{self, BilanEchange, Conflit, SaisieTrame, Trame, TrameImportee};
use tauri::State;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};
use crate::facturation::{montrer, nom_de_fichier};

/// Un fichier d'échange (trames ou modèle) : du texte, cinq mégaoctets au plus.
pub(crate) fn lire_fichier_echange(chemin: &str) -> Result<String, String> {
    let taille = std::fs::metadata(chemin).map_err(|_| "Ce fichier est introuvable.".to_owned())?.len();
    if taille > 5 * 1024 * 1024 {
        return Err("Ce fichier est trop gros pour un fichier d’échange (5 Mo au plus).".into());
    }
    std::fs::read_to_string(chemin).map_err(|_| "Ce fichier n’est pas un fichier texte lisible.".into())
}

/// Écrit un fichier d'échange dans Documents › Osteosphere › Exports, daté du jour, et le montre.
pub(crate) fn ecrire_fichier_echange(etat: &EtatCabinet, nom: &str, contenu: &str) -> Result<String, String> {
    let dossier = etat.dossier_documents().join("Exports");
    std::fs::create_dir_all(&dossier).map_err(message)?;
    let chemin = dossier.join(nom_de_fichier(&format!("{nom} {}.json", horloge::paris(maintenant()).0)));
    std::fs::write(&chemin, contenu).map_err(message)?;
    montrer(Path::new(&chemin));
    Ok(chemin.display().to_string())
}

/// Exporte les trames choisies (toutes sans liste) dans un fichier d'échange.
#[tauri::command]
pub async fn exporter_trames(etat: State<'_, Arc<EtatCabinet>>, ids: Option<Vec<String>>) -> Result<String, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = etat.avec_base(|base| trames::exporter(base, ids.as_deref()).map_err(message))?;
        ecrire_fichier_echange(&etat, "Trames Osteosphere", &contenu)
    })
    .await
}

#[tauri::command]
pub async fn analyser_trames(etat: State<'_, Arc<EtatCabinet>>, chemin: String) -> Result<Vec<TrameImportee>, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_fichier_echange(&chemin)?;
        etat.avec_base(|base| trames::analyser_import(base, &contenu).map_err(message))
    })
    .await
}

#[tauri::command]
pub async fn importer_trames(etat: State<'_, Arc<EtatCabinet>>, chemin: String, conflit: Conflit) -> Result<BilanEchange, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_fichier_echange(&chemin)?;
        etat.avec_base(|base| trames::importer(base, &contenu, conflit).map_err(message))
    })
    .await
}

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

/// Le caractère qui appelle les trames, @ ou /, se change à tout moment.
#[tauri::command]
pub fn definir_caractere_trames(etat: State<'_, Arc<EtatCabinet>>, caractere: CaractereTrames) -> Result<CaractereTrames, String> {
    etat.avec_base(|base| {
        let avant: CaractereTrames = base.lire_parametre(PARAMETRE_TRAMES).map_err(message)?.unwrap_or_default();
        base.ecrire_parametre(PARAMETRE_TRAMES, &caractere).map_err(message)?;
        let json = |c: &CaractereTrames| serde_json::to_string(c).ok();
        base.journaliser("trames.caractere", PARAMETRE_TRAMES, json(&avant).as_deref(), json(&caractere).as_deref()).map_err(message)?;
        Ok(caractere)
    })
}

/// Le catalogue de trames partagées par les praticiens, dans le dépôt du projet.
const CATALOGUE: &str = "https://github.com/Kiiwom/mon-cabinet-osteo/tree/main/catalogue/trames";

/// Ouvre le catalogue dans le navigateur : une adresse fixe, jamais une adresse venue de l'interface.
#[tauri::command]
pub fn ouvrir_catalogue_trames() -> Result<(), String> {
    tauri_plugin_opener::open_url(CATALOGUE, None::<&str>).map_err(|_| format!("Impossible d’ouvrir le navigateur. Le catalogue est à l’adresse {CATALOGUE}"))
}
