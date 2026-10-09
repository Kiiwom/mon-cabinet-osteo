//! Commandes des imports (MonCabinetLibéral, tableur, LibreOsteo) : le fichier est d'abord analysé sans rien
//! écrire, puis importé juste après une sauvegarde du cabinet ; le rapport est rangé avec les documents.

use std::path::Path;
use std::sync::Arc;

use osteosphere_core::base::maintenant;
use osteosphere_core::horloge;
use osteosphere_core::import_mcl::{self, Analyse, ChoixImport, Rapport};
use osteosphere_core::import_libreosteo::{self, AnalyseLibreOsteo, ChoixLibreOsteo, RapportLibreOsteo};
use osteosphere_core::import_tableur::{self, AnalyseTableur, Cible, RapportTableur};
use serde::Serialize;
use tauri::State;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};

/// Taille au-delà de laquelle le fichier n'est pas lu : un export pèse quelques Mo, pièces jointes
/// comprises quelques centaines.
const TAILLE_MAX: u64 = 512 * 1024 * 1024;

fn lire_archive(chemin: &str) -> Result<Vec<u8>, String> {
    let taille = std::fs::metadata(chemin).map_err(|_| "Fichier introuvable.".to_owned())?.len();
    if taille > TAILLE_MAX {
        return Err("Ce fichier est bien trop gros pour un import.".into());
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
        let fichier_rapport = ecrire_rapport(&etat, "Import MonCabinetLibéral", |maintenant| rapport.en_texte(&nom_de_fichier(&chemin), &sauvegarde, maintenant));
        Ok(ResultatImport { rapport, sauvegarde, fichier_rapport })
    })
    .await
}

fn nom_de_fichier(chemin: &str) -> String {
    Path::new(chemin).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| chemin.to_owned())
}

/// Le rapport lisible, dans Documents › Osteosphere › Imports. C'est un plus : l'import est fait même
/// si le disque le refuse.
fn ecrire_rapport(etat: &EtatCabinet, titre: &str, texte: impl FnOnce(i64) -> String) -> Option<String> {
    let maintenant = maintenant();
    let (date, h, m) = horloge::paris(maintenant);
    let dossier = etat.dossier_documents().join("Imports");
    // Deux imports dans la même minute gardent chacun leur rapport.
    let nom = format!("{titre} {date} {h:02}h{m:02}");
    let fichier = (1..)
        .map(|rang| dossier.join(if rang == 1 { format!("{nom}.txt") } else { format!("{nom} ({rang}).txt") }))
        .find(|f| !f.exists())
        .expect("un nom libre finit toujours par se trouver");
    std::fs::create_dir_all(&dossier)
        .and_then(|()| std::fs::write(&fichier, texte(maintenant)))
        .inspect_err(|erreur| log::warn!("rapport d'import non écrit : {erreur}"))
        .ok()
        .map(|()| fichier.display().to_string())
}

/// Lit le tableur et propose la correspondance des colonnes, ou applique celle choisie. Rien n'est écrit.
#[tauri::command]
pub async fn analyser_tableur(etat: State<'_, Arc<EtatCabinet>>, chemin: String, correspondance: Option<Vec<Cible>>) -> Result<AnalyseTableur, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_archive(&chemin)?;
        etat.avec_base(|base| import_tableur::analyser(base, &chemin, &contenu, correspondance.as_deref()).map_err(message))
    })
    .await
}

#[derive(Serialize)]
pub struct ResultatImportTableur {
    rapport: RapportTableur,
    sauvegarde: String,
    fichier_rapport: Option<String>,
}

#[tauri::command]
pub async fn importer_tableur(etat: State<'_, Arc<EtatCabinet>>, chemin: String, correspondance: Vec<Cible>) -> Result<ResultatImportTableur, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_archive(&chemin)?;
        let (rapport, sauvegarde) = etat.avec_base(|base| {
            let sauvegarde = etat.sauvegarder(base).map_err(|e| format!("La sauvegarde avant l’import a échoué, rien n’a été importé : {e}"))?;
            let rapport = import_tableur::importer(base, &chemin, &contenu, &correspondance).map_err(message)?;
            Ok((rapport, sauvegarde.chemin))
        })?;
        let fichier_rapport = ecrire_rapport(&etat, "Import tableur", |maintenant| rapport.en_texte(&nom_de_fichier(&chemin), &sauvegarde, maintenant));
        Ok(ResultatImportTableur { rapport, sauvegarde, fichier_rapport })
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

#[tauri::command]
pub async fn analyser_libreosteo(etat: State<'_, Arc<EtatCabinet>>, chemin: String) -> Result<AnalyseLibreOsteo, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_archive(&chemin)?;
        etat.avec_base(|base| import_libreosteo::analyser(base, &contenu).map_err(message))
    })
    .await
}

#[derive(Serialize)]
pub struct ResultatImportLibreOsteo {
    rapport: RapportLibreOsteo,
    sauvegarde: String,
    fichier_rapport: Option<String>,
}

#[tauri::command]
pub async fn importer_libreosteo(etat: State<'_, Arc<EtatCabinet>>, chemin: String, choix: ChoixLibreOsteo) -> Result<ResultatImportLibreOsteo, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        let contenu = lire_archive(&chemin)?;
        let (rapport, sauvegarde) = etat.avec_base(|base| {
            let sauvegarde = etat.sauvegarder(base).map_err(|e| format!("La sauvegarde avant l’import a échoué, rien n’a été importé : {e}"))?;
            let rapport = import_libreosteo::importer(base, &contenu, choix).map_err(message)?;
            Ok((rapport, sauvegarde.chemin))
        })?;
        let fichier_rapport = ecrire_rapport(&etat, "Import LibreOsteo", |maintenant| rapport.en_texte(&nom_de_fichier(&chemin), &sauvegarde, maintenant));
        Ok(ResultatImportLibreOsteo { rapport, sauvegarde, fichier_rapport })
    })
    .await
}
