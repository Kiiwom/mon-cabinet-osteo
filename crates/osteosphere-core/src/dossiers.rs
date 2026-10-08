//! Opérations sur un dossier entier : ce qu'il contient, fusion de deux dossiers, effacement
//! définitif sur demande du patient, historique des modifications.
//!
//! L'effacement garde les factures émises et leurs règlements, que la loi demande de conserver :
//! elles portent déjà le nom et l'adresse du destinataire du jour de leur émission.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::Value;

use crate::base::{Base, ErreurBase};
use crate::patients::{self, ErreurPatient, FichePatient, Patient};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ContenuDossier {
    /// Séances, corbeille comprise.
    pub seances: i64,
    pub antecedents: i64,
    /// Documents, corbeille comprise.
    pub documents: i64,
    /// Factures et avoirs, brouillons compris.
    pub factures: i64,
    pub proches: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BilanEffacement {
    pub seances: i64,
    pub antecedents: i64,
    pub documents: i64,
    /// Factures et avoirs émis, gardés sans lien avec un dossier.
    pub factures_conservees: i64,
    pub brouillons_supprimes: i64,
}

/// Un changement d'un champ, d'après le journal.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Changement {
    pub champ: String,
    pub avant: Value,
    pub apres: Value,
}

/// Une ligne de l'historique du dossier.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Modification {
    pub id: i64,
    /// Secondes depuis 1970, en temps universel.
    pub le: i64,
    pub action: String,
    pub entite: String,
    pub avant: Option<Value>,
    pub apres: Option<Value>,
    /// Les champs changés, quand l'état d'avant et d'après sont connus.
    pub changements: Vec<Changement>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurDossier {
    #[error("choisissez deux dossiers différents")]
    MemeDossier,
    #[error(transparent)]
    Patient(#[from] ErreurPatient),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurDossier {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurDossier {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

fn compter(base: &Base, requete: &str, id: &str) -> Result<i64, ErreurDossier> {
    Ok(base.connexion().query_row(requete, [id], |l| l.get(0))?)
}

pub fn contenu(base: &Base, patient_id: &str) -> Result<ContenuDossier, ErreurDossier> {
    patients::lire(base, patient_id)?;
    Ok(ContenuDossier {
        seances: compter(base, "SELECT COUNT(*) FROM seances WHERE patient_id = ?1", patient_id)?,
        antecedents: compter(base, "SELECT COUNT(*) FROM antecedents WHERE patient_id = ?1", patient_id)?,
        documents: compter(base, "SELECT COUNT(*) FROM documents WHERE patient_id = ?1", patient_id)?,
        factures: compter(base, "SELECT COUNT(*) FROM factures WHERE patient_id = ?1", patient_id)?,
        proches: compter(base, "SELECT COUNT(*) FROM liens_familiaux WHERE patient_id = ?1", patient_id)?,
    })
}

fn ids(base: &Base, requete: &str, id: &str) -> Result<Vec<String>, ErreurDossier> {
    let mut requete = base.connexion().prepare(requete)?;
    Ok(requete.query_map([id], |l| l.get(0))?.collect::<Result<_, _>>()?)
}

/// Réunit deux dossiers du même patient : séances, antécédents, documents, factures, proches et
/// historique passent au dossier gardé, qui prend la fiche choisie ; l'autre dossier disparaît.
pub fn fusionner(base: &Base, garde_id: &str, absorbe_id: &str, fiche: &FichePatient) -> Result<Patient, ErreurDossier> {
    if garde_id == absorbe_id {
        return Err(ErreurDossier::MemeDossier);
    }
    let garde = patients::lire(base, garde_id)?;
    let absorbe = patients::lire(base, absorbe_id)?;
    let fiche = fiche.verifier()?;
    base.atomique(|| {
        let c = base.connexion();
        for table in ["seances", "antecedents", "documents", "factures"] {
            c.execute(&format!("UPDATE {table} SET patient_id = ?1 WHERE patient_id = ?2"), [garde_id, absorbe_id])?;
        }
        // Les proches de l'autre dossier deviennent ceux du dossier gardé, sauf s'il les a déjà.
        c.execute(
            "INSERT OR IGNORE INTO liens_familiaux (patient_id, proche_id, lien)
             SELECT ?1, proche_id, lien FROM liens_familiaux WHERE patient_id = ?2 AND proche_id <> ?1",
            [garde_id, absorbe_id],
        )?;
        c.execute(
            "INSERT OR IGNORE INTO liens_familiaux (patient_id, proche_id, lien)
             SELECT patient_id, ?1, lien FROM liens_familiaux WHERE proche_id = ?2 AND patient_id <> ?1",
            [garde_id, absorbe_id],
        )?;
        c.execute("UPDATE patients SET factures_a = ?1 WHERE factures_a = ?2 AND id <> ?1", [garde_id, absorbe_id])?;
        if garde.factures_a.is_none()
            && let Some(payeur) = absorbe.factures_a.as_deref().filter(|p| *p != garde_id)
        {
            c.execute(
                "UPDATE patients SET factures_a = ?2 WHERE id = ?1
                   AND EXISTS (SELECT 1 FROM liens_familiaux WHERE patient_id = ?1 AND proche_id = ?2 AND lien IN ('parent', 'conjoint'))",
                [garde_id, payeur],
            )?;
        }
        // Un nouvel import retrouve le dossier gardé.
        c.execute("UPDATE liens_import SET id = ?1 WHERE nature = 'patient' AND id = ?2", [garde_id, absorbe_id])?;
        c.execute("UPDATE journal SET entite = ?1 WHERE entite = ?2", [garde_id, absorbe_id])?;
        c.execute(
            "UPDATE patients SET cree_le = MIN(cree_le, (SELECT cree_le FROM patients WHERE id = ?2)),
                                 archive_le = CASE WHEN (SELECT archive_le FROM patients WHERE id = ?2) IS NULL THEN NULL ELSE archive_le END
             WHERE id = ?1",
            [garde_id, absorbe_id],
        )?;
        c.execute("DELETE FROM patients WHERE id = ?1", [absorbe_id])?;
        patients::modifier(base, garde_id, &fiche)?;
        let apres = patients::lire(base, garde_id)?;
        base.journaliser("patient.fusionne", garde_id, Some(&serde_json::to_string(&absorbe)?), Some(&serde_json::to_string(&apres)?))?;
        Ok(apres)
    })
}

/// Efface le dossier pour de bon, sur demande du patient : fiche, antécédents, séances, documents,
/// proches et historique. Les factures émises restent, sans lien avec un dossier ; les brouillons
/// sont supprimés.
pub fn effacer(base: &Base, patient_id: &str) -> Result<BilanEffacement, ErreurDossier> {
    patients::lire(base, patient_id)?;
    base.atomique(|| {
        let c = base.connexion();
        let seances = ids(base, "SELECT id FROM seances WHERE patient_id = ?1", patient_id)?;
        let antecedents = ids(base, "SELECT id FROM antecedents WHERE patient_id = ?1", patient_id)?;
        let documents = ids(base, "SELECT id FROM documents WHERE patient_id = ?1", patient_id)?;
        let brouillons = c.execute(
            "DELETE FROM factures WHERE etat = 'brouillon'
               AND (patient_id = ?1 OR seance_id IN (SELECT id FROM seances WHERE patient_id = ?1))",
            [patient_id],
        )?;
        let conservees = c.execute(
            "UPDATE factures SET patient_id = NULL, seance_id = NULL
             WHERE patient_id = ?1 OR seance_id IN (SELECT id FROM seances WHERE patient_id = ?1)",
            [patient_id],
        )?;
        c.execute("DELETE FROM seances WHERE patient_id = ?1", [patient_id])?;
        c.execute("DELETE FROM patients WHERE id = ?1", [patient_id])?;
        // L'historique du dossier contient sa fiche : il part avec lui.
        let mut requete = c.prepare("DELETE FROM journal WHERE entite = ?1")?;
        for id in std::iter::once(patient_id.to_owned()).chain(seances.iter().cloned()).chain(antecedents.iter().cloned()).chain(documents.iter().cloned()) {
            requete.execute([id])?;
        }
        // Ce qui avait été supprimé avant (antécédent, séance ou document effacé) part aussi ; l'histoire
        // des factures, qui restent, est gardée.
        c.execute(
            "DELETE FROM journal
             WHERE action NOT LIKE 'facture.%' AND action NOT LIKE 'reglement.%' AND action <> 'avoir.emis'
               AND ((CASE WHEN json_valid(avant) THEN json_extract(avant, '$.patient_id') END) = ?1
                 OR (CASE WHEN json_valid(apres) THEN json_extract(apres, '$.patient_id') END) = ?1)",
            [patient_id],
        )?;
        let bilan = BilanEffacement {
            seances: seances.len() as i64,
            antecedents: antecedents.len() as i64,
            documents: documents.len() as i64,
            factures_conservees: conservees as i64,
            brouillons_supprimes: brouillons as i64,
        };
        base.journaliser("patient.efface", patient_id, None, Some(&serde_json::to_string(&bilan)?))?;
        Ok(bilan)
    })
}

/// Les champs dont la valeur diffère entre deux états d'un même objet ; les dates techniques n'en sont pas.
fn changements(avant: &Value, apres: &Value) -> Vec<Changement> {
    let (Value::Object(avant), Value::Object(apres)) = (avant, apres) else {
        return Vec::new();
    };
    let ignores = ["cree_le", "modifie_le", "version_le"];
    let cles: BTreeSet<&String> = avant.keys().chain(apres.keys()).filter(|c| !ignores.contains(&c.as_str())).collect();
    cles.into_iter()
        .filter_map(|cle| {
            let (a, b) = (avant.get(cle).unwrap_or(&Value::Null), apres.get(cle).unwrap_or(&Value::Null));
            (a != b).then(|| Changement { champ: cle.clone(), avant: a.clone(), apres: b.clone() })
        })
        .collect()
}

/// Les modifications du dossier, de la plus récente à la plus ancienne : sa fiche, ses proches,
/// ses antécédents, ses séances, ses documents et ses factures. `avant` pour la page suivante.
pub fn historique(base: &Base, patient_id: &str, limite: u32, avant: Option<i64>) -> Result<Vec<Modification>, ErreurDossier> {
    let mut requete = base.connexion().prepare(
        "SELECT id, le, action, entite, avant, apres FROM journal
         WHERE id < ?2 AND (
           entite = ?1
           OR (CASE WHEN json_valid(avant) THEN json_extract(avant, '$.patient_id') END) = ?1
           OR (CASE WHEN json_valid(apres) THEN json_extract(apres, '$.patient_id') END) = ?1
           OR (CASE WHEN json_valid(avant) THEN json_extract(avant, '$.proche_id') END) = ?1
           OR (CASE WHEN json_valid(apres) THEN json_extract(apres, '$.proche_id') END) = ?1
         )
         ORDER BY id DESC LIMIT ?3",
    )?;
    let lignes = requete.query_map(rusqlite::params![patient_id, avant.unwrap_or(i64::MAX), limite], |l| {
        Ok((l.get::<_, i64>(0)?, l.get::<_, String>(1)?, l.get::<_, String>(2)?, l.get::<_, String>(3)?, l.get::<_, Option<String>>(4)?, l.get::<_, Option<String>>(5)?))
    })?;
    let lire = |texte: Option<String>| texte.and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let mut modifications = Vec::new();
    for ligne in lignes {
        let (id, le, action, entite, avant, apres) = ligne?;
        let (avant, apres) = (lire(avant), lire(apres));
        let changements = match (&avant, &apres) {
            (Some(a), Some(b)) => changements(a, b),
            _ => Vec::new(),
        };
        modifications.push(Modification { id, le: le.parse().unwrap_or(0), action, entite, avant, apres, changements });
    }
    Ok(modifications)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::antecedents::{self, SaisieAntecedent};
    use crate::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
    use crate::chiffrement::CleDonnees;
    use crate::facturation::{self, Destinataire, LigneFacture, SaisieFacture};
    use crate::familles;
    use crate::groupes::{self, SaisieGroupe};
    use crate::modeles;
    use crate::seances::{self, SaisieSeance};

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        modeles::installer_modeles_fournis(&base).unwrap();
        let identite = IdentiteCabinet {
            prenom: "Alexandre".into(),
            nom: "Roux".into(),
            adresse: "12 place de la Halle".into(),
            code_postal: "47150".into(),
            ville: "Lacapelle-Biron".into(),
            siret: "12345678900012".into(),
            rpps: "10000000000".into(),
            ..Default::default()
        };
        base.ecrire_parametre(PARAMETRE_IDENTITE, &identite).unwrap();
        (dossier, base)
    }

    fn fiche(prenom: &str) -> FichePatient {
        FichePatient { nom: "Martin".into(), prenom: prenom.into(), ..Default::default() }
    }

    fn seance(base: &Base, patient_id: &str, debut: &str) -> String {
        let modele = &modeles::lister(base).unwrap()[0];
        let saisie = SaisieSeance { debut: debut.into(), modele_id: modele.id.clone(), modele_version: modele.version, ..Default::default() };
        seances::creer(base, patient_id, &saisie).unwrap().id
    }

    fn saisie_facture(patient_id: &str, seance_id: &str) -> SaisieFacture {
        SaisieFacture {
            patient_id: Some(patient_id.into()),
            seance_id: Some(seance_id.into()),
            destinataire: Destinataire { nom: "Martin".into(), prenom: "Camille".into(), ..Default::default() },
            lignes: vec![LigneFacture { designation: "Consultation".into(), quantite: 1, prix_unitaire_centimes: 5500, ..Default::default() }],
            ..Default::default()
        }
    }

    fn facture_emise(base: &Base, patient_id: &str, seance_id: &str) -> String {
        let brouillon = facturation::creer_brouillon(base, &saisie_facture(patient_id, seance_id)).unwrap();
        facturation::emettre(base, &brouillon.id, "2026-10-06").unwrap().id
    }

    fn antecedent(base: &Base, patient_id: &str) -> String {
        let saisie = SaisieAntecedent { categorie: "medicaux".into(), rubrique: "Allergies".into(), precision: "AINS".into(), ..Default::default() };
        antecedents::enregistrer(base, patient_id, None, &saisie).unwrap().id
    }

    #[test]
    fn fusionne_deux_dossiers_et_tout_ce_qu_ils_contiennent() {
        let (_dossier, base) = base();
        let club = groupes::enregistrer(&base, None, &SaisieGroupe { nom: "Club".into(), couleur: "vert".into() }).unwrap();
        let garde = patients::creer(&base, &FichePatient { portable: "06 00 00 00 01".into(), ..fiche("Camille") }).unwrap();
        let doublon = patients::creer(&base, &FichePatient { email: "camille@exemple.fr".into(), groupes: vec![club.id.clone()], ..fiche("Camile") }).unwrap();
        let lucas = patients::creer(&base, &fiche("Lucas")).unwrap();
        familles::lier(&base, &lucas.id, &doublon.id, "parent").unwrap();
        familles::definir_payeur(&base, &lucas.id, Some(&doublon.id)).unwrap();
        seance(&base, &garde.id, "2026-09-01T10:00");
        let s = seance(&base, &doublon.id, "2026-10-06T14:30");
        facture_emise(&base, &doublon.id, &s);
        antecedent(&base, &doublon.id);
        assert_eq!(contenu(&base, &doublon.id).unwrap(), ContenuDossier { seances: 1, antecedents: 1, documents: 0, factures: 1, proches: 1 });

        let choisie = FichePatient { portable: garde.fiche.portable.clone(), email: doublon.fiche.email.clone(), groupes: vec![club.id.clone()], ..fiche("Camille") };
        let fusionne = fusionner(&base, &garde.id, &doublon.id, &choisie).unwrap();
        assert_eq!(fusionne.fiche.email, "camille@exemple.fr");
        assert_eq!(fusionne.fiche.groupes, std::slice::from_ref(&club.id));
        assert!(matches!(patients::lire(&base, &doublon.id), Err(ErreurPatient::Introuvable)));
        assert_eq!(contenu(&base, &garde.id).unwrap(), ContenuDossier { seances: 2, antecedents: 1, documents: 0, factures: 1, proches: 1 });
        // Lucas a toujours sa mère, et ses factures lui vont toujours.
        assert_eq!(familles::proches(&base, &lucas.id).unwrap()[0].id, garde.id);
        assert_eq!(patients::lire(&base, &lucas.id).unwrap().factures_a.as_deref(), Some(garde.id.as_str()));
        // L'historique du doublon suit le dossier gardé.
        let actions: Vec<String> = historique(&base, &garde.id, 50, None).unwrap().into_iter().map(|m| m.action).collect();
        assert_eq!(actions.first().map(String::as_str), Some("patient.fusionne"));
        assert_eq!(actions.iter().filter(|a| *a == "patient.cree").count(), 2);
        assert!(matches!(fusionner(&base, &garde.id, &garde.id, &choisie), Err(ErreurDossier::MemeDossier)));
    }

    #[test]
    fn efface_le_dossier_et_garde_les_factures_emises() {
        let (_dossier, base) = base();
        let camille = patients::creer(&base, &fiche("Camille")).unwrap();
        let lucas = patients::creer(&base, &fiche("Lucas")).unwrap();
        familles::lier(&base, &lucas.id, &camille.id, "parent").unwrap();
        familles::definir_payeur(&base, &lucas.id, Some(&camille.id)).unwrap();
        let emise = seance(&base, &camille.id, "2026-10-06T14:30");
        let facture = facture_emise(&base, &camille.id, &emise);
        let autre = seance(&base, &camille.id, "2026-10-07T09:00");
        facturation::creer_brouillon(&base, &saisie_facture(&camille.id, &autre)).unwrap();
        let a = antecedent(&base, &camille.id);
        let ancien = antecedent(&base, &camille.id);
        antecedents::supprimer(&base, &ancien).unwrap();

        let bilan = effacer(&base, &camille.id).unwrap();
        assert_eq!(bilan, BilanEffacement { seances: 2, antecedents: 1, documents: 0, factures_conservees: 1, brouillons_supprimes: 1 });
        let supprime: i64 = base.connexion().query_row("SELECT COUNT(*) FROM journal WHERE entite = ?1", [&ancien], |l| l.get(0)).unwrap();
        assert_eq!(supprime, 0);
        // L'histoire de la facture gardée reste.
        assert!(!facturation::historique(&base, &facture).unwrap().is_empty());
        assert!(matches!(patients::lire(&base, &camille.id), Err(ErreurPatient::Introuvable)));
        let gardee = facturation::lire(&base, &facture).unwrap();
        assert_eq!((gardee.saisie.patient_id, gardee.saisie.seance_id), (None, None));
        assert_eq!(gardee.saisie.destinataire.nom, "Martin");
        assert!(familles::proches(&base, &lucas.id).unwrap().is_empty());
        assert_eq!(patients::lire(&base, &lucas.id).unwrap().factures_a, None);
        // Plus rien du dossier au journal, sauf la trace de l'effacement.
        let restes: Vec<String> = base
            .connexion()
            .prepare("SELECT action FROM journal WHERE entite IN (?1, ?2, ?3)")
            .unwrap()
            .query_map([&camille.id, &emise, &a], |l| l.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(restes, ["patient.efface"]);
    }

    #[test]
    fn l_historique_detaille_les_champs_changes() {
        let (_dossier, base) = base();
        let camille = patients::creer(&base, &fiche("Camille")).unwrap();
        patients::modifier(&base, &camille.id, &FichePatient { profession: "Infirmière".into(), ville: "Fumel".into(), ..fiche("Camille") }).unwrap();
        antecedent(&base, &camille.id);
        let lucas = patients::creer(&base, &fiche("Lucas")).unwrap();
        familles::lier(&base, &lucas.id, &camille.id, "parent").unwrap();

        let h = historique(&base, &camille.id, 50, None).unwrap();
        let actions: Vec<&str> = h.iter().map(|m| m.action.as_str()).collect();
        assert_eq!(actions, ["famille.lien", "antecedent.cree", "patient.modifie", "patient.cree"]);
        let champs: Vec<&str> = h[2].changements.iter().map(|c| c.champ.as_str()).collect();
        assert_eq!(champs, ["profession", "ville"]);
        assert_eq!(h[2].changements[0].apres, json!("Infirmière"));
        // Page suivante.
        assert_eq!(historique(&base, &camille.id, 2, Some(h[1].id)).unwrap().len(), 2);
        // L'historique de Lucas a son propre lien, pas l'antécédent de sa mère.
        let de_lucas: Vec<String> = historique(&base, &lucas.id, 50, None).unwrap().into_iter().map(|m| m.action).collect();
        assert_eq!(de_lucas, ["famille.lien", "patient.cree"]);
    }
}
