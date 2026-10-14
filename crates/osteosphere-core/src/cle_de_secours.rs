//! Clé de secours : 24 caractères imprimables, présentés en six groupes de quatre.
//!
//! Elle est remise au premier démarrage, avec ou sans mot de passe. Elle seule rouvre les
//! sauvegardes sur un autre poste et remplace un mot de passe oublié.
//!
//! Alphabet de Crockford (chiffres et majuscules sans I, L, O ni U) : 5 bits par caractère,
//! soit 120 bits au total.

use std::fmt;

use zeroize::{Zeroize, ZeroizeOnDrop};

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// Nombre de caractères, tirets exclus.
pub const LONGUEUR: usize = 24;
const GROUPE: usize = 4;

#[derive(Clone, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
pub struct CleDeSecours(String);

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ErreurCle {
    #[error("la clé de secours compte {LONGUEUR} caractères, tirets non compris")]
    Longueur,
    #[error("la clé de secours contient un caractère qui n'en fait pas partie")]
    Caractere,
    #[error("le générateur aléatoire du système est indisponible")]
    Aleatoire,
}

impl CleDeSecours {
    pub fn generer() -> Result<Self, ErreurCle> {
        let mut octets = [0u8; LONGUEUR];
        getrandom::fill(&mut octets).map_err(|_| ErreurCle::Aleatoire)?;
        // 256 est un multiple de 32 : chaque caractère a exactement la même probabilité.
        let texte = octets.iter().map(|o| ALPHABET[(o & 31) as usize] as char).collect();
        octets.zeroize();
        Ok(Self(texte))
    }

    /// Lit une clé saisie, en majuscules ou minuscules, avec ou sans tirets ni espaces.
    /// O se lit 0, I et L se lisent 1, comme le prévoit l'alphabet de Crockford.
    pub fn lire(saisie: &str) -> Result<Self, ErreurCle> {
        let mut texte = String::with_capacity(LONGUEUR);
        for c in saisie.chars() {
            if c == '-' || c.is_whitespace() {
                continue;
            }
            let c = match c.to_ascii_uppercase() {
                'O' => '0',
                'I' | 'L' => '1',
                c => c,
            };
            if !c.is_ascii() || !ALPHABET.contains(&(c as u8)) {
                texte.zeroize();
                return Err(ErreurCle::Caractere);
            }
            texte.push(c);
        }
        if texte.len() != LONGUEUR {
            texte.zeroize();
            return Err(ErreurCle::Longueur);
        }
        Ok(Self(texte))
    }

    /// Forme imprimée : `7KQM-R4TX-9WBE-H2NC-PX6V-3DFA`.
    pub fn affichage(&self) -> String {
        self.0
            .as_bytes()
            .chunks(GROUPE)
            .map(|groupe| std::str::from_utf8(groupe).expect("alphabet ASCII"))
            .collect::<Vec<_>>()
            .join("-")
    }

    pub(crate) fn secret(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

/// N'affiche jamais la clé dans les journaux.
impl fmt::Debug for CleDeSecours {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CleDeSecours(****)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn genere_six_groupes_de_quatre() {
        let cle = CleDeSecours::generer().unwrap();
        let texte = cle.affichage();
        assert_eq!(texte.len(), LONGUEUR + 5);
        assert_eq!(texte.split('-').count(), 6);
        assert!(texte.split('-').all(|g| g.len() == GROUPE));
    }

    #[test]
    fn deux_cles_different() {
        assert_ne!(CleDeSecours::generer().unwrap(), CleDeSecours::generer().unwrap());
    }

    #[test]
    fn relit_la_forme_imprimee_et_une_saisie_libre() {
        let cle = CleDeSecours::lire("7KQM-R4TX-9WBE-H2NC-PX6V-3DFA").unwrap();
        assert_eq!(cle.affichage(), "7KQM-R4TX-9WBE-H2NC-PX6V-3DFA");
        assert_eq!(CleDeSecours::lire("7kqm r4tx 9wbe h2nc px6v 3dfa").unwrap(), cle);
    }

    #[test]
    fn corrige_les_lettres_ambigues() {
        let cle = CleDeSecours::lire("OOOO-IIII-LLLL-0000-1111-2222").unwrap();
        assert_eq!(cle.affichage(), "0000-1111-1111-0000-1111-2222");
    }

    #[test]
    fn refuse_une_cle_incomplete_ou_fausse() {
        assert_eq!(CleDeSecours::lire("7KQM-R4TX"), Err(ErreurCle::Longueur));
        assert_eq!(CleDeSecours::lire("UUUU-R4TX-9WBE-H2NC-PX6V-3DFA"), Err(ErreurCle::Caractere));
        assert_eq!(CleDeSecours::lire("ÉKQM-R4TX-9WBE-H2NC-PX6V-3DFA"), Err(ErreurCle::Caractere));
    }

    #[test]
    fn ne_se_montre_pas_dans_les_journaux() {
        let cle = CleDeSecours::generer().unwrap();
        assert_eq!(format!("{cle:?}"), "CleDeSecours(****)");
    }
}
