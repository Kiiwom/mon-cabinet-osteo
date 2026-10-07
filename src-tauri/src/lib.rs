mod demarrage;
mod documents;
mod trames;

use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct InfosApplication {
    nom: &'static str,
    version: &'static str,
    version_coeur: &'static str,
}

/// Informations affichées dans « À propos » et sur l'accueil du prototype.
#[tauri::command]
fn infos_application() -> InfosApplication {
    InfosApplication {
        nom: "Osteosphere",
        version: env!("CARGO_PKG_VERSION"),
        version_coeur: osteosphere_core::VERSION,
    }
}

/// Dossier du cabinet : `%LOCALAPPDATA%\fr.pierre-besnier.osteosphere\cabinet` sous Windows,
/// `~/.local/share/fr.pierre-besnier.osteosphere/cabinet` sous Linux.
/// La variable OSTEOSPHERE_DOSSIER le remplace, pour les essais et les démonstrations.
fn dossier_du_cabinet(app: &tauri::App) -> tauri::Result<PathBuf> {
    match std::env::var_os("OSTEOSPHERE_DOSSIER") {
        Some(dossier) => Ok(PathBuf::from(dossier)),
        None => Ok(app.path().app_local_data_dir()?.join("cabinet")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle()
                    .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let dossier = dossier_du_cabinet(app)?;
            let sauvegardes = app
                .path()
                .document_dir()
                .map(|documents| documents.join("Osteosphere").join("Sauvegardes"))
                .unwrap_or_else(|_| dossier.join("sauvegardes"));
            app.manage(demarrage::EtatCabinet::new(dossier, sauvegardes));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            infos_application,
            demarrage::etat_demarrage,
            demarrage::preparer_premier_demarrage,
            demarrage::terminer_premier_demarrage,
            demarrage::deverrouiller,
            demarrage::ouvrir_avec_cle_de_secours,
            trames::lister_trames,
            trames::enregistrer_trame,
            trames::supprimer_trame,
            trames::noter_utilisation_trame,
            trames::caractere_trames,
            documents::facture_essai_pdf,
            documents::ouvrir_facture_essai,
        ])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Osteosphere");
}
