//! Antécédents du patient : rangés par catégorie et rubrique (formulaire réglable), avec une
//! précision, une date de début facultative (année, mois ou jour), une fin ou « en cours »,
//! une couleur et une marque « important » qui les remonte dans les repères de la séance.

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;
use crate::numerotation::Date;

const FORMULAIRE_PAR_DEFAUT: &str = include_str!("formulaire_antecedents.json");
pub const PARAMETRE_FORMULAIRE: &str = "antecedents.formulaire";
/// Couleurs proposées, celles de MonCabinetLibéral ; vide = couleur de la catégorie.
pub const COULEURS: [&str; 7] = ["", "gris", "blanc", "jaune", "rouge", "bleu", "vert"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CategorieAntecedents {
    pub cle: String,
    pub libelle: String,
    pub rubriques: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaisieAntecedent {
    pub categorie: String,
    pub rubrique: String,
    pub precision: String,
    /// « AAAA », « AAAA-MM » ou « AAAA-MM-JJ ».
    pub debut: Option<String>,
    pub fin: Option<String>,
    pub en_cours: bool,
    pub couleur: String,
    pub important: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Antecedent {
    pub id: String,
    pub patient_id: String,
    #[serde(flatten)]
    pub saisie: SaisieAntecedent,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurAntecedent {
    #[error("choisissez la catégorie et la rubrique de l'antécédent")]
    RubriqueVide,
    #[error("{0}")]
    Champ(&'static str),
    #[error("cet antécédent n'existe plus")]
    Introuvable,
    #[error("ce dossier patient n'existe plus")]
    PatientIntrouvable,
    #[error(transparent)]
    Aleatoire(#[from] identifiant::ErreurAleatoire),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurAntecedent {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurAntecedent {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

/// Date partielle : « 2009 », « 2009-03 » ou « 2009-03-14 ». Rend la date complète la plus tôt.
fn lire_date_partielle(texte: &str) -> Option<Date> {
    let complete = match texte.len() {
        4 => format!("{texte}-01-01"),
        7 => format!("{texte}-01"),
        10 => texte.to_owned(),
        _ => return None,
    };
    Date::lire(&complete).ok().filter(|d| d.annee() >= 1900)
}

fn date_facultative(texte: &Option<String>) -> Result<Option<String>, ErreurAntecedent> {
    match texte.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(date) if lire_date_partielle(date).is_some() => Ok(Some(date.to_owned())),
        Some(_) => Err(ErreurAntecedent::Champ("date invalide : année, mois et année, ou date complète")),
    }
}

impl SaisieAntecedent {
    pub fn verifier(&self) -> Result<Self, ErreurAntecedent> {
        let saisie = Self {
            categorie: self.categorie.trim().to_owned(),
            rubrique: self.rubrique.split_whitespace().collect::<Vec<_>>().join(" "),
            precision: self.precision.trim().to_owned(),
            debut: date_facultative(&self.debut)?,
            fin: if self.en_cours { None } else { date_facultative(&self.fin)? },
            en_cours: self.en_cours,
            couleur: self.couleur.trim().to_owned(),
            important: self.important,
        };
        if saisie.categorie.is_empty() || saisie.rubrique.is_empty() {
            return Err(ErreurAntecedent::RubriqueVide);
        }
        if !COULEURS.contains(&saisie.couleur.as_str()) {
            return Err(ErreurAntecedent::Champ("couleur inconnue"));
        }
        if let (Some(debut), Some(fin)) = (&saisie.debut, &saisie.fin)
            && lire_date_partielle(fin) < lire_date_partielle(debut)
        {
            return Err(ErreurAntecedent::Champ("la fin précède le début"));
        }
        if saisie.fin.is_some() && saisie.debut.is_none() {
            return Err(ErreurAntecedent::Champ("indiquez le début avant la fin"));
        }
        Ok(saisie)
    }
}

/// Formulaire du praticien, sinon celui repris de MonCabinetLibéral.
pub fn formulaire(base: &Base) -> Result<Vec<CategorieAntecedents>, ErreurAntecedent> {
    match base.lire_parametre::<Vec<CategorieAntecedents>>(PARAMETRE_FORMULAIRE)? {
        Some(formulaire) => Ok(formulaire),
        None => Ok(serde_json::from_str(FORMULAIRE_PAR_DEFAUT)?),
    }
}

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<Antecedent> {
    Ok(Antecedent {
        id: ligne.get("id")?,
        patient_id: ligne.get("patient_id")?,
        saisie: SaisieAntecedent {
            categorie: ligne.get("categorie")?,
            rubrique: ligne.get("rubrique")?,
            precision: ligne.get("precision")?,
            debut: ligne.get("debut")?,
            fin: ligne.get("fin")?,
            en_cours: ligne.get("en_cours")?,
            couleur: ligne.get("couleur")?,
            important: ligne.get("important")?,
        },
    })
}

fn lire(base: &Base, id: &str) -> Result<Antecedent, ErreurAntecedent> {
    base.connexion()
        .query_row("SELECT * FROM antecedents WHERE id = ?1", [id], depuis_ligne)
        .optional()?
        .ok_or(ErreurAntecedent::Introuvable)
}

/// Antécédents du patient : non datés d'abord, puis du plus ancien au plus récent.
pub fn lister(base: &Base, patient_id: &str) -> Result<Vec<Antecedent>, ErreurAntecedent> {
    let mut requete = base.connexion().prepare(
        "SELECT * FROM antecedents WHERE patient_id = ?1
         ORDER BY debut IS NOT NULL, debut, categorie, rubrique, cree_le",
    )?;
    let lignes = requete.query_map([patient_id], depuis_ligne)?;
    Ok(lignes.collect::<Result<_, _>>()?)
}

pub fn enregistrer(
    base: &Base,
    patient_id: &str,
    id: Option<&str>,
    saisie: &SaisieAntecedent,
) -> Result<Antecedent, ErreurAntecedent> {
    let saisie = saisie.verifier()?;
    let patient_existe: Option<i64> = base
        .connexion()
        .query_row("SELECT 1 FROM patients WHERE id = ?1", [patient_id], |l| l.get(0))
        .optional()?;
    if patient_existe.is_none() {
        return Err(ErreurAntecedent::PatientIntrouvable);
    }
    let avant = id.map(|id| lire(base, id)).transpose()?;
    if avant.as_ref().is_some_and(|a| a.patient_id != patient_id) {
        return Err(ErreurAntecedent::Introuvable);
    }
    let id = match id {
        Some(id) => id.to_owned(),
        None => identifiant::nouveau()?,
    };
    let s = &saisie;
    base.connexion().execute(
        "INSERT INTO antecedents (id, patient_id, categorie, rubrique, precision, debut, fin, en_cours, couleur, important,
                                  cree_le, modifie_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
         ON CONFLICT (id) DO UPDATE SET categorie = excluded.categorie, rubrique = excluded.rubrique,
           precision = excluded.precision, debut = excluded.debut, fin = excluded.fin, en_cours = excluded.en_cours,
           couleur = excluded.couleur, important = excluded.important, modifie_le = excluded.modifie_le",
        rusqlite::params![id, patient_id, s.categorie, s.rubrique, s.precision, s.debut, s.fin, s.en_cours, s.couleur, s.important, maintenant()],
    )?;
    let apres = lire(base, &id)?;
    base.journaliser(
        if avant.is_some() { "antecedent.modifie" } else { "antecedent.cree" },
        &apres.id,
        avant.map(|a| serde_json::to_string(&a)).transpose()?.as_deref(),
        Some(&serde_json::to_string(&apres)?),
    )?;
    Ok(apres)
}

pub fn supprimer(base: &Base, id: &str) -> Result<(), ErreurAntecedent> {
    let avant = lire(base, id)?;
    base.connexion().execute("DELETE FROM antecedents WHERE id = ?1", [id])?;
    base.journaliser("antecedent.supprime", id, Some(&serde_json::to_string(&avant)?), None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;
    use crate::patients::{self, FichePatient};

    fn base_et_patient() -> (tempfile::TempDir, Base, String) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        let fiche = FichePatient { nom: "Martin".into(), prenom: "Camille".into(), ..Default::default() };
        let id = patients::creer(&base, &fiche).unwrap().id;
        (dossier, base, id)
    }

    fn fracture() -> SaisieAntecedent {
        SaisieAntecedent {
            categorie: "traumatiques".into(),
            rubrique: "Fracture".into(),
            precision: " poignet G ".into(),
            debut: Some("2009".into()),
            ..Default::default()
        }
    }

    #[test]
    fn formulaire_repris_de_moncabinetliberal() {
        let (_dossier, base, _) = base_et_patient();
        let formulaire = formulaire(&base).unwrap();
        let cles: Vec<&str> = formulaire.iter().map(|c| c.cle.as_str()).collect();
        assert_eq!(cles, ["medicaux", "traumatiques", "chirurgicaux", "familiaux", "psychologiques"]);
        assert!(formulaire[1].rubriques.contains(&"Fracture".to_string()));
    }

    #[test]
    fn enregistre_liste_et_supprime_avec_le_journal() {
        let (_dossier, base, patient) = base_et_patient();
        let non_date = SaisieAntecedent {
            categorie: "medicaux".into(),
            rubrique: "Allergies".into(),
            precision: "AINS".into(),
            couleur: "rouge".into(),
            important: true,
            ..Default::default()
        };
        let traitement = SaisieAntecedent {
            categorie: "medicaux".into(),
            rubrique: "Traitement longue durée".into(),
            precision: "lévothyroxine".into(),
            debut: Some("2015-06".into()),
            fin: Some("2020".into()),
            en_cours: true,
            ..Default::default()
        };
        let poignet = enregistrer(&base, &patient, None, &fracture()).unwrap();
        assert_eq!(poignet.saisie.precision, "poignet G");
        let allergie = enregistrer(&base, &patient, None, &non_date).unwrap();
        let traitement = enregistrer(&base, &patient, None, &traitement).unwrap();
        // En cours : la fin saisie est ignorée.
        assert_eq!(traitement.saisie.fin, None);

        let ordre: Vec<&str> = vec!["Allergies", "Fracture", "Traitement longue durée"];
        let liste = lister(&base, &patient).unwrap();
        assert_eq!(liste.iter().map(|a| a.saisie.rubrique.as_str()).collect::<Vec<_>>(), ordre);

        let modifie = enregistrer(&base, &patient, Some(&poignet.id), &SaisieAntecedent { precision: "scaphoïde G".into(), ..fracture() }).unwrap();
        assert_eq!(modifie.id, poignet.id);
        supprimer(&base, &allergie.id).unwrap();
        assert_eq!(lister(&base, &patient).unwrap().len(), 2);

        let actions: Vec<String> = base
            .connexion()
            .prepare("SELECT action FROM journal WHERE action LIKE 'antecedent.%' ORDER BY id")
            .unwrap()
            .query_map([], |l| l.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actions, ["antecedent.cree", "antecedent.cree", "antecedent.cree", "antecedent.modifie", "antecedent.supprime"]);
    }

    #[test]
    fn verifie_les_dates_partielles_et_la_coherence() {
        let erreur = |saisie: SaisieAntecedent| saisie.verifier().unwrap_err().to_string();
        assert!(SaisieAntecedent { debut: Some("2009-03".into()), ..fracture() }.verifier().is_ok());
        assert!(SaisieAntecedent { debut: Some("2009-03-14".into()), ..fracture() }.verifier().is_ok());
        assert_eq!(erreur(SaisieAntecedent { debut: Some("2009-13".into()), ..fracture() }), "date invalide : année, mois et année, ou date complète");
        assert_eq!(erreur(SaisieAntecedent { debut: Some("09".into()), ..fracture() }), "date invalide : année, mois et année, ou date complète");
        assert_eq!(erreur(SaisieAntecedent { fin: Some("2008".into()), ..fracture() }), "la fin précède le début");
        assert_eq!(erreur(SaisieAntecedent { debut: None, fin: Some("2008".into()), ..fracture() }), "indiquez le début avant la fin");
        assert_eq!(erreur(SaisieAntecedent { rubrique: " ".into(), ..fracture() }), "choisissez la catégorie et la rubrique de l'antécédent");
        assert_eq!(erreur(SaisieAntecedent { couleur: "fuchsia".into(), ..fracture() }), "couleur inconnue");
    }

    #[test]
    fn refuse_un_patient_inconnu_ou_un_antecedent_d_un_autre_dossier() {
        let (_dossier, base, patient) = base_et_patient();
        assert!(matches!(enregistrer(&base, "inconnu", None, &fracture()), Err(ErreurAntecedent::PatientIntrouvable)));
        let fiche = FichePatient { nom: "Martin".into(), prenom: "Lucas".into(), ..Default::default() };
        let autre = patients::creer(&base, &fiche).unwrap().id;
        let antecedent = enregistrer(&base, &patient, None, &fracture()).unwrap();
        assert!(matches!(enregistrer(&base, &autre, Some(&antecedent.id), &fracture()), Err(ErreurAntecedent::Introuvable)));
    }
}
