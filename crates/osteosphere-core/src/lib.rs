//! Cœur d'Osteosphere, sans interface.
//!
//! - [`base`] : base SQLite chiffrée par SQLCipher, migrations du schéma.
//! - [`chiffrement`] : clé de la base et enveloppes qui la protègent.
//! - [`cle_de_secours`] : clé imprimable remise au premier démarrage.
//! - [`trousseau`] : enveloppes rangées à côté de la base (clé de secours, mot de passe facultatif).
//! - [`numerotation`] : numéros de facture continus et chronologiques.
//!
//! Ce code ne manipule que des données fictives dans ses tests.

pub mod base;
pub mod chiffrement;
pub mod cle_de_secours;
mod fichier;
mod hexa;
pub mod numerotation;
pub mod trousseau;

/// Version du cœur, affichée dans « À propos ».
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
