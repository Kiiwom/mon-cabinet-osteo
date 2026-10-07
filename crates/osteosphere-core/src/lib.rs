//! Cœur d'Osteosphere, sans interface.
//!
//! - [`cabinet`] : ouverture du cabinet au démarrage, premier démarrage, mot de passe facultatif.
//! - [`base`] : base SQLite chiffrée par SQLCipher, migrations du schéma, paramètres.
//! - [`chiffrement`] : clé de la base et enveloppes qui la protègent.
//! - [`cle_de_secours`] : clé imprimable remise au premier démarrage.
//! - [`trousseau`] : enveloppes rangées à côté de la base (clé de secours, session, mot de passe).
//! - [`numerotation`] : numéros de facture continus et chronologiques.
//! - [`trames`] : textes réutilisables appelés par un code court pendant la saisie.
//!
//! Ce code ne manipule que des données fictives dans ses tests.

pub mod base;
pub mod cabinet;
pub mod chiffrement;
pub mod cle_de_secours;
mod fichier;
mod hexa;
pub mod numerotation;
pub mod trames;
pub mod trousseau;

/// Version du cœur, affichée dans « À propos ».
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
