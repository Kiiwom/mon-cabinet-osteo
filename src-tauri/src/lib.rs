mod antecedents;
mod comptes_rendus;
mod demarrage;
mod documents;
mod dossiers;
mod facturation;
mod import;
mod modeles;
mod parametres;
mod patients;
mod pieces;
mod sauvegardes;
mod seances;
mod statistiques;
mod trames;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use osteosphere_core::sauvegardes::Moment;
use serde::Serialize;
use tauri::{Manager, WindowEvent};

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
        .plugin(tauri_plugin_dialog::init())
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
            let etat = demarrage::EtatCabinet::new(dossier, documents);
            app.manage(Arc::clone(&etat));
            // Chaque minute, la sauvegarde automatique se demande si elle est due (intervalle, jour, semaine).
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(60));
                    etat.sauvegarde_automatique(Moment::Minute);
                }
            });
            Ok(())
        })
        .on_window_event(|fenetre, evenement| {
            // À la fermeture de la fenêtre : la sauvegarde « à chaque fermeture », si quelque chose a changé.
            if let WindowEvent::CloseRequested { .. } = evenement {
                fenetre.state::<Arc<demarrage::EtatCabinet>>().sauvegarde_automatique(Moment::Fermeture);
            }
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
            documents::mise_en_page,
            documents::enregistrer_mise_en_page,
            documents::image_documents,
            documents::choisir_image_documents,
            documents::supprimer_image_documents,
            documents::apercu_facture_essai,
            documents::ouvrir_facture_essai,
            patients::lister_patients,
            patients::lire_patient,
            patients::creer_patient,
            patients::modifier_patient,
            patients::archiver_patient,
            patients::statuts_patients,
            patients::enregistrer_statuts,
            patients::lister_groupes,
            patients::enregistrer_groupe,
            patients::supprimer_groupe,
            dossiers::proches_patient,
            dossiers::lier_proche,
            dossiers::delier_proche,
            dossiers::definir_payeur,
            dossiers::contenu_dossier,
            dossiers::fusionner_dossiers,
            dossiers::effacer_dossier,
            dossiers::historique_dossier,
            dossiers::apercu_dossier_pdf,
            dossiers::enregistrer_dossier_pdf,
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
            seances::dernieres_seances,
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
            facturation::modele_email,
            facturation::enregistrer_modele_email,
            facturation::exporter_fichier,
            facturation::exporter_classeur,
            sauvegardes::etat_des_sauvegardes,
            sauvegardes::enregistrer_preferences_sauvegarde,
            sauvegardes::sauvegarder_maintenant,
            sauvegardes::lister_sauvegardes,
            sauvegardes::choisir_fichier,
            sauvegardes::choisir_dossier,
            sauvegardes::apercu_restauration,
            sauvegardes::confirmer_restauration,
            sauvegardes::annuler_restauration,
            sauvegardes::securite,
            sauvegardes::definir_mot_de_passe,
            sauvegardes::retirer_mot_de_passe,
            sauvegardes::verrouiller,
            sauvegardes::exporter_tout,
            sauvegardes::journal,
            statistiques::statistiques,
            import::analyser_import,
            import::importer_mcl,
            import::ouvrir_rapport_import,
            parametres::accueil,
            parametres::enregistrer_accueil,
            trames::definir_caractere_trames,
            trames::exporter_trames,
            trames::analyser_trames,
            trames::importer_trames,
            trames::ouvrir_catalogue_trames,
            pieces::lister_documents,
            pieces::ajouter_documents,
            pieces::choisir_documents,
            pieces::contenu_document,
            pieces::modifier_document,
            pieces::supprimer_document,
            pieces::restaurer_document,
            pieces::corbeille_documents,
            pieces::ouvrir_document,
            pieces::enregistrer_copie_document,
            comptes_rendus::champs_compte_rendu,
            comptes_rendus::apercu_compte_rendu,
            comptes_rendus::enregistrer_compte_rendu,
            comptes_rendus::imprimer_compte_rendu,
        ])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Osteosphere");
}
