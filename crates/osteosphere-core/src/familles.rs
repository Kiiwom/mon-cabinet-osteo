//! Liens familiaux entre dossiers : parent, enfant, conjoint, frère ou sœur. Un lien s'inscrit
//! dans les deux sens : dire que Camille est la mère de Lucas, c'est dire que Lucas est son
//! enfant. Un parent ou un conjoint peut recevoir les factures du patient.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::base::{Base, ErreurBase};
use crate::patients::{self, ErreurPatient, Patient};

/// Ce que le proche est pour le patient, dans l'ordre d'affichage.
pub const LIENS: [&str; 4] = ["parent", "enfant", "conjoint", "fratrie"];
/// Les proches qui peuvent recevoir les factures du patient.
const PAYEURS: [&str; 2] = ["parent", "conjoint"];

fn inverse(lien: &str) -> &'static str {
    match lien {
        "parent" => "enfant",
        "enfant" => "parent",
        "conjoint" => "conjoint",
        _ => "fratrie",
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Proche {
    pub id: String,
    pub lien: String,
    pub sexe: String,
    pub nom: String,
    pub prenom: String,
    pub naissance: Option<String>,
    pub archive: bool,
    pub decede: bool,
    /// Ce proche reçoit les factures du patient.
    pub recoit_les_factures: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurFamille {
    #[error("lien familial inconnu")]
    LienInconnu,
    #[error("un dossier ne peut pas être lié à lui-même")]
    SoiMeme,
    #[error("ces deux dossiers ne sont pas liés")]
    NonLies,
    #[error("seul un parent ou un conjoint peut recevoir les factures")]
    PayeurInvalide,
    #[error(transparent)]
    Patient(#[from] ErreurPatient),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurFamille {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurFamille {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

/// Les proches du patient : parents, enfants, conjoint, puis frères et sœurs, chacun du plus âgé au plus jeune.
pub fn proches(base: &Base, patient_id: &str) -> Result<Vec<Proche>, ErreurFamille> {
    let payeur: Option<String> = base
        .connexion()
        .query_row("SELECT factures_a FROM patients WHERE id = ?1", [patient_id], |l| l.get(0))
        .optional()?
        .flatten();
    let mut requete = base.connexion().prepare(
        "SELECT p.id, l.lien, p.sexe, p.nom, p.prenom, p.naissance, p.archive_le, p.decede
         FROM liens_familiaux l JOIN patients p ON p.id = l.proche_id
         WHERE l.patient_id = ?1",
    )?;
    let mut liste: Vec<Proche> = requete
        .query_map([patient_id], |l| {
            let id: String = l.get(0)?;
            Ok(Proche {
                recoit_les_factures: payeur.as_deref() == Some(id.as_str()),
                id,
                lien: l.get(1)?,
                sexe: l.get(2)?,
                nom: l.get(3)?,
                prenom: l.get(4)?,
                naissance: l.get(5)?,
                archive: l.get::<_, Option<i64>>(6)?.is_some(),
                decede: l.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let rang = |lien: &str| LIENS.iter().position(|l| *l == lien).unwrap_or(LIENS.len());
    liste.sort_by(|a, b| {
        rang(&a.lien)
            .cmp(&rang(&b.lien))
            .then_with(|| a.naissance.is_none().cmp(&b.naissance.is_none()))
            .then_with(|| a.naissance.cmp(&b.naissance))
            .then_with(|| a.prenom.cmp(&b.prenom))
    });
    Ok(liste)
}

fn lien_entre(base: &Base, patient_id: &str, proche_id: &str) -> Result<Option<String>, ErreurFamille> {
    Ok(base
        .connexion()
        .query_row("SELECT lien FROM liens_familiaux WHERE patient_id = ?1 AND proche_id = ?2", [patient_id, proche_id], |l| l.get(0))
        .optional()?)
}

/// Retire le payeur de chacun des deux dossiers s'il désigne l'autre et que le lien ne le permet plus.
fn verifier_payeurs(base: &Base, a: &str, b: &str) -> Result<(), ErreurFamille> {
    for (patient, proche) in [(a, b), (b, a)] {
        let permis = lien_entre(base, patient, proche)?.is_some_and(|l| PAYEURS.contains(&l.as_str()));
        if !permis {
            base.connexion().execute("UPDATE patients SET factures_a = NULL WHERE id = ?1 AND factures_a = ?2", [patient, proche])?;
        }
    }
    Ok(())
}

/// Lie deux dossiers : `lien` dit ce que le proche est pour le patient. Un lien existant est remplacé.
pub fn lier(base: &Base, patient_id: &str, proche_id: &str, lien: &str) -> Result<Vec<Proche>, ErreurFamille> {
    if !LIENS.contains(&lien) {
        return Err(ErreurFamille::LienInconnu);
    }
    if patient_id == proche_id {
        return Err(ErreurFamille::SoiMeme);
    }
    patients::lire(base, patient_id)?;
    patients::lire(base, proche_id)?;
    let avant = lien_entre(base, patient_id, proche_id)?;
    base.atomique(|| {
        let ecrire = "INSERT INTO liens_familiaux (patient_id, proche_id, lien) VALUES (?1, ?2, ?3)
                      ON CONFLICT (patient_id, proche_id) DO UPDATE SET lien = excluded.lien";
        base.connexion().execute(ecrire, [patient_id, proche_id, lien])?;
        base.connexion().execute(ecrire, [proche_id, patient_id, inverse(lien)])?;
        verifier_payeurs(base, patient_id, proche_id)?;
        base.journaliser(
            "famille.lien",
            patient_id,
            avant.map(|l| json!({ "proche_id": proche_id, "lien": l }).to_string()).as_deref(),
            Some(&json!({ "proche_id": proche_id, "lien": lien }).to_string()),
        )?;
        Ok::<_, ErreurFamille>(())
    })?;
    proches(base, patient_id)
}

/// Défait le lien entre deux dossiers, dans les deux sens.
pub fn delier(base: &Base, patient_id: &str, proche_id: &str) -> Result<Vec<Proche>, ErreurFamille> {
    let Some(avant) = lien_entre(base, patient_id, proche_id)? else {
        return Err(ErreurFamille::NonLies);
    };
    base.atomique(|| {
        base.connexion().execute(
            "DELETE FROM liens_familiaux WHERE (patient_id = ?1 AND proche_id = ?2) OR (patient_id = ?2 AND proche_id = ?1)",
            [patient_id, proche_id],
        )?;
        verifier_payeurs(base, patient_id, proche_id)?;
        base.journaliser("famille.delie", patient_id, Some(&json!({ "proche_id": proche_id, "lien": avant }).to_string()), None)?;
        Ok::<_, ErreurFamille>(())
    })?;
    proches(base, patient_id)
}

/// Le proche qui reçoit les factures du patient (un parent ou un conjoint), ou le patient lui-même.
pub fn definir_payeur(base: &Base, patient_id: &str, payeur: Option<&str>) -> Result<Patient, ErreurFamille> {
    let avant = patients::lire(base, patient_id)?;
    if let Some(payeur) = payeur
        && !lien_entre(base, patient_id, payeur)?.is_some_and(|l| PAYEURS.contains(&l.as_str()))
    {
        return Err(ErreurFamille::PayeurInvalide);
    }
    if avant.factures_a.as_deref() == payeur {
        return Ok(avant);
    }
    base.connexion().execute("UPDATE patients SET factures_a = ?2 WHERE id = ?1", rusqlite::params![patient_id, payeur])?;
    base.journaliser(
        "patient.payeur",
        patient_id,
        Some(&json!({ "factures_a": avant.factures_a }).to_string()),
        Some(&json!({ "factures_a": payeur }).to_string()),
    )?;
    Ok(patients::lire(base, patient_id)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;
    use crate::patients::FichePatient;

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        (dossier, base)
    }

    fn patient(base: &Base, prenom: &str, naissance: &str) -> String {
        let fiche = FichePatient { nom: "Martin".into(), prenom: prenom.into(), naissance: Some(naissance.into()), ..Default::default() };
        patients::creer(base, &fiche).unwrap().id
    }

    #[test]
    fn lie_dans_les_deux_sens_et_range_les_proches() {
        let (_dossier, base) = base();
        let (camille, lucas, lea, paul) =
            (patient(&base, "Camille", "1988-03-14"), patient(&base, "Lucas", "2019-06-02"), patient(&base, "Léa", "2016-01-10"), patient(&base, "Paul", "1986-07-01"));
        lier(&base, &lucas, &camille, "parent").unwrap();
        lier(&base, &camille, &lea, "enfant").unwrap();
        lier(&base, &camille, &paul, "conjoint").unwrap();
        lier(&base, &lucas, &lea, "fratrie").unwrap();

        let de_camille: Vec<(String, String)> = proches(&base, &camille).unwrap().into_iter().map(|p| (p.prenom, p.lien)).collect();
        assert_eq!(de_camille, [("Léa".into(), "enfant".into()), ("Lucas".into(), "enfant".into()), ("Paul".into(), "conjoint".into())]);
        let de_lucas: Vec<(String, String)> = proches(&base, &lucas).unwrap().into_iter().map(|p| (p.prenom, p.lien)).collect();
        assert_eq!(de_lucas, [("Camille".into(), "parent".into()), ("Léa".into(), "fratrie".into())]);

        // Un lien remplacé change aussi dans l'autre sens.
        lier(&base, &camille, &paul, "fratrie").unwrap();
        assert_eq!(proches(&base, &paul).unwrap()[0].lien, "fratrie");
        delier(&base, &paul, &camille).unwrap();
        assert!(proches(&base, &paul).unwrap().is_empty());
        assert!(matches!(delier(&base, &paul, &camille), Err(ErreurFamille::NonLies)));
        assert!(matches!(lier(&base, &paul, &paul, "fratrie"), Err(ErreurFamille::SoiMeme)));
        assert!(matches!(lier(&base, &paul, &camille, "cousin"), Err(ErreurFamille::LienInconnu)));
    }

    #[test]
    fn un_parent_recoit_les_factures_tant_que_le_lien_le_permet() {
        let (_dossier, base) = base();
        let (camille, lucas, lea) = (patient(&base, "Camille", "1988-03-14"), patient(&base, "Lucas", "2019-06-02"), patient(&base, "Léa", "2016-01-10"));
        lier(&base, &lucas, &camille, "parent").unwrap();
        lier(&base, &lucas, &lea, "fratrie").unwrap();
        assert!(matches!(definir_payeur(&base, &lucas, Some(&lea)), Err(ErreurFamille::PayeurInvalide)));
        assert_eq!(definir_payeur(&base, &lucas, Some(&camille)).unwrap().factures_a.as_deref(), Some(camille.as_str()));
        assert!(proches(&base, &lucas).unwrap()[0].recoit_les_factures);

        // Le lien devient fraternel : Camille ne reçoit plus les factures de Lucas.
        lier(&base, &lucas, &camille, "fratrie").unwrap();
        assert_eq!(patients::lire(&base, &lucas).unwrap().factures_a, None);
        lier(&base, &lucas, &camille, "parent").unwrap();
        definir_payeur(&base, &lucas, Some(&camille)).unwrap();
        delier(&base, &camille, &lucas).unwrap();
        assert_eq!(patients::lire(&base, &lucas).unwrap().factures_a, None);
        assert_eq!(definir_payeur(&base, &lucas, None).unwrap().factures_a, None);
    }
}
