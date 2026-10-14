//! Dossiers patients : identité, coordonnées, profil, situations particulières, remarques.
//!
//! La recherche instantanée et l'alerte de doublons se font dans l'interface, sur la liste
//! complète des résumés : quelques milliers de lignes, sans aller-retour à chaque frappe.
//! Chaque création, modification ou mise aux archives est inscrite au journal.

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;
use crate::numerotation::Date;

/// Statuts proposés tant que le praticien n'a pas réglé les siens.
pub const STATUTS_PAR_DEFAUT: [&str; 3] = ["Nouveau", "Suivi", "Ancien patient"];
pub const PARAMETRE_STATUTS: &str = "patients.statuts";

/// Ce que le praticien saisit dans la fiche. Les champs absents prennent leur valeur vide.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct FichePatient {
    /// « F », « M » ou vide.
    pub sexe: String,
    pub nom: String,
    pub nom_naissance: String,
    pub prenom: String,
    /// `AAAA-MM-JJ`.
    pub naissance: Option<String>,
    pub adresse: String,
    pub complement_adresse: String,
    pub code_postal: String,
    pub ville: String,
    pub pays: String,
    pub portable: String,
    pub fixe: String,
    pub email: String,
    pub profession: String,
    pub retraite: bool,
    pub situation_familiale: String,
    pub enfants: Option<u32>,
    /// « droitier », « gaucher », « ambidextre » ou vide.
    pub lateralite: String,
    pub activites: String,
    pub medecin_traitant: String,
    pub autres_therapeutes: String,
    pub mobilite_reduite: bool,
    pub decede: bool,
    pub statut: String,
    /// Allergie, contre-indication, précaution : affichées en tête du dossier et de chaque séance.
    pub notes_importantes: String,
    pub remarques: String,
    /// Remarques sur les antécédents, saisies dans l'onglet Antécédents.
    pub remarques_antecedents: String,
    /// Date de recueil du consentement au traitement des données, `AAAA-MM-JJ`.
    pub consentement_le: Option<String>,
    /// Identifiants des groupes du patient, triés.
    pub groupes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Patient {
    pub id: String,
    #[serde(flatten)]
    pub fiche: FichePatient,
    pub archive: bool,
    /// Le proche qui reçoit les factures (un parent pour son enfant), sinon le patient lui-même.
    #[serde(default)]
    pub factures_a: Option<String>,
    pub cree_le: i64,
    pub modifie_le: i64,
}

/// Une ligne de la liste des patients, avec ce qu'il faut pour chercher et filtrer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ResumePatient {
    pub id: String,
    pub sexe: String,
    pub nom: String,
    pub nom_naissance: String,
    pub prenom: String,
    pub naissance: Option<String>,
    pub portable: String,
    pub fixe: String,
    pub email: String,
    pub adresse: String,
    pub complement_adresse: String,
    pub code_postal: String,
    pub ville: String,
    pub statut: String,
    pub groupes: Vec<String>,
    pub notes_importantes: String,
    pub decede: bool,
    pub archive: bool,
    pub seances: i64,
    pub derniere_seance: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurPatient {
    #[error("indiquez le nom et le prénom du patient")]
    NomOuPrenomVide,
    #[error("{0}")]
    Champ(&'static str),
    #[error("ce dossier n'existe plus")]
    Introuvable,
    #[error("un des groupes choisis n'existe plus")]
    GroupeIntrouvable,
    #[error(transparent)]
    Aleatoire(#[from] identifiant::ErreurAleatoire),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurPatient {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurPatient {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

/// Espaces en trop retirés, espaces multiples réduits à un seul.
fn propre(texte: &str) -> String {
    texte.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Texte sur plusieurs lignes : seules les fins de texte sont nettoyées.
fn propre_long(texte: &str) -> String {
    texte.trim().replace("\r\n", "\n")
}

fn date_facultative(texte: &Option<String>, erreur: &'static str) -> Result<Option<String>, ErreurPatient> {
    match texte.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(date) => {
            let lue = Date::lire(date).map_err(|_| ErreurPatient::Champ(erreur))?;
            if lue < Date::lire("1900-01-01").unwrap_or(lue) {
                return Err(ErreurPatient::Champ(erreur));
            }
            Ok(Some(date.to_owned()))
        }
    }
}

impl FichePatient {
    pub fn verifier(&self) -> Result<Self, ErreurPatient> {
        let fiche = Self {
            sexe: self.sexe.trim().to_owned(),
            nom: propre(&self.nom),
            nom_naissance: propre(&self.nom_naissance),
            prenom: propre(&self.prenom),
            naissance: date_facultative(&self.naissance, "la date de naissance est invalide")?,
            adresse: propre(&self.adresse),
            complement_adresse: propre(&self.complement_adresse),
            code_postal: self.code_postal.split_whitespace().collect(),
            ville: propre(&self.ville),
            pays: propre(&self.pays),
            portable: propre(&self.portable),
            fixe: propre(&self.fixe),
            email: self.email.trim().to_owned(),
            profession: propre(&self.profession),
            retraite: self.retraite,
            situation_familiale: propre(&self.situation_familiale),
            enfants: self.enfants,
            lateralite: self.lateralite.trim().to_owned(),
            activites: propre_long(&self.activites),
            medecin_traitant: propre(&self.medecin_traitant),
            autres_therapeutes: propre_long(&self.autres_therapeutes),
            mobilite_reduite: self.mobilite_reduite,
            decede: self.decede,
            statut: propre(&self.statut),
            notes_importantes: propre_long(&self.notes_importantes),
            remarques: propre_long(&self.remarques),
            remarques_antecedents: propre_long(&self.remarques_antecedents),
            consentement_le: date_facultative(&self.consentement_le, "la date du consentement est invalide")?,
            groupes: {
                let mut groupes: Vec<String> = self.groupes.iter().map(|g| g.trim().to_owned()).filter(|g| !g.is_empty()).collect();
                groupes.sort();
                groupes.dedup();
                groupes
            },
        };
        if fiche.nom.is_empty() || fiche.prenom.is_empty() {
            return Err(ErreurPatient::NomOuPrenomVide);
        }
        if !["", "F", "M"].contains(&fiche.sexe.as_str()) {
            return Err(ErreurPatient::Champ("sexe inconnu"));
        }
        if !["", "droitier", "gaucher", "ambidextre"].contains(&fiche.lateralite.as_str()) {
            return Err(ErreurPatient::Champ("latéralité inconnue"));
        }
        // Le lendemain reste admis : l'horloge est en temps universel, le praticien en heure locale.
        if let Some(naissance) = &fiche.naissance
            && Date::lire(naissance).is_ok_and(|n| n > Date::du_jour_utc(1))
        {
            return Err(ErreurPatient::Champ("la date de naissance est dans le futur"));
        }
        let francais = fiche.pays.is_empty() || fiche.pays.eq_ignore_ascii_case("france");
        if francais && !fiche.code_postal.is_empty() && !(fiche.code_postal.len() == 5 && fiche.code_postal.bytes().all(|o| o.is_ascii_digit())) {
            return Err(ErreurPatient::Champ("le code postal compte 5 chiffres"));
        }
        if !fiche.email.is_empty() {
            let valide = fiche
                .email
                .split_once('@')
                .is_some_and(|(avant, apres)| !avant.is_empty() && apres.contains('.') && !apres.starts_with('.') && !apres.ends_with('.'));
            if !valide {
                return Err(ErreurPatient::Champ("l'adresse email semble incomplète"));
            }
        }
        Ok(fiche)
    }
}

/// Colonnes de la fiche, dans l'ordre des valeurs passées par `ecrire`.
const COLONNES: [&str; 28] = [
    "sexe",
    "nom",
    "nom_naissance",
    "prenom",
    "naissance",
    "adresse",
    "complement_adresse",
    "code_postal",
    "ville",
    "pays",
    "portable",
    "fixe",
    "email",
    "profession",
    "retraite",
    "situation_familiale",
    "enfants",
    "lateralite",
    "activites",
    "medecin_traitant",
    "autres_therapeutes",
    "mobilite_reduite",
    "decede",
    "statut",
    "notes_importantes",
    "remarques",
    "remarques_antecedents",
    "consentement_le",
];

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<Patient> {
    Ok(Patient {
        id: ligne.get("id")?,
        fiche: FichePatient {
            sexe: ligne.get("sexe")?,
            nom: ligne.get("nom")?,
            nom_naissance: ligne.get("nom_naissance")?,
            prenom: ligne.get("prenom")?,
            naissance: ligne.get("naissance")?,
            adresse: ligne.get("adresse")?,
            complement_adresse: ligne.get("complement_adresse")?,
            code_postal: ligne.get("code_postal")?,
            ville: ligne.get("ville")?,
            pays: ligne.get("pays")?,
            portable: ligne.get("portable")?,
            fixe: ligne.get("fixe")?,
            email: ligne.get("email")?,
            profession: ligne.get("profession")?,
            retraite: ligne.get("retraite")?,
            situation_familiale: ligne.get("situation_familiale")?,
            enfants: ligne.get("enfants")?,
            lateralite: ligne.get("lateralite")?,
            activites: ligne.get("activites")?,
            medecin_traitant: ligne.get("medecin_traitant")?,
            autres_therapeutes: ligne.get("autres_therapeutes")?,
            mobilite_reduite: ligne.get("mobilite_reduite")?,
            decede: ligne.get("decede")?,
            statut: ligne.get("statut")?,
            notes_importantes: ligne.get("notes_importantes")?,
            remarques: ligne.get("remarques")?,
            remarques_antecedents: ligne.get("remarques_antecedents")?,
            consentement_le: ligne.get("consentement_le")?,
            groupes: Vec::new(),
        },
        archive: ligne.get::<_, Option<i64>>("archive_le")?.is_some(),
        factures_a: ligne.get("factures_a")?,
        cree_le: ligne.get("cree_le")?,
        modifie_le: ligne.get("modifie_le")?,
    })
}

pub fn lire(base: &Base, id: &str) -> Result<Patient, ErreurPatient> {
    let mut patient = base
        .connexion()
        .query_row("SELECT * FROM patients WHERE id = ?1", [id], depuis_ligne)
        .optional()?
        .ok_or(ErreurPatient::Introuvable)?;
    let mut requete = base.connexion().prepare("SELECT groupe_id FROM patients_groupes WHERE patient_id = ?1 ORDER BY groupe_id")?;
    patient.fiche.groupes = requete.query_map([id], |l| l.get(0))?.collect::<Result<_, _>>()?;
    Ok(patient)
}

fn ecrire(base: &Base, id: &str, fiche: &FichePatient, cree_le: i64) -> Result<(), ErreurPatient> {
    let f = fiche;
    let valeurs: [&dyn rusqlite::ToSql; 28] = [
        &f.sexe,
        &f.nom,
        &f.nom_naissance,
        &f.prenom,
        &f.naissance,
        &f.adresse,
        &f.complement_adresse,
        &f.code_postal,
        &f.ville,
        &f.pays,
        &f.portable,
        &f.fixe,
        &f.email,
        &f.profession,
        &f.retraite,
        &f.situation_familiale,
        &f.enfants,
        &f.lateralite,
        &f.activites,
        &f.medecin_traitant,
        &f.autres_therapeutes,
        &f.mobilite_reduite,
        &f.decede,
        &f.statut,
        &f.notes_importantes,
        &f.remarques,
        &f.remarques_antecedents,
        &f.consentement_le,
    ];
    let maintenant = maintenant();
    let mut parametres: Vec<&dyn rusqlite::ToSql> = vec![&id];
    parametres.extend(valeurs);
    parametres.extend([&cree_le as &dyn rusqlite::ToSql, &maintenant]);
    let places: Vec<String> = (1..=parametres.len()).map(|n| format!("?{n}")).collect();
    let mises_a_jour: Vec<String> = COLONNES.iter().map(|c| format!("{c} = excluded.{c}")).collect();
    base.connexion().execute(
        &format!(
            "INSERT INTO patients (id, {}, cree_le, modifie_le) VALUES ({})
             ON CONFLICT (id) DO UPDATE SET {}, modifie_le = excluded.modifie_le",
            COLONNES.join(", "),
            places.join(", "),
            mises_a_jour.join(", "),
        ),
        parametres.as_slice(),
    )?;
    base.connexion().execute("DELETE FROM patients_groupes WHERE patient_id = ?1", [id])?;
    for groupe in &f.groupes {
        let existe: bool = base.connexion().query_row("SELECT EXISTS (SELECT 1 FROM groupes WHERE id = ?1)", [groupe], |l| l.get(0))?;
        if !existe {
            return Err(ErreurPatient::GroupeIntrouvable);
        }
        base.connexion().execute("INSERT INTO patients_groupes (patient_id, groupe_id) VALUES (?1, ?2)", [id, groupe])?;
    }
    Ok(())
}

fn journaliser(base: &Base, action: &str, avant: Option<&Patient>, apres: &Patient) -> Result<(), ErreurPatient> {
    let avant = avant.map(serde_json::to_string).transpose()?;
    base.journaliser(action, &apres.id, avant.as_deref(), Some(&serde_json::to_string(apres)?))?;
    Ok(())
}

pub fn creer(base: &Base, fiche: &FichePatient) -> Result<Patient, ErreurPatient> {
    let fiche = fiche.verifier()?;
    let id = identifiant::nouveau()?;
    base.atomique(|| {
        ecrire(base, &id, &fiche, maintenant())?;
        let patient = lire(base, &id)?;
        journaliser(base, "patient.cree", None, &patient)?;
        Ok(patient)
    })
}

pub fn modifier(base: &Base, id: &str, fiche: &FichePatient) -> Result<Patient, ErreurPatient> {
    let fiche = fiche.verifier()?;
    let avant = lire(base, id)?;
    if avant.fiche == fiche {
        return Ok(avant);
    }
    base.atomique(|| {
        ecrire(base, id, &fiche, avant.cree_le)?;
        let apres = lire(base, id)?;
        journaliser(base, "patient.modifie", Some(&avant), &apres)?;
        Ok(apres)
    })
}

/// Met le dossier aux archives ou l'en sort. Un dossier archivé reste consultable et cherchable.
pub fn archiver(base: &Base, id: &str, archive: bool) -> Result<Patient, ErreurPatient> {
    let avant = lire(base, id)?;
    if avant.archive == archive {
        return Ok(avant);
    }
    base.connexion().execute(
        "UPDATE patients SET archive_le = ?2, modifie_le = ?3 WHERE id = ?1",
        rusqlite::params![id, archive.then(maintenant), maintenant()],
    )?;
    let apres = lire(base, id)?;
    journaliser(base, if archive { "patient.archive" } else { "patient.desarchive" }, Some(&avant), &apres)?;
    Ok(apres)
}

/// Tous les dossiers, archives comprises, par nom puis prénom.
pub fn lister(base: &Base) -> Result<Vec<ResumePatient>, ErreurPatient> {
    let mut requete = base.connexion().prepare(
        "SELECT id, sexe, nom, nom_naissance, prenom, naissance, portable, fixe, email, adresse, complement_adresse, code_postal,
                ville, statut, notes_importantes, decede, archive_le,
                (SELECT group_concat(groupe_id, ',') FROM patients_groupes g WHERE g.patient_id = p.id) AS groupes,
                (SELECT COUNT(*) FROM seances s WHERE s.patient_id = p.id AND s.supprimee_le IS NULL) AS nombre_seances,
                (SELECT substr(MAX(s.debut), 1, 10) FROM seances s WHERE s.patient_id = p.id AND s.supprimee_le IS NULL)
                  AS derniere_seance
         FROM patients p ORDER BY nom COLLATE NOCASE, prenom COLLATE NOCASE",
    )?;
    let lignes = requete.query_map([], |l| {
        Ok(ResumePatient {
            id: l.get("id")?,
            sexe: l.get("sexe")?,
            nom: l.get("nom")?,
            nom_naissance: l.get("nom_naissance")?,
            prenom: l.get("prenom")?,
            naissance: l.get("naissance")?,
            portable: l.get("portable")?,
            fixe: l.get("fixe")?,
            email: l.get("email")?,
            adresse: l.get("adresse")?,
            complement_adresse: l.get("complement_adresse")?,
            code_postal: l.get("code_postal")?,
            ville: l.get("ville")?,
            statut: l.get("statut")?,
            groupes: {
                let mut groupes: Vec<String> =
                    l.get::<_, Option<String>>("groupes")?.unwrap_or_default().split(',').filter(|g| !g.is_empty()).map(str::to_owned).collect();
                groupes.sort();
                groupes
            },
            notes_importantes: l.get("notes_importantes")?,
            decede: l.get("decede")?,
            archive: l.get::<_, Option<i64>>("archive_le")?.is_some(),
            seances: l.get("nombre_seances")?,
            derniere_seance: l.get("derniere_seance")?,
        })
    })?;
    Ok(lignes.collect::<Result<_, _>>()?)
}

/// Statuts proposés dans la fiche : ceux du praticien, sinon ceux par défaut.
pub fn statuts(base: &Base) -> Result<Vec<String>, ErreurPatient> {
    Ok(base
        .lire_parametre::<Vec<String>>(PARAMETRE_STATUTS)?
        .unwrap_or_else(|| STATUTS_PAR_DEFAUT.iter().map(|s| s.to_string()).collect()))
}

/// Un statut de la liste réglée par le praticien : `ancien` est son nom d'avant, absent s'il est nouveau.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct StatutSaisi {
    pub ancien: Option<String>,
    pub nom: String,
}

/// Remplace la liste des statuts, dans l'ordre donné. Un statut renommé l'est aussi dans les
/// dossiers ; un statut retiré de la liste est retiré des dossiers qui le portaient.
pub fn enregistrer_statuts(base: &Base, saisis: &[StatutSaisi]) -> Result<Vec<String>, ErreurPatient> {
    let avant = statuts(base)?;
    let mut liste: Vec<String> = Vec::new();
    for saisi in saisis {
        let nom = propre(&saisi.nom);
        if nom.is_empty() {
            return Err(ErreurPatient::Champ("indiquez le nom de chaque statut"));
        }
        if nom.chars().count() > 40 {
            return Err(ErreurPatient::Champ("le nom d'un statut est trop long"));
        }
        if liste.iter().any(|s| s.to_lowercase() == nom.to_lowercase()) {
            return Err(ErreurPatient::Champ("deux statuts portent le même nom"));
        }
        liste.push(nom);
    }
    let gardes: Vec<(&String, &String)> = saisis
        .iter()
        .zip(&liste)
        .filter_map(|(saisi, nom)| saisi.ancien.as_ref().filter(|a| avant.contains(a)).map(|a| (a, nom)))
        .collect();
    base.atomique(|| {
        for retire in avant.iter().filter(|a| !gardes.iter().any(|(ancien, _)| ancien == a)) {
            base.connexion().execute("UPDATE patients SET statut = '' WHERE statut = ?1", [retire])?;
        }
        // En deux temps, pour que deux statuts puissent échanger leurs noms.
        let renommes: Vec<_> = gardes.iter().filter(|(ancien, nom)| ancien != nom).collect();
        for (rang, (ancien, _)) in renommes.iter().enumerate() {
            base.connexion().execute("UPDATE patients SET statut = ?2 WHERE statut = ?1", [ancien.as_str(), &format!("\u{1}{rang}")])?;
        }
        for (rang, (_, nom)) in renommes.iter().enumerate() {
            base.connexion().execute("UPDATE patients SET statut = ?2 WHERE statut = ?1", [&format!("\u{1}{rang}"), nom.as_str()])?;
        }
        base.ecrire_parametre(PARAMETRE_STATUTS, &liste)?;
        base.journaliser("patients.statuts", PARAMETRE_STATUTS, Some(&serde_json::to_string(&avant)?), Some(&serde_json::to_string(&liste)?))?;
        Ok::<_, ErreurPatient>(())
    })?;
    Ok(liste)
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

    fn camille() -> FichePatient {
        FichePatient {
            sexe: "F".into(),
            nom: "  Martin ".into(),
            prenom: "Camille".into(),
            naissance: Some("1988-03-14".into()),
            adresse: "12 rue des   Tilleuls".into(),
            code_postal: "47 500".into(),
            ville: "Fumel".into(),
            portable: "06 00 00 00 00".into(),
            email: "camille.martin@exemple.fr".into(),
            lateralite: "droitier".into(),
            notes_importantes: "Allergie aux AINS\n".into(),
            statut: "Suivi".into(),
            ..Default::default()
        }
    }

    #[test]
    fn cree_relit_et_nettoie_la_fiche() {
        let (_dossier, base) = base();
        let patient = creer(&base, &camille()).unwrap();
        assert_eq!(patient.fiche.nom, "Martin");
        assert_eq!(patient.fiche.adresse, "12 rue des Tilleuls");
        assert_eq!(patient.fiche.code_postal, "47500");
        assert_eq!(patient.fiche.notes_importantes, "Allergie aux AINS");
        assert!(!patient.archive);
        assert_eq!(lire(&base, &patient.id).unwrap(), patient);
        let liste = lister(&base).unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].prenom, "Camille");
        assert_eq!(liste[0].notes_importantes, "Allergie aux AINS");
    }

    #[test]
    fn refuse_une_fiche_incomplete_ou_incoherente() {
        let erreur = |fiche: FichePatient| fiche.verifier().unwrap_err().to_string();
        assert_eq!(erreur(FichePatient { prenom: " ".into(), ..camille() }), "indiquez le nom et le prénom du patient");
        assert_eq!(erreur(FichePatient { naissance: Some("1988-02-30".into()), ..camille() }), "la date de naissance est invalide");
        assert_eq!(erreur(FichePatient { naissance: Some("2999-01-01".into()), ..camille() }), "la date de naissance est dans le futur");
        assert_eq!(erreur(FichePatient { code_postal: "4750".into(), ..camille() }), "le code postal compte 5 chiffres");
        assert_eq!(erreur(FichePatient { email: "camille@exemple".into(), ..camille() }), "l'adresse email semble incomplète");
        assert_eq!(erreur(FichePatient { lateralite: "les deux".into(), ..camille() }), "latéralité inconnue");
        // Code postal étranger : libre.
        assert!(FichePatient { pays: "Belgique".into(), code_postal: "1000".into(), ..camille() }.verifier().is_ok());
        // Date vide : pas de date.
        assert_eq!(FichePatient { naissance: Some(" ".into()), ..camille() }.verifier().unwrap().naissance, None);
    }

    #[test]
    fn modifie_archive_et_journalise() {
        let (_dossier, base) = base();
        let patient = creer(&base, &camille()).unwrap();
        let modifie = modifier(&base, &patient.id, &FichePatient { profession: "Infirmière".into(), ..camille() }).unwrap();
        assert_eq!(modifie.fiche.profession, "Infirmière");
        assert_eq!(modifie.cree_le, patient.cree_le);
        // Rien de changé : rien au journal.
        modifier(&base, &patient.id, &FichePatient { profession: "Infirmière".into(), ..camille() }).unwrap();
        assert!(archiver(&base, &patient.id, true).unwrap().archive);
        assert!(lister(&base).unwrap()[0].archive);
        assert!(!archiver(&base, &patient.id, false).unwrap().archive);

        let actions: Vec<String> = base
            .connexion()
            .prepare("SELECT action FROM journal WHERE entite = ?1 ORDER BY id")
            .unwrap()
            .query_map([&patient.id], |l| l.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actions, ["patient.cree", "patient.modifie", "patient.archive", "patient.desarchive"]);
        assert!(matches!(lire(&base, "inconnu"), Err(ErreurPatient::Introuvable)));
    }

    #[test]
    fn statuts_par_defaut_puis_ceux_du_praticien() {
        let (_dossier, base) = base();
        assert_eq!(statuts(&base).unwrap(), STATUTS_PAR_DEFAUT);
        base.ecrire_parametre(PARAMETRE_STATUTS, &["Suivi", "Archivé"]).unwrap();
        assert_eq!(statuts(&base).unwrap(), ["Suivi", "Archivé"]);
    }

    #[test]
    fn renomme_echange_et_retire_les_statuts_dans_les_dossiers() {
        let (_dossier, base) = base();
        let avec = |prenom: &str, statut: &str| creer(&base, &FichePatient { prenom: prenom.into(), statut: statut.into(), ..camille() }).unwrap().id;
        let (nouveau, suivi, ancien, importe) = (avec("A", "Nouveau"), avec("B", "Suivi"), avec("C", "Ancien patient"), avec("D", "Importé"));
        let saisi = |ancien: Option<&str>, nom: &str| StatutSaisi { ancien: ancien.map(str::to_owned), nom: nom.into() };
        let liste = enregistrer_statuts(&base, &[saisi(Some("Nouveau"), "Suivi"), saisi(Some("Suivi"), "Nouveau"), saisi(None, " Bilan  annuel ")]).unwrap();
        assert_eq!(liste, ["Suivi", "Nouveau", "Bilan annuel"]);
        assert_eq!(statuts(&base).unwrap(), liste);
        let statut = |id: &str| lire(&base, id).unwrap().fiche.statut;
        assert_eq!(statut(&nouveau), "Suivi");
        assert_eq!(statut(&suivi), "Nouveau");
        assert_eq!(statut(&ancien), "");
        // Un statut qui n'était pas dans la liste (repris d'un import) ne bouge pas.
        assert_eq!(statut(&importe), "Importé");

        let erreur = |saisis: &[StatutSaisi]| enregistrer_statuts(&base, saisis).unwrap_err().to_string();
        assert_eq!(erreur(&[saisi(None, "Suivi"), saisi(None, "suivi")]), "deux statuts portent le même nom");
        assert_eq!(erreur(&[saisi(None, " ")]), "indiquez le nom de chaque statut");
        assert_eq!(statuts(&base).unwrap(), liste);
    }
}
