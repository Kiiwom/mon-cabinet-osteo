//! Cabinet : la base chiffrée et son trousseau, rangés dans un même dossier.
//!
//! Au démarrage, [`Cabinet::ouvrir_automatiquement`] décide de l'écran à montrer :
//! assistant de premier démarrage, ouverture directe (sans mot de passe, choix par défaut),
//! demande du mot de passe, ou demande de la clé de secours (autre poste, sauvegarde restaurée).

use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};
use crate::chiffrement::{CleDonnees, ErreurChiffrement, ReglagesDerivation};
use crate::cle_de_secours::CleDeSecours;
use crate::trousseau::{ErreurTrousseau, ProtectionSession, Trousseau};

pub const FICHIER_BASE: &str = "cabinet.osteosphere";
pub const FICHIER_TROUSSEAU: &str = "trousseau.json";

pub const PARAMETRE_IDENTITE: &str = "cabinet.identite";
pub const PARAMETRE_TRAMES: &str = "trames.caractere";
pub const PARAMETRE_SAUVEGARDES: &str = "sauvegardes";

/// Identité du praticien, imprimée sur les factures. Seuls le prénom et le nom sont exigés
/// au premier démarrage ; le reste peut être complété ensuite dans les paramètres.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct IdentiteCabinet {
    pub prenom: String,
    pub nom: String,
    pub profession: String,
    pub adresse: String,
    pub code_postal: String,
    pub ville: String,
    pub telephone: String,
    pub email: String,
    pub siret: String,
    pub rpps: String,
}

impl IdentiteCabinet {
    /// Vérifie la saisie et renvoie l'identité nettoyée (espaces retirés autour et dans les numéros).
    pub fn verifier(&self) -> Result<Self, ErreurCabinet> {
        let propre = |t: &str| t.trim().to_owned();
        let chiffres = |t: &str| t.chars().filter(|c| !c.is_whitespace()).collect::<String>();
        let identite = Self {
            prenom: propre(&self.prenom),
            nom: propre(&self.nom),
            profession: propre(&self.profession),
            adresse: propre(&self.adresse),
            code_postal: chiffres(&self.code_postal),
            ville: propre(&self.ville),
            telephone: propre(&self.telephone),
            email: propre(&self.email),
            siret: chiffres(&self.siret),
            rpps: chiffres(&self.rpps),
        };
        let que_des_chiffres = |t: &str, n: usize| t.is_empty() || (t.len() == n && t.bytes().all(|o| o.is_ascii_digit()));
        if identite.prenom.is_empty() || identite.nom.is_empty() {
            return Err(ErreurCabinet::Identite("indiquez votre prénom et votre nom"));
        }
        if !que_des_chiffres(&identite.code_postal, 5) {
            return Err(ErreurCabinet::Identite("le code postal compte 5 chiffres"));
        }
        if !que_des_chiffres(&identite.siret, 14) {
            return Err(ErreurCabinet::Identite("le SIRET compte 14 chiffres"));
        }
        if !que_des_chiffres(&identite.rpps, 11) {
            return Err(ErreurCabinet::Identite("le numéro RPPS compte 11 chiffres"));
        }
        if !identite.email.is_empty() {
            let valide = identite
                .email
                .split_once('@')
                .is_some_and(|(avant, apres)| !avant.is_empty() && apres.contains('.') && !apres.starts_with('.'));
            if !valide {
                return Err(ErreurCabinet::Identite("l'adresse email semble incomplète"));
            }
        }
        Ok(identite)
    }
}

/// Caractère qui ouvre le menu des trames pendant la saisie.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum CaractereTrames {
    #[default]
    #[serde(rename = "@")]
    Arobase,
    #[serde(rename = "/")]
    Barre,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrequenceSauvegarde {
    #[default]
    Fermeture,
    /// Pendant l'utilisation, toutes les `intervalle_minutes`, et à la fermeture ;
    /// seulement si quelque chose a changé depuis la sauvegarde précédente.
    Intervalle,
    Jour,
    Semaine,
    Manuelle,
}

/// Intervalles proposés, en minutes : de 10 minutes à 4 heures.
pub const INTERVALLES_SAUVEGARDE: [u32; 6] = [10, 15, 30, 60, 120, 240];

fn intervalle_par_defaut() -> u32 {
    60
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreferencesSauvegarde {
    pub frequence: FrequenceSauvegarde,
    /// Pour la fréquence « intervalle » ; gardé tel quel pour les autres, si le praticien y revient.
    #[serde(default = "intervalle_par_defaut")]
    pub intervalle_minutes: u32,
    /// Dossier choisi par le praticien ; vide = dossier proposé par l'application.
    pub dossier: String,
}

impl Default for PreferencesSauvegarde {
    fn default() -> Self {
        Self { frequence: FrequenceSauvegarde::default(), intervalle_minutes: intervalle_par_defaut(), dossier: String::new() }
    }
}

impl PreferencesSauvegarde {
    pub fn verifier(self) -> Result<Self, ErreurCabinet> {
        if !INTERVALLES_SAUVEGARDE.contains(&self.intervalle_minutes) {
            return Err(ErreurCabinet::IntervalleSauvegarde(self.intervalle_minutes));
        }
        Ok(self)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurCabinet {
    #[error("un cabinet existe déjà dans ce dossier : il ne sera jamais remplacé")]
    DejaCree,
    #[error("intervalle de sauvegarde non proposé : {0} minutes")]
    IntervalleSauvegarde(u32),
    #[error("mot de passe incorrect")]
    MotDePasseIncorrect,
    #[error("clé de secours incorrecte")]
    CleDeSecoursIncorrecte,
    #[error("{0}")]
    Identite(&'static str),
    #[error(transparent)]
    Trousseau(#[from] ErreurTrousseau),
    #[error(transparent)]
    Base(#[from] ErreurBase),
    #[error("dossier du cabinet : {0}")]
    Fichier(#[from] io::Error),
}

/// Ce que le démarrage doit montrer.
pub enum Ouverture {
    PremierDemarrage,
    Ouvert(CabinetOuvert),
    MotDePasseRequis,
    CleDeSecoursRequise,
}

/// Base ouverte et clé gardée en mémoire, pour changer le mot de passe sans redemander de secret.
pub struct CabinetOuvert {
    pub base: Base,
    cle: CleDonnees,
}

pub struct Cabinet {
    dossier: PathBuf,
    reglages: ReglagesDerivation,
}

impl Cabinet {
    pub fn new(dossier: impl Into<PathBuf>) -> Self {
        Self { dossier: dossier.into(), reglages: ReglagesDerivation::default() }
    }

    #[cfg(test)]
    fn pour_tests(dossier: &Path) -> Self {
        Self { dossier: dossier.to_owned(), reglages: ReglagesDerivation::pour_tests() }
    }

    pub fn dossier(&self) -> &Path {
        &self.dossier
    }

    fn chemin_base(&self) -> PathBuf {
        self.dossier.join(FICHIER_BASE)
    }

    fn chemin_trousseau(&self) -> PathBuf {
        self.dossier.join(FICHIER_TROUSSEAU)
    }

    pub fn existe(&self) -> bool {
        self.chemin_trousseau().exists()
    }

    pub fn mot_de_passe_actif(&self) -> Result<bool, ErreurCabinet> {
        Ok(Trousseau::charger(&self.chemin_trousseau())?.mot_de_passe_actif())
    }

    pub fn ouvrir_automatiquement(&self, protection: &dyn ProtectionSession) -> Result<Ouverture, ErreurCabinet> {
        if !self.existe() {
            return Ok(Ouverture::PremierDemarrage);
        }
        let trousseau = Trousseau::charger(&self.chemin_trousseau())?;
        if trousseau.mot_de_passe_actif() {
            return Ok(Ouverture::MotDePasseRequis);
        }
        match trousseau.ouvrir_avec_session(protection) {
            Ok(cle) => Ok(Ouverture::Ouvert(self.ouvrir_base(cle)?)),
            // Autre poste, autre compte, trousseau de session effacé ou sauvegarde restaurée :
            // la clé de secours prend le relais.
            Err(ErreurTrousseau::SessionAbsente | ErreurTrousseau::Session(_)) => Ok(Ouverture::CleDeSecoursRequise),
            Err(erreur) => Err(erreur.into()),
        }
    }

    /// Crée le cabinet. Refuse si un trousseau existe : un cabinet n'est jamais écrasé.
    pub fn creer(
        &self,
        cle_de_secours: &CleDeSecours,
        mot_de_passe: Option<&str>,
        protection: &dyn ProtectionSession,
    ) -> Result<CabinetOuvert, ErreurCabinet> {
        if self.existe() {
            return Err(ErreurCabinet::DejaCree);
        }
        std::fs::create_dir_all(&self.dossier)?;
        self.ecarter_une_base_orpheline()?;

        let cle = CleDonnees::generer().map_err(ErreurTrousseau::from)?;
        let mut trousseau = Trousseau::creer(&cle, cle_de_secours, self.reglages)?;
        match mot_de_passe {
            Some(mot_de_passe) => trousseau.definir_mot_de_passe(&cle, mot_de_passe, self.reglages)?,
            None => trousseau.confier_a_la_session(&cle, protection)?,
        }
        let ouvert = self.ouvrir_base(cle)?;
        // Le trousseau s'écrit en dernier : tant qu'il n'existe pas, le premier démarrage peut reprendre.
        trousseau.enregistrer(&self.chemin_trousseau())?;
        Ok(ouvert)
    }

    pub fn ouvrir_avec_mot_de_passe(&self, mot_de_passe: &str) -> Result<CabinetOuvert, ErreurCabinet> {
        let trousseau = Trousseau::charger(&self.chemin_trousseau())?;
        let cle = trousseau.ouvrir_avec_mot_de_passe(mot_de_passe).map_err(|erreur| match erreur {
            ErreurTrousseau::Chiffrement(ErreurChiffrement::SecretIncorrect) => ErreurCabinet::MotDePasseIncorrect,
            autre => autre.into(),
        })?;
        self.ouvrir_base(cle)
    }

    /// Ouvre avec la clé de secours. Sans mot de passe, la clé est de nouveau confiée
    /// à la session de ce poste : les ouvertures suivantes seront directes.
    pub fn ouvrir_avec_cle_de_secours(
        &self,
        cle_de_secours: &CleDeSecours,
        protection: &dyn ProtectionSession,
    ) -> Result<CabinetOuvert, ErreurCabinet> {
        let mut trousseau = Trousseau::charger(&self.chemin_trousseau())?;
        let cle = trousseau.ouvrir_avec_secours(cle_de_secours).map_err(|erreur| match erreur {
            ErreurTrousseau::Chiffrement(ErreurChiffrement::SecretIncorrect) => ErreurCabinet::CleDeSecoursIncorrecte,
            autre => autre.into(),
        })?;
        let ouvert = self.ouvrir_base(cle)?;
        if !trousseau.mot_de_passe_actif() {
            trousseau.confier_a_la_session(&ouvert.cle, protection)?;
            trousseau.enregistrer(&self.chemin_trousseau())?;
        }
        Ok(ouvert)
    }

    /// Active ou change le mot de passe. La base n'est pas rechiffrée.
    pub fn definir_mot_de_passe(&self, ouvert: &CabinetOuvert, mot_de_passe: &str) -> Result<(), ErreurCabinet> {
        let mut trousseau = Trousseau::charger(&self.chemin_trousseau())?;
        trousseau.definir_mot_de_passe(&ouvert.cle, mot_de_passe, self.reglages)?;
        trousseau.enregistrer(&self.chemin_trousseau())?;
        Ok(())
    }

    /// Retire le mot de passe : le logiciel s'ouvrira directement avec la session de l'ordinateur.
    pub fn retirer_mot_de_passe(&self, ouvert: &CabinetOuvert, protection: &dyn ProtectionSession) -> Result<(), ErreurCabinet> {
        let mut trousseau = Trousseau::charger(&self.chemin_trousseau())?;
        trousseau.retirer_mot_de_passe(&ouvert.cle, protection)?;
        trousseau.enregistrer(&self.chemin_trousseau())?;
        Ok(())
    }

    fn ouvrir_base(&self, cle: CleDonnees) -> Result<CabinetOuvert, ErreurCabinet> {
        Ok(CabinetOuvert { base: Base::ouvrir(&self.chemin_base(), &cle)?, cle })
    }

    /// Une base sans trousseau vient d'un premier démarrage interrompu : sa clé n'a jamais été
    /// enregistrée, elle est illisible. Elle est mise de côté, jamais supprimée.
    fn ecarter_une_base_orpheline(&self) -> io::Result<()> {
        let base = self.chemin_base();
        if !base.exists() {
            return Ok(());
        }
        let horodatage = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        for suffixe in ["", "-wal", "-shm"] {
            let source = self.dossier.join(format!("{FICHIER_BASE}{suffixe}"));
            if source.exists() {
                std::fs::rename(&source, self.dossier.join(format!("{FICHIER_BASE}.orpheline-{horodatage}{suffixe}")))?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trousseau::SessionFactice;

    fn identite() -> IdentiteCabinet {
        IdentiteCabinet { prenom: "Alexandre".into(), nom: "Roux".into(), ..Default::default() }
    }

    fn ecrire_un_patient(ouvert: &CabinetOuvert) {
        ouvert
            .base
            .connexion()
            .execute("INSERT INTO patients VALUES ('p1', 'Martin', 'Camille', NULL, '2026-10-07', '2026-10-07')", [])
            .unwrap();
    }

    fn nombre_de_patients(ouvert: &CabinetOuvert) -> i64 {
        ouvert.base.connexion().query_row("SELECT count(*) FROM patients", [], |l| l.get(0)).unwrap()
    }

    #[test]
    fn premier_demarrage_puis_ouverture_directe_sans_mot_de_passe() {
        let dossier = tempfile::tempdir().unwrap();
        let cabinet = Cabinet::pour_tests(dossier.path());
        assert!(matches!(cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap(), Ouverture::PremierDemarrage));

        let secours = CleDeSecours::generer().unwrap();
        let ouvert = cabinet.creer(&secours, None, &SessionFactice(1)).unwrap();
        ouvert.base.ecrire_parametre(PARAMETRE_IDENTITE, &identite()).unwrap();
        ecrire_un_patient(&ouvert);
        drop(ouvert);

        let Ouverture::Ouvert(rouvert) = cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap() else {
            panic!("le cabinet doit s'ouvrir directement");
        };
        assert_eq!(nombre_de_patients(&rouvert), 1);
        assert_eq!(rouvert.base.lire_parametre::<IdentiteCabinet>(PARAMETRE_IDENTITE).unwrap(), Some(identite()));
    }

    #[test]
    fn ne_remplace_jamais_un_cabinet_existant() {
        let dossier = tempfile::tempdir().unwrap();
        let cabinet = Cabinet::pour_tests(dossier.path());
        let ouvert = cabinet.creer(&CleDeSecours::generer().unwrap(), None, &SessionFactice(1)).unwrap();
        ecrire_un_patient(&ouvert);
        drop(ouvert);
        assert!(matches!(
            cabinet.creer(&CleDeSecours::generer().unwrap(), None, &SessionFactice(1)),
            Err(ErreurCabinet::DejaCree)
        ));
        let Ouverture::Ouvert(rouvert) = cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap() else { panic!() };
        assert_eq!(nombre_de_patients(&rouvert), 1);
    }

    #[test]
    fn avec_mot_de_passe() {
        let dossier = tempfile::tempdir().unwrap();
        let cabinet = Cabinet::pour_tests(dossier.path());
        let secours = CleDeSecours::generer().unwrap();
        ecrire_un_patient(&cabinet.creer(&secours, Some("mot de passe fictif"), &SessionFactice(1)).unwrap());

        assert!(matches!(cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap(), Ouverture::MotDePasseRequis));
        assert!(matches!(cabinet.ouvrir_avec_mot_de_passe("faux"), Err(ErreurCabinet::MotDePasseIncorrect)));
        assert_eq!(nombre_de_patients(&cabinet.ouvrir_avec_mot_de_passe("mot de passe fictif").unwrap()), 1);
        // Mot de passe oublié : la clé de secours ouvre, et le mot de passe reste exigé ensuite.
        assert_eq!(nombre_de_patients(&cabinet.ouvrir_avec_cle_de_secours(&secours, &SessionFactice(1)).unwrap()), 1);
        assert!(matches!(cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap(), Ouverture::MotDePasseRequis));
    }

    #[test]
    fn activer_puis_retirer_le_mot_de_passe_garde_les_donnees() {
        let dossier = tempfile::tempdir().unwrap();
        let cabinet = Cabinet::pour_tests(dossier.path());
        let ouvert = cabinet.creer(&CleDeSecours::generer().unwrap(), None, &SessionFactice(1)).unwrap();
        ecrire_un_patient(&ouvert);

        cabinet.definir_mot_de_passe(&ouvert, "mot de passe fictif").unwrap();
        assert!(cabinet.mot_de_passe_actif().unwrap());
        assert!(matches!(cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap(), Ouverture::MotDePasseRequis));

        cabinet.retirer_mot_de_passe(&ouvert, &SessionFactice(1)).unwrap();
        drop(ouvert);
        assert!(!cabinet.mot_de_passe_actif().unwrap());
        let Ouverture::Ouvert(rouvert) = cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap() else { panic!() };
        assert_eq!(nombre_de_patients(&rouvert), 1);
    }

    #[test]
    fn sur_un_autre_poste_la_cle_de_secours_prend_le_relais() {
        let dossier = tempfile::tempdir().unwrap();
        let cabinet = Cabinet::pour_tests(dossier.path());
        let secours = CleDeSecours::generer().unwrap();
        ecrire_un_patient(&cabinet.creer(&secours, None, &SessionFactice(1)).unwrap());

        let autre_poste = SessionFactice(2);
        assert!(matches!(cabinet.ouvrir_automatiquement(&autre_poste).unwrap(), Ouverture::CleDeSecoursRequise));
        let fausse = CleDeSecours::generer().unwrap();
        assert!(matches!(
            cabinet.ouvrir_avec_cle_de_secours(&fausse, &autre_poste),
            Err(ErreurCabinet::CleDeSecoursIncorrecte)
        ));
        assert_eq!(nombre_de_patients(&cabinet.ouvrir_avec_cle_de_secours(&secours, &autre_poste).unwrap()), 1);
        // La clé est maintenant confiée à la session du nouveau poste.
        assert!(matches!(cabinet.ouvrir_automatiquement(&autre_poste).unwrap(), Ouverture::Ouvert(_)));
    }

    #[test]
    fn met_de_cote_une_base_orpheline() {
        let dossier = tempfile::tempdir().unwrap();
        std::fs::write(dossier.path().join(FICHIER_BASE), b"premier demarrage interrompu").unwrap();
        let cabinet = Cabinet::pour_tests(dossier.path());
        cabinet.creer(&CleDeSecours::generer().unwrap(), None, &SessionFactice(1)).unwrap();
        let orphelines = std::fs::read_dir(dossier.path())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".orpheline-"))
            .count();
        assert_eq!(orphelines, 1);
    }

    #[test]
    fn verifie_l_identite() {
        let mut saisie = identite();
        saisie.siret = "123 456 789 00012".into();
        saisie.rpps = "10000000000".into();
        saisie.code_postal = " 47150 ".into();
        let propre = saisie.verifier().unwrap();
        assert_eq!(propre.siret, "12345678900012");
        assert_eq!(propre.code_postal, "47150");

        assert!(IdentiteCabinet { nom: "Roux".into(), ..Default::default() }.verifier().is_err());
        assert!(IdentiteCabinet { siret: "123".into(), ..identite() }.verifier().is_err());
        assert!(IdentiteCabinet { rpps: "1000000000A".into(), ..identite() }.verifier().is_err());
        assert!(IdentiteCabinet { email: "cabinet@exemple".into(), ..identite() }.verifier().is_err());
        assert!(IdentiteCabinet { email: "cabinet@exemple.fr".into(), ..identite() }.verifier().is_ok());
    }

    #[test]
    fn preferences_en_json() {
        assert_eq!(serde_json::to_string(&CaractereTrames::Arobase).unwrap(), "\"@\"");
        assert_eq!(serde_json::from_str::<CaractereTrames>("\"/\"").unwrap(), CaractereTrames::Barre);
        assert_eq!(serde_json::to_string(&FrequenceSauvegarde::Fermeture).unwrap(), "\"fermeture\"");
    }

    #[test]
    fn sauvegarde_a_intervalle() {
        let lire = |json: &str| serde_json::from_str::<PreferencesSauvegarde>(json).unwrap();
        let toutes_les_heures = lire(r#"{"frequence":"intervalle","intervalle_minutes":60,"dossier":""}"#);
        assert_eq!(toutes_les_heures.frequence, FrequenceSauvegarde::Intervalle);
        assert!(toutes_les_heures.verifier().is_ok());
        assert!(lire(r#"{"frequence":"intervalle","intervalle_minutes":7,"dossier":""}"#).verifier().is_err());
        // Préférences enregistrées avant l'option : une heure par défaut.
        assert_eq!(lire(r#"{"frequence":"jour","dossier":"/media/cle-usb"}"#).intervalle_minutes, 60);
    }
}
