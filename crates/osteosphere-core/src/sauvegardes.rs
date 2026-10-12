//! Sauvegardes : un fichier par sauvegarde, la base telle qu'elle est sur le disque (chiffrée par
//! SQLCipher), précédée d'un en-tête qui porte l'enveloppe de la clé de secours. Sans la clé de
//! secours, une sauvegarde est illisible ; avec elle, elle se restaure sur n'importe quel poste.
//!
//! Une sauvegarde automatique ne se fait que si quelque chose a changé depuis la précédente :
//! le dernier numéro du journal est gardé avec elle.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};
use crate::cabinet::{FrequenceSauvegarde, IdentiteCabinet, PARAMETRE_IDENTITE, PreferencesSauvegarde};
use crate::chiffrement::{self, CleDonnees, Enveloppe, ErreurChiffrement};
use crate::cle_de_secours::CleDeSecours;
use crate::{fichier, horloge};

pub const EXTENSION: &str = "osteosauve";
const MAGIE: &[u8; 8] = b"OSTSAUV1";
const FORMAT: u32 = 1;
const PREFIXE: &str = "Osteosphere ";
pub const PARAMETRE_DERNIERE: &str = "sauvegardes.derniere";
/// Copie déchiffrable d'une sauvegarde, le temps de la vérifier puis de la restaurer.
pub const FICHIER_RESTAURATION: &str = "restauration-provisoire.osteosphere";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entete {
    pub format: u32,
    /// Secondes depuis 1970.
    pub cree_le: i64,
    pub logiciel: String,
    pub schema: i64,
    /// Dernier numéro du journal au moment de la sauvegarde.
    pub journal: i64,
    pub secours: Enveloppe,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DerniereSauvegarde {
    pub le: i64,
    pub journal: i64,
    pub fichier: String,
}

/// Une sauvegarde trouvée dans un dossier, lue sans la déchiffrer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FichierSauvegarde {
    pub chemin: String,
    pub nom: String,
    pub cree_le: i64,
    pub taille: u64,
    pub logiciel: String,
}

/// Ce que contient une sauvegarde, lu après l'avoir déchiffrée avec la clé de secours.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Apercu {
    pub cree_le: i64,
    pub logiciel: String,
    pub praticien: String,
    pub patients: i64,
    pub seances: i64,
    pub factures: i64,
    pub derniere_seance: Option<String>,
}

/// Moment où la sauvegarde automatique se pose la question.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Moment {
    Ouverture,
    /// Vérification régulière, chaque minute, pendant l'utilisation.
    Minute,
    Fermeture,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurSauvegarde {
    #[error("ce fichier n'est pas une sauvegarde Osteosphere")]
    PasUneSauvegarde,
    #[error("cette sauvegarde vient d'une version plus récente d'Osteosphere : mettez le logiciel à jour pour la restaurer")]
    Future,
    #[error("clé de secours incorrecte pour cette sauvegarde")]
    CleIncorrecte,
    #[error("sauvegarde abîmée : {0}")]
    Abimee(String),
    #[error("fichier de sauvegarde : {0}")]
    Fichier(#[from] io::Error),
    #[error(transparent)]
    Base(#[from] ErreurBase),
    #[error("en-tête de sauvegarde illisible : {0}")]
    Format(#[from] serde_json::Error),
}

impl From<rusqlite::Error> for ErreurSauvegarde {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

fn dernier_journal(base: &Base) -> Result<i64, ErreurSauvegarde> {
    Ok(base.connexion().query_row("SELECT coalesce(max(id), 0) FROM journal", [], |l| l.get(0))?)
}

pub fn derniere(base: &Base) -> Result<Option<DerniereSauvegarde>, ErreurSauvegarde> {
    Ok(base.lire_parametre(PARAMETRE_DERNIERE)?)
}

/// Faut-il sauvegarder maintenant ? Jamais si rien n'a changé depuis la sauvegarde précédente.
pub fn due(base: &Base, preferences: &PreferencesSauvegarde, moment: Moment, maintenant: i64) -> Result<bool, ErreurSauvegarde> {
    let derniere = derniere(base)?;
    if derniere.as_ref().is_some_and(|d| d.journal >= dernier_journal(base).unwrap_or(0)) {
        return Ok(false);
    }
    let depuis = derniere.as_ref().map(|d| d.le);
    Ok(match preferences.frequence {
        FrequenceSauvegarde::Manuelle => false,
        FrequenceSauvegarde::Fermeture => moment == Moment::Fermeture,
        FrequenceSauvegarde::Intervalle => {
            moment == Moment::Fermeture
                || depuis.is_none_or(|le| maintenant - le >= i64::from(preferences.intervalle_minutes) * 60)
        }
        FrequenceSauvegarde::Jour => {
            moment != Moment::Fermeture && depuis.is_none_or(|le| horloge::paris(le).0 != horloge::paris(maintenant).0)
        }
        FrequenceSauvegarde::Semaine => {
            moment != Moment::Fermeture && depuis.is_none_or(|le| horloge::lundi_paris(le) != horloge::lundi_paris(maintenant))
        }
    })
}

/// « Osteosphere 2026-10-07 20h30.osteosauve », avec un numéro si deux sauvegardes tombent la même minute.
fn nom_libre(dossier: &Path, maintenant: i64) -> PathBuf {
    let (date, h, m) = horloge::paris(maintenant);
    let base = format!("{PREFIXE}{date} {h:02}h{m:02}");
    let mut chemin = dossier.join(format!("{base}.{EXTENSION}"));
    let mut rang = 2;
    while chemin.exists() {
        chemin = dossier.join(format!("{base} ({rang}).{EXTENSION}"));
        rang += 1;
    }
    chemin
}

/// Écrit une sauvegarde de la base ouverte dans le dossier choisi, en retenant la base le temps de
/// la copie : pour une sauvegarde qui ne doit rien manquer, juste avant un import par exemple.
///
/// La base est d'abord ramenée dans son fichier principal (point de contrôle du journal WAL),
/// puis copiée telle quelle : elle reste chiffrée par la clé de la base.
pub fn ecrire(
    base: &Base,
    chemin_base: &Path,
    secours: &Enveloppe,
    dossier: &Path,
    logiciel: &str,
    maintenant: i64,
) -> Result<FichierSauvegarde, ErreurSauvegarde> {
    point_de_controle(base)?;
    let entete = entete(base, secours, logiciel, maintenant)?;
    let fichier = copier(chemin_base, &entete, dossier)?;
    noter(base, &fichier, entete.journal)?;
    Ok(fichier)
}

/// Base figée pour une sauvegarde : tant que l'instantané existe, le fichier de la base ne change plus
/// et se copie sans retenir le cabinet, qui reste utilisable pendant la copie.
pub struct Instantane {
    /// Seconde connexion à la base, avec une lecture ouverte.
    lecteur: Base,
    chemin_base: PathBuf,
    entete: Entete,
}

/// Fige la base pour la sauvegarder. Le point de contrôle ramène tout le journal WAL dans le fichier
/// de la base ; la lecture ouverte ensuite par `lecteur`, une seconde connexion à la même base,
/// empêche tout point de contrôle d'y écrire jusqu'à la fin de la copie. Les saisies faites pendant
/// la copie vont au journal WAL : elles seront dans la sauvegarde suivante.
///
/// À appeler en retenant la base : rien ne doit s'écrire entre le point de contrôle et la lecture.
pub fn figer(
    base: &Base,
    lecteur: Base,
    chemin_base: &Path,
    secours: &Enveloppe,
    logiciel: &str,
    maintenant: i64,
) -> Result<Instantane, ErreurSauvegarde> {
    point_de_controle(base)?;
    lecteur.connexion().execute_batch("BEGIN")?;
    let entete = entete(&lecteur, secours, logiciel, maintenant)?;
    Ok(Instantane { lecteur, chemin_base: chemin_base.to_owned(), entete })
}

impl Instantane {
    /// Dernière modification comprise dans la sauvegarde.
    pub fn journal(&self) -> i64 {
        self.entete.journal
    }

    /// Copie la base figée dans le dossier, puis la relâche.
    pub fn ecrire(self, dossier: &Path) -> Result<FichierSauvegarde, ErreurSauvegarde> {
        let fichier = copier(&self.chemin_base, &self.entete, dossier);
        drop(self.lecteur);
        fichier
    }
}

/// Note la sauvegarde écrite : la sauvegarde automatique suivante attend une nouvelle modification.
pub fn noter(base: &Base, fichier: &FichierSauvegarde, journal: i64) -> Result<(), ErreurSauvegarde> {
    base.ecrire_parametre(PARAMETRE_DERNIERE, &DerniereSauvegarde { le: fichier.cree_le, journal, fichier: fichier.chemin.clone() })?;
    Ok(())
}

fn point_de_controle(base: &Base) -> Result<(), ErreurSauvegarde> {
    let bloque: i64 = base.connexion().query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |l| l.get(0))?;
    if bloque != 0 {
        return Err(ErreurSauvegarde::Fichier(io::Error::other("la base est occupée par une autre sauvegarde : réessayez dans un instant")));
    }
    Ok(())
}

fn entete(base: &Base, secours: &Enveloppe, logiciel: &str, maintenant: i64) -> Result<Entete, ErreurSauvegarde> {
    Ok(Entete {
        format: FORMAT,
        cree_le: maintenant,
        logiciel: logiciel.to_owned(),
        schema: base.version_schema()?,
        journal: dernier_journal(base)?,
        secours: secours.clone(),
    })
}

/// En-tête puis fichier de la base, copié par morceaux.
fn copier(chemin_base: &Path, entete: &Entete, dossier: &Path) -> Result<FichierSauvegarde, ErreurSauvegarde> {
    fs::create_dir_all(dossier)?;
    let entete_json = serde_json::to_vec(entete)?;
    let mut donnees = fs::File::open(chemin_base)?;
    let chemin = nom_libre(dossier, entete.cree_le);
    let mut taille = 0;
    fichier::ecrire_atomiquement_par(&chemin, |sortie| {
        sortie.write_all(MAGIE)?;
        sortie.write_all(&(entete_json.len() as u32).to_le_bytes())?;
        sortie.write_all(&entete_json)?;
        let copies = io::copy(&mut donnees, sortie)?;
        taille = (MAGIE.len() + 4 + entete_json.len()) as u64 + copies;
        Ok(())
    })?;
    let nom = chemin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(FichierSauvegarde { chemin: chemin.display().to_string(), nom, cree_le: entete.cree_le, taille, logiciel: entete.logiciel.clone() })
}

/// L'en-tête et le début des données de la base.
fn lire(contenu: &[u8]) -> Result<(Entete, &[u8]), ErreurSauvegarde> {
    if contenu.len() < MAGIE.len() + 4 || &contenu[..MAGIE.len()] != MAGIE {
        return Err(ErreurSauvegarde::PasUneSauvegarde);
    }
    let taille = u32::from_le_bytes(contenu[8..12].try_into().unwrap_or_default()) as usize;
    let fin = 12usize.checked_add(taille).filter(|f| *f <= contenu.len()).ok_or(ErreurSauvegarde::PasUneSauvegarde)?;
    let entete: Entete = serde_json::from_slice(&contenu[12..fin])?;
    if entete.format > FORMAT {
        return Err(ErreurSauvegarde::Future);
    }
    Ok((entete, &contenu[fin..]))
}

/// L'en-tête seul, sans lire toute la base.
pub fn lire_entete(chemin: &Path) -> Result<Entete, ErreurSauvegarde> {
    use std::io::Read;
    let mut fichier = fs::File::open(chemin)?;
    let mut debut = [0u8; 12];
    fichier.read_exact(&mut debut).map_err(|_| ErreurSauvegarde::PasUneSauvegarde)?;
    if &debut[..8] != MAGIE {
        return Err(ErreurSauvegarde::PasUneSauvegarde);
    }
    let taille = u32::from_le_bytes(debut[8..12].try_into().unwrap_or_default()) as usize;
    if taille > 1_000_000 {
        return Err(ErreurSauvegarde::PasUneSauvegarde);
    }
    let mut entete = vec![0u8; taille];
    fichier.read_exact(&mut entete).map_err(|_| ErreurSauvegarde::PasUneSauvegarde)?;
    let entete: Entete = serde_json::from_slice(&entete)?;
    if entete.format > FORMAT {
        return Err(ErreurSauvegarde::Future);
    }
    Ok(entete)
}

/// Les sauvegardes du dossier, de la plus récente à la plus ancienne. Les autres fichiers sont ignorés.
pub fn lister(dossier: &Path) -> Result<Vec<FichierSauvegarde>, ErreurSauvegarde> {
    let mut liste = Vec::new();
    let entrees = match fs::read_dir(dossier) {
        Ok(entrees) => entrees,
        Err(erreur) if erreur.kind() == io::ErrorKind::NotFound => return Ok(liste),
        Err(erreur) => return Err(erreur.into()),
    };
    for entree in entrees.flatten() {
        let chemin = entree.path();
        if chemin.extension().and_then(|e| e.to_str()) != Some(EXTENSION) {
            continue;
        }
        let Ok(entete) = lire_entete(&chemin) else { continue };
        liste.push(FichierSauvegarde {
            nom: chemin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            chemin: chemin.display().to_string(),
            cree_le: entete.cree_le,
            taille: entree.metadata().map(|m| m.len()).unwrap_or(0),
            logiciel: entete.logiciel,
        });
    }
    liste.sort_by(|a, b| b.cree_le.cmp(&a.cree_le).then(b.nom.cmp(&a.nom)));
    Ok(liste)
}

/// Garde les `garder` sauvegardes les plus récentes du dossier, efface les plus anciennes.
/// Seuls les fichiers nommés par Osteosphere sont concernés. Rend le nombre de fichiers effacés.
pub fn purger(dossier: &Path, garder: usize) -> Result<usize, ErreurSauvegarde> {
    let a_effacer: Vec<FichierSauvegarde> =
        lister(dossier)?.into_iter().filter(|f| f.nom.starts_with(PREFIXE)).skip(garder.max(1)).collect();
    for f in &a_effacer {
        fs::remove_file(&f.chemin)?;
    }
    Ok(a_effacer.len())
}

/// La base est-elle intacte ? Vérifie la structure et l'authentification de chaque page.
pub fn verifier_integrite(base: &Base) -> Result<(), ErreurSauvegarde> {
    let resultat: String = base.connexion().query_row("PRAGMA integrity_check", [], |l| l.get(0))?;
    if resultat != "ok" {
        return Err(ErreurSauvegarde::Abimee(resultat));
    }
    let mut requete = base.connexion().prepare("PRAGMA cipher_integrity_check")?;
    let erreurs: Vec<String> = requete.query_map([], |l| l.get::<_, String>(0))?.collect::<Result<_, _>>()?;
    if let Some(premiere) = erreurs.first() {
        return Err(ErreurSauvegarde::Abimee(premiere.clone()));
    }
    Ok(())
}

fn apercu_de(base: &Base, entete: &Entete) -> Result<Apercu, ErreurSauvegarde> {
    let compter = |table: &str| -> Result<i64, ErreurSauvegarde> {
        Ok(base.connexion().query_row(&format!("SELECT count(*) FROM {table}"), [], |l| l.get(0))?)
    };
    let identite: IdentiteCabinet = base.lire_parametre(PARAMETRE_IDENTITE)?.unwrap_or_default();
    let derniere_seance: Option<String> =
        base.connexion().query_row("SELECT max(substr(debut, 1, 10)) FROM seances WHERE supprimee_le IS NULL", [], |l| l.get(0))?;
    Ok(Apercu {
        cree_le: entete.cree_le,
        logiciel: entete.logiciel.clone(),
        praticien: format!("{} {}", identite.prenom, identite.nom).trim().to_owned(),
        patients: compter("patients")?,
        seances: compter("seances WHERE supprimee_le IS NULL")?,
        factures: compter("factures WHERE numero IS NOT NULL")?,
        derniere_seance,
    })
}

/// Déchiffre la sauvegarde avec la clé de secours, en écrit une copie dans `dossier_travail`,
/// la vérifie et la décrit. La copie sert ensuite à la restauration ; rien d'autre n'est touché.
pub fn ouvrir(chemin: &Path, secours: &CleDeSecours, dossier_travail: &Path) -> Result<(Entete, CleDonnees, PathBuf, Apercu), ErreurSauvegarde> {
    let contenu = fs::read(chemin)?;
    let (entete, donnees) = lire(&contenu)?;
    let cle = chiffrement::ouvrir(&entete.secours, secours.secret()).map_err(|erreur| match erreur {
        ErreurChiffrement::SecretIncorrect => ErreurSauvegarde::CleIncorrecte,
        autre => ErreurSauvegarde::Abimee(autre.to_string()),
    })?;
    fs::create_dir_all(dossier_travail)?;
    let copie = dossier_travail.join(FICHIER_RESTAURATION);
    effacer_copie(&copie)?;
    fichier::ecrire_atomiquement(&copie, donnees)?;
    let apercu = {
        let base = Base::ouvrir(&copie, &cle).map_err(|erreur| match erreur {
            ErreurBase::SchemaFutur(_) => ErreurSauvegarde::Future,
            ErreurBase::CleRefusee => ErreurSauvegarde::Abimee("la base ne s'ouvre pas avec sa clé".into()),
            autre => ErreurSauvegarde::Base(autre),
        })?;
        verifier_integrite(&base)?;
        let apercu = apercu_de(&base, &entete)?;
        base.connexion().query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        apercu
    };
    Ok((entete, cle, copie, apercu))
}

/// Efface une copie de restauration et ses fichiers WAL, s'il en reste.
pub fn effacer_copie(copie: &Path) -> io::Result<()> {
    for suffixe in ["", "-wal", "-shm"] {
        let mut chemin = copie.as_os_str().to_owned();
        chemin.push(suffixe);
        match fs::remove_file(PathBuf::from(chemin)) {
            Err(erreur) if erreur.kind() != io::ErrorKind::NotFound => return Err(erreur),
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cabinet::{Cabinet, Ouverture};
    use crate::chiffrement::ReglagesDerivation;
    use crate::patients::{self, FichePatient};
    use crate::trousseau::{SessionFactice, Trousseau};

    fn cabinet(dossier: &Path) -> (Cabinet, CleDeSecours) {
        let cabinet = Cabinet::pour_tests(dossier);
        let secours = CleDeSecours::generer().unwrap();
        let ouvert = cabinet.creer(&secours, None, &SessionFactice(1)).unwrap();
        patients::creer(&ouvert.base, &FichePatient { nom: "Martin".into(), prenom: "Camille".into(), ..Default::default() }).unwrap();
        (cabinet, secours)
    }

    fn enveloppe(dossier: &Path) -> Enveloppe {
        Trousseau::charger(&dossier.join("trousseau.json")).unwrap().secours
    }

    #[test]
    fn ecrit_liste_et_relit_une_sauvegarde_chiffree() {
        let dossier = tempfile::tempdir().unwrap();
        let (cabinet, secours) = cabinet(&dossier.path().join("cabinet"));
        let Ouverture::Ouvert(ouvert) = cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap() else { panic!() };
        let sauvegardes = dossier.path().join("sauvegardes");
        let maintenant = 1_791_397_800; // 7 octobre 2026, 18 h 30 UTC
        let f = ecrire(&ouvert.base, &cabinet.chemin_base(), &enveloppe(cabinet.dossier()), &sauvegardes, "0.7.0", maintenant).unwrap();
        assert_eq!(f.nom, "Osteosphere 2026-10-07 20h30.osteosauve");
        let octets = fs::read(&f.chemin).unwrap();
        assert!(!octets.windows(6).any(|w| w == b"Martin"));
        let second = ecrire(&ouvert.base, &cabinet.chemin_base(), &enveloppe(cabinet.dossier()), &sauvegardes, "0.7.0", maintenant).unwrap();
        assert_eq!(second.nom, "Osteosphere 2026-10-07 20h30 (2).osteosauve");
        assert_eq!(lister(&sauvegardes).unwrap().len(), 2);

        let travail = dossier.path().join("travail");
        assert!(matches!(ouvrir(Path::new(&f.chemin), &CleDeSecours::generer().unwrap(), &travail), Err(ErreurSauvegarde::CleIncorrecte)));
        let (entete, _, copie, apercu) = ouvrir(Path::new(&f.chemin), &secours, &travail).unwrap();
        assert_eq!((apercu.patients, apercu.seances, entete.logiciel.as_str()), (1, 0, "0.7.0"));
        assert!(copie.exists());
        effacer_copie(&copie).unwrap();
        assert!(!copie.exists());

        fs::write(sauvegardes.join("notes.txt"), "autre fichier").unwrap();
        fs::write(sauvegardes.join("faux.osteosauve"), "pas une sauvegarde").unwrap();
        assert_eq!(lister(&sauvegardes).unwrap().len(), 2);
        assert!(matches!(ouvrir(&sauvegardes.join("faux.osteosauve"), &secours, &travail), Err(ErreurSauvegarde::PasUneSauvegarde)));
        assert_eq!(purger(&sauvegardes, 1).unwrap(), 1);
        assert_eq!(lister(&sauvegardes).unwrap().len(), 1);
    }

    #[test]
    fn une_base_figee_se_copie_pendant_que_le_praticien_ecrit() {
        let dossier = tempfile::tempdir().unwrap();
        let (cabinet, secours) = cabinet(&dossier.path().join("cabinet"));
        let Ouverture::Ouvert(ouvert) = cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap() else { panic!() };
        let lecteur = cabinet.second_acces(&ouvert).unwrap();
        let instantane = figer(&ouvert.base, lecteur, &cabinet.chemin_base(), &enveloppe(cabinet.dossier()), "0.8.0", 1_791_397_800).unwrap();
        // Pendant la copie, le praticien continue : assez d'écritures pour qu'un point de contrôle
        // automatique (1 000 pages, 4 Mo) essaie de les reporter dans le fichier de la base.
        let journal = instantane.journal();
        for rang in 0..600 {
            let remarques = format!("{rang} {}", "x".repeat(8_000));
            patients::creer(&ouvert.base, &FichePatient { nom: "Petit".into(), prenom: "Louis".into(), remarques, ..Default::default() }).unwrap();
        }
        let f = instantane.ecrire(&dossier.path().join("s")).unwrap();
        noter(&ouvert.base, &f, journal).unwrap();

        // La sauvegarde est la base telle qu'elle était figée, saine ; la base, elle, a tout gardé.
        let (_, _, copie, apercu) = ouvrir(Path::new(&f.chemin), &secours, &dossier.path().join("travail")).unwrap();
        assert_eq!(apercu.patients, 1);
        effacer_copie(&copie).unwrap();
        assert_eq!(patients::lister(&ouvert.base).unwrap().len(), 601);
        assert_eq!(derniere(&ouvert.base).unwrap().unwrap().journal, journal);
        assert_eq!(fs::metadata(&f.chemin).unwrap().len(), f.taille);
    }

    #[test]
    fn ne_sauvegarde_que_si_quelque_chose_a_change() {
        let dossier = tempfile::tempdir().unwrap();
        let (cabinet, _) = cabinet(&dossier.path().join("cabinet"));
        let Ouverture::Ouvert(ouvert) = cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap() else { panic!() };
        let base = &ouvert.base;
        let heure = |minutes: u32| PreferencesSauvegarde { frequence: FrequenceSauvegarde::Intervalle, intervalle_minutes: minutes, ..Default::default() };
        let maintenant = 1_791_397_800;
        assert!(due(base, &heure(60), Moment::Minute, maintenant).unwrap());
        ecrire(base, &cabinet.chemin_base(), &enveloppe(cabinet.dossier()), &dossier.path().join("s"), "0.7.0", maintenant).unwrap();
        // Rien n'a changé : pas de nouvelle sauvegarde, même à la fermeture.
        assert!(!due(base, &heure(60), Moment::Minute, maintenant + 7_200).unwrap());
        assert!(!due(base, &heure(60), Moment::Fermeture, maintenant + 7_200).unwrap());
        patients::creer(base, &FichePatient { nom: "Petit".into(), prenom: "Louis".into(), ..Default::default() }).unwrap();
        assert!(!due(base, &heure(60), Moment::Minute, maintenant + 1_800).unwrap());
        assert!(due(base, &heure(60), Moment::Minute, maintenant + 3_600).unwrap());
        assert!(due(base, &heure(60), Moment::Fermeture, maintenant + 60).unwrap());

        let avec = |frequence| PreferencesSauvegarde { frequence, ..heure(60) };
        assert!(due(base, &avec(FrequenceSauvegarde::Fermeture), Moment::Fermeture, maintenant + 60).unwrap());
        assert!(!due(base, &avec(FrequenceSauvegarde::Fermeture), Moment::Ouverture, maintenant + 60).unwrap());
        assert!(!due(base, &avec(FrequenceSauvegarde::Jour), Moment::Ouverture, maintenant + 60).unwrap());
        assert!(due(base, &avec(FrequenceSauvegarde::Jour), Moment::Ouverture, maintenant + 86_400).unwrap());
        assert!(!due(base, &avec(FrequenceSauvegarde::Semaine), Moment::Ouverture, maintenant + 86_400).unwrap());
        assert!(due(base, &avec(FrequenceSauvegarde::Semaine), Moment::Ouverture, maintenant + 7 * 86_400).unwrap());
        assert!(!due(base, &avec(FrequenceSauvegarde::Manuelle), Moment::Fermeture, maintenant + 7 * 86_400).unwrap());
    }

    #[test]
    fn restaure_sur_un_autre_poste_avec_la_cle_de_secours() {
        let dossier = tempfile::tempdir().unwrap();
        let (cabinet, secours) = cabinet(&dossier.path().join("cabinet"));
        let Ouverture::Ouvert(ouvert) = cabinet.ouvrir_automatiquement(&SessionFactice(1)).unwrap() else { panic!() };
        let f = ecrire(&ouvert.base, &cabinet.chemin_base(), &enveloppe(cabinet.dossier()), &dossier.path().join("s"), "0.7.0", 1_791_397_800).unwrap();
        drop(ouvert);

        // Nouveau poste : aucun cabinet, puis restauration.
        let nouveau = Cabinet::pour_tests(&dossier.path().join("nouveau"));
        let (entete, cle, copie, _) = ouvrir(Path::new(&f.chemin), &secours, nouveau.dossier()).unwrap();
        let restaure = nouveau.restaurer(&copie, &cle, entete.secours, &SessionFactice(2)).unwrap();
        assert_eq!(patients::lister(&restaure.base).unwrap().len(), 1);
        drop(restaure);
        assert!(matches!(nouveau.ouvrir_automatiquement(&SessionFactice(2)).unwrap(), Ouverture::Ouvert(_)));
        assert!(nouveau.ouvrir_avec_cle_de_secours(&secours, &SessionFactice(2)).is_ok());

        // Sur un cabinet existant : l'ancienne base est mise de côté, jamais effacée.
        let (entete, cle, copie, _) = ouvrir(Path::new(&f.chemin), &secours, cabinet.dossier()).unwrap();
        cabinet.restaurer(&copie, &cle, entete.secours, &SessionFactice(1)).unwrap();
        let mises_de_cote = fs::read_dir(cabinet.dossier())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains("avant-restauration"))
            .count();
        assert!(mises_de_cote >= 2);
        let _ = ReglagesDerivation::pour_tests();
    }
}
