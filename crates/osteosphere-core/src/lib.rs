//! Cœur d'Osteosphere, sans interface.
//!
//! - [`cabinet`] : ouverture du cabinet au démarrage, premier démarrage, mot de passe facultatif.
//! - [`base`] : base SQLite chiffrée par SQLCipher, migrations du schéma, paramètres.
//! - [`chiffrement`] : clé de la base et enveloppes qui la protègent.
//! - [`cle_de_secours`] : clé imprimable remise au premier démarrage.
//! - [`trousseau`] : enveloppes rangées à côté de la base (clé de secours, session, mot de passe).
//! - [`numerotation`] : numéros de facture continus et chronologiques.
//! - [`trames`] : textes réutilisables appelés par un code court pendant la saisie.
//! - [`patients`] : dossiers patients, identité, profil, remarques, archives.
//! - [`antecedents`] : antécédents par catégorie et rubrique, datés ou non.
//! - [`modeles`] : modèles de consultation versionnés, modèles fournis.
//!
//! Ce code ne manipule que des données fictives dans ses tests.

pub mod antecedents;
pub mod base;
pub mod cabinet;
pub mod chiffrement;
pub mod cle_de_secours;
mod fichier;
mod hexa;
pub mod identifiant;
pub mod modeles;
pub mod numerotation;
pub mod patients;
pub mod trames;
pub mod trousseau;

/// Version du cœur, affichée dans « À propos ».
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
