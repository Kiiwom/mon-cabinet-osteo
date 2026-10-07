mod antecedents;
mod demarrage;
mod documents;
mod facturation;
mod modeles;
mod parametres;
mod patients;
mod seances;
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
            let documents = app
                .path()
                .document_dir()
                .map(|documents| documents.join("Osteosphere"))
                .unwrap_or_else(|_| dossier.join("documents"));
            app.manage(demarrage::EtatCabinet::new(dossier, documents));
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
            documents::apercu_facture_essai,
            documents::ouvrir_facture_essai,
            patients::lister_patients,
            patients::lire_patient,
            patients::creer_patient,
            patients::modifier_patient,
            patients::archiver_patient,
            patients::statuts_patients,
            antecedents::formulaire_antecedents,
            antecedents::lister_antecedents,
            antecedents::enregistrer_antecedent,
            antecedents::supprimer_antecedent,
            modeles::lister_modeles,
            modeles::lire_version_modele,
            modeles::enregistrer_modele,
            modeles::definir_modele_par_defaut,
            seances::creer_seance,
            seances::lire_seance,
            seances::enregistrer_seance,
            seances::lister_seances_patient,
            seances::lister_seances_periode,
            seances::supprimer_seance,
            seances::restaurer_seance,
            seances::corbeille_seances,
            parametres::identite_cabinet,
            parametres::enregistrer_identite_cabinet,
            facturation::lister_prestations,
            facturation::enregistrer_prestation,
            facturation::reglages_numerotation,
            facturation::enregistrer_reglages_numerotation,
            facturation::numero_suivant,
            facturation::lire_facture,
            facturation::creer_facture,
            facturation::modifier_facture,
            facturation::annoter_facture,
            facturation::supprimer_brouillon,
            facturation::emettre_facture,
            facturation::facturer_seance,
            facturation::facturer_seances,
            facturation::corriger_facture,
            facturation::annuler_facture,
            facturation::ajouter_reglement,
            facturation::modifier_reglement,
            facturation::supprimer_reglement,
            facturation::lister_factures,
            facturation::factures_en_attente,
            facturation::factures_patient,
            facturation::facture_de_seance,
            facturation::historique_facture,
            facturation::recettes,
            facturation::seances_a_facturer,
            facturation::apercu_facture,
            facturation::enregistrer_facture_pdf,
            facturation::imprimer_facture,
            facturation::preparer_email_facture,
            facturation::exporter_fichier,
        ])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Osteosphere");
}
