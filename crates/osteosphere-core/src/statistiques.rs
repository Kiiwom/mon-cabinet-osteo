//! Statistiques du cabinet sur une période, comparées à la même période de l'année précédente.
//!
//! Le chiffre d'affaires se compte à la date d'encaissement des règlements (ce qui est entré en
//! caisse) ou à la date des factures et avoirs émis, au choix. L'historique importé compte comme
//! le reste.

use std::collections::{HashMap, HashSet};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};
use crate::facturation::Moyen;
use crate::numerotation::Date;
use crate::seances::{self, Facturation, TypeSeance};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BaseChiffre {
    #[default]
    Encaissement,
    Facture,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Comparaison {
    pub valeur: i64,
    pub precedent: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Mois {
    /// `AAAA-MM`.
    pub mois: String,
    pub chiffre: i64,
    pub chiffre_precedent: i64,
    pub seances: i64,
    pub seances_precedent: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Compte {
    pub libelle: String,
    pub nombre: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ParMoyen {
    pub moyen: Moyen,
    pub montant: i64,
    pub nombre: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Sexes {
    pub femmes: i64,
    pub hommes: i64,
    pub non_renseigne: i64,
}

/// Patients selon leur dernière séance, comptée depuis la fin de la période.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Recence {
    pub moins_6_mois: i64,
    pub de_6_a_12_mois: i64,
    pub de_1_a_2_ans: i64,
    pub plus_2_ans: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PatientSuivi {
    pub id: String,
    pub nom: String,
    pub prenom: String,
    pub seances: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Douleur {
    /// Séances où la douleur est notée avant et après.
    pub seances: i64,
    pub avant: f64,
    pub apres: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Statistiques {
    pub du: String,
    pub au: String,
    pub du_precedent: String,
    pub au_precedent: String,
    pub base: BaseChiffre,
    /// Centimes.
    pub chiffre: Comparaison,
    pub seances: Comparaison,
    /// Chiffre d'affaires par séance facturée, en centimes.
    pub panier_moyen: Comparaison,
    /// Patients dont la toute première séance tombe dans la période.
    pub nouveaux_patients: Comparaison,
    pub par_mois: Vec<Mois>,
    /// Encaissements de la période, par moyen de paiement.
    pub moyens: Vec<ParMoyen>,
    /// Patients venus au moins une fois dans la période.
    pub patients_actifs: i64,
    pub age_moyen: Option<f64>,
    pub ages: Vec<Compte>,
    pub sexes: Sexes,
    pub recence: Recence,
    pub seances_par_patient: f64,
    pub premieres_seances: i64,
    pub actes_gratuits: i64,
    pub villes: Vec<Compte>,
    pub antecedents: Vec<Compte>,
    pub patients_suivis: Vec<PatientSuivi>,
    pub douleur: Option<Douleur>,
    /// Séances par jour de la semaine, du lundi au dimanche.
    pub jours: Vec<Compte>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurStatistiques {
    #[error("période invalide : {0}")]
    Periode(String),
    #[error("statistiques : {0}")]
    Donnees(String),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurStatistiques {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

const TRANCHES: [(i32, &str); 8] = [
    (3, "Moins de 3 ans"),
    (12, "3 à 11 ans"),
    (18, "12 à 17 ans"),
    (30, "18 à 29 ans"),
    (45, "30 à 44 ans"),
    (60, "45 à 59 ans"),
    (75, "60 à 74 ans"),
    (i32::MAX, "75 ans et plus"),
];
const JOURS: [&str; 7] = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/// La même date un an plus tôt ; le 29 février devient le 28.
fn un_an_avant(date: Date) -> Date {
    let jour = if date.mois() == 2 && date.jour() == 29 { 28 } else { date.jour() };
    Date::lire(&format!("{:04}-{:02}-{:02}", date.annee() - 1, date.mois(), jour)).unwrap_or(date)
}

/// Âge en années révolues à une date.
fn age_le(naissance: Date, date: Date) -> i32 {
    let mut age = date.annee() - naissance.annee();
    if (date.mois(), date.jour()) < (naissance.mois(), naissance.jour()) {
        age -= 1;
    }
    age
}

fn chiffre_par_mois(base: &Base, chiffre: BaseChiffre, du: &str, au: &str) -> Result<HashMap<String, i64>, ErreurStatistiques> {
    let requete = match chiffre {
        BaseChiffre::Encaissement => {
            "SELECT substr(encaisse_le, 1, 7), sum(montant_centimes) FROM reglements WHERE encaisse_le >= ?1 AND encaisse_le <= ?2 GROUP BY 1"
        }
        BaseChiffre::Facture => {
            "SELECT substr(date_emission, 1, 7), sum(total_centimes) FROM factures
             WHERE numero IS NOT NULL AND date_emission >= ?1 AND date_emission <= ?2 GROUP BY 1"
        }
    };
    Ok(base.connexion().prepare(requete)?.query_map([du, au], |l| Ok((l.get(0)?, l.get(1)?)))?.collect::<Result<_, _>>()?)
}

fn seances_par_mois(base: &Base, du: &str, au: &str) -> Result<HashMap<String, i64>, ErreurStatistiques> {
    let fin = format!("{au}T99");
    Ok(base
        .connexion()
        .prepare("SELECT substr(debut, 1, 7), count(*) FROM seances WHERE supprimee_le IS NULL AND debut >= ?1 AND debut < ?2 GROUP BY 1")?
        .query_map([du, fin.as_str()], |l| Ok((l.get(0)?, l.get(1)?)))?
        .collect::<Result<_, _>>()?)
}

/// Patients dont la première séance (corbeille exclue) tombe entre deux dates comprises.
fn nouveaux(premieres: &HashMap<String, String>, du: &str, au: &str) -> i64 {
    premieres.values().filter(|d| d.as_str() >= du && d.as_str() <= au).count() as i64
}

fn haut_du_classement(mut comptes: HashMap<String, i64>, nombre: usize) -> Vec<Compte> {
    let mut liste: Vec<Compte> = comptes.drain().filter(|(l, _)| !l.trim().is_empty()).map(|(libelle, nombre)| Compte { libelle, nombre }).collect();
    liste.sort_by(|a, b| b.nombre.cmp(&a.nombre).then(a.libelle.cmp(&b.libelle)));
    liste.truncate(nombre);
    liste
}

/// Les statistiques entre deux dates comprises (`AAAA-MM-JJ`).
pub fn calculer(base: &Base, du: &str, au: &str, chiffre: BaseChiffre) -> Result<Statistiques, ErreurStatistiques> {
    let debut = Date::lire(du).map_err(|e| ErreurStatistiques::Periode(e.to_string()))?;
    let fin = Date::lire(au).map_err(|e| ErreurStatistiques::Periode(e.to_string()))?;
    if fin < debut {
        return Err(ErreurStatistiques::Periode("la fin précède le début".into()));
    }
    let (du_p, au_p) = (un_an_avant(debut).to_string(), un_an_avant(fin).to_string());

    let ca = chiffre_par_mois(base, chiffre, du, au)?;
    let ca_p = chiffre_par_mois(base, chiffre, &du_p, &au_p)?;
    let sm = seances_par_mois(base, du, au)?;
    let sm_p = seances_par_mois(base, &du_p, &au_p)?;
    let decaler = |mois: &str| -> String {
        let annee: i32 = mois[..4].parse().unwrap_or(0);
        format!("{}{}", annee + 1, &mois[4..])
    };
    let ca_p_decale: HashMap<String, i64> = ca_p.iter().map(|(m, v)| (decaler(m), *v)).collect();
    let sm_p_decale: HashMap<String, i64> = sm_p.iter().map(|(m, v)| (decaler(m), *v)).collect();

    let mut par_mois = Vec::new();
    let (mut annee, mut mois) = (debut.annee(), debut.mois());
    while (annee, mois) <= (fin.annee(), fin.mois()) {
        let cle = format!("{annee:04}-{mois:02}");
        par_mois.push(Mois {
            chiffre: ca.get(&cle).copied().unwrap_or(0),
            chiffre_precedent: ca_p_decale.get(&cle).copied().unwrap_or(0),
            seances: sm.get(&cle).copied().unwrap_or(0),
            seances_precedent: sm_p_decale.get(&cle).copied().unwrap_or(0),
            mois: cle,
        });
        if mois == 12 {
            annee += 1;
            mois = 1;
        } else {
            mois += 1;
        }
    }
    let somme = |m: &HashMap<String, i64>| m.values().sum::<i64>();

    let liste = seances::lister_periode(base, du, au).map_err(|e| ErreurStatistiques::Donnees(e.to_string()))?;
    let fin_p = format!("{au_p}T99");
    let seances_p: i64 =
        base.connexion().query_row("SELECT count(*) FROM seances WHERE supprimee_le IS NULL AND debut >= ?1 AND debut < ?2", [du_p.as_str(), fin_p.as_str()], |l| l.get(0))?;
    let facturees = liste.iter().filter(|s| s.facturation == Facturation::AFacturer).count() as i64;
    let facturees_p: i64 = base.connexion().query_row(
        "SELECT count(*) FROM seances WHERE supprimee_le IS NULL AND facturation = 'a_facturer' AND debut >= ?1 AND debut < ?2",
        [du_p.as_str(), fin_p.as_str()],
        |l| l.get(0),
    )?;
    let panier = |ca: i64, n: i64| if n > 0 { ca / n } else { 0 };

    let premieres: HashMap<String, String> = base
        .connexion()
        .prepare("SELECT patient_id, min(substr(debut, 1, 10)) FROM seances WHERE supprimee_le IS NULL GROUP BY patient_id")?
        .query_map([], |l| Ok((l.get(0)?, l.get(1)?)))?
        .collect::<Result<_, _>>()?;

    let mut moyens: Vec<ParMoyen> = Vec::new();
    {
        let mut requete =
            base.connexion().prepare("SELECT moyen, sum(montant_centimes), count(*) FROM reglements WHERE encaisse_le >= ?1 AND encaisse_le <= ?2 GROUP BY moyen")?;
        let lignes = requete.query_map([du, au], |l| Ok((l.get::<_, String>(0)?, l.get::<_, i64>(1)?, l.get::<_, i64>(2)?)))?;
        for ligne in lignes {
            let (moyen, montant, nombre) = ligne?;
            let moyen: Moyen = serde_json::from_value(serde_json::Value::String(moyen)).unwrap_or(Moyen::Autre);
            moyens.push(ParMoyen { moyen, montant, nombre });
        }
        moyens.sort_by_key(|m| Moyen::TOUS.iter().position(|x| *x == m.moyen));
    }

    // Patients venus dans la période.
    let mut seances_par_patient: HashMap<String, i64> = HashMap::new();
    for s in &liste {
        *seances_par_patient.entry(s.patient_id.clone()).or_default() += 1;
    }
    let actifs: HashSet<&String> = seances_par_patient.keys().collect();
    let mut ages: HashMap<String, i64> = HashMap::new();
    let mut somme_ages = 0i64;
    let mut nombre_ages = 0i64;
    let mut sexes = Sexes::default();
    let mut villes: HashMap<String, i64> = HashMap::new();
    let mut recence = Recence::default();
    let mut suivis = Vec::new();
    {
        let mut requete = base.connexion().prepare(
            "SELECT p.id, p.nom, p.prenom, p.sexe, p.naissance, p.ville, p.archive_le, p.decede,
                    (SELECT max(substr(debut, 1, 10)) FROM seances s WHERE s.patient_id = p.id AND s.supprimee_le IS NULL AND substr(s.debut, 1, 10) <= ?1)
             FROM patients p",
        )?;
        let lignes = requete.query_map([au], |l| {
            Ok((
                l.get::<_, String>(0)?,
                l.get::<_, String>(1)?,
                l.get::<_, String>(2)?,
                l.get::<_, String>(3)?,
                l.get::<_, Option<String>>(4)?,
                l.get::<_, String>(5)?,
                l.get::<_, Option<i64>>(6)?,
                l.get::<_, bool>(7)?,
                l.get::<_, Option<String>>(8)?,
            ))
        })?;
        for ligne in lignes {
            let (id, nom, prenom, sexe, naissance, ville, archive, decede, derniere) = ligne?;
            if let Some(derniere) = derniere.as_deref().and_then(|d| Date::lire(d).ok())
                && archive.is_none()
                && !decede
            {
                let jours = fin.jours_unix() - derniere.jours_unix();
                match jours {
                    ..183 => recence.moins_6_mois += 1,
                    183..365 => recence.de_6_a_12_mois += 1,
                    365..730 => recence.de_1_a_2_ans += 1,
                    _ => recence.plus_2_ans += 1,
                }
            }
            if !actifs.contains(&id) {
                continue;
            }
            match sexe.as_str() {
                "F" => sexes.femmes += 1,
                "M" => sexes.hommes += 1,
                _ => sexes.non_renseigne += 1,
            }
            *villes.entry(ville.trim().to_owned()).or_default() += 1;
            let tranche = match naissance.as_deref().and_then(|n| Date::lire(n).ok()) {
                Some(n) => {
                    let age = age_le(n, fin);
                    somme_ages += i64::from(age);
                    nombre_ages += 1;
                    TRANCHES.iter().find(|(limite, _)| age < *limite).map(|(_, l)| *l).unwrap_or("75 ans et plus")
                }
                None => "Âge non renseigné",
            };
            *ages.entry(tranche.to_owned()).or_default() += 1;
            suivis.push(PatientSuivi { seances: seances_par_patient.get(&id).copied().unwrap_or(0), id, nom, prenom });
        }
    }
    suivis.sort_by(|a, b| b.seances.cmp(&a.seances).then(a.nom.cmp(&b.nom)));
    suivis.truncate(5);
    let ages: Vec<Compte> = TRANCHES
        .iter()
        .map(|(_, l)| *l)
        .chain(["Âge non renseigné"])
        .filter_map(|l| ages.get(l).map(|n| Compte { libelle: l.to_owned(), nombre: *n }))
        .collect();

    let mut antecedents: HashMap<String, i64> = HashMap::new();
    {
        let mut requete = base.connexion().prepare("SELECT patient_id, rubrique FROM antecedents")?;
        let mut vus: HashSet<(String, String)> = HashSet::new();
        for ligne in requete.query_map([], |l| Ok((l.get::<_, String>(0)?, l.get::<_, String>(1)?)))? {
            let (patient, rubrique) = ligne?;
            if actifs.contains(&patient) && vus.insert((patient, rubrique.clone())) {
                *antecedents.entry(rubrique).or_default() += 1;
            }
        }
    }

    let notees: Vec<(f64, f64)> = liste.iter().filter_map(|s| Some((s.douleur_avant?, s.douleur_apres?))).collect();
    let douleur = (!notees.is_empty()).then(|| Douleur {
        seances: notees.len() as i64,
        avant: notees.iter().map(|d| d.0).sum::<f64>() / notees.len() as f64,
        apres: notees.iter().map(|d| d.1).sum::<f64>() / notees.len() as f64,
    });
    let mut jours = [0i64; 7];
    for s in &liste {
        if let Ok(d) = Date::lire(&s.debut[..10.min(s.debut.len())]) {
            jours[(d.jours_unix() + 3).rem_euclid(7) as usize] += 1;
        }
    }

    let chiffre_total = somme(&ca);
    let chiffre_precedent = somme(&ca_p);
    Ok(Statistiques {
        du: du.to_owned(),
        au: au.to_owned(),
        du_precedent: du_p.clone(),
        au_precedent: au_p.clone(),
        base: chiffre,
        chiffre: Comparaison { valeur: chiffre_total, precedent: chiffre_precedent },
        seances: Comparaison { valeur: liste.len() as i64, precedent: seances_p },
        panier_moyen: Comparaison { valeur: panier(chiffre_total, facturees), precedent: panier(chiffre_precedent, facturees_p) },
        nouveaux_patients: Comparaison { valeur: nouveaux(&premieres, du, au), precedent: nouveaux(&premieres, &du_p, &au_p) },
        par_mois,
        moyens,
        patients_actifs: actifs.len() as i64,
        age_moyen: (nombre_ages > 0).then(|| somme_ages as f64 / nombre_ages as f64),
        ages,
        sexes,
        recence,
        seances_par_patient: if actifs.is_empty() { 0.0 } else { liste.len() as f64 / actifs.len() as f64 },
        premieres_seances: liste.iter().filter(|s| s.type_seance == TypeSeance::Premiere).count() as i64,
        actes_gratuits: liste.iter().filter(|s| s.facturation == Facturation::Gratuit).count() as i64,
        villes: haut_du_classement(villes, 6),
        antecedents: haut_du_classement(antecedents, 6),
        patients_suivis: suivis,
        douleur,
        jours: JOURS.iter().zip(jours).map(|(l, n)| Compte { libelle: (*l).to_owned(), nombre: n }).collect(),
    })
}

/// Première date d'activité du cabinet (séance ou règlement), pour proposer des périodes utiles.
pub fn premiere_activite(base: &Base) -> Result<Option<String>, ErreurStatistiques> {
    Ok(base
        .connexion()
        .query_row(
            "SELECT min(d) FROM (SELECT min(substr(debut, 1, 10)) AS d FROM seances UNION ALL SELECT min(encaisse_le) FROM reglements)",
            [],
            |l| l.get(0),
        )
        .optional()?
        .flatten())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
    use crate::chiffrement::CleDonnees;
    use crate::facturation::{self, LigneFacture, SaisieReglement};
    use crate::modeles;
    use crate::patients::{self, FichePatient};
    use crate::seances::SaisieSeance;

    #[test]
    fn compare_a_l_annee_precedente_et_decrit_la_patientele() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        base.ecrire_parametre(
            PARAMETRE_IDENTITE,
            &IdentiteCabinet {
                prenom: "Alexandre".into(),
                nom: "Roux".into(),
                adresse: "12 place de la Halle".into(),
                code_postal: "47150".into(),
                ville: "Lacapelle-Biron".into(),
                siret: "12345678900012".into(),
                rpps: "10000000000".into(),
                ..Default::default()
            },
        )
        .unwrap();
        modeles::installer_modeles_fournis(&base).unwrap();
        let modele = modeles::lister(&base).unwrap().remove(0);
        let patient = |nom: &str, sexe: &str, naissance: &str, ville: &str| {
            patients::creer(
                &base,
                &FichePatient { nom: nom.into(), prenom: "P".into(), sexe: sexe.into(), naissance: Some(naissance.into()), ville: ville.into(), ..Default::default() },
            )
            .unwrap()
            .id
        };
        let camille = patient("Martin", "F", "1988-03-14", "Fumel");
        let louis = patient("Petit", "M", "2014-09-20", "Fumel");
        let ancienne = patient("Aubert", "F", "1954-11-08", "Villeréal");
        let seance = |p: &str, debut: &str, avant: i64, apres: i64, facturer: bool| {
            let mut s = SaisieSeance { debut: debut.into(), modele_id: modele.id.clone(), modele_version: modele.version, ..Default::default() };
            s.valeurs.insert("douleur_avant".into(), json!(avant));
            s.valeurs.insert("douleur_apres".into(), json!(apres));
            if !facturer {
                s.facturation = Facturation::Gratuit;
            }
            let id = seances::creer(&base, p, &s).unwrap().id;
            if facturer {
                let date = &debut[..10];
                facturation::facturer_seance(
                    &base,
                    &id,
                    &[LigneFacture { designation: "Consultation".into(), quantite: 1, prix_unitaire_centimes: 5500, ..Default::default() }],
                    Some(&SaisieReglement { montant_centimes: 5500, encaisse_le: date.into(), ..Default::default() }),
                    date,
                )
                .unwrap();
            }
        };
        seance(&ancienne, "2024-02-10T10:00", 5, 3, true);
        seance(&camille, "2025-03-05T10:00", 6, 2, true);
        seance(&camille, "2026-03-04T10:00", 7, 3, true);
        seance(&camille, "2026-03-18T10:00", 4, 1, true);
        seance(&louis, "2026-05-06T17:00", 2, 1, false);

        let stats = calculer(&base, "2026-01-01", "2026-09-30", BaseChiffre::Encaissement).unwrap();
        assert_eq!((stats.du_precedent.as_str(), stats.au_precedent.as_str()), ("2025-01-01", "2025-09-30"));
        assert_eq!(stats.chiffre, Comparaison { valeur: 11_000, precedent: 5_500 });
        assert_eq!(stats.seances, Comparaison { valeur: 3, precedent: 1 });
        assert_eq!(stats.panier_moyen, Comparaison { valeur: 5_500, precedent: 5_500 });
        assert_eq!(stats.nouveaux_patients, Comparaison { valeur: 1, precedent: 1 });
        assert_eq!(stats.par_mois.len(), 9);
        assert_eq!((stats.par_mois[2].chiffre, stats.par_mois[2].chiffre_precedent, stats.par_mois[2].seances), (11_000, 5_500, 2));
        assert_eq!(stats.moyens, vec![ParMoyen { moyen: Moyen::Carte, montant: 11_000, nombre: 2 }]);
        assert_eq!(stats.patients_actifs, 2);
        assert_eq!(stats.sexes, Sexes { femmes: 1, hommes: 1, non_renseigne: 0 });
        assert_eq!(stats.ages.iter().map(|a| a.libelle.as_str()).collect::<Vec<_>>(), ["12 à 17 ans", "30 à 44 ans"]);
        assert_eq!(stats.villes, vec![Compte { libelle: "Fumel".into(), nombre: 2 }]);
        assert_eq!(stats.recence, Recence { moins_6_mois: 1, de_6_a_12_mois: 1, de_1_a_2_ans: 0, plus_2_ans: 1 });
        assert_eq!(stats.actes_gratuits, 1);
        assert_eq!(stats.patients_suivis[0].nom, "Martin");
        let douleur = stats.douleur.unwrap();
        assert_eq!((douleur.seances, douleur.avant, douleur.apres), (3, 13.0 / 3.0, 5.0 / 3.0));
        assert_eq!(stats.jours[2].nombre, 3);

        let par_facture = calculer(&base, "2026-01-01", "2026-09-30", BaseChiffre::Facture).unwrap();
        assert_eq!(par_facture.chiffre.valeur, 11_000);
        assert_eq!(premiere_activite(&base).unwrap().as_deref(), Some("2024-02-10"));
        assert!(calculer(&base, "2026-09-30", "2026-01-01", BaseChiffre::Facture).is_err());
    }

    #[test]
    fn un_an_avant_le_29_fevrier() {
        assert_eq!(un_an_avant(Date::lire("2028-02-29").unwrap()).to_string(), "2027-02-28");
        assert_eq!(age_le(Date::lire("1988-03-14").unwrap(), Date::lire("2026-03-13").unwrap()), 37);
        assert_eq!(age_le(Date::lire("1988-03-14").unwrap(), Date::lire("2026-03-14").unwrap()), 38);
    }
}
