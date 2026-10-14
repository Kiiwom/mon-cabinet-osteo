//! Identifiants des enregistrements : 12 octets tirés au hasard, écrits en hexadécimal.
//! Ils ne disent rien du patient ni de l'ordre de création.

use crate::hexa;

#[derive(Debug, thiserror::Error)]
#[error("le générateur aléatoire du système est indisponible")]
pub struct ErreurAleatoire;

pub fn nouveau() -> Result<String, ErreurAleatoire> {
    let mut octets = [0u8; 12];
    getrandom::fill(&mut octets).map_err(|_| ErreurAleatoire)?;
    Ok(hexa::encoder(&octets))
}
