//! Préférences de saisie et d'affichage du praticien, gardées dans la base chiffrée.

use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};

pub const PARAMETRE_PREFERENCES: &str = "preferences";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    /// Les séances du dossier se regroupent par année au-delà de ce nombre ; jamais sans valeur.
    pub regrouper_seances_au_dela: Option<u32>,
    /// Le logiciel propose la fin des mots déjà saisis dans les séances et les trames.
    pub mots_frequents: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self { regrouper_seances_au_dela: Some(10), mots_frequents: true }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurPreferences {
    #[error("le regroupement par année se règle entre 1 et 1 000 séances")]
    Seuil,
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

pub fn lire(base: &Base) -> Result<Preferences, ErreurPreferences> {
    Ok(base.lire_parametre(PARAMETRE_PREFERENCES)?.unwrap_or_default())
}

pub fn enregistrer(base: &Base, preferences: &Preferences) -> Result<Preferences, ErreurPreferences> {
    if preferences.regrouper_seances_au_dela.is_some_and(|n| !(1..=1_000).contains(&n)) {
        return Err(ErreurPreferences::Seuil);
    }
    let avant = lire(base)?;
    base.atomique(|| {
        base.ecrire_parametre(PARAMETRE_PREFERENCES, preferences)?;
        let json = |p: &Preferences| serde_json::to_string(p).ok();
        base.journaliser("preferences.modifiees", PARAMETRE_PREFERENCES, json(&avant).as_deref(), json(preferences).as_deref())?;
        Ok::<_, ErreurPreferences>(())
    })?;
    Ok(preferences.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;

    #[test]
    fn garde_les_preferences_et_refuse_un_seuil_absurde() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        assert_eq!(lire(&base).unwrap(), Preferences::default());
        let choisies = Preferences { regrouper_seances_au_dela: None, mots_frequents: false };
        enregistrer(&base, &choisies).unwrap();
        assert_eq!(lire(&base).unwrap(), choisies);
        assert!(matches!(enregistrer(&base, &Preferences { regrouper_seances_au_dela: Some(0), ..choisies }), Err(ErreurPreferences::Seuil)));
        // Une préférence ajoutée plus tard prend sa valeur par défaut.
        base.ecrire_parametre(PARAMETRE_PREFERENCES, &serde_json::json!({ "mots_frequents": false })).unwrap();
        assert_eq!(lire(&base).unwrap().regrouper_seances_au_dela, Some(10));
    }
}
