//! Mises à jour d'Osteosphere : recherchées seulement quand le praticien le demande (aucune connexion
//! sortante sans son action), installées après une sauvegarde complète, et seulement si leur
//! signature est celle des versions d'Osteosphere (clé publique de `tauri.conf.json`).

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Error as ErreurMiseAJour, Update, UpdaterExt};

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};

/// La mise à jour trouvée par la dernière recherche, en attente de la décision du praticien.
#[derive(Default)]
pub struct MiseAJourTrouvee(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(tag = "etat", rename_all = "snake_case")]
pub enum ReponseMiseAJour {
    AJour { version: String },
    Disponible { version_actuelle: String, version: String, date: Option<String>, notes: String },
}

/// Message compréhensible pour une recherche ou une installation qui n'aboutit pas.
fn expliquer(erreur: ErreurMiseAJour) -> String {
    match erreur {
        ErreurMiseAJour::ReleaseNotFound => "Aucune version n'est encore publiée.".into(),
        ErreurMiseAJour::TargetNotFound(_) | ErreurMiseAJour::TargetsNotFound(_) => {
            "La dernière version n'est pas encore publiée pour ce système.".into()
        }
        ErreurMiseAJour::AuthenticationFailed => {
            "Installation annulée : le mot de passe administrateur de l'ordinateur n'a pas été donné.".into()
        }
        ErreurMiseAJour::Minisign(_)
        | ErreurMiseAJour::SignatureUtf8(_)
        | ErreurMiseAJour::Base64(_)
        | ErreurMiseAJour::SignedVersionMismatch { .. }
        | ErreurMiseAJour::MissingSignedVersion => {
            "La mise à jour téléchargée ne porte pas la signature d'Osteosphere : elle n'a pas été installée.".into()
        }
        ErreurMiseAJour::Reqwest(_) | ErreurMiseAJour::Network(_) => {
            "Le site des versions ne répond pas : vérifiez la connexion à internet, puis réessayez.".into()
        }
        autre => message(autre),
    }
}

/// Recherche une version plus récente sur la page des versions d'Osteosphere.
#[tauri::command]
pub async fn rechercher_mise_a_jour(
    app: AppHandle,
    etat: State<'_, Arc<EtatCabinet>>,
    trouvee: State<'_, MiseAJourTrouvee>,
) -> Result<ReponseMiseAJour, String> {
    let fermer = Arc::clone(&etat);
    let verificateur = app
        .updater_builder()
        // Windows : l'installateur quitte Osteosphere ; la base est d'abord refermée proprement.
        .on_before_exit(move || {
            let _ = fermer.fermer();
        })
        .build()
        .map_err(expliquer)?;
    let mise_a_jour = verificateur.check().await.map_err(expliquer)?;
    let reponse = match &mise_a_jour {
        None => ReponseMiseAJour::AJour { version: env!("CARGO_PKG_VERSION").into() },
        Some(m) => ReponseMiseAJour::Disponible {
            version_actuelle: m.current_version.clone(),
            version: m.version.clone(),
            date: m.date.map(|d| d.date().to_string()),
            notes: m.body.clone().unwrap_or_default(),
        },
    };
    *trouvee.0.lock().map_err(message)? = mise_a_jour;
    Ok(reponse)
}

/// Télécharge la version trouvée, vérifie sa signature et l'installe, après une sauvegarde complète.
/// Windows : l'installateur ferme Osteosphere puis le rouvre. Linux : le système demande le mot de
/// passe administrateur pour installer le paquet, puis Osteosphere redémarre.
#[tauri::command]
pub async fn installer_mise_a_jour(
    app: AppHandle,
    etat: State<'_, Arc<EtatCabinet>>,
    trouvee: State<'_, MiseAJourTrouvee>,
) -> Result<(), String> {
    let mise_a_jour = trouvee.0.lock().map_err(message)?.clone().ok_or("Recherchez d'abord la mise à jour.")?;
    let sauvegarde = Arc::clone(&etat);
    en_arriere_plan(move || {
        sauvegarde.sauvegarder(None).map_err(|e| format!("La sauvegarde avant la mise à jour a échoué, rien n'a été installé : {e}"))
    })
    .await?;
    let octets = mise_a_jour.download(|_, _| {}, || {}).await.map_err(expliquer)?;
    mise_a_jour.install(octets).map_err(expliquer)?;
    // Hors Windows, la nouvelle version est installée : Osteosphere redémarre dessus.
    etat.fermer()?;
    app.restart()
}
