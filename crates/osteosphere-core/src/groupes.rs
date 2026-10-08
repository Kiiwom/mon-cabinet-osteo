//! Groupes de patients : colorés, utilisables comme filtres de la liste (une famille, un club,
//! une entreprise…). Un patient peut appartenir à plusieurs groupes ; supprimer un groupe ne
//! touche pas aux dossiers.

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;

/// Les couleurs des prestations, reprises pour les groupes.
pub const COULEURS: [&str; 6] = crate::prestations::COULEURS;
const LONGUEUR_MAX: usize = 40;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaisieGroupe {
    pub nom: String,
    pub couleur: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Groupe {
    pub id: String,
    pub nom: String,
    pub couleur: String,
    /// Dossiers du groupe, archives comprises.
    pub patients: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurGroupe {
    #[error("indiquez le nom du groupe")]
    NomVide,
    #[error("le nom du groupe est trop long")]
    NomTropLong,
    #[error("un groupe porte déjà ce nom")]
    Doublon,
    #[error("couleur inconnue")]
    Couleur,
    #[error("ce groupe n'existe plus")]
    Introuvable,
    #[error(transparent)]
    Aleatoire(#[from] identifiant::ErreurAleatoire),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurGroupe {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurGroupe {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl SaisieGroupe {
    pub fn verifier(&self) -> Result<Self, ErreurGroupe> {
        let nom = self.nom.split_whitespace().collect::<Vec<_>>().join(" ");
        if nom.is_empty() {
            return Err(ErreurGroupe::NomVide);
        }
        if nom.chars().count() > LONGUEUR_MAX {
            return Err(ErreurGroupe::NomTropLong);
        }
        let couleur = if self.couleur.trim().is_empty() { COULEURS[0].to_owned() } else { self.couleur.trim().to_owned() };
        if !COULEURS.contains(&couleur.as_str()) {
            return Err(ErreurGroupe::Couleur);
        }
        Ok(Self { nom, couleur })
    }
}

const SELECTION: &str = "SELECT g.id, g.nom, g.couleur, (SELECT COUNT(*) FROM patients_groupes pg WHERE pg.groupe_id = g.id) AS patients
                         FROM groupes g";

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<Groupe> {
    Ok(Groupe { id: ligne.get("id")?, nom: ligne.get("nom")?, couleur: ligne.get("couleur")?, patients: ligne.get("patients")? })
}

fn lire(base: &Base, id: &str) -> Result<Groupe, ErreurGroupe> {
    base.connexion()
        .query_row(&format!("{SELECTION} WHERE g.id = ?1"), [id], depuis_ligne)
        .optional()?
        .ok_or(ErreurGroupe::Introuvable)
}

/// Les groupes par nom.
pub fn lister(base: &Base) -> Result<Vec<Groupe>, ErreurGroupe> {
    let mut requete = base.connexion().prepare(&format!("{SELECTION} ORDER BY g.nom COLLATE NOCASE"))?;
    Ok(requete.query_map([], depuis_ligne)?.collect::<Result<_, _>>()?)
}

/// Crée le groupe (`id` absent) ou le renomme et change sa couleur.
pub fn enregistrer(base: &Base, id: Option<&str>, saisie: &SaisieGroupe) -> Result<Groupe, ErreurGroupe> {
    let saisie = saisie.verifier()?;
    let homonyme: Option<String> = base
        .connexion()
        .query_row("SELECT id FROM groupes WHERE nom = ?1 COLLATE NOCASE", [&saisie.nom], |l| l.get(0))
        .optional()?;
    if homonyme.is_some_and(|h| Some(h.as_str()) != id) {
        return Err(ErreurGroupe::Doublon);
    }
    let avant = id.map(|id| lire(base, id)).transpose()?;
    let id = match &avant {
        Some(avant) => {
            base.connexion().execute(
                "UPDATE groupes SET nom = ?2, couleur = ?3, modifie_le = ?4 WHERE id = ?1",
                rusqlite::params![avant.id, saisie.nom, saisie.couleur, maintenant()],
            )?;
            avant.id.clone()
        }
        None => {
            let id = identifiant::nouveau()?;
            base.connexion().execute(
                "INSERT INTO groupes (id, nom, couleur, cree_le, modifie_le) VALUES (?1, ?2, ?3, ?4, ?4)",
                rusqlite::params![id, saisie.nom, saisie.couleur, maintenant()],
            )?;
            id
        }
    };
    let apres = lire(base, &id)?;
    base.journaliser(
        if avant.is_some() { "groupe.modifie" } else { "groupe.cree" },
        &id,
        avant.map(|a| serde_json::to_string(&a)).transpose()?.as_deref(),
        Some(&serde_json::to_string(&apres)?),
    )?;
    Ok(apres)
}

/// Supprime le groupe ; ses patients le quittent, leurs dossiers restent.
pub fn supprimer(base: &Base, id: &str) -> Result<(), ErreurGroupe> {
    let avant = lire(base, id)?;
    base.connexion().execute("DELETE FROM groupes WHERE id = ?1", [id])?;
    base.journaliser("groupe.supprime", id, Some(&serde_json::to_string(&avant)?), None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;
    use crate::patients::{self, FichePatient};

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        (dossier, base)
    }

    fn saisie(nom: &str, couleur: &str) -> SaisieGroupe {
        SaisieGroupe { nom: nom.into(), couleur: couleur.into() }
    }

    #[test]
    fn cree_renomme_et_refuse_les_homonymes() {
        let (_dossier, base) = base();
        let club = enregistrer(&base, None, &saisie("  Club de   rugby ", "")).unwrap();
        assert_eq!(club.nom, "Club de rugby");
        assert_eq!(club.couleur, "bleu");
        assert!(matches!(enregistrer(&base, None, &saisie("club DE rugby", "vert")), Err(ErreurGroupe::Doublon)));
        // Changer la casse ou la couleur de son propre nom reste possible.
        let renomme = enregistrer(&base, Some(&club.id), &saisie("Club de Rugby", "vert")).unwrap();
        assert_eq!((renomme.nom.as_str(), renomme.couleur.as_str()), ("Club de Rugby", "vert"));
        enregistrer(&base, None, &saisie("Famille Martin", "rose")).unwrap();
        let noms: Vec<String> = lister(&base).unwrap().into_iter().map(|g| g.nom).collect();
        assert_eq!(noms, ["Club de Rugby", "Famille Martin"]);
        assert!(matches!(saisie("", "bleu").verifier(), Err(ErreurGroupe::NomVide)));
        assert!(matches!(saisie("Club", "turquoise").verifier(), Err(ErreurGroupe::Couleur)));
        assert!(matches!(saisie(&"x".repeat(41), "bleu").verifier(), Err(ErreurGroupe::NomTropLong)));
    }

    #[test]
    fn supprimer_un_groupe_garde_les_dossiers() {
        let (_dossier, base) = base();
        let famille = enregistrer(&base, None, &saisie("Famille Martin", "rose")).unwrap();
        let fiche = FichePatient { nom: "Martin".into(), prenom: "Camille".into(), groupes: vec![famille.id.clone()], ..Default::default() };
        let patient = patients::creer(&base, &fiche).unwrap();
        assert_eq!(patient.fiche.groupes, std::slice::from_ref(&famille.id));
        assert_eq!(lister(&base).unwrap()[0].patients, 1);
        assert_eq!(patients::lister(&base).unwrap()[0].groupes, std::slice::from_ref(&famille.id));
        // Un groupe inconnu est refusé, sans rien écrire.
        let inconnu = FichePatient { groupes: vec!["inconnu".into()], ..fiche.clone() };
        assert!(matches!(patients::modifier(&base, &patient.id, &inconnu), Err(patients::ErreurPatient::GroupeIntrouvable)));
        assert_eq!(patients::lire(&base, &patient.id).unwrap().fiche.groupes, std::slice::from_ref(&famille.id));
        supprimer(&base, &famille.id).unwrap();
        assert!(patients::lire(&base, &patient.id).unwrap().fiche.groupes.is_empty());
        assert!(matches!(supprimer(&base, &famille.id), Err(ErreurGroupe::Introuvable)));
    }
}
