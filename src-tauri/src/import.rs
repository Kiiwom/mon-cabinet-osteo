//! Commandes de l'import MonCabinetLibéral : l'archive est d'abord analysée sans rien écrire, puis
//! importée juste après une sauvegarde du cabinet ; le rapport est rangé avec les documents.

use std::path::Path;
use std::sync::Arc;

use osteosphere_core::base::maintenant;
use osteosphere_core::horloge;
use osteosphere_core::import_mcl::{self, Analyse, ChoixImport, Rapport};
use serde::Serialize;
use tauri::State;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};

/// Taille au-delà de laquelle l'archive n'est pas lue : un export MonCabinetLibéral pèse quelques Mo.
const TAILLE_MAX: u64 = 512 * 1024 * 1024;

fn lire_archive(chemin: &str) -> Result<Vec<u8>, String> {
    let taille = std::fs::metadata(chemin).map_err(|_| "Fichier introuvable.".to_owned())?.len();
    if taille > TAILLE_MAX {
        return Err("Ce fichier est bien trop gros pour un export MonCabinetLibéral.".into());
    }
    std::fs::read(chemin).map_err(message)
}

#[tauri::command]
pub async fn analyser_import(etat: State<'_, Arc<EtatCabinet>>, chemin: String) -> Result<Analyse, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_archive(&chemin)?;
        etat.avec_base(|base| import_mcl::analyser(base, &contenu).map_err(message))
    })
    .await
}

#[derive(Serialize)]
pub struct ResultatImport {
    rapport: Rapport,
    /// La sauvegarde faite juste avant l'import, pour revenir en arrière.
    sauvegarde: String,
    /// Le rapport lisible, dans Documents › Osteosphere › Imports.
    fichier_rapport: Option<String>,
}

#[tauri::command]
pub async fn importer_mcl(etat: State<'_, Arc<EtatCabinet>>, chemin: String, choix: ChoixImport) -> Result<ResultatImport, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_archive(&chemin)?;
        let (rapport, sauvegarde) = etat.avec_base(|base| {
            let sauvegarde = etat.sauvegarder(base).map_err(|e| format!("La sauvegarde avant l’import a échoué, rien n’a été importé : {e}"))?;
            let rapport = import_mcl::importer(base, &contenu, choix).map_err(message)?;
            Ok((rapport, sauvegarde.chemin))
        })?;
        // Le rapport écrit est un plus : l'import est fait même si le disque le refuse.
        let maintenant = maintenant();
        let (date, h, m) = horloge::paris(maintenant);
        let dossier = etat.dossier_documents().join("Imports");
        // Deux imports dans la même minute gardent chacun leur rapport.
        let nom = format!("Import MonCabinetLibéral {date} {h:02}h{m:02}");
        let fichier = (1..)
            .map(|rang| dossier.join(if rang == 1 { format!("{nom}.txt") } else { format!("{nom} ({rang}).txt") }))
            .find(|f| !f.exists())
            .expect("un nom libre finit toujours par se trouver");
        let nom_archive = Path::new(&chemin).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(chemin.clone());
        let fichier_rapport = std::fs::create_dir_all(&dossier)
            .and_then(|()| std::fs::write(&fichier, rapport.en_texte(&nom_archive, &sauvegarde, maintenant)))
            .inspect_err(|erreur| log::warn!("rapport d'import non écrit : {erreur}"))
            .ok()
            .map(|()| fichier.display().to_string());
        Ok(ResultatImport { rapport, sauvegarde, fichier_rapport })
    })
    .await
}

/// Ouvre le rapport d'import dans l'éditeur de texte du système.
#[tauri::command]
pub fn ouvrir_rapport_import(etat: State<'_, Arc<EtatCabinet>>, chemin: String) -> Result<(), String> {
    let dossier = etat.dossier_documents().join("Imports");
    let chemin = Path::new(&chemin);
    if !chemin.starts_with(&dossier) {
        return Err("Ce fichier n’est pas un rapport d’import.".into());
    }
    tauri_plugin_opener::open_path(chemin, None::<&str>).map_err(message)
}
