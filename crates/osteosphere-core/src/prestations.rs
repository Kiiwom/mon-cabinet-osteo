//! Prestations : les actes proposés à la facturation, avec leur tarif TTC.
//!
//! Une facture recopie le libellé imprimé et le tarif de la prestation : changer un tarif ne
//! touche jamais une facture déjà faite. Une prestation qui ne sert plus est archivée.

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;

const PARAMETRE_INSTALLEES: &str = "prestations.installees";
/// Couleurs proposées pour distinguer les prestations dans les listes.
pub const COULEURS: [&str; 6] = ["bleu", "vert", "ocre", "violet", "rose", "gris"];
const TARIF_MAX: i64 = 10_000_000;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaisiePrestation {
    pub libelle: String,
    /// Désignation imprimée sur la facture ; vide = le libellé.
    pub libelle_imprime: String,
    pub tarif_centimes: i64,
    pub couleur: String,
    /// Proposée d'office en fin de séance.
    pub par_defaut: bool,
    pub archivee: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Prestation {
    pub id: String,
    #[serde(flatten)]
    pub saisie: SaisiePrestation,
    pub rang: i64,
    pub cree_le: i64,
    pub modifie_le: i64,
}

impl Prestation {
    /// Ce qui s'imprime sur la facture.
    pub fn designation(&self) -> &str {
        if self.saisie.libelle_imprime.is_empty() { &self.saisie.libelle } else { &self.saisie.libelle_imprime }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurPrestation {
    #[error("{0}")]
    Invalide(&'static str),
    #[error("cette prestation n'existe plus")]
    Introuvable,
    #[error(transparent)]
    Aleatoire(#[from] identifiant::ErreurAleatoire),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurPrestation {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl SaisiePrestation {
    pub fn verifier(&self) -> Result<Self, ErreurPrestation> {
        let propre = |t: &str| t.split_whitespace().collect::<Vec<_>>().join(" ");
        let saisie = Self {
            libelle: propre(&self.libelle),
            libelle_imprime: propre(&self.libelle_imprime),
            couleur: if COULEURS.contains(&self.couleur.as_str()) { self.couleur.clone() } else { COULEURS[0].to_owned() },
            ..self.clone()
        };
        if saisie.libelle.is_empty() {
            return Err(ErreurPrestation::Invalide("donnez un libellé à la prestation"));
        }
        if saisie.libelle.chars().count() > 120 || saisie.libelle_imprime.chars().count() > 200 {
            return Err(ErreurPrestation::Invalide("le libellé de la prestation est trop long"));
        }
        if !(0..=TARIF_MAX).contains(&saisie.tarif_centimes) {
            return Err(ErreurPrestation::Invalide("tarif impossible"));
        }
        if saisie.archivee && saisie.par_defaut {
            return Err(ErreurPrestation::Invalide("une prestation archivée ne peut pas être proposée par défaut"));
        }
        Ok(saisie)
    }
}

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<Prestation> {
    Ok(Prestation {
        id: ligne.get("id")?,
        saisie: SaisiePrestation {
            libelle: ligne.get("libelle")?,
            libelle_imprime: ligne.get("libelle_imprime")?,
            tarif_centimes: ligne.get("tarif_centimes")?,
            couleur: ligne.get("couleur")?,
            par_defaut: ligne.get("par_defaut")?,
            archivee: ligne.get("archivee")?,
        },
        rang: ligne.get("rang")?,
        cree_le: ligne.get("cree_le")?,
        modifie_le: ligne.get("modifie_le")?,
    })
}

/// Toutes les prestations, archivées comprises, dans l'ordre choisi par le praticien.
pub fn lister(base: &Base) -> Result<Vec<Prestation>, ErreurPrestation> {
    Ok(base
        .connexion()
        .prepare("SELECT * FROM prestations ORDER BY archivee, rang, libelle")?
        .query_map([], depuis_ligne)?
        .collect::<Result<_, _>>()?)
}

pub fn lire(base: &Base, id: &str) -> Result<Prestation, ErreurPrestation> {
    base.connexion()
        .query_row("SELECT * FROM prestations WHERE id = ?1", [id], depuis_ligne)
        .optional()?
        .ok_or(ErreurPrestation::Introuvable)
}

/// La prestation proposée en fin de séance : celle par défaut, sinon la première active.
pub fn par_defaut(base: &Base) -> Result<Option<Prestation>, ErreurPrestation> {
    Ok(lister(base)?.into_iter().filter(|p| !p.saisie.archivee).max_by_key(|p| (p.saisie.par_defaut, -p.rang)))
}

/// Crée la prestation (sans `id`) ou la modifie.
pub fn enregistrer(base: &Base, id: Option<&str>, saisie: &SaisiePrestation) -> Result<Prestation, ErreurPrestation> {
    let saisie = saisie.verifier()?;
    base.atomique(|| {
        if saisie.par_defaut {
            base.connexion().execute("UPDATE prestations SET par_defaut = 0", [])?;
        }
        let s = &saisie;
        let id = match id {
            Some(id) => {
                let avant = lire(base, id)?;
                base.connexion().execute(
                    "UPDATE prestations SET libelle = ?2, libelle_imprime = ?3, tarif_centimes = ?4, couleur = ?5, par_defaut = ?6,
                            archivee = ?7, modifie_le = ?8
                     WHERE id = ?1",
                    rusqlite::params![id, s.libelle, s.libelle_imprime, s.tarif_centimes, s.couleur, s.par_defaut, s.archivee, maintenant()],
                )?;
                let apres = lire(base, id)?;
                base.journaliser(
                    "prestation.modifiee",
                    id,
                    serde_json::to_string(&avant).ok().as_deref(),
                    serde_json::to_string(&apres).ok().as_deref(),
                )?;
                id.to_owned()
            }
            None => {
                let id = identifiant::nouveau()?;
                let rang: i64 = base.connexion().query_row("SELECT coalesce(max(rang), 0) + 1 FROM prestations", [], |l| l.get(0))?;
                base.connexion().execute(
                    "INSERT INTO prestations (id, libelle, libelle_imprime, tarif_centimes, couleur, rang, par_defaut, archivee, cree_le, modifie_le)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                    rusqlite::params![id, s.libelle, s.libelle_imprime, s.tarif_centimes, s.couleur, rang, s.par_defaut, s.archivee, maintenant()],
                )?;
                let apres = lire(base, &id)?;
                base.journaliser("prestation.creee", &id, None, serde_json::to_string(&apres).ok().as_deref())?;
                id
            }
        };
        lire(base, &id)
    })
}

/// Une consultation à 55 € pour commencer, une seule fois par cabinet : le praticien règle ensuite
/// ses propres tarifs dans les paramètres.
pub fn installer_prestations_de_depart(base: &Base) -> Result<(), ErreurPrestation> {
    if base.lire_parametre::<bool>(PARAMETRE_INSTALLEES)?.unwrap_or(false) {
        return Ok(());
    }
    let existantes: i64 = base.connexion().query_row("SELECT count(*) FROM prestations", [], |l| l.get(0))?;
    if existantes == 0 {
        enregistrer(
            base,
            None,
            &SaisiePrestation {
                libelle: "Consultation".into(),
                libelle_imprime: "Consultation d’ostéopathie".into(),
                tarif_centimes: 5500,
                couleur: "bleu".into(),
                par_defaut: true,
                archivee: false,
            },
        )?;
    }
    base.ecrire_parametre(PARAMETRE_INSTALLEES, &true)?;
    Ok(())
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

    #[test]
    fn installe_une_consultation_une_seule_fois() {
        let (_d, base) = base();
        installer_prestations_de_depart(&base).unwrap();
        installer_prestations_de_depart(&base).unwrap();
        let liste = lister(&base).unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!((liste[0].designation(), liste[0].saisie.tarif_centimes), ("Consultation d’ostéopathie", 5500));
        assert_eq!(par_defaut(&base).unwrap().unwrap().id, liste[0].id);
    }

    #[test]
    fn une_seule_prestation_par_defaut_et_archives() {
        let (_d, base) = base();
        installer_prestations_de_depart(&base).unwrap();
        let enfant = enregistrer(
            &base,
            None,
            &SaisiePrestation { libelle: "  Consultation   enfant ".into(), tarif_centimes: 4500, par_defaut: true, ..Default::default() },
        )
        .unwrap();
        assert_eq!(enfant.saisie.libelle, "Consultation enfant");
        assert_eq!(enfant.designation(), "Consultation enfant");
        assert_eq!(enfant.saisie.couleur, "bleu");
        assert_eq!(lister(&base).unwrap().iter().filter(|p| p.saisie.par_defaut).count(), 1);
        assert_eq!(par_defaut(&base).unwrap().unwrap().id, enfant.id);

        let mut archive = enfant.saisie.clone();
        archive.archivee = true;
        assert!(enregistrer(&base, Some(&enfant.id), &archive).is_err());
        archive.par_defaut = false;
        enregistrer(&base, Some(&enfant.id), &archive).unwrap();
        assert_eq!(par_defaut(&base).unwrap().unwrap().saisie.libelle, "Consultation");
        assert!(lister(&base).unwrap().last().unwrap().saisie.archivee);
    }

    #[test]
    fn refuse_un_libelle_vide_ou_un_tarif_negatif() {
        let (_d, base) = base();
        assert!(enregistrer(&base, None, &SaisiePrestation { libelle: "  ".into(), ..Default::default() }).is_err());
        assert!(enregistrer(&base, None, &SaisiePrestation { libelle: "Acte".into(), tarif_centimes: -1, ..Default::default() }).is_err());
        assert!(matches!(enregistrer(&base, Some("inconnue"), &SaisiePrestation { libelle: "Acte".into(), ..Default::default() }), Err(ErreurPrestation::Introuvable)));
    }
}
