//! Commandes du démarrage : premier démarrage, ouverture directe, mot de passe, clé de secours.

use std::fmt::Display;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use osteosphere_core::base::Base;
use osteosphere_core::cabinet::{
    Cabinet, CabinetOuvert, CaractereTrames, ErreurCabinet, IdentiteCabinet, Ouverture, PARAMETRE_IDENTITE, PARAMETRE_SAUVEGARDES,
    PARAMETRE_TRAMES, PreferencesSauvegarde,
};
use osteosphere_core::chiffrement::{CleDonnees, Enveloppe};
use osteosphere_core::cle_de_secours::CleDeSecours;
use osteosphere_core::sauvegardes::{self, Entete, FichierSauvegarde, Moment};
use osteosphere_core::verrouillage::{self, ESSAIS_CODE_COURT};
use osteosphere_core::{modeles, prestations, seances, trames};
use osteosphere_core::trousseau::ProtectionSession;
use osteosphere_session::SessionOrdinateur;
use serde::{Deserialize, Serialize};
use tauri::State;
use zeroize::Zeroizing;

/// Relie la session de l'ordinateur au trousseau du cœur.
pub struct Session;

impl ProtectionSession for Session {
    fn nom(&self) -> &'static str {
        SessionOrdinateur::NOM
    }

    fn proteger(&self, donnees: &[u8]) -> Result<Vec<u8>, String> {
        SessionOrdinateur.proteger(donnees)
    }

    fn deproteger(&self, protege: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        SessionOrdinateur.deproteger(protege)
    }
}

pub struct EtatCabinet {
    cabinet: Cabinet,
    /// `Documents/Osteosphere` : factures en PDF, exports, sauvegardes proposées.
    dossier_documents: PathBuf,
    dossier_sauvegardes_propose: PathBuf,
    ouvert: Mutex<Option<CabinetOuvert>>,
    /// Clé de secours affichée par l'assistant, gardée ici jusqu'à la création du cabinet.
    cle_en_attente: Mutex<Option<CleDeSecours>>,
    /// Sauvegarde déchiffrée et vérifiée, en attente de la confirmation du praticien.
    pub restauration: Mutex<Option<Restauration>>,
    /// Dernière erreur de la sauvegarde automatique, montrée dans les paramètres.
    pub erreur_sauvegarde: Mutex<Option<String>>,
    /// Cabinet verrouillé avec un code court : la clé scellée par le code, jamais la clé elle-même.
    pub veille: Mutex<Option<Veille>>,
}

pub struct Veille {
    pub enveloppe: Enveloppe,
    pub essais_restants: u8,
}

pub struct Restauration {
    pub entete: Entete,
    pub cle: CleDonnees,
    pub copie: PathBuf,
}

impl EtatCabinet {
    pub fn new(dossier: PathBuf, dossier_documents: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            cabinet: Cabinet::new(dossier),
            dossier_sauvegardes_propose: dossier_documents.join("Sauvegardes"),
            dossier_documents,
            ouvert: Mutex::new(None),
            cle_en_attente: Mutex::new(None),
            restauration: Mutex::new(None),
            erreur_sauvegarde: Mutex::new(None),
            veille: Mutex::new(None),
        })
    }

    pub fn cabinet(&self) -> &Cabinet {
        &self.cabinet
    }

    /// Copies en clair des documents ouverts dans une autre application, effacées à chaque ouverture
    /// et à la fermeture du cabinet.
    pub fn dossier_copies(&self) -> PathBuf {
        self.cabinet.chemin_base().with_file_name("documents-ouverts")
    }

    /// Dossier des sauvegardes : celui choisi par le praticien, sinon celui proposé.
    pub fn dossier_sauvegardes(&self, preferences: &PreferencesSauvegarde) -> PathBuf {
        if preferences.dossier.is_empty() { self.dossier_sauvegardes_propose.clone() } else { PathBuf::from(&preferences.dossier) }
    }

    /// Sauvegarde le cabinet ouvert, puis efface les sauvegardes au-delà du nombre gardé.
    pub fn sauvegarder(&self, base: &Base) -> Result<FichierSauvegarde, String> {
        let preferences: PreferencesSauvegarde = base.lire_parametre(PARAMETRE_SAUVEGARDES).map_err(message)?.unwrap_or_default();
        let dossier = self.dossier_sauvegardes(&preferences);
        let secours = self.cabinet.enveloppe_secours().map_err(message)?;
        let fichier = sauvegardes::ecrire(
            base,
            &self.cabinet.chemin_base(),
            &secours,
            &dossier,
            env!("CARGO_PKG_VERSION"),
            osteosphere_core::base::maintenant(),
        )
        .map_err(message)?;
        sauvegardes::purger(&dossier, preferences.conserver as usize).map_err(message)?;
        Ok(fichier)
    }

    /// Sauvegarde automatique, si la fréquence choisie le demande et si quelque chose a changé.
    /// Une erreur est gardée pour les paramètres et le journal de l'application, jamais bloquante.
    pub fn sauvegarde_automatique(&self, moment: Moment) {
        let resultat = (|| -> Result<(), String> {
            let garde = self.ouvert.lock().map_err(message)?;
            let Some(ouvert) = garde.as_ref() else { return Ok(()) };
            let preferences: PreferencesSauvegarde = ouvert.base.lire_parametre(PARAMETRE_SAUVEGARDES).map_err(message)?.unwrap_or_default();
            if sauvegardes::due(&ouvert.base, &preferences, moment, osteosphere_core::base::maintenant()).map_err(message)? {
                self.sauvegarder(&ouvert.base)?;
            }
            Ok(())
        })();
        if let Ok(mut erreur) = self.erreur_sauvegarde.lock() {
            match resultat {
                Ok(()) => {}
                Err(texte) => {
                    log::warn!("sauvegarde automatique : {texte}");
                    *erreur = Some(texte);
                }
            }
        }
    }

    /// Verrouille le cabinet ouvert : la base est fermée et sa clé quitte la mémoire. Avec un code court,
    /// seule la clé scellée par ce code reste, pour rouvrir sans le mot de passe. Rend vrai dans ce cas.
    pub fn verrouiller(&self) -> Result<bool, String> {
        let enveloppe = self.avec_base(|base| Ok(verrouillage::lire(base).map_err(message)?.code_court))?;
        self.sauvegarde_automatique(Moment::Fermeture);
        self.fermer()?;
        let code_court = enveloppe.is_some();
        *self.veille.lock().map_err(message)? = enveloppe.map(|enveloppe| Veille { enveloppe, essais_restants: ESSAIS_CODE_COURT });
        Ok(code_court)
    }

    /// Ferme le cabinet : la base est relâchée, le mot de passe sera redemandé.
    pub fn fermer(&self) -> Result<(), String> {
        *self.ouvert.lock().map_err(message)? = None;
        crate::pieces::effacer_copies_ouvertes(&self.dossier_copies());
        Ok(())
    }

    /// Remplace les données par la sauvegarde vérifiée, puis rouvre le cabinet.
    pub fn restaurer(&self, restauration: Restauration) -> Result<IdentiteCabinet, String> {
        // La base en place est relâchée avant d'être mise de côté.
        *self.ouvert.lock().map_err(message)? = None;
        let ouvert = self
            .cabinet
            .restaurer(&restauration.copie, &restauration.cle, restauration.entete.secours, &Session)
            .map_err(message)?;
        self.garder_ouvert(ouvert)
    }

    fn garder_ouvert(&self, ouvert: CabinetOuvert) -> Result<IdentiteCabinet, String> {
        let identite = ouvert.base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default();
        // Une seule fois par cabinet : une trame de départ supprimée ne revient pas.
        trames::installer_bibliotheque_de_depart(&ouvert.base).map_err(message)?;
        modeles::installer_modeles_fournis(&ouvert.base).map_err(message)?;
        prestations::installer_prestations_de_depart(&ouvert.base).map_err(message)?;
        // Les séances et les documents restés plus de 30 jours à la corbeille sont effacés à l'ouverture.
        seances::vider_corbeille_ancienne(&ouvert.base).map_err(message)?;
        osteosphere_core::documents::vider_corbeille_ancienne(&ouvert.base).map_err(message)?;
        // Les copies en clair des documents ouverts à la dernière session sont effacées.
        crate::pieces::effacer_copies_ouvertes(&self.dossier_copies());
        *self.ouvert.lock().map_err(message)? = Some(ouvert);
        // Ouvert par n'importe quel moyen : le code court du verrouillage précédent ne sert plus.
        *self.veille.lock().map_err(message)? = None;
        // Sauvegarde « du jour » ou « de la semaine » : à la première ouverture.
        self.sauvegarde_automatique(Moment::Ouverture);
        Ok(identite)
    }

    pub fn dossier_documents(&self) -> &std::path::Path {
        &self.dossier_documents
    }

    /// Exécute une opération sur la base du cabinet ouvert.
    pub fn avec_ouvert<T>(&self, operation: impl FnOnce(&CabinetOuvert) -> Result<T, String>) -> Result<T, String> {
        let garde = self.ouvert.lock().map_err(message)?;
        let ouvert = garde.as_ref().ok_or("Le cabinet n'est pas ouvert.")?;
        operation(ouvert)
    }

    pub fn avec_base<T>(&self, operation: impl FnOnce(&Base) -> Result<T, String>) -> Result<T, String> {
        let garde = self.ouvert.lock().map_err(message)?;
        let ouvert = garde.as_ref().ok_or("Le cabinet n'est pas ouvert.")?;
        operation(&ouvert.base)
    }
}

/// Message d'erreur affiché tel quel dans l'interface, avec une majuscule.
pub fn message(erreur: impl Display) -> String {
    let texte = erreur.to_string();
    let mut lettres = texte.chars();
    match lettres.next() {
        Some(premiere) => premiere.to_uppercase().chain(lettres).collect(),
        None => texte,
    }
}

/// Travail long (dérivation de clé, ouverture de la base) hors du fil de l'interface.
pub async fn en_arriere_plan<T: Send + 'static>(
    travail: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(travail).await.map_err(message)?
}

#[derive(Serialize)]
#[serde(tag = "etat", rename_all = "snake_case")]
pub enum EtatDemarrage {
    PremierDemarrage,
    /// `code_court` : le cabinet a été verrouillé pendant la session et le code court le rouvre.
    MotDePasseRequis { code_court: bool },
    CleDeSecoursRequise,
    Ouvert { cabinet: Box<IdentiteCabinet> },
}

#[tauri::command]
pub async fn etat_demarrage(etat: State<'_, Arc<EtatCabinet>>) -> Result<EtatDemarrage, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        if let Some(ouvert) = etat.ouvert.lock().map_err(message)?.as_ref() {
            let cabinet = ouvert.base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default();
            return Ok(EtatDemarrage::Ouvert { cabinet: Box::new(cabinet) });
        }
        Ok(match etat.cabinet.ouvrir_automatiquement(&Session).map_err(message)? {
            Ouverture::PremierDemarrage => EtatDemarrage::PremierDemarrage,
            Ouverture::MotDePasseRequis => EtatDemarrage::MotDePasseRequis { code_court: etat.veille.lock().map_err(message)?.is_some() },
            Ouverture::CleDeSecoursRequise => EtatDemarrage::CleDeSecoursRequise,
            Ouverture::Ouvert(ouvert) => EtatDemarrage::Ouvert { cabinet: Box::new(etat.garder_ouvert(ouvert)?) },
        })
    })
    .await
}

#[derive(Serialize)]
pub struct PreparationPremierDemarrage {
    cle_de_secours: String,
    dossier_sauvegardes_propose: String,
    /// Faux si la session ne peut pas protéger la clé : trousseau absent sous Linux, macOS pas encore pris en charge.
    session_protegee: bool,
    /// « windows », « linux » ou « macos » : l'assistant parle du verrouillage propre au système.
    systeme: &'static str,
}

/// Prépare la clé de secours affichée par l'assistant. Rappelée, elle rend la même clé.
#[tauri::command]
pub async fn preparer_premier_demarrage(etat: State<'_, Arc<EtatCabinet>>) -> Result<PreparationPremierDemarrage, String> {
    let etat = Arc::clone(&etat);
    // Sous Linux, la question au trousseau de la session passe par le bus : hors du fil de l'interface.
    en_arriere_plan(move || {
        if etat.cabinet.existe() {
            return Err("Un cabinet existe déjà sur cet ordinateur.".into());
        }
        let cle_de_secours = {
            let mut en_attente = etat.cle_en_attente.lock().map_err(message)?;
            if en_attente.is_none() {
                *en_attente = Some(CleDeSecours::generer().map_err(message)?);
            }
            en_attente.as_ref().map(CleDeSecours::affichage).unwrap_or_default()
        };
        Ok(PreparationPremierDemarrage {
            cle_de_secours,
            dossier_sauvegardes_propose: etat.dossier_sauvegardes_propose.display().to_string(),
            session_protegee: SessionOrdinateur::protection_disponible(),
            systeme: std::env::consts::OS,
        })
    })
    .await
}

#[derive(Deserialize)]
pub struct ChoixPremierDemarrage {
    identite: IdentiteCabinet,
    mot_de_passe: Option<String>,
    cle_notee: bool,
    caractere_trames: CaractereTrames,
    sauvegardes: PreferencesSauvegarde,
    #[serde(default)]
    pratique: PratiqueDeDepart,
}

/// Étape « Votre pratique » : le modèle de toutes les séances, et les modèles nourrisson et grossesse.
#[derive(Deserialize)]
#[serde(default)]
pub struct PratiqueDeDepart {
    modele: String,
    modeles_specifiques: bool,
}

impl Default for PratiqueDeDepart {
    fn default() -> Self {
        Self { modele: "Adulte".into(), modeles_specifiques: true }
    }
}

#[tauri::command]
pub async fn terminer_premier_demarrage(
    etat: State<'_, Arc<EtatCabinet>>,
    choix: ChoixPremierDemarrage,
) -> Result<IdentiteCabinet, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        if !choix.cle_notee {
            return Err("Cochez la case qui confirme que la clé de secours est notée ou imprimée.".into());
        }
        let identite = choix.identite.verifier().map_err(message)?;
        let sauvegardes = choix.sauvegardes.verifier().map_err(message)?;
        if !modeles::MODELES_PRINCIPAUX.contains(&choix.pratique.modele.as_str()) {
            return Err("Choisissez le modèle de vos séances parmi ceux proposés.".into());
        }
        let mot_de_passe = choix.mot_de_passe.map(Zeroizing::new);
        if mot_de_passe.as_ref().is_some_and(|m| m.is_empty()) {
            return Err("Choisissez un mot de passe, ou gardez l'ouverture directe.".into());
        }
        let cle = etat
            .cle_en_attente
            .lock()
            .map_err(message)?
            .clone()
            .ok_or_else(|| "La clé de secours a expiré : recommencez l'étape « Protection des données ».".to_string())?;

        let ouvert = etat
            .cabinet
            .creer(&cle, mot_de_passe.as_ref().map(|m| m.as_str()), &Session)
            .map_err(message)?;
        ouvert.base.ecrire_parametre(PARAMETRE_IDENTITE, &identite).map_err(message)?;
        ouvert.base.ecrire_parametre(PARAMETRE_TRAMES, &choix.caractere_trames).map_err(message)?;
        ouvert.base.ecrire_parametre(PARAMETRE_SAUVEGARDES, &sauvegardes).map_err(message)?;
        *etat.cle_en_attente.lock().map_err(message)? = None;
        let identite = etat.garder_ouvert(ouvert)?;
        // Les modèles fournis viennent d'être installés : le choix de l'assistant s'y applique.
        etat.avec_base(|base| {
            modeles::choisir_pratique_de_depart(base, &choix.pratique.modele, choix.pratique.modeles_specifiques).map_err(message)
        })?;
        Ok(identite)
    })
    .await
}

#[tauri::command]
pub async fn deverrouiller(etat: State<'_, Arc<EtatCabinet>>, mot_de_passe: String) -> Result<IdentiteCabinet, String> {
    let etat = Arc::clone(&etat);
    let mot_de_passe = Zeroizing::new(mot_de_passe);
    en_arriere_plan(move || {
        let ouvert = etat.cabinet.ouvrir_avec_mot_de_passe(&mot_de_passe).map_err(message)?;
        etat.garder_ouvert(ouvert)
    })
    .await
}

#[tauri::command]
pub async fn ouvrir_avec_cle_de_secours(etat: State<'_, Arc<EtatCabinet>>, cle: String) -> Result<IdentiteCabinet, String> {
    let etat = Arc::clone(&etat);
    let cle = Zeroizing::new(cle);
    en_arriere_plan(move || {
        let cle = CleDeSecours::lire(&cle).map_err(message)?;
        let ouvert = etat.cabinet.ouvrir_avec_cle_de_secours(&cle, &Session).map_err(message)?;
        etat.garder_ouvert(ouvert)
    })
    .await
}

#[derive(Serialize)]
#[serde(tag = "etat", rename_all = "snake_case")]
pub enum ReponseCodeCourt {
    Ouvert { cabinet: Box<IdentiteCabinet> },
    /// Code faux. À zéro essai restant, seul le mot de passe (ou la clé de secours) rouvre le cabinet.
    Incorrect { essais_restants: u8 },
}

/// Rouvre le cabinet verrouillé avec le code court.
#[tauri::command]
pub async fn deverrouiller_avec_code(etat: State<'_, Arc<EtatCabinet>>, code: String) -> Result<ReponseCodeCourt, String> {
    let etat = Arc::clone(&etat);
    let code = Zeroizing::new(code);
    en_arriere_plan(move || {
        let enveloppe = match etat.veille.lock().map_err(message)?.as_ref() {
            Some(veille) => veille.enveloppe.clone(),
            None => return Ok(ReponseCodeCourt::Incorrect { essais_restants: 0 }),
        };
        // La dérivation du code prend une demi-seconde : le verrou n'est pas tenu pendant ce temps.
        match etat.cabinet.ouvrir_avec_code_court(&enveloppe, &code) {
            Ok(ouvert) => Ok(ReponseCodeCourt::Ouvert { cabinet: Box::new(etat.garder_ouvert(ouvert)?) }),
            Err(ErreurCabinet::CodeCourtIncorrect) => {
                let mut veille = etat.veille.lock().map_err(message)?;
                let essais_restants = veille.as_ref().map_or(0, |v| v.essais_restants.saturating_sub(1));
                match veille.as_mut() {
                    Some(v) if essais_restants > 0 => v.essais_restants = essais_restants,
                    _ => *veille = None,
                }
                Ok(ReponseCodeCourt::Incorrect { essais_restants })
            }
            Err(autre) => Err(message(autre)),
        }
    })
    .await
}
