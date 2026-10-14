//! Accueil personnalisable : blocs affichés ou masqués, pense-bêtes du praticien. Rangés dans la
//! base, ils suivent le cabinet dans ses sauvegardes.

use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};
use crate::identifiant;
use crate::numerotation::Date;

pub const PARAMETRE_ACCUEIL: &str = "accueil";

/// Les blocs de l'accueil, dans leur ordre d'affichage.
pub const BLOCS: [&str; 8] = ["seances_du_jour", "dernieres_seances", "a_facturer", "statistiques", "pense_betes", "en_attente", "anniversaires", "sauvegarde"];

/// Les couleurs des pense-bêtes ; le jaune d'abord, celui des notes collées.
pub const COULEURS: [&str; 6] = ["jaune", "vert", "bleu", "rose", "violet", "orange"];

const PENSE_BETES_MAX: usize = 100;
const LONGUEUR_MAX: usize = 300;

#[derive(Debug, thiserror::Error)]
pub enum ErreurAccueil {
    #[error("{0}")]
    Invalide(String),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PenseBete {
    pub id: String,
    pub texte: String,
    /// `AAAA-MM-JJ`.
    pub le: String,
    /// Une des [`COULEURS`] ; jaune pour les pense-bêtes d'avant les couleurs.
    #[serde(default = "jaune")]
    pub couleur: String,
}

fn jaune() -> String {
    COULEURS[0].to_owned()
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Accueil {
    /// Blocs masqués par le praticien ; tous sont affichés par défaut.
    #[serde(default)]
    pub masques: Vec<String>,
    /// Le plus récent en premier.
    #[serde(default)]
    pub pense_betes: Vec<PenseBete>,
}

pub fn lire(base: &Base) -> Result<Accueil, ErreurAccueil> {
    Ok(base.lire_parametre(PARAMETRE_ACCUEIL)?.unwrap_or_default())
}

/// Vérifie et enregistre l'accueil : un pense-bête sans identifiant en reçoit un.
pub fn enregistrer(base: &Base, accueil: &Accueil) -> Result<Accueil, ErreurAccueil> {
    let invalide = |m: &str| ErreurAccueil::Invalide(m.to_owned());
    let mut propre = Accueil::default();
    for bloc in &accueil.masques {
        if !BLOCS.contains(&bloc.as_str()) {
            return Err(invalide("Bloc d’accueil inconnu."));
        }
        if !propre.masques.contains(bloc) {
            propre.masques.push(bloc.clone());
        }
    }
    if accueil.pense_betes.len() > PENSE_BETES_MAX {
        return Err(invalide("Cent pense-bêtes au plus : supprimez ceux qui sont faits."));
    }
    for note in &accueil.pense_betes {
        let texte = note.texte.split_whitespace().collect::<Vec<_>>().join(" ");
        if texte.is_empty() {
            return Err(invalide("Un pense-bête vide ne sert à rien."));
        }
        if texte.chars().count() > LONGUEUR_MAX {
            return Err(invalide("Un pense-bête tient en 300 caractères."));
        }
        Date::lire(&note.le).map_err(|_| invalide("Date de pense-bête invalide."))?;
        if !COULEURS.contains(&note.couleur.as_str()) {
            return Err(invalide("Couleur de pense-bête inconnue."));
        }
        let id = if note.id.is_empty() { identifiant::nouveau().map_err(|e| ErreurAccueil::Invalide(e.to_string()))? } else { note.id.clone() };
        propre.pense_betes.push(PenseBete { id, texte, le: note.le.clone(), couleur: note.couleur.clone() });
    }
    base.atomique(|| {
        base.ecrire_parametre(PARAMETRE_ACCUEIL, &propre)?;
        base.journaliser("accueil.modifie", PARAMETRE_ACCUEIL, None, None)?;
        Ok::<_, ErreurAccueil>(())
    })?;
    Ok(propre)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;

    #[test]
    fn garde_les_blocs_masques_et_les_pense_betes() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        assert_eq!(lire(&base).unwrap(), Accueil::default());

        let saisi = Accueil {
            masques: vec!["anniversaires".into(), "anniversaires".into()],
            pense_betes: vec![PenseBete { id: String::new(), texte: "  Commander des draps\n d’examen ".into(), le: "2026-10-02".into(), couleur: "vert".into() }],
        };
        let enregistre = enregistrer(&base, &saisi).unwrap();
        assert_eq!(enregistre.masques, ["anniversaires"]);
        assert_eq!(enregistre.pense_betes[0].texte, "Commander des draps d’examen");
        assert!(!enregistre.pense_betes[0].id.is_empty());
        assert_eq!(enregistre.pense_betes[0].couleur, "vert");
        assert_eq!(lire(&base).unwrap(), enregistre);

        let inconnu = Accueil { masques: vec!["agenda".into()], ..Default::default() };
        assert!(matches!(enregistrer(&base, &inconnu), Err(ErreurAccueil::Invalide(_))));
        let vide = Accueil { pense_betes: vec![PenseBete { id: "a".into(), texte: " ".into(), le: "2026-10-02".into(), couleur: jaune() }], ..Default::default() };
        assert!(matches!(enregistrer(&base, &vide), Err(ErreurAccueil::Invalide(_))));
        let teinte = Accueil { pense_betes: vec![PenseBete { id: "a".into(), texte: "Appeler".into(), le: "2026-10-02".into(), couleur: "fuchsia".into() }], ..Default::default() };
        assert!(matches!(enregistrer(&base, &teinte), Err(ErreurAccueil::Invalide(_))));
        assert_eq!(lire(&base).unwrap(), enregistre);
    }

    #[test]
    fn un_pense_bete_d_avant_les_couleurs_est_jaune() {
        let ancien: Accueil = serde_json::from_str(r#"{"masques":[],"pense_betes":[{"id":"a","texte":"Draps","le":"2026-10-02"}]}"#).unwrap();
        assert_eq!(ancien.pense_betes[0].couleur, "jaune");
    }
}
