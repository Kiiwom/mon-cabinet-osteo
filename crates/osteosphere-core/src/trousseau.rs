//! Trousseau : les enveloppes de la clé de la base, rangées à côté d'elle dans un fichier JSON.
//!
//! La clé de secours scelle toujours une enveloppe ; le mot de passe, seulement s'il est activé.
//! Sans mot de passe, la clé est confiée au coffre de la session de l'ordinateur (côté application) :
//! le logiciel s'ouvre directement, et c'est un fonctionnement normal, pas un mode dégradé.
//! Activer, changer ou retirer le mot de passe ne touche jamais à la clé de la base.

use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::chiffrement::{self, CleDonnees, Enveloppe, ErreurChiffrement, ReglagesDerivation};
use crate::cle_de_secours::CleDeSecours;
use crate::fichier;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trousseau {
    pub version: u32,
    pub secours: Enveloppe,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mot_de_passe: Option<Enveloppe>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurTrousseau {
    #[error(transparent)]
    Chiffrement(#[from] ErreurChiffrement),
    #[error("aucun mot de passe n'est activé")]
    MotDePasseInactif,
    #[error("le mot de passe ne peut pas être vide")]
    MotDePasseVide,
    #[error("fichier du trousseau : {0}")]
    Fichier(#[from] io::Error),
    #[error("trousseau illisible : {0}")]
    Format(#[from] serde_json::Error),
}

impl Trousseau {
    pub fn creer(cle: &CleDonnees, secours: &CleDeSecours, reglages: ReglagesDerivation) -> Result<Self, ErreurTrousseau> {
        Ok(Self { version: 1, secours: chiffrement::sceller(cle, secours.secret(), reglages)?, mot_de_passe: None })
    }

    pub fn mot_de_passe_actif(&self) -> bool {
        self.mot_de_passe.is_some()
    }

    /// Active ou change le mot de passe.
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
        Ok(())
    }

    pub fn retirer_mot_de_passe(&mut self) {
        self.mot_de_passe = None;
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
    fn sans_mot_de_passe_par_defaut() {
        let (cle, secours, trousseau) = trousseau();
        assert!(!trousseau.mot_de_passe_actif());
        assert_eq!(trousseau.ouvrir_avec_secours(&secours).unwrap().octets(), cle.octets());
        assert!(matches!(trousseau.ouvrir_avec_mot_de_passe("x"), Err(ErreurTrousseau::MotDePasseInactif)));
    }

    #[test]
    fn activer_puis_retirer_le_mot_de_passe_garde_la_meme_cle() {
        let (cle, secours, mut trousseau) = trousseau();
        trousseau.definir_mot_de_passe(&cle, "mot de passe fictif", ReglagesDerivation::pour_tests()).unwrap();
        assert_eq!(trousseau.ouvrir_avec_mot_de_passe("mot de passe fictif").unwrap().octets(), cle.octets());
        assert!(trousseau.ouvrir_avec_mot_de_passe("faux").is_err());
        assert_eq!(trousseau.ouvrir_avec_secours(&secours).unwrap().octets(), cle.octets());

        trousseau.retirer_mot_de_passe();
        assert!(!trousseau.mot_de_passe_actif());
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
        let (cle, secours, trousseau) = trousseau();
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("trousseau.json");
        trousseau.enregistrer(&chemin).unwrap();
        let relu = Trousseau::charger(&chemin).unwrap();
        assert_eq!(relu, trousseau);
        assert_eq!(relu.ouvrir_avec_secours(&secours).unwrap().octets(), cle.octets());
        assert!(!std::fs::read_to_string(&chemin).unwrap().contains(&secours.affichage()));
    }
}
