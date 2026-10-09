//! Verrouillage du cabinet pendant la journée, quand le mot de passe est activé.
//!
//! - Après une durée d'inactivité réglable, ou par Ctrl + L, le cabinet se verrouille : la base est
//!   fermée et la clé quitte la mémoire.
//! - Le code court, facultatif, rouvre le cabinet verrouillé entre deux patients. La clé de la base,
//!   scellée par ce code, est rangée dans la base chiffrée : elle n'est lisible que pendant que le
//!   cabinet est ouvert, et l'application ne la garde en mémoire que le temps d'un verrouillage. Au
//!   lancement du logiciel, le mot de passe complet reste demandé. Après cinq codes faux, aussi.

use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};
use crate::chiffrement::Enveloppe;

pub const PARAMETRE_VERROUILLAGE: &str = "verrouillage";
/// Durées d'inactivité proposées, en minutes.
pub const DELAIS_INACTIVITE: [u32; 5] = [5, 10, 15, 30, 60];
/// Codes faux acceptés avant d'exiger le mot de passe.
pub const ESSAIS_CODE_COURT: u8 = 5;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ReglagesVerrouillage {
    /// Minutes sans activité avant le verrouillage ; jamais si `None`.
    pub inactivite_minutes: Option<u32>,
    /// La clé de la base scellée par le code court.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_court: Option<Enveloppe>,
}

impl Default for ReglagesVerrouillage {
    fn default() -> Self {
        Self { inactivite_minutes: Some(15), code_court: None }
    }
}

/// Ce que l'interface peut savoir des réglages : jamais l'enveloppe du code.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EtatVerrouillage {
    pub inactivite_minutes: Option<u32>,
    pub code_court: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurVerrouillage {
    #[error("durée d'inactivité non proposée : {0} minutes")]
    Delai(u32),
    #[error("le code court compte 4 à 6 chiffres")]
    CodeFormat,
    #[error("ce code se devine trop facilement : évitez les suites et les chiffres répétés")]
    CodeFacile,
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

pub fn lire(base: &Base) -> Result<ReglagesVerrouillage, ErreurBase> {
    Ok(base.lire_parametre(PARAMETRE_VERROUILLAGE)?.unwrap_or_default())
}

pub fn etat(base: &Base) -> Result<EtatVerrouillage, ErreurBase> {
    let reglages = lire(base)?;
    Ok(EtatVerrouillage { inactivite_minutes: reglages.inactivite_minutes, code_court: reglages.code_court.is_some() })
}

fn ecrire(base: &Base, reglages: &ReglagesVerrouillage, action: &str) -> Result<(), ErreurBase> {
    base.atomique(|| {
        base.ecrire_parametre(PARAMETRE_VERROUILLAGE, reglages)?;
        // Le journal ne garde que la durée, jamais l'enveloppe du code.
        let apres = serde_json::json!({ "inactivite_minutes": reglages.inactivite_minutes }).to_string();
        base.journaliser(action, PARAMETRE_VERROUILLAGE, None, Some(&apres))
    })
}

pub fn regler_inactivite(base: &Base, minutes: Option<u32>) -> Result<EtatVerrouillage, ErreurVerrouillage> {
    if let Some(minutes) = minutes.filter(|m| !DELAIS_INACTIVITE.contains(m)) {
        return Err(ErreurVerrouillage::Delai(minutes));
    }
    let reglages = ReglagesVerrouillage { inactivite_minutes: minutes, ..lire(base)? };
    ecrire(base, &reglages, "verrouillage.inactivite")?;
    Ok(etat(base)?)
}

/// Refuse un code mal formé ou trop facile à deviner : 0000, 1234, 987654…
pub fn verifier_code(code: &str) -> Result<(), ErreurVerrouillage> {
    let chiffres: Vec<i32> = code.chars().filter_map(|c| c.to_digit(10).map(|d| d as i32)).collect();
    if chiffres.len() != code.chars().count() || !(4..=6).contains(&chiffres.len()) {
        return Err(ErreurVerrouillage::CodeFormat);
    }
    let ecarts: Vec<i32> = chiffres.windows(2).map(|p| p[1] - p[0]).collect();
    if ecarts.iter().all(|e| *e == ecarts[0] && e.abs() <= 1) {
        return Err(ErreurVerrouillage::CodeFacile);
    }
    Ok(())
}

/// Range l'enveloppe du code court, déjà scellée par le cabinet ouvert.
pub fn enregistrer_code_court(base: &Base, enveloppe: Enveloppe) -> Result<(), ErreurBase> {
    let reglages = ReglagesVerrouillage { code_court: Some(enveloppe), ..lire(base)? };
    ecrire(base, &reglages, "verrouillage.code_court_defini")
}

pub fn retirer_code_court(base: &Base) -> Result<(), ErreurBase> {
    let reglages = lire(base)?;
    if reglages.code_court.is_none() {
        return Ok(());
    }
    ecrire(base, &ReglagesVerrouillage { code_court: None, ..reglages }, "verrouillage.code_court_retire")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;

    #[test]
    fn refuse_les_codes_faciles() {
        for code in ["0000", "1234", "4321", "123456", "98765", "111111"] {
            assert!(matches!(verifier_code(code), Err(ErreurVerrouillage::CodeFacile)), "{code}");
        }
        for code in ["123", "1234567", "12a4", "١٢٣٤", ""] {
            assert!(matches!(verifier_code(code), Err(ErreurVerrouillage::CodeFormat)), "{code}");
        }
        for code in ["2468", "1357", "4826", "120612", "90817"] {
            assert!(verifier_code(code).is_ok(), "{code}");
        }
    }

    #[test]
    fn regle_la_duree_sans_toucher_au_code() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        assert_eq!(etat(&base).unwrap(), EtatVerrouillage { inactivite_minutes: Some(15), code_court: false });
        assert_eq!(regler_inactivite(&base, None).unwrap().inactivite_minutes, None);
        assert!(matches!(regler_inactivite(&base, Some(7)), Err(ErreurVerrouillage::Delai(7))));
        assert_eq!(regler_inactivite(&base, Some(30)).unwrap(), EtatVerrouillage { inactivite_minutes: Some(30), code_court: false });
        let journal: String = base.connexion().query_row("SELECT apres FROM journal WHERE action = 'verrouillage.inactivite' ORDER BY id DESC", [], |l| l.get(0)).unwrap();
        assert_eq!(journal, r#"{"inactivite_minutes":30}"#);
        retirer_code_court(&base).unwrap();
        assert_eq!(lire(&base).unwrap().inactivite_minutes, Some(30));
    }
}
