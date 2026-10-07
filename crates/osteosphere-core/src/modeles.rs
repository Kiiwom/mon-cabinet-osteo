//! Modèles de consultation : la liste des champs proposés à chaque séance.
//!
//! Chaque modification de la liste des champs crée une nouvelle version ; une séance garde la
//! version avec laquelle elle a été écrite. Les modèles fournis reprennent ceux du praticien dans
//! MonCabinetLibéral (Adulte, Femme enceinte, Nourrisson), plus Note libre et Examen par sphères.

use std::collections::HashSet;

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;

const MODELES_FOURNIS: &str = include_str!("modeles_fournis.json");
const PARAMETRE_FOURNIS: &str = "modeles.fournis_installes";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TypeChamp {
    TexteCourt,
    /// Texte mis en forme, avec les trames.
    #[default]
    TexteEnrichi,
    /// Un choix dans une liste.
    Liste,
    /// Plusieurs cases à cocher.
    Cases,
    /// Une case, et une précision quand elle est cochée.
    CasePrecision,
    Curseur,
    Date,
    Nombre,
    Intertitre,
    /// Taille, poids et IMC calculé.
    Mesures,
    /// Résumé de la séance précédente, en lecture.
    ResumePrecedent,
    /// Dessin sur planches anatomiques : module Schéma corporel.
    Dessin,
}

fn vrai() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Champ {
    /// Clé de la valeur dans la séance : ne change plus une fois le champ créé.
    pub id: String,
    #[serde(rename = "type")]
    pub type_champ: TypeChamp,
    pub libelle: String,
    #[serde(default = "vrai")]
    pub visible: bool,
    #[serde(default)]
    pub obligatoire: bool,
    /// Imprimé dans le compte rendu PDF.
    #[serde(default = "vrai")]
    pub imprimer: bool,
    /// « motif », « douleur_avant », « douleur_apres » ou vide : repris dans les listes et les statistiques.
    #[serde(default)]
    pub role: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pas: Option<f64>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub unite: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Definition {
    pub champs: Vec<Champ>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Modele {
    pub id: String,
    pub nom: String,
    /// Proposé automatiquement à partir de cet âge, en années révolues.
    pub age_min: Option<u32>,
    /// Proposé automatiquement avant cet âge.
    pub age_max: Option<u32>,
    pub par_defaut: bool,
    pub actif: bool,
    pub origine: String,
    pub version: i64,
    /// Date de la version en cours, en secondes depuis 1970.
    pub version_le: i64,
    pub definition: Definition,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaisieModele {
    pub nom: String,
    pub age_min: Option<u32>,
    pub age_max: Option<u32>,
    pub actif: bool,
    pub definition: Definition,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurModele {
    #[error("{0}")]
    Invalide(String),
    #[error("ce modèle n'existe plus")]
    Introuvable,
    #[error("un modèle désactivé ne peut pas être le modèle par défaut")]
    DefautInactif,
    #[error(transparent)]
    Aleatoire(#[from] identifiant::ErreurAleatoire),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurModele {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurModele {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

fn invalide(message: impl Into<String>) -> ErreurModele {
    ErreurModele::Invalide(message.into())
}

impl Champ {
    fn verifier(&self) -> Result<Self, ErreurModele> {
        let mut champ = self.clone();
        champ.libelle = self.libelle.split_whitespace().collect::<Vec<_>>().join(" ");
        champ.unite = self.unite.trim().to_owned();
        champ.options = self.options.iter().map(|o| o.trim().to_owned()).filter(|o| !o.is_empty()).collect();
        let nom = if champ.libelle.is_empty() { champ.id.clone() } else { format!("« {} »", champ.libelle) };
        if champ.id.is_empty() || champ.id.len() > 40 || !champ.id.bytes().all(|o| o.is_ascii_lowercase() || o.is_ascii_digit() || o == b'_') {
            return Err(invalide(format!("identifiant de champ invalide : {}", champ.id)));
        }
        if champ.libelle.is_empty() {
            return Err(invalide("chaque champ a besoin d'un libellé"));
        }
        match champ.type_champ {
            TypeChamp::Curseur => {
                let (min, max, pas) = (champ.min.unwrap_or(0.0), champ.max.unwrap_or(10.0), champ.pas.unwrap_or(1.0));
                if !(min < max) || pas <= 0.0 || (max - min) / pas > 1000.0 {
                    return Err(invalide(format!("{nom} : le minimum doit être sous le maximum, avec un pas positif")));
                }
                (champ.min, champ.max, champ.pas) = (Some(min), Some(max), Some(pas));
            }
            TypeChamp::Liste | TypeChamp::Cases => {
                if champ.options.is_empty() {
                    return Err(invalide(format!("{nom} : ajoutez au moins un choix")));
                }
                let uniques: HashSet<&String> = champ.options.iter().collect();
                if uniques.len() != champ.options.len() {
                    return Err(invalide(format!("{nom} : deux choix portent le même nom")));
                }
            }
            _ => {}
        }
        let role_admis = match champ.role.as_str() {
            "" => true,
            "motif" => matches!(champ.type_champ, TypeChamp::TexteCourt | TypeChamp::TexteEnrichi),
            "douleur_avant" | "douleur_apres" => champ.type_champ == TypeChamp::Curseur,
            _ => false,
        };
        if !role_admis {
            return Err(invalide(format!("{nom} : rôle « {} » impossible pour ce type de champ", champ.role)));
        }
        Ok(champ)
    }
}

impl SaisieModele {
    pub fn verifier(&self) -> Result<Self, ErreurModele> {
        let nom = self.nom.split_whitespace().collect::<Vec<_>>().join(" ");
        if nom.is_empty() {
            return Err(invalide("donnez un nom au modèle"));
        }
        if let (Some(min), Some(max)) = (self.age_min, self.age_max)
            && min >= max
        {
            return Err(invalide("la tranche d'âge est vide"));
        }
        if self.definition.champs.is_empty() {
            return Err(invalide("le modèle a besoin d'au moins un champ"));
        }
        let champs = self.definition.champs.iter().map(Champ::verifier).collect::<Result<Vec<_>, _>>()?;
        let mut ids = HashSet::new();
        let mut roles = HashSet::new();
        for champ in &champs {
            if !ids.insert(champ.id.as_str()) {
                return Err(invalide(format!("deux champs portent l'identifiant {}", champ.id)));
            }
            if !champ.role.is_empty() && !roles.insert(champ.role.as_str()) {
                return Err(invalide(format!("un seul champ peut tenir le rôle « {} »", champ.role)));
            }
        }
        for unique in [TypeChamp::Mesures, TypeChamp::ResumePrecedent] {
            if champs.iter().filter(|c| c.type_champ == unique).count() > 1 {
                return Err(invalide("taille, poids et IMC, comme le résumé de la séance précédente, ne figurent qu'une fois"));
            }
        }
        Ok(Self { nom, age_min: self.age_min, age_max: self.age_max, actif: self.actif, definition: Definition { champs } })
    }
}

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<(Modele, String)> {
    Ok((
        Modele {
            id: ligne.get("id")?,
            nom: ligne.get("nom")?,
            age_min: ligne.get("age_min")?,
            age_max: ligne.get("age_max")?,
            par_defaut: ligne.get("par_defaut")?,
            actif: ligne.get("actif")?,
            origine: ligne.get("origine")?,
            version: ligne.get("version")?,
            version_le: ligne.get("cree_le")?,
            definition: Definition::default(),
        },
        ligne.get("definition")?,
    ))
}

const SELECTION: &str = "SELECT m.*, v.definition, v.cree_le FROM modeles m
  JOIN versions_modeles v ON v.modele_id = m.id AND v.version = m.version";

fn avec_definition((mut modele, definition): (Modele, String)) -> Result<Modele, ErreurModele> {
    modele.definition = serde_json::from_str(&definition)?;
    Ok(modele)
}

/// Modèles avec leur version en cours : le modèle par défaut d'abord, puis dans l'ordre de création.
pub fn lister(base: &Base) -> Result<Vec<Modele>, ErreurModele> {
    let mut requete = base.connexion().prepare(&format!("{SELECTION} ORDER BY m.par_defaut DESC, m.ordre, m.nom"))?;
    let lignes = requete.query_map([], depuis_ligne)?.collect::<Result<Vec<_>, _>>()?;
    lignes.into_iter().map(avec_definition).collect()
}

pub fn lire(base: &Base, id: &str) -> Result<Modele, ErreurModele> {
    let ligne = base
        .connexion()
        .query_row(&format!("{SELECTION} WHERE m.id = ?1"), [id], depuis_ligne)
        .optional()?
        .ok_or(ErreurModele::Introuvable)?;
    avec_definition(ligne)
}

/// Définition d'une version passée : celle qu'une séance a utilisée.
pub fn lire_version(base: &Base, id: &str, version: i64) -> Result<Definition, ErreurModele> {
    let texte: String = base
        .connexion()
        .query_row("SELECT definition FROM versions_modeles WHERE modele_id = ?1 AND version = ?2", rusqlite::params![id, version], |l| l.get(0))
        .optional()?
        .ok_or(ErreurModele::Introuvable)?;
    Ok(serde_json::from_str(&texte)?)
}

fn inserer_version(base: &Base, id: &str, version: i64, definition: &Definition) -> Result<(), ErreurModele> {
    base.connexion().execute(
        "INSERT INTO versions_modeles (modele_id, version, definition, cree_le) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, version, serde_json::to_string(definition)?, maintenant()],
    )?;
    Ok(())
}

fn creer(base: &Base, saisie: &SaisieModele, origine: &str, par_defaut: bool) -> Result<String, ErreurModele> {
    let id = identifiant::nouveau()?;
    let ordre: i64 = base.connexion().query_row("SELECT COALESCE(MAX(ordre), 0) + 1 FROM modeles", [], |l| l.get(0))?;
    base.connexion().execute(
        "INSERT INTO modeles (id, nom, age_min, age_max, par_defaut, actif, origine, ordre, version, modifie_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)",
        rusqlite::params![id, saisie.nom, saisie.age_min, saisie.age_max, par_defaut, saisie.actif, origine, ordre, maintenant()],
    )?;
    inserer_version(base, &id, 1, &saisie.definition)?;
    Ok(id)
}

/// Crée ou modifie un modèle. Une nouvelle liste de champs crée une nouvelle version.
pub fn enregistrer(base: &Base, id: Option<&str>, saisie: &SaisieModele) -> Result<Modele, ErreurModele> {
    let saisie = saisie.verifier()?;
    let (id, avant) = match id {
        None => {
            let aucun_defaut: bool = base.connexion().query_row("SELECT COUNT(*) = 0 FROM modeles WHERE par_defaut = 1", [], |l| l.get(0))?;
            (creer(base, &saisie, "praticien", aucun_defaut && saisie.actif)?, None)
        }
        Some(id) => {
            let avant = lire(base, id)?;
            if avant.par_defaut && !saisie.actif {
                return Err(ErreurModele::DefautInactif);
            }
            let version = if avant.definition == saisie.definition {
                avant.version
            } else {
                inserer_version(base, id, avant.version + 1, &saisie.definition)?;
                avant.version + 1
            };
            base.connexion().execute(
                "UPDATE modeles SET nom = ?2, age_min = ?3, age_max = ?4, actif = ?5, version = ?6, modifie_le = ?7 WHERE id = ?1",
                rusqlite::params![id, saisie.nom, saisie.age_min, saisie.age_max, saisie.actif, version, maintenant()],
            )?;
            (id.to_owned(), Some(avant))
        }
    };
    let apres = lire(base, &id)?;
    base.journaliser(
        if avant.is_some() { "modele.modifie" } else { "modele.cree" },
        &id,
        avant.map(|m| serde_json::to_string(&m)).transpose()?.as_deref(),
        Some(&serde_json::to_string(&apres)?),
    )?;
    Ok(apres)
}

pub fn definir_par_defaut(base: &Base, id: &str) -> Result<Modele, ErreurModele> {
    let modele = lire(base, id)?;
    if !modele.actif {
        return Err(ErreurModele::DefautInactif);
    }
    base.connexion().execute("UPDATE modeles SET par_defaut = (id = ?1)", [id])?;
    base.journaliser("modele.par_defaut", id, None, None)?;
    lire(base, id)
}

#[derive(Deserialize)]
struct ModeleFourni {
    #[serde(flatten)]
    saisie: SaisieModele,
    par_defaut: bool,
}

/// Installe les modèles fournis, une seule fois par cabinet : un modèle supprimé ou modifié le reste.
pub fn installer_modeles_fournis(base: &Base) -> Result<usize, ErreurModele> {
    if base.lire_parametre::<bool>(PARAMETRE_FOURNIS)?.unwrap_or(false) {
        return Ok(0);
    }
    let fournis: Vec<ModeleFourni> = serde_json::from_str(MODELES_FOURNIS)?;
    for fourni in &fournis {
        creer(base, &fourni.saisie.verifier()?, "fourni", fourni.par_defaut)?;
    }
    base.ecrire_parametre(PARAMETRE_FOURNIS, &true)?;
    Ok(fournis.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        (dossier, base)
    }

    fn champ(id: &str, type_champ: TypeChamp, libelle: &str) -> Champ {
        Champ {
            id: id.into(),
            type_champ,
            libelle: libelle.into(),
            visible: true,
            obligatoire: false,
            imprimer: true,
            role: String::new(),
            options: vec![],
            min: None,
            max: None,
            pas: None,
            unite: String::new(),
        }
    }

    #[test]
    fn installe_les_modeles_fournis_une_seule_fois() {
        let (_dossier, base) = base();
        assert_eq!(installer_modeles_fournis(&base).unwrap(), 5);
        assert_eq!(installer_modeles_fournis(&base).unwrap(), 0);
        let modeles = lister(&base).unwrap();
        let noms: Vec<&str> = modeles.iter().map(|m| m.nom.as_str()).collect();
        assert_eq!(noms, ["Adulte", "Femme enceinte", "Nourrisson", "Note libre", "Examen par sphères"]);
        assert!(modeles[0].par_defaut && modeles[0].age_min == Some(18));
        assert_eq!(modeles[2].age_max, Some(2));
        assert!(!modeles[4].actif);
        let adulte = &modeles[0].definition.champs;
        assert_eq!(adulte[1].role, "douleur_avant");
        assert_eq!((adulte[1].min, adulte[1].max, adulte[1].pas), (Some(0.0), Some(10.0), Some(1.0)));
        assert!(adulte.iter().any(|c| c.type_champ == TypeChamp::Dessin));
    }

    #[test]
    fn une_nouvelle_liste_de_champs_cree_une_version_et_garde_l_ancienne() {
        let (_dossier, base) = base();
        installer_modeles_fournis(&base).unwrap();
        let adulte = lister(&base).unwrap().remove(0);
        assert_eq!(adulte.version, 1);
        let mut saisie = SaisieModele { nom: adulte.nom.clone(), age_min: adulte.age_min, age_max: adulte.age_max, actif: true, definition: adulte.definition.clone() };

        // Seul le nom change : même version.
        saisie.nom = "Adulte et adolescent".into();
        saisie.age_min = Some(12);
        let renomme = enregistrer(&base, Some(&adulte.id), &saisie).unwrap();
        assert_eq!((renomme.version, renomme.nom.as_str(), renomme.age_min), (1, "Adulte et adolescent", Some(12)));

        saisie.definition.champs.push(champ("sommeil", TypeChamp::TexteCourt, "Qualité du sommeil"));
        let enrichi = enregistrer(&base, Some(&adulte.id), &saisie).unwrap();
        assert_eq!(enrichi.version, 2);
        assert_eq!(lire_version(&base, &adulte.id, 1).unwrap(), adulte.definition);
        assert_eq!(lire_version(&base, &adulte.id, 2).unwrap().champs.last().unwrap().id, "sommeil");
    }

    #[test]
    fn verifie_les_champs() {
        let modele = |champs: Vec<Champ>| SaisieModele { nom: "Essai".into(), actif: true, definition: Definition { champs }, ..Default::default() };
        let erreur = |champs: Vec<Champ>| modele(champs).verifier().unwrap_err().to_string();
        let texte = champ("motif", TypeChamp::TexteEnrichi, "Motif");
        assert_eq!(erreur(vec![]), "le modèle a besoin d'au moins un champ");
        assert_eq!(erreur(vec![texte.clone(), texte.clone()]), "deux champs portent l'identifiant motif");
        assert_eq!(erreur(vec![champ("Motif", TypeChamp::TexteCourt, "Motif")]), "identifiant de champ invalide : Motif");
        assert_eq!(erreur(vec![champ("liste", TypeChamp::Liste, "Côté")]), "« Côté » : ajoutez au moins un choix");
        let mut curseur = champ("douleur", TypeChamp::Curseur, "Douleur");
        curseur.min = Some(10.0);
        curseur.max = Some(0.0);
        assert_eq!(erreur(vec![curseur.clone()]), "« Douleur » : le minimum doit être sous le maximum, avec un pas positif");
        let mut mauvais_role = texte.clone();
        mauvais_role.role = "douleur_avant".into();
        assert_eq!(erreur(vec![mauvais_role]), "« Motif » : rôle « douleur_avant » impossible pour ce type de champ");
        assert_eq!(erreur(vec![champ("a", TypeChamp::Mesures, "M"), champ("b", TypeChamp::Mesures, "M")]), "taille, poids et IMC, comme le résumé de la séance précédente, ne figurent qu'une fois");
        // Un curseur sans bornes prend 0 à 10, pas de 1.
        let verifie = modele(vec![champ("eva", TypeChamp::Curseur, "EVA")]).verifier().unwrap();
        assert_eq!((verifie.definition.champs[0].min, verifie.definition.champs[0].max), (Some(0.0), Some(10.0)));
        assert_eq!(SaisieModele { nom: " ".into(), ..modele(vec![texte.clone()]) }.verifier().unwrap_err().to_string(), "donnez un nom au modèle");
        assert_eq!(SaisieModele { age_min: Some(18), age_max: Some(2), ..modele(vec![texte]) }.verifier().unwrap_err().to_string(), "la tranche d'âge est vide");
    }

    #[test]
    fn modele_par_defaut() {
        let (_dossier, base) = base();
        installer_modeles_fournis(&base).unwrap();
        let modeles = lister(&base).unwrap();
        let nourrisson = &modeles[2];
        definir_par_defaut(&base, &nourrisson.id).unwrap();
        let apres = lister(&base).unwrap();
        assert_eq!(apres[0].nom, "Nourrisson");
        assert_eq!(apres.iter().filter(|m| m.par_defaut).count(), 1);
        assert!(matches!(definir_par_defaut(&base, &modeles[4].id), Err(ErreurModele::DefautInactif)));
        let saisie = SaisieModele { nom: "Nourrisson".into(), actif: false, definition: nourrisson.definition.clone(), ..Default::default() };
        assert!(matches!(enregistrer(&base, Some(&nourrisson.id), &saisie), Err(ErreurModele::DefautInactif)));
    }

    #[test]
    fn un_nouveau_modele_est_cree_en_version_1_et_journalise() {
        let (_dossier, base) = base();
        let saisie = SaisieModele {
            nom: "Sportif".into(),
            actif: true,
            definition: Definition { champs: vec![champ("motif", TypeChamp::TexteEnrichi, "Motif")] },
            ..Default::default()
        };
        let modele = enregistrer(&base, None, &saisie).unwrap();
        assert_eq!((modele.version, modele.origine.as_str()), (1, "praticien"));
        // Premier modèle du cabinet : il devient le modèle par défaut.
        assert!(modele.par_defaut);
        let action: String = base.connexion().query_row("SELECT action FROM journal ORDER BY id DESC LIMIT 1", [], |l| l.get(0)).unwrap();
        assert_eq!(action, "modele.cree");
    }
}
