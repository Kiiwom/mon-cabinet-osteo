//! Trousseau : les enveloppes de la clé de la base, rangées à côté d'elle dans un fichier JSON.
//!
//! La clé de secours scelle toujours une enveloppe. Ensuite, de deux choses l'une :
//! - sans mot de passe (choix par défaut), la clé est confiée à la session de l'ordinateur
//!   (DPAPI sous Windows, trousseau de la session sous Linux) : le logiciel s'ouvre directement,
//!   c'est un fonctionnement normal ;
//! - avec mot de passe, l'enveloppe de session est retirée : sans le mot de passe ou la clé de
//!   secours, la base reste illisible.
//!
//! Activer, changer ou retirer le mot de passe ne touche jamais à la clé de la base.

use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::chiffrement::{self, CleDonnees, Enveloppe, ErreurChiffrement, ReglagesDerivation, TAILLE_CLE};
use crate::cle_de_secours::CleDeSecours;
use crate::{fichier, hexa};

/// Coffre de la session de l'ordinateur, fourni par l'application (DPAPI sous Windows,
/// trousseau de la session sous Linux).
/// Ce qu'il protège ne se relit que dans la même session, sur le même poste.
pub trait ProtectionSession {
    /// Nom du mécanisme, gardé dans le trousseau : « dpapi » par exemple.
    fn nom(&self) -> &'static str;
    fn proteger(&self, donnees: &[u8]) -> Result<Vec<u8>, String>;
    fn deproteger(&self, protege: &[u8]) -> Result<Zeroizing<Vec<u8>>, String>;
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnveloppeSession {
    pub protection: String,
    pub donnees: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trousseau {
    pub version: u32,
    pub secours: Enveloppe,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mot_de_passe: Option<Enveloppe>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<EnveloppeSession>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurTrousseau {
    #[error(transparent)]
    Chiffrement(#[from] ErreurChiffrement),
    #[error("aucun mot de passe n'est activé")]
    MotDePasseInactif,
    #[error("le mot de passe ne peut pas être vide")]
    MotDePasseVide,
    #[error("la clé n'est pas confiée à la session de cet ordinateur")]
    SessionAbsente,
    #[error("protection par la session de cet ordinateur : {0}")]
    Session(String),
    #[error("fichier du trousseau : {0}")]
    Fichier(#[from] io::Error),
    #[error("trousseau illisible : {0}")]
    Format(#[from] serde_json::Error),
}

impl Trousseau {
    pub fn creer(cle: &CleDonnees, secours: &CleDeSecours, reglages: ReglagesDerivation) -> Result<Self, ErreurTrousseau> {
        Ok(Self {
            version: 1,
            secours: chiffrement::sceller(cle, secours.secret(), reglages)?,
            mot_de_passe: None,
            session: None,
        })
    }

    pub fn mot_de_passe_actif(&self) -> bool {
        self.mot_de_passe.is_some()
    }

    /// Active ou change le mot de passe. La clé n'est plus confiée à la session.
    pub fn definir_mot_de_passe(
        &mut self,
        cle: &CleDonnees,
        mot_de_passe: &str,
        reglages: ReglagesDerivation,
    ) -> Result<(), ErreurTrousseau> {
        if mot_de_passe.is_empty() {
            return Err(ErreurTrousseau::MotDePasseVide);
        }
        self.mot_de_passe = Some(chiffrement::sceller(cle, mot_de_passe.as_bytes(), reglages)?);
        self.session = None;
        Ok(())
    }

    /// Retire le mot de passe : la clé est de nouveau confiée à la session de l'ordinateur.
    pub fn retirer_mot_de_passe(&mut self, cle: &CleDonnees, protection: &dyn ProtectionSession) -> Result<(), ErreurTrousseau> {
        self.confier_a_la_session(cle, protection)?;
        self.mot_de_passe = None;
        Ok(())
    }

    /// Confie la clé à la session de cet ordinateur, par exemple après une restauration sur un autre poste.
    pub fn confier_a_la_session(&mut self, cle: &CleDonnees, protection: &dyn ProtectionSession) -> Result<(), ErreurTrousseau> {
        let protege = protection.proteger(cle.octets()).map_err(ErreurTrousseau::Session)?;
        self.session = Some(EnveloppeSession { protection: protection.nom().into(), donnees: hexa::encoder(&protege) });
        Ok(())
    }

    pub fn ouvrir_avec_session(&self, protection: &dyn ProtectionSession) -> Result<CleDonnees, ErreurTrousseau> {
        let enveloppe = self.session.as_ref().ok_or(ErreurTrousseau::SessionAbsente)?;
        if enveloppe.protection != protection.nom() {
            return Err(ErreurTrousseau::SessionAbsente);
        }
        let protege = hexa::decoder(&enveloppe.donnees).ok_or(ErreurTrousseau::Session("enveloppe abîmée".into()))?;
        let clair = protection.deproteger(&protege).map_err(ErreurTrousseau::Session)?;
        let octets: [u8; TAILLE_CLE] =
            clair.as_slice().try_into().map_err(|_| ErreurTrousseau::Session("taille de clé".into()))?;
        Ok(CleDonnees::depuis_octets(octets))
    }

    pub fn ouvrir_avec_secours(&self, secours: &CleDeSecours) -> Result<CleDonnees, ErreurTrousseau> {
        Ok(chiffrement::ouvrir(&self.secours, secours.secret())?)
    }

    pub fn ouvrir_avec_mot_de_passe(&self, mot_de_passe: &str) -> Result<CleDonnees, ErreurTrousseau> {
        let enveloppe = self.mot_de_passe.as_ref().ok_or(ErreurTrousseau::MotDePasseInactif)?;
        Ok(chiffrement::ouvrir(enveloppe, mot_de_passe.as_bytes())?)
    }

    pub fn enregistrer(&self, chemin: &Path) -> Result<(), ErreurTrousseau> {
        fichier::ecrire_atomiquement(chemin, &serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }

    pub fn charger(chemin: &Path) -> Result<Self, ErreurTrousseau> {
        Ok(serde_json::from_slice(&std::fs::read(chemin)?)?)
    }
}

/// Protection factice pour les tests : réversible, liée à un « poste » fictif.
#[cfg(test)]
pub(crate) struct SessionFactice(pub u8);

#[cfg(test)]
impl ProtectionSession for SessionFactice {
    fn nom(&self) -> &'static str {
        "factice"
    }

    fn proteger(&self, donnees: &[u8]) -> Result<Vec<u8>, String> {
        let mut protege = vec![self.0];
        protege.extend(donnees.iter().map(|o| o ^ 0x5a));
        Ok(protege)
    }

    fn deproteger(&self, protege: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        match protege.split_first() {
            Some((poste, reste)) if *poste == self.0 => Ok(Zeroizing::new(reste.iter().map(|o| o ^ 0x5a).collect())),
            _ => Err("autre poste".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trousseau() -> (CleDonnees, CleDeSecours, Trousseau) {
        let cle = CleDonnees::generer().unwrap();
        let secours = CleDeSecours::generer().unwrap();
        let trousseau = Trousseau::creer(&cle, &secours, ReglagesDerivation::pour_tests()).unwrap();
        (cle, secours, trousseau)
    }

    #[test]
    fn sans_mot_de_passe_la_session_ouvre_la_base() {
        let (cle, secours, mut trousseau) = trousseau();
        trousseau.confier_a_la_session(&cle, &SessionFactice(1)).unwrap();
        assert!(!trousseau.mot_de_passe_actif());
        assert_eq!(trousseau.ouvrir_avec_session(&SessionFactice(1)).unwrap().octets(), cle.octets());
        assert_eq!(trousseau.ouvrir_avec_secours(&secours).unwrap().octets(), cle.octets());
        assert!(matches!(trousseau.ouvrir_avec_mot_de_passe("x"), Err(ErreurTrousseau::MotDePasseInactif)));
    }

    #[test]
    fn un_autre_poste_ne_relit_pas_la_session() {
        let (cle, _, mut trousseau) = trousseau();
        trousseau.confier_a_la_session(&cle, &SessionFactice(1)).unwrap();
        assert!(matches!(trousseau.ouvrir_avec_session(&SessionFactice(2)), Err(ErreurTrousseau::Session(_))));
    }

    #[test]
    fn le_mot_de_passe_remplace_la_session_puis_la_rend() {
        let (cle, secours, mut trousseau) = trousseau();
        trousseau.confier_a_la_session(&cle, &SessionFactice(1)).unwrap();

        trousseau.definir_mot_de_passe(&cle, "mot de passe fictif", ReglagesDerivation::pour_tests()).unwrap();
        assert!(trousseau.session.is_none());
        assert!(matches!(trousseau.ouvrir_avec_session(&SessionFactice(1)), Err(ErreurTrousseau::SessionAbsente)));
        assert_eq!(trousseau.ouvrir_avec_mot_de_passe("mot de passe fictif").unwrap().octets(), cle.octets());
        assert!(trousseau.ouvrir_avec_mot_de_passe("faux").is_err());

        trousseau.retirer_mot_de_passe(&cle, &SessionFactice(1)).unwrap();
        assert!(!trousseau.mot_de_passe_actif());
        assert_eq!(trousseau.ouvrir_avec_session(&SessionFactice(1)).unwrap().octets(), cle.octets());
        assert_eq!(trousseau.ouvrir_avec_secours(&secours).unwrap().octets(), cle.octets());
    }

    #[test]
    fn refuse_un_mot_de_passe_vide() {
        let (cle, _, mut trousseau) = trousseau();
        assert!(matches!(
            trousseau.definir_mot_de_passe(&cle, "", ReglagesDerivation::pour_tests()),
            Err(ErreurTrousseau::MotDePasseVide)
        ));
        assert!(!trousseau.mot_de_passe_actif());
    }

    #[test]
    fn se_relit_depuis_le_disque() {
        let (cle, secours, mut trousseau) = trousseau();
        trousseau.confier_a_la_session(&cle, &SessionFactice(1)).unwrap();
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("trousseau.json");
        trousseau.enregistrer(&chemin).unwrap();
        let relu = Trousseau::charger(&chemin).unwrap();
        assert_eq!(relu, trousseau);
        assert_eq!(relu.ouvrir_avec_secours(&secours).unwrap().octets(), cle.octets());
        assert!(!std::fs::read_to_string(&chemin).unwrap().contains(&secours.affichage()));
    }
}
