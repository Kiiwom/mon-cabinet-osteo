use serde::Serialize;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle()
                    .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![infos_application])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Osteosphere");
}
