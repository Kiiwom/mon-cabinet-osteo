//! Préférences de saisie et d'affichage du praticien, gardées dans la base chiffrée.

use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};

pub const PARAMETRE_PREFERENCES: &str = "preferences";
pub const PARAMETRE_APPARENCE: &str = "apparence";

/// Couleurs d'accent proposées ; l'ocre reprend la palette de pierre-besnier.fr.
pub const ACCENTS: [&str; 5] = ["ocre", "sauge", "bleu", "terracotta", "lavande"];
/// Taille du texte, en pourcentage de la taille normale.
pub const TAILLES_TEXTE: [u32; 6] = [100, 110, 120, 130, 140, 150];

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    /// Clair ou sombre selon le réglage de l'ordinateur.
    #[default]
    Systeme,
    Clair,
    Sombre,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tactile {
    /// Boutons et cases agrandis quand l'ordinateur a un écran tactile.
    #[default]
    Auto,
    Toujours,
    Jamais,
}

/// Apparence du logiciel. Gardée dans la base comme le reste ; l'interface en garde une copie pour
/// les écrans d'avant l'ouverture (verrouillage, clé de secours).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Apparence {
    pub theme: Theme,
    pub accent: String,
    pub taille_texte: u32,
    pub tactile: Tactile,
}

impl Default for Apparence {
    fn default() -> Self {
        Self { theme: Theme::Systeme, accent: "ocre".into(), taille_texte: 100, tactile: Tactile::Auto }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurPreferences {
    #[error("le regroupement par année se règle entre 1 et 1 000 séances")]
    Seuil,
    #[error("couleur d'accent inconnue")]
    Accent,
    #[error("la taille du texte va de 100 à 150 %, par pas de 10")]
    TailleTexte,
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

pub fn lire_apparence(base: &Base) -> Result<Apparence, ErreurPreferences> {
    Ok(base.lire_parametre(PARAMETRE_APPARENCE)?.unwrap_or_default())
}

pub fn enregistrer_apparence(base: &Base, apparence: &Apparence) -> Result<Apparence, ErreurPreferences> {
    if !ACCENTS.contains(&apparence.accent.as_str()) {
        return Err(ErreurPreferences::Accent);
    }
    if !TAILLES_TEXTE.contains(&apparence.taille_texte) {
        return Err(ErreurPreferences::TailleTexte);
    }
    let avant = lire_apparence(base)?;
    base.atomique(|| {
        base.ecrire_parametre(PARAMETRE_APPARENCE, apparence)?;
        let json = |a: &Apparence| serde_json::to_string(a).ok();
        base.journaliser("apparence.modifiee", PARAMETRE_APPARENCE, json(&avant).as_deref(), json(apparence).as_deref())?;
        Ok::<_, ErreurPreferences>(())
    })?;
    Ok(apparence.clone())
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

    #[test]
    fn garde_l_apparence_et_refuse_une_valeur_inconnue() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        assert_eq!(lire_apparence(&base).unwrap(), Apparence::default());
        let choisie = Apparence { theme: Theme::Sombre, accent: "sauge".into(), taille_texte: 130, tactile: Tactile::Toujours };
        enregistrer_apparence(&base, &choisie).unwrap();
        assert_eq!(lire_apparence(&base).unwrap(), choisie);
        let accent = Apparence { accent: "fuchsia".into(), ..choisie.clone() };
        assert!(matches!(enregistrer_apparence(&base, &accent), Err(ErreurPreferences::Accent)));
        let taille = Apparence { taille_texte: 125, ..choisie };
        assert!(matches!(enregistrer_apparence(&base, &taille), Err(ErreurPreferences::TailleTexte)));
        // Un réglage ajouté plus tard prend sa valeur par défaut.
        base.ecrire_parametre(PARAMETRE_APPARENCE, &serde_json::json!({ "theme": "clair" })).unwrap();
        assert_eq!(lire_apparence(&base).unwrap(), Apparence { theme: Theme::Clair, ..Apparence::default() });
    }
}
