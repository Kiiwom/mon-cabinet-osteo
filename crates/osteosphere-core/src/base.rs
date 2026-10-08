//! Base SQLite chiffrée par SQLCipher : ouverture, vérification de la clé, migrations.

use std::path::Path;

use rusqlite::{Connection, ErrorCode, OptionalExtension};
use serde::Serialize;
use serde::de::DeserializeOwned;
use zeroize::Zeroizing;

use crate::chiffrement::CleDonnees;
use crate::hexa;

/// Migrations dans l'ordre ; la version du schéma est le nombre de migrations appliquées.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001_initiale.sql"),
    include_str!("migrations/0002_trames.sql"),
    include_str!("migrations/0003_patients.sql"),
    include_str!("migrations/0004_antecedents.sql"),
    include_str!("migrations/0005_modeles.sql"),
    include_str!("migrations/0006_seances.sql"),
    include_str!("migrations/0007_facturation.sql"),
    include_str!("migrations/0008_import.sql"),
    include_str!("migrations/0009_trames_mises_en_forme.sql"),
    include_str!("migrations/0010_documents.sql"),
    include_str!("migrations/0011_images.sql"),
];

#[derive(Debug, thiserror::Error)]
pub enum ErreurBase {
    #[error("la clé ne correspond pas à cette base, ou le fichier n'est pas une base Osteosphere")]
    CleRefusee,
    #[error("cette base vient d'une version plus récente d'Osteosphere (schéma {0})")]
    SchemaFutur(i64),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error("paramètre illisible : {0}")]
    Parametre(#[from] serde_json::Error),
}

/// Secondes depuis le 1er janvier 1970, en temps universel.
pub fn maintenant() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub struct Base {
    connexion: Connection,
}

impl Base {
    /// Ouvre la base, ou la crée chiffrée si le fichier n'existe pas, puis applique les migrations.
    pub fn ouvrir(chemin: &Path, cle: &CleDonnees) -> Result<Self, ErreurBase> {
        let connexion = Connection::open(chemin)?;
        // La clé brute évite une seconde dérivation : elle vient déjà d'Argon2id ou du coffre système.
        let pragma = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", hexa::encoder(cle.octets())));
        connexion.execute_batch(&pragma)?;
        match connexion.query_row("SELECT count(*) FROM sqlite_master", [], |ligne| ligne.get::<_, i64>(0)) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(erreur, _)) if erreur.code == ErrorCode::NotADatabase => {
                return Err(ErreurBase::CleRefusee);
            }
            Err(erreur) => return Err(erreur.into()),
        }
        // WAL et synchronisation complète : aucune saisie perdue après une coupure de courant.
        connexion.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;")?;
        let mut base = Self { connexion };
        base.migrer()?;
        Ok(base)
    }

    pub fn version_schema(&self) -> Result<i64, ErreurBase> {
        Ok(self.connexion.query_row("PRAGMA user_version", [], |ligne| ligne.get(0))?)
    }

    pub fn connexion(&self) -> &Connection {
        &self.connexion
    }

    pub fn connexion_mut(&mut self) -> &mut Connection {
        &mut self.connexion
    }

    /// Enregistre un paramètre du cabinet, sérialisé en JSON.
    pub fn ecrire_parametre<T: Serialize + ?Sized>(&self, cle: &str, valeur: &T) -> Result<(), ErreurBase> {
        self.connexion.execute(
            "INSERT INTO parametres (cle, valeur) VALUES (?1, ?2)
             ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur",
            (cle, serde_json::to_string(valeur)?),
        )?;
        Ok(())
    }

    /// Inscrit une création, modification ou suppression au journal, avec l'état avant et après.
    pub fn journaliser(
        &self,
        action: &str,
        entite: &str,
        avant: Option<&str>,
        apres: Option<&str>,
    ) -> Result<(), ErreurBase> {
        self.connexion.execute(
            "INSERT INTO journal (le, action, entite, avant, apres) VALUES (?1, ?2, ?3, ?4, ?5)",
            (maintenant().to_string(), action, entite, avant, apres),
        )?;
        Ok(())
    }

    /// Exécute l'opération d'un seul tenant : si elle échoue, rien de ce qu'elle a écrit ne reste.
    pub fn atomique<T, E: From<ErreurBase>>(&self, operation: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
        self.connexion.execute_batch("SAVEPOINT atomique").map_err(ErreurBase::from)?;
        match operation() {
            Ok(valeur) => {
                self.connexion.execute_batch("RELEASE atomique").map_err(ErreurBase::from)?;
                Ok(valeur)
            }
            Err(erreur) => {
                self.connexion.execute_batch("ROLLBACK TO atomique; RELEASE atomique").map_err(ErreurBase::from)?;
                Err(erreur)
            }
        }
    }

    pub fn lire_parametre<T: DeserializeOwned>(&self, cle: &str) -> Result<Option<T>, ErreurBase> {
        let texte: Option<String> = self
            .connexion
            .query_row("SELECT valeur FROM parametres WHERE cle = ?1", [cle], |ligne| ligne.get(0))
            .optional()?;
        Ok(texte.map(|t| serde_json::from_str(&t)).transpose()?)
    }

    fn migrer(&mut self) -> Result<(), ErreurBase> {
        let actuelle = self.version_schema()?;
        let cible = MIGRATIONS.len() as i64;
        if actuelle > cible {
            return Err(ErreurBase::SchemaFutur(actuelle));
        }
        for (rang, migration) in MIGRATIONS.iter().enumerate().skip(actuelle as usize) {
            let transaction = self.connexion.transaction()?;
            transaction.execute_batch(migration)?;
            transaction.pragma_update(None, "user_version", rang as i64 + 1)?;
            transaction.commit()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cree_une_base_chiffree_et_la_rouvre() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("cabinet.osteosphere");
        let cle = CleDonnees::generer().unwrap();
        {
            let base = Base::ouvrir(&chemin, &cle).unwrap();
            assert_eq!(base.version_schema().unwrap(), MIGRATIONS.len() as i64);
            base.connexion()
                .execute(
                    "INSERT INTO patients (id, nom, prenom, naissance, cree_le, modifie_le) VALUES ('p1', 'Martin', 'Camille', '1987-03-14', 0, 0)",
                    [],
                )
                .unwrap();
        }
        let base = Base::ouvrir(&chemin, &cle).unwrap();
        let prenom: String = base.connexion().query_row("SELECT prenom FROM patients", [], |l| l.get(0)).unwrap();
        assert_eq!(prenom, "Camille");
    }

    #[test]
    fn la_migration_des_patients_garde_les_dossiers_du_prototype() {
        let connexion = Connection::open_in_memory().unwrap();
        connexion.execute_batch(MIGRATIONS[0]).unwrap();
        connexion.execute_batch(MIGRATIONS[1]).unwrap();
        connexion
            .execute("INSERT INTO patients VALUES ('p1', 'Martin', 'Camille', '1987-03-14', '2026-10-06', '2026-10-06')", [])
            .unwrap();
        connexion.execute_batch(MIGRATIONS[2]).unwrap();
        let (nom, naissance, statut): (String, String, String) = connexion
            .query_row("SELECT nom, naissance, statut FROM patients WHERE id = 'p1'", [], |l| {
                Ok((l.get(0)?, l.get(1)?, l.get(2)?))
            })
            .unwrap();
        assert_eq!((nom.as_str(), naissance.as_str(), statut.as_str()), ("Martin", "1987-03-14", ""));
    }

    #[test]
    fn le_fichier_est_illisible_sans_la_cle() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("cabinet.osteosphere");
        let cle = CleDonnees::generer().unwrap();
        Base::ouvrir(&chemin, &cle)
            .unwrap()
            .connexion()
            .execute("INSERT INTO parametres VALUES ('nom', 'Cabinet fictif')", [])
            .unwrap();
        let octets = std::fs::read(&chemin).unwrap();
        assert!(!octets.starts_with(b"SQLite format 3"));
        assert!(!octets.windows(14).any(|w| w == b"Cabinet fictif"));
    }

    #[test]
    fn refuse_une_autre_cle() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("cabinet.osteosphere");
        Base::ouvrir(&chemin, &CleDonnees::generer().unwrap()).unwrap();
        assert!(matches!(Base::ouvrir(&chemin, &CleDonnees::generer().unwrap()), Err(ErreurBase::CleRefusee)));
    }

    #[test]
    fn ecrit_et_relit_les_parametres() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("cabinet.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        assert_eq!(base.lire_parametre::<String>("trames.caractere").unwrap(), None);
        base.ecrire_parametre("trames.caractere", "@").unwrap();
        base.ecrire_parametre("trames.caractere", "/").unwrap();
        assert_eq!(base.lire_parametre::<String>("trames.caractere").unwrap().as_deref(), Some("/"));
    }

    #[test]
    fn refuse_une_base_plus_recente() {
        let dossier = tempfile::tempdir().unwrap();
        let chemin = dossier.path().join("cabinet.osteosphere");
        let cle = CleDonnees::generer().unwrap();
        Base::ouvrir(&chemin, &cle).unwrap().connexion().pragma_update(None, "user_version", 99).unwrap();
        assert!(matches!(Base::ouvrir(&chemin, &cle), Err(ErreurBase::SchemaFutur(99))));
    }
}
