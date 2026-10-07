//! Base SQLite chiffrée par SQLCipher : ouverture, vérification de la clé, migrations.

use std::path::Path;

use rusqlite::{Connection, ErrorCode, OptionalExtension};
use serde::Serialize;
use serde::de::DeserializeOwned;
use zeroize::Zeroizing;

use crate::chiffrement::CleDonnees;
use crate::hexa;

/// Migrations dans l'ordre ; la version du schéma est le nombre de migrations appliquées.
const MIGRATIONS: &[&str] = &[include_str!("migrations/0001_initiale.sql")];

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
                    "INSERT INTO patients VALUES ('p1', 'Martin', 'Camille', '1987-03-14', '2026-10-06', '2026-10-06')",
                    [],
                )
                .unwrap();
        }
        let base = Base::ouvrir(&chemin, &cle).unwrap();
        let prenom: String = base.connexion().query_row("SELECT prenom FROM patients", [], |l| l.get(0)).unwrap();
        assert_eq!(prenom, "Camille");
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
