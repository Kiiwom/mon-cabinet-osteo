//! Commandes du démarrage : premier démarrage, ouverture directe, mot de passe, clé de secours.

use std::fmt::Display;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use osteosphere_core::cabinet::{
    Cabinet, CabinetOuvert, CaractereTrames, IdentiteCabinet, Ouverture, PARAMETRE_IDENTITE, PARAMETRE_SAUVEGARDES,
    PARAMETRE_TRAMES, PreferencesSauvegarde,
};
use osteosphere_core::cle_de_secours::CleDeSecours;
use osteosphere_core::trousseau::ProtectionSession;
use osteosphere_session::SessionOrdinateur;
use serde::{Deserialize, Serialize};
use tauri::State;
use zeroize::Zeroizing;

/// Relie la session de l'ordinateur au trousseau du cœur.
struct Session;

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
    dossier_sauvegardes_propose: PathBuf,
    ouvert: Mutex<Option<CabinetOuvert>>,
    /// Clé de secours affichée par l'assistant, gardée ici jusqu'à la création du cabinet.
    cle_en_attente: Mutex<Option<CleDeSecours>>,
}

impl EtatCabinet {
    pub fn new(dossier: PathBuf, dossier_sauvegardes_propose: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            cabinet: Cabinet::new(dossier),
            dossier_sauvegardes_propose,
            ouvert: Mutex::new(None),
            cle_en_attente: Mutex::new(None),
        })
    }

    fn garder_ouvert(&self, ouvert: CabinetOuvert) -> Result<IdentiteCabinet, String> {
        let identite = ouvert.base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default();
        *self.ouvert.lock().map_err(message)? = Some(ouvert);
        Ok(identite)
    }
}

/// Message d'erreur affiché tel quel dans l'interface, avec une majuscule.
fn message(erreur: impl Display) -> String {
    let texte = erreur.to_string();
    let mut lettres = texte.chars();
    match lettres.next() {
        Some(premiere) => premiere.to_uppercase().chain(lettres).collect(),
        None => texte,
    }
}

/// Travail long (dérivation de clé, ouverture de la base) hors du fil de l'interface.
async fn en_arriere_plan<T: Send + 'static>(
    travail: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(travail).await.map_err(message)?
}

#[derive(Serialize)]
#[serde(tag = "etat", rename_all = "snake_case")]
pub enum EtatDemarrage {
    PremierDemarrage,
    MotDePasseRequis,
    CleDeSecoursRequise,
    Ouvert { cabinet: IdentiteCabinet },
}

#[tauri::command]
pub async fn etat_demarrage(etat: State<'_, Arc<EtatCabinet>>) -> Result<EtatDemarrage, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || {
        if let Some(ouvert) = etat.ouvert.lock().map_err(message)?.as_ref() {
            let cabinet = ouvert.base.lire_parametre(PARAMETRE_IDENTITE).map_err(message)?.unwrap_or_default();
            return Ok(EtatDemarrage::Ouvert { cabinet });
        }
        Ok(match etat.cabinet.ouvrir_automatiquement(&Session).map_err(message)? {
            Ouverture::PremierDemarrage => EtatDemarrage::PremierDemarrage,
            Ouverture::MotDePasseRequis => EtatDemarrage::MotDePasseRequis,
            Ouverture::CleDeSecoursRequise => EtatDemarrage::CleDeSecoursRequise,
            Ouverture::Ouvert(ouvert) => EtatDemarrage::Ouvert { cabinet: etat.garder_ouvert(ouvert)? },
        })
    })
    .await
}

#[derive(Serialize)]
pub struct PreparationPremierDemarrage {
    cle_de_secours: String,
    dossier_sauvegardes_propose: String,
    session_protegee: bool,
}

/// Prépare la clé de secours affichée par l'assistant. Rappelée, elle rend la même clé.
#[tauri::command]
pub fn preparer_premier_demarrage(etat: State<'_, Arc<EtatCabinet>>) -> Result<PreparationPremierDemarrage, String> {
    if etat.cabinet.existe() {
        return Err("Un cabinet existe déjà sur cet ordinateur.".into());
    }
    let mut en_attente = etat.cle_en_attente.lock().map_err(message)?;
    if en_attente.is_none() {
        *en_attente = Some(CleDeSecours::generer().map_err(message)?);
    }
    Ok(PreparationPremierDemarrage {
        cle_de_secours: en_attente.as_ref().map(CleDeSecours::affichage).unwrap_or_default(),
        dossier_sauvegardes_propose: etat.dossier_sauvegardes_propose.display().to_string(),
        session_protegee: SessionOrdinateur::protege_vraiment(),
    })
}

#[derive(Deserialize)]
pub struct ChoixPremierDemarrage {
    identite: IdentiteCabinet,
    mot_de_passe: Option<String>,
    cle_notee: bool,
    caractere_trames: CaractereTrames,
    sauvegardes: PreferencesSauvegarde,
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
        ouvert.base.ecrire_parametre(PARAMETRE_SAUVEGARDES, &choix.sauvegardes).map_err(message)?;
        *etat.cle_en_attente.lock().map_err(message)? = None;
        etat.garder_ouvert(ouvert)
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
