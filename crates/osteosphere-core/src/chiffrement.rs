//! Clé de la base et enveloppes qui la protègent.
//!
//! La base est chiffrée par une clé aléatoire de 256 bits, jamais écrite en clair. Chaque secret
//! (clé de secours, mot de passe facultatif) scelle sa propre copie de cette clé dans une
//! « enveloppe » : Argon2id dérive une clé du secret, XChaCha20-Poly1305 chiffre et authentifie.
//! Changer de secret refait une enveloppe ; la base, elle, n'est jamais rechiffrée.

use std::fmt;

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::hexa;

pub const TAILLE_CLE: usize = 32;
const TAILLE_SEL: usize = 16;
const TAILLE_NONCE: usize = 24;
/// Plafond accepté à l'ouverture, pour qu'une enveloppe trafiquée ne bloque pas le poste.
const MEMOIRE_MAX_KIO: u32 = 1024 * 1024;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct CleDonnees([u8; TAILLE_CLE]);

impl CleDonnees {
    pub fn generer() -> Result<Self, ErreurChiffrement> {
        let mut octets = [0u8; TAILLE_CLE];
        getrandom::fill(&mut octets).map_err(|_| ErreurChiffrement::Aleatoire)?;
        Ok(Self(octets))
    }

    /// Pour le coffre de la session de l'ordinateur, qui rend la clé telle quelle.
    pub fn depuis_octets(octets: [u8; TAILLE_CLE]) -> Self {
        Self(octets)
    }

    pub fn octets(&self) -> &[u8; TAILLE_CLE] {
        &self.0
    }
}

impl fmt::Debug for CleDonnees {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CleDonnees(****)")
    }
}

/// Réglages d'Argon2id. Par défaut : 64 Mio et 3 passes, environ une demi-seconde sur un PC de cabinet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReglagesDerivation {
    pub memoire_kio: u32,
    pub passes: u32,
    pub parallelisme: u32,
}

impl Default for ReglagesDerivation {
    fn default() -> Self {
        Self { memoire_kio: 64 * 1024, passes: 3, parallelisme: 1 }
    }
}

impl ReglagesDerivation {
    /// Réglages allégés pour que les tests restent rapides. Jamais pour de vraies données.
    #[cfg(test)]
    pub(crate) fn pour_tests() -> Self {
        Self { memoire_kio: 256, passes: 1, parallelisme: 1 }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Enveloppe {
    pub version: u32,
    pub derivation: ReglagesDerivation,
    pub sel: String,
    pub nonce: String,
    pub cle_scellee: String,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ErreurChiffrement {
    #[error("le générateur aléatoire du système est indisponible")]
    Aleatoire,
    #[error("secret incorrect")]
    SecretIncorrect,
    #[error("enveloppe illisible : {0}")]
    EnveloppeIllisible(&'static str),
    #[error("réglages de dérivation refusés")]
    Derivation,
}

pub fn sceller(cle: &CleDonnees, secret: &[u8], reglages: ReglagesDerivation) -> Result<Enveloppe, ErreurChiffrement> {
    let mut sel = [0u8; TAILLE_SEL];
    let mut nonce = [0u8; TAILLE_NONCE];
    getrandom::fill(&mut sel).map_err(|_| ErreurChiffrement::Aleatoire)?;
    getrandom::fill(&mut nonce).map_err(|_| ErreurChiffrement::Aleatoire)?;
    let cle_secret = deriver(secret, &sel, reglages)?;
    let scellee = XChaCha20Poly1305::new(cle_secret.as_ref().into())
        .encrypt(XNonce::from_slice(&nonce), cle.octets().as_slice())
        .map_err(|_| ErreurChiffrement::Derivation)?;
    Ok(Enveloppe {
        version: 1,
        derivation: reglages,
        sel: hexa::encoder(&sel),
        nonce: hexa::encoder(&nonce),
        cle_scellee: hexa::encoder(&scellee),
    })
}

pub fn ouvrir(enveloppe: &Enveloppe, secret: &[u8]) -> Result<CleDonnees, ErreurChiffrement> {
    if enveloppe.version != 1 {
        return Err(ErreurChiffrement::EnveloppeIllisible("version inconnue"));
    }
    if enveloppe.derivation.memoire_kio > MEMOIRE_MAX_KIO {
        return Err(ErreurChiffrement::EnveloppeIllisible("réglages excessifs"));
    }
    let sel = hexa::decoder(&enveloppe.sel).ok_or(ErreurChiffrement::EnveloppeIllisible("sel"))?;
    let nonce = hexa::decoder(&enveloppe.nonce)
        .filter(|n| n.len() == TAILLE_NONCE)
        .ok_or(ErreurChiffrement::EnveloppeIllisible("nonce"))?;
    let scellee = hexa::decoder(&enveloppe.cle_scellee).ok_or(ErreurChiffrement::EnveloppeIllisible("clé scellée"))?;
    let cle_secret = deriver(secret, &sel, enveloppe.derivation)?;
    let clair = Zeroizing::new(
        XChaCha20Poly1305::new(cle_secret.as_ref().into())
            .decrypt(XNonce::from_slice(&nonce), scellee.as_slice())
            .map_err(|_| ErreurChiffrement::SecretIncorrect)?,
    );
    let octets: [u8; TAILLE_CLE] = clair
        .as_slice()
        .try_into()
        .map_err(|_| ErreurChiffrement::EnveloppeIllisible("taille de clé"))?;
    Ok(CleDonnees(octets))
}

fn deriver(secret: &[u8], sel: &[u8], reglages: ReglagesDerivation) -> Result<Zeroizing<[u8; TAILLE_CLE]>, ErreurChiffrement> {
    let params = Params::new(reglages.memoire_kio, reglages.passes, reglages.parallelisme, Some(TAILLE_CLE))
        .map_err(|_| ErreurChiffrement::Derivation)?;
    let mut sortie = Zeroizing::new([0u8; TAILLE_CLE]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, sel, sortie.as_mut())
        .map_err(|_| ErreurChiffrement::Derivation)?;
    Ok(sortie)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rouvre_avec_le_bon_secret() {
        let cle = CleDonnees::generer().unwrap();
        let enveloppe = sceller(&cle, b"secret fictif", ReglagesDerivation::pour_tests()).unwrap();
        assert_eq!(ouvrir(&enveloppe, b"secret fictif").unwrap().octets(), cle.octets());
    }

    #[test]
    fn refuse_un_autre_secret() {
        let cle = CleDonnees::generer().unwrap();
        let enveloppe = sceller(&cle, b"secret fictif", ReglagesDerivation::pour_tests()).unwrap();
        assert_eq!(ouvrir(&enveloppe, b"autre secret").unwrap_err(), ErreurChiffrement::SecretIncorrect);
    }

    #[test]
    fn detecte_une_enveloppe_modifiee() {
        let cle = CleDonnees::generer().unwrap();
        let mut enveloppe = sceller(&cle, b"secret fictif", ReglagesDerivation::pour_tests()).unwrap();
        let dernier = if enveloppe.cle_scellee.ends_with('0') { "1" } else { "0" };
        enveloppe.cle_scellee.replace_range(enveloppe.cle_scellee.len() - 1.., dernier);
        assert_eq!(ouvrir(&enveloppe, b"secret fictif").unwrap_err(), ErreurChiffrement::SecretIncorrect);
    }

    #[test]
    fn deux_enveloppes_du_meme_secret_different() {
        let cle = CleDonnees::generer().unwrap();
        let a = sceller(&cle, b"secret fictif", ReglagesDerivation::pour_tests()).unwrap();
        let b = sceller(&cle, b"secret fictif", ReglagesDerivation::pour_tests()).unwrap();
        assert_ne!(a.sel, b.sel);
        assert_ne!(a.cle_scellee, b.cle_scellee);
    }

    #[test]
    fn refuse_des_reglages_excessifs() {
        let cle = CleDonnees::generer().unwrap();
        let mut enveloppe = sceller(&cle, b"secret fictif", ReglagesDerivation::pour_tests()).unwrap();
        enveloppe.derivation.memoire_kio = u32::MAX;
        assert!(matches!(ouvrir(&enveloppe, b"secret fictif"), Err(ErreurChiffrement::EnveloppeIllisible(_))));
    }
}
