//! Facturation : factures et avoirs numérotés, règlements, recettes.
//!
//! Une facture naît brouillon, modifiable et sans numéro. À l'émission, elle reçoit le numéro
//! suivant (continu, chronologique) et l'identité du cabinet du jour : elle ne change plus,
//! sauf son commentaire interne et ses règlements. Corriger émet un avoir qui l'annule et une
//! facture rectificative où ses règlements sont reportés, sans double compte ; annuler émet
//! seulement l'avoir. Factures et avoirs partagent la même numérotation.

use rusqlite::types::Type;
use rusqlite::{OptionalExtension, Row};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::base::{Base, ErreurBase, maintenant};
use crate::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
use crate::identifiant;
use crate::numerotation::{self, Date, ErreurNumerotation, EtatAnnee, FormatNumero, NumeroFacture, Reserve};
use crate::patients::{self, Patient};

pub const PARAMETRE_NUMEROTATION: &str = "facturation.numerotation";
const MONTANT_MAX: i64 = 10_000_000;
const LIGNES_MAX: usize = 50;
const COMMENTAIRE_MAX: usize = 2000;

/// Compteur de la première facture d'une année, pour qui change de logiciel en cours d'année
/// sans importer son historique.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompteurDepart {
    pub annee: i32,
    pub compteur: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ReglagesNumerotation {
    pub format: FormatNumero,
    pub depart: Option<CompteurDepart>,
}

impl ReglagesNumerotation {
    pub fn verifier(&self) -> Result<Self, ErreurFacture> {
        let modele = self.format.modele.trim().to_owned();
        if !modele.contains("{N}") {
            return Err(ErreurNumerotation::ModeleSansCompteur.into());
        }
        // Le compteur repart chaque année : sans l'année, deux factures auraient le même numéro.
        if !modele.contains("{AAAA}") && !modele.contains("{AA}") {
            return Err(ErreurFacture::Invalide("le modèle de numéro doit contenir l'année, {AAAA} ou {AA}"));
        }
        if modele.chars().count() > 40 {
            return Err(ErreurFacture::Invalide("le modèle de numéro est trop long"));
        }
        if !(1..=8).contains(&self.format.chiffres) {
            return Err(ErreurFacture::Invalide("le compteur compte de 1 à 8 chiffres"));
        }
        if let Some(depart) = self.depart
            && (depart.compteur == 0 || depart.compteur > 99_999_999 || !(2000..=2100).contains(&depart.annee))
        {
            return Err(ErreurFacture::Invalide("compteur de départ impossible"));
        }
        Ok(Self { format: FormatNumero { modele, chiffres: self.format.chiffres }, depart: self.depart })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Nature {
    Facture,
    Avoir,
}

impl Nature {
    fn texte(self) -> &'static str {
        match self {
            Self::Facture => "facture",
            Self::Avoir => "avoir",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EtatFacture {
    Brouillon,
    Emise,
    /// Annulée par un avoir, et remplacée par une facture rectificative si elle a été corrigée.
    Annulee,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Moyen {
    #[default]
    Carte,
    Cheque,
    Especes,
    Virement,
    Autre,
}

impl Moyen {
    pub const TOUS: [Self; 5] = [Self::Carte, Self::Cheque, Self::Especes, Self::Virement, Self::Autre];

    pub fn texte(self) -> &'static str {
        match self {
            Self::Carte => "carte",
            Self::Cheque => "cheque",
            Self::Especes => "especes",
            Self::Virement => "virement",
            Self::Autre => "autre",
        }
    }

    fn depuis(texte: &str) -> Self {
        Self::TOUS.into_iter().find(|m| m.texte() == texte).unwrap_or(Self::Autre)
    }

    /// « par carte », « en espèces » : pour la facture imprimée.
    pub fn en_lettres(self) -> &'static str {
        match self {
            Self::Carte => "par carte",
            Self::Cheque => "par chèque",
            Self::Especes => "en espèces",
            Self::Virement => "par virement",
            Self::Autre => "par un autre moyen",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Destinataire {
    pub civilite: String,
    pub prenom: String,
    pub nom: String,
    /// Une ou deux lignes.
    pub adresse: String,
    pub code_postal: String,
    pub ville: String,
    /// Le patient soigné, quand la facture est adressée à un autre que lui (un parent) : « Lucas Martin ».
    pub patient: String,
}

impl Destinataire {
    /// Le patient lui-même, d'après sa fiche.
    pub fn du_patient(patient: &Patient) -> Self {
        let f = &patient.fiche;
        Self {
            civilite: match f.sexe.as_str() {
                "F" => "Mme",
                "M" => "M.",
                _ => "",
            }
            .into(),
            prenom: f.prenom.clone(),
            nom: f.nom.clone(),
            adresse: [f.adresse.trim(), f.complement_adresse.trim()].into_iter().filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n"),
            code_postal: f.code_postal.clone(),
            ville: f.ville.clone(),
            patient: String::new(),
        }
    }

    /// Le proche qui reçoit les factures du patient (un parent), avec le nom du patient ; sinon le patient.
    pub fn pour(patient: &Patient, payeur: Option<&Patient>) -> Self {
        match payeur {
            Some(payeur) => Self { patient: format!("{} {}", patient.fiche.prenom, patient.fiche.nom).trim().to_owned(), ..Self::du_patient(payeur) },
            None => Self::du_patient(patient),
        }
    }

    /// Le destinataire des factures du patient, d'après sa fiche et ses proches.
    pub fn des_factures(base: &Base, patient: &Patient) -> Self {
        let payeur = patient.factures_a.as_deref().and_then(|id| patients::lire(base, id).ok());
        Self::pour(patient, payeur.as_ref())
    }

    /// « Camille Martin »
    pub fn nom_complet(&self) -> String {
        [self.prenom.trim(), self.nom.trim()].into_iter().filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" ")
    }

    fn verifier(&self) -> Result<Self, ErreurFacture> {
        let d = Self {
            civilite: propre(&self.civilite),
            prenom: propre(&self.prenom),
            nom: propre(&self.nom),
            adresse: self.adresse.lines().map(propre).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n"),
            code_postal: propre(&self.code_postal),
            ville: propre(&self.ville),
            patient: propre(&self.patient),
        };
        if d.nom.is_empty() {
            return Err(ErreurFacture::Invalide("indiquez le nom du destinataire de la facture"));
        }
        if [&d.civilite, &d.prenom, &d.nom, &d.code_postal, &d.ville, &d.patient].iter().any(|t| t.chars().count() > 120) || d.adresse.chars().count() > 300 {
            return Err(ErreurFacture::Invalide("le destinataire est trop long"));
        }
        Ok(d)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct LigneFacture {
    pub prestation_id: Option<String>,
    pub designation: String,
    pub quantite: u32,
    pub prix_unitaire_centimes: i64,
    /// Remise accordée sur la ligne, en centimes.
    pub reduction_centimes: i64,
}

impl LigneFacture {
    pub fn montant(&self) -> Option<i64> {
        self.prix_unitaire_centimes.checked_mul(i64::from(self.quantite))?.checked_sub(self.reduction_centimes)
    }

    fn verifier(&self) -> Result<Self, ErreurFacture> {
        let ligne = Self { designation: propre(&self.designation), ..self.clone() };
        if ligne.designation.is_empty() {
            return Err(ErreurFacture::Invalide("chaque ligne de la facture a besoin d'une désignation"));
        }
        if ligne.designation.chars().count() > 200 {
            return Err(ErreurFacture::Invalide("la désignation est trop longue"));
        }
        if !(1..=999).contains(&ligne.quantite) {
            return Err(ErreurFacture::Invalide("quantité impossible"));
        }
        if !(0..=MONTANT_MAX).contains(&ligne.prix_unitaire_centimes) {
            return Err(ErreurFacture::Invalide("prix impossible"));
        }
        let brut = ligne.prix_unitaire_centimes * i64::from(ligne.quantite);
        if ligne.reduction_centimes < 0 || ligne.reduction_centimes > brut {
            return Err(ErreurFacture::Invalide("la réduction dépasse le montant de la ligne"));
        }
        Ok(ligne)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaisieFacture {
    pub patient_id: Option<String>,
    pub seance_id: Option<String>,
    /// `AAAA-MM-JJ`, imprimée sous la date d'émission.
    pub date_seance: Option<String>,
    pub destinataire: Destinataire,
    pub lignes: Vec<LigneFacture>,
    pub commentaire_imprime: String,
    /// Jamais imprimé.
    pub commentaire_interne: String,
}

impl SaisieFacture {
    /// Rend la saisie nettoyée et son total.
    pub fn verifier(&self) -> Result<(Self, i64), ErreurFacture> {
        if self.lignes.is_empty() {
            return Err(ErreurFacture::Invalide("une facture compte au moins une ligne"));
        }
        if self.lignes.len() > LIGNES_MAX {
            return Err(ErreurFacture::Invalide("trop de lignes sur cette facture"));
        }
        let lignes = self.lignes.iter().map(LigneFacture::verifier).collect::<Result<Vec<_>, _>>()?;
        let total = lignes
            .iter()
            .try_fold(0i64, |total, l| total.checked_add(l.montant()?))
            .filter(|t| *t <= MONTANT_MAX)
            .ok_or(ErreurFacture::Invalide("montant trop élevé"))?;
        let date_seance = match self.date_seance.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(date) => Some(date_valide(date)?.to_string()),
        };
        let commentaire = |t: &str| -> Result<String, ErreurFacture> {
            let t = t.trim().replace("\r\n", "\n");
            if t.chars().count() > COMMENTAIRE_MAX {
                return Err(ErreurFacture::Invalide("le commentaire est trop long"));
            }
            Ok(t)
        };
        let saisie = Self {
            patient_id: self.patient_id.clone().filter(|id| !id.is_empty()),
            seance_id: self.seance_id.clone().filter(|id| !id.is_empty()),
            date_seance,
            destinataire: self.destinataire.verifier()?,
            lignes,
            commentaire_imprime: commentaire(&self.commentaire_imprime)?,
            commentaire_interne: commentaire(&self.commentaire_interne)?,
        };
        Ok((saisie, total))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaisieReglement {
    pub moyen: Moyen,
    /// Négatif pour un remboursement.
    pub montant_centimes: i64,
    /// `AAAA-MM-JJ`.
    pub encaisse_le: String,
    /// Numéro du chèque, référence du virement.
    pub reference: String,
    /// Quand ce n'est pas le patient qui règle.
    pub payeur: String,
    /// Jamais imprimé.
    pub commentaire: String,
}

impl SaisieReglement {
    pub fn verifier(&self) -> Result<Self, ErreurFacture> {
        let r = Self {
            encaisse_le: date_valide(self.encaisse_le.trim())?.to_string(),
            reference: propre(&self.reference),
            payeur: propre(&self.payeur),
            commentaire: self.commentaire.trim().to_owned(),
            ..self.clone()
        };
        if r.montant_centimes == 0 || r.montant_centimes.abs() > MONTANT_MAX {
            return Err(ErreurFacture::Invalide("montant du règlement impossible"));
        }
        if r.reference.chars().count() > 100 || r.payeur.chars().count() > 120 || r.commentaire.chars().count() > 500 {
            return Err(ErreurFacture::Invalide("le règlement est trop long"));
        }
        Ok(r)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Reglement {
    pub id: String,
    pub facture_id: String,
    #[serde(flatten)]
    pub saisie: SaisieReglement,
    pub importe: bool,
    pub cree_le: i64,
    pub modifie_le: i64,
}

/// Une autre facture citée : celle qu'un avoir annule, celle qu'une rectificative remplace…
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Renvoi {
    pub id: String,
    pub numero: String,
    pub date_emission: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Facture {
    pub id: String,
    pub nature: Nature,
    pub etat: EtatFacture,
    pub numero: Option<String>,
    pub date_emission: Option<String>,
    #[serde(flatten)]
    pub saisie: SaisieFacture,
    /// Négatif pour un avoir.
    pub total_centimes: i64,
    pub regle_centimes: i64,
    /// Ce qui reste dû : seulement pour une facture émise. Négatif s'il y a un trop-perçu.
    pub reste_centimes: i64,
    /// Pour un avoir : ce qui peut encore être remboursé, d'après les règlements restés sur la
    /// facture annulée. Zéro si elle n'avait pas été réglée, ou si ses règlements sont reportés.
    pub remboursable_centimes: i64,
    /// Identité du cabinet au jour de l'émission.
    pub praticien: Option<IdentiteCabinet>,
    /// Pour un avoir, la facture annulée ; pour une facture rectificative, celle qu'elle remplace.
    pub origine: Option<Renvoi>,
    /// Pour une facture annulée : l'avoir qui l'annule.
    pub avoir: Option<Renvoi>,
    /// Pour une facture corrigée : la facture rectificative.
    pub rectificative: Option<Renvoi>,
    pub reglements: Vec<Reglement>,
    pub importee: bool,
    pub cree_le: i64,
    pub modifie_le: i64,
}

/// Une ligne des listes de factures.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ResumeFacture {
    pub id: String,
    pub nature: Nature,
    pub etat: EtatFacture,
    pub numero: Option<String>,
    pub date_emission: Option<String>,
    pub patient_id: Option<String>,
    pub patient_nom: String,
    pub patient_prenom: String,
    pub destinataire: String,
    pub seance_id: Option<String>,
    pub date_seance: Option<String>,
    /// Première ligne, suivie de « … » s'il y en a d'autres.
    pub designation: String,
    pub total_centimes: i64,
    pub regle_centimes: i64,
    pub reste_centimes: i64,
    pub moyens: Vec<Moyen>,
    pub origine_numero: Option<String>,
    pub importee: bool,
}

/// Une ligne du journal des recettes : un règlement encaissé.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LigneRecette {
    pub id: String,
    pub facture_id: String,
    pub facture_numero: Option<String>,
    pub facture_date: Option<String>,
    pub nature: Nature,
    pub patient_id: Option<String>,
    /// Le patient, sinon le destinataire de la facture.
    pub nom: String,
    #[serde(flatten)]
    pub reglement: SaisieReglement,
    pub importe: bool,
}

/// Une ligne de l'historique d'une facture.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EvenementFacture {
    pub le: i64,
    pub action: String,
    pub numero: Option<String>,
    pub montant_centimes: Option<i64>,
    pub moyen: Option<Moyen>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurFacture {
    #[error("{0}")]
    Invalide(&'static str),
    #[error("{0}")]
    Refus(String),
    #[error("cette facture n'existe plus")]
    Introuvable,
    #[error("mentions obligatoires à compléter dans Paramètres › Cabinet avant d'émettre : {0}")]
    MentionsManquantes(String),
    #[error(transparent)]
    Numerotation(#[from] ErreurNumerotation),
    #[error(transparent)]
    Aleatoire(#[from] identifiant::ErreurAleatoire),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurFacture {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurFacture {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<patients::ErreurPatient> for ErreurFacture {
    fn from(erreur: patients::ErreurPatient) -> Self {
        match erreur {
            patients::ErreurPatient::Base(e) => Self::Base(e),
            autre => Self::Refus(autre.to_string()),
        }
    }
}

fn propre(texte: &str) -> String {
    texte.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn date_valide(texte: &str) -> Result<Date, ErreurFacture> {
    Date::lire(texte).ok().filter(|d| d.annee() >= 1990).ok_or(ErreurFacture::Invalide("date invalide"))
}

fn json<T: DeserializeOwned>(ligne: &Row<'_>, colonne: &str) -> rusqlite::Result<T> {
    let texte: String = ligne.get(colonne)?;
    serde_json::from_str(&texte).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(e)))
}

fn nature_de(ligne: &Row<'_>) -> rusqlite::Result<Nature> {
    Ok(if ligne.get::<_, String>("nature")? == "avoir" { Nature::Avoir } else { Nature::Facture })
}

fn etat_de(ligne: &Row<'_>) -> rusqlite::Result<EtatFacture> {
    Ok(match ligne.get::<_, String>("etat")?.as_str() {
        "brouillon" => EtatFacture::Brouillon,
        "annulee" => EtatFacture::Annulee,
        _ => EtatFacture::Emise,
    })
}

fn reste(nature: Nature, etat: EtatFacture, total: i64, regle: i64) -> i64 {
    if nature == Nature::Facture && etat == EtatFacture::Emise { total - regle } else { 0 }
}

/// Facture lue sans ses règlements ni ses renvois, et l'identifiant de son origine.
fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<(Facture, Option<String>)> {
    let praticien: Option<String> = ligne.get("praticien")?;
    let praticien = praticien
        .map(|t| serde_json::from_str(&t))
        .transpose()
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(e)))?;
    Ok((
        Facture {
            id: ligne.get("id")?,
            nature: nature_de(ligne)?,
            etat: etat_de(ligne)?,
            numero: ligne.get("numero")?,
            date_emission: ligne.get("date_emission")?,
            saisie: SaisieFacture {
                patient_id: ligne.get("patient_id")?,
                seance_id: ligne.get("seance_id")?,
                date_seance: ligne.get("date_seance")?,
                destinataire: json(ligne, "destinataire")?,
                lignes: json(ligne, "lignes")?,
                commentaire_imprime: ligne.get("commentaire_imprime")?,
                commentaire_interne: ligne.get("commentaire_interne")?,
            },
            total_centimes: ligne.get("total_centimes")?,
            regle_centimes: 0,
            reste_centimes: 0,
            remboursable_centimes: 0,
            praticien,
            origine: None,
            avoir: None,
            rectificative: None,
            reglements: Vec::new(),
            importee: ligne.get("importee")?,
            cree_le: ligne.get("cree_le")?,
            modifie_le: ligne.get("modifie_le")?,
        },
        ligne.get("origine_id")?,
    ))
}

fn reglement_depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<Reglement> {
    Ok(Reglement {
        id: ligne.get("id")?,
        facture_id: ligne.get("facture_id")?,
        saisie: SaisieReglement {
            moyen: Moyen::depuis(&ligne.get::<_, String>("moyen")?),
            montant_centimes: ligne.get("montant_centimes")?,
            encaisse_le: ligne.get("encaisse_le")?,
            reference: ligne.get("reference")?,
            payeur: ligne.get("payeur")?,
            commentaire: ligne.get("commentaire")?,
        },
        importe: ligne.get("importe")?,
        cree_le: ligne.get("cree_le")?,
        modifie_le: ligne.get("modifie_le")?,
    })
}

fn renvoi(base: &Base, condition: &str, parametre: &str) -> Result<Option<Renvoi>, ErreurFacture> {
    Ok(base
        .connexion()
        .query_row(
            &format!("SELECT id, numero, date_emission FROM factures WHERE {condition} AND numero IS NOT NULL ORDER BY cree_le DESC LIMIT 1"),
            [parametre],
            |l| Ok(Renvoi { id: l.get(0)?, numero: l.get(1)?, date_emission: l.get(2)? }),
        )
        .optional()?)
}

pub fn lire(base: &Base, id: &str) -> Result<Facture, ErreurFacture> {
    let (mut facture, origine) =
        base.connexion().query_row("SELECT * FROM factures WHERE id = ?1", [id], depuis_ligne).optional()?.ok_or(ErreurFacture::Introuvable)?;
    facture.reglements = base
        .connexion()
        .prepare("SELECT * FROM reglements WHERE facture_id = ?1 ORDER BY encaisse_le, cree_le")?
        .query_map([id], reglement_depuis_ligne)?
        .collect::<Result<_, _>>()?;
    facture.regle_centimes = facture.reglements.iter().map(|r| r.saisie.montant_centimes).sum();
    facture.reste_centimes = reste(facture.nature, facture.etat, facture.total_centimes, facture.regle_centimes);
    if let Some(origine) = origine {
        facture.origine = renvoi(base, "id = ?1", &origine)?;
        if facture.nature == Nature::Avoir {
            let regle_origine: i64 = base.connexion().query_row(
                "SELECT coalesce(sum(montant_centimes), 0) FROM reglements WHERE facture_id = ?1",
                [&origine],
                |l| l.get(0),
            )?;
            facture.remboursable_centimes = (regle_origine + facture.regle_centimes).max(0);
        }
    }
    if facture.etat == EtatFacture::Annulee {
        facture.avoir = renvoi(base, "origine_id = ?1 AND nature = 'avoir'", id)?;
        facture.rectificative = renvoi(base, "origine_id = ?1 AND nature = 'facture'", id)?;
    }
    Ok(facture)
}

fn journaliser(base: &Base, action: &str, facture_id: &str, avant: Option<&Value>, apres: Option<&Value>) -> Result<(), ErreurFacture> {
    let texte = |v: Option<&Value>| v.map(Value::to_string);
    base.journaliser(action, facture_id, texte(avant).as_deref(), texte(apres).as_deref())?;
    Ok(())
}

fn en_json<T: Serialize>(valeur: &T) -> Result<Value, ErreurFacture> {
    Ok(serde_json::to_value(valeur)?)
}

/// Patient et séance existent, vont ensemble, et la séance n'a pas déjà sa facture.
fn verifier_liens(base: &Base, saisie: &mut SaisieFacture, sauf: Option<&str>) -> Result<(), ErreurFacture> {
    if let Some(seance_id) = &saisie.seance_id {
        let seance: Option<(String, String, Option<i64>, String)> = base
            .connexion()
            .query_row("SELECT patient_id, facturation, supprimee_le, debut FROM seances WHERE id = ?1", [seance_id], |l| {
                Ok((l.get(0)?, l.get(1)?, l.get(2)?, l.get(3)?))
            })
            .optional()?;
        let Some((patient_id, facturation, supprimee_le, debut)) = seance else {
            return Err(ErreurFacture::Invalide("cette séance n'existe plus"));
        };
        if supprimee_le.is_some() {
            return Err(ErreurFacture::Invalide("cette séance est à la corbeille"));
        }
        if facturation == "gratuit" {
            return Err(ErreurFacture::Invalide("cette séance est un acte gratuit"));
        }
        if saisie.patient_id.as_ref().is_some_and(|p| *p != patient_id) {
            return Err(ErreurFacture::Invalide("cette séance appartient à un autre patient"));
        }
        let deja: Option<String> = base
            .connexion()
            .query_row(
                "SELECT id FROM factures WHERE seance_id = ?1 AND nature = 'facture' AND etat IN ('brouillon', 'emise') AND id IS NOT ?2",
                rusqlite::params![seance_id, sauf],
                |l| l.get(0),
            )
            .optional()?;
        if deja.is_some() {
            return Err(ErreurFacture::Invalide("cette séance a déjà sa facture"));
        }
        saisie.patient_id = Some(patient_id);
        if saisie.date_seance.is_none() {
            saisie.date_seance = Some(debut.chars().take(10).collect());
        }
    }
    if let Some(patient_id) = &saisie.patient_id {
        patients::lire(base, patient_id)?;
    }
    Ok(())
}

fn inserer(base: &Base, nature: Nature, saisie: &SaisieFacture, total: i64, origine: Option<&str>) -> Result<String, ErreurFacture> {
    let id = identifiant::nouveau()?;
    let s = saisie;
    base.connexion().execute(
        "INSERT INTO factures (id, nature, etat, patient_id, seance_id, date_seance, destinataire, lignes, total_centimes,
                               commentaire_imprime, commentaire_interne, origine_id, cree_le, modifie_le)
         VALUES (?1, ?2, 'brouillon', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        rusqlite::params![
            id,
            nature.texte(),
            s.patient_id,
            s.seance_id,
            s.date_seance,
            serde_json::to_string(&s.destinataire)?,
            serde_json::to_string(&s.lignes)?,
            total,
            s.commentaire_imprime,
            s.commentaire_interne,
            origine,
            maintenant()
        ],
    )?;
    Ok(id)
}

/// Crée une facture brouillon, sans numéro.
pub fn creer_brouillon(base: &Base, saisie: &SaisieFacture) -> Result<Facture, ErreurFacture> {
    let (mut saisie, total) = saisie.verifier()?;
    base.atomique(|| {
        verifier_liens(base, &mut saisie, None)?;
        let id = inserer(base, Nature::Facture, &saisie, total, None)?;
        let facture = lire(base, &id)?;
        journaliser(base, "facture.brouillon", &id, None, Some(&en_json(&facture)?))?;
        Ok(facture)
    })
}

pub fn modifier_brouillon(base: &Base, id: &str, saisie: &SaisieFacture) -> Result<Facture, ErreurFacture> {
    let (mut saisie, total) = saisie.verifier()?;
    base.atomique(|| {
        let avant = lire(base, id)?;
        if avant.etat != EtatFacture::Brouillon {
            return Err(ErreurFacture::Invalide("une facture émise ne se modifie pas : corrigez-la par un avoir"));
        }
        verifier_liens(base, &mut saisie, Some(id))?;
        let s = &saisie;
        base.connexion().execute(
            "UPDATE factures SET patient_id = ?2, seance_id = ?3, date_seance = ?4, destinataire = ?5, lignes = ?6, total_centimes = ?7,
                    commentaire_imprime = ?8, commentaire_interne = ?9, modifie_le = ?10
             WHERE id = ?1",
            rusqlite::params![
                id,
                s.patient_id,
                s.seance_id,
                s.date_seance,
                serde_json::to_string(&s.destinataire)?,
                serde_json::to_string(&s.lignes)?,
                total,
                s.commentaire_imprime,
                s.commentaire_interne,
                maintenant()
            ],
        )?;
        let apres = lire(base, id)?;
        journaliser(base, "facture.modifiee", id, Some(&en_json(&avant)?), Some(&en_json(&apres)?))?;
        Ok(apres)
    })
}

/// Le commentaire interne se modifie à tout moment : il n'est jamais imprimé.
pub fn annoter(base: &Base, id: &str, commentaire_interne: &str) -> Result<Facture, ErreurFacture> {
    let commentaire = commentaire_interne.trim().replace("\r\n", "\n");
    if commentaire.chars().count() > COMMENTAIRE_MAX {
        return Err(ErreurFacture::Invalide("le commentaire est trop long"));
    }
    let avant = lire(base, id)?;
    if avant.saisie.commentaire_interne == commentaire {
        return Ok(avant);
    }
    base.connexion().execute(
        "UPDATE factures SET commentaire_interne = ?2, modifie_le = ?3 WHERE id = ?1",
        rusqlite::params![id, commentaire, maintenant()],
    )?;
    let apres = lire(base, id)?;
    journaliser(
        base,
        "facture.annotee",
        id,
        Some(&serde_json::json!({ "commentaire_interne": avant.saisie.commentaire_interne })),
        Some(&serde_json::json!({ "commentaire_interne": apres.saisie.commentaire_interne })),
    )?;
    Ok(apres)
}

pub fn supprimer_brouillon(base: &Base, id: &str) -> Result<(), ErreurFacture> {
    let avant = lire(base, id)?;
    if avant.etat != EtatFacture::Brouillon {
        return Err(ErreurFacture::Invalide("une facture émise ne se supprime pas : annulez-la par un avoir"));
    }
    base.connexion().execute("DELETE FROM factures WHERE id = ?1", [id])?;
    journaliser(base, "facture.brouillon_supprime", id, Some(&en_json(&avant)?), None)
}

pub fn reglages(base: &Base) -> Result<ReglagesNumerotation, ErreurFacture> {
    Ok(base.lire_parametre(PARAMETRE_NUMEROTATION)?.unwrap_or_default())
}

pub fn enregistrer_reglages(base: &Base, reglages: &ReglagesNumerotation) -> Result<ReglagesNumerotation, ErreurFacture> {
    let reglages = reglages.verifier()?;
    base.ecrire_parametre(PARAMETRE_NUMEROTATION, &reglages)?;
    Ok(reglages)
}

/// Numéro que recevrait une facture émise à cette date, sans rien réserver.
pub fn numero_suivant(base: &Base, date: &str) -> Result<NumeroFacture, ErreurFacture> {
    let date = date_valide(date)?;
    let reglages = reglages(base)?;
    let derniere_emise: Option<String> =
        base.connexion().query_row("SELECT max(date_emission) FROM factures WHERE importee = 0 AND numero IS NOT NULL", [], |l| l.get(0))?;
    if let Some(derniere) = derniere_emise.as_deref().and_then(|d| Date::lire(d).ok())
        && date < derniere
    {
        return Err(ErreurNumerotation::AvantDerniere(derniere).into());
    }
    let annee = date.annee();
    let derniere: Option<(u32, String)> = base
        .connexion()
        .query_row(
            "SELECT sequence, date_emission FROM factures WHERE importee = 0 AND annee = ?1 AND sequence IS NOT NULL
             ORDER BY sequence DESC LIMIT 1",
            [annee],
            |l| Ok((l.get(0)?, l.get(1)?)),
        )
        .optional()?;
    let reserve: (Option<u32>, Option<String>) = base.connexion().query_row(
        "SELECT max(sequence), max(date_emission) FROM factures WHERE importee = 1 AND annee = ?1 AND sequence IS NOT NULL",
        [annee],
        |l| Ok((l.get(0)?, l.get(1)?)),
    )?;
    let etat = EtatAnnee {
        derniere: derniere.and_then(|(sequence, d)| Date::lire(&d).ok().map(|d| (sequence, d))),
        reserve: match reserve {
            (Some(sequence_max), Some(d)) => Date::lire(&d).ok().map(|derniere_date| Reserve { sequence_max, derniere_date }),
            _ => None,
        },
    };
    let depart = reglages.depart.filter(|d| d.annee == annee).map(|d| d.compteur).unwrap_or(1);
    let numero = numerotation::prochain_numero(&reglages.format, date, &etat, depart)?;
    let pris: Option<i64> = base.connexion().query_row("SELECT 1 FROM factures WHERE numero = ?1", [&numero.numero], |l| l.get(0)).optional()?;
    if pris.is_some() {
        return Err(ErreurFacture::Refus(format!(
            "le numéro {} existe déjà : vérifiez le modèle de numérotation dans Paramètres › Facturation",
            numero.numero
        )));
    }
    Ok(numero)
}

/// Donne au brouillon son numéro, sa date d'émission et l'identité du cabinet du jour.
fn numeroter(base: &Base, id: &str, date: &str) -> Result<(), ErreurFacture> {
    if date_valide(date)? > Date::du_jour_utc(1) {
        return Err(ErreurFacture::Invalide("la date d'émission ne peut pas être dans le futur"));
    }
    let praticien: IdentiteCabinet = base.lire_parametre(PARAMETRE_IDENTITE)?.unwrap_or_default();
    let manquantes = praticien.mentions_manquantes();
    if !manquantes.is_empty() {
        return Err(ErreurFacture::MentionsManquantes(manquantes.join(", ")));
    }
    let numero = numero_suivant(base, date)?;
    base.connexion().execute(
        "UPDATE factures SET etat = 'emise', numero = ?2, annee = ?3, sequence = ?4, date_emission = ?5, praticien = ?6, modifie_le = ?7
         WHERE id = ?1 AND etat = 'brouillon'",
        rusqlite::params![
            id,
            numero.numero,
            numero.annee,
            numero.sequence,
            date_valide(date)?.to_string(),
            serde_json::to_string(&praticien)?,
            maintenant()
        ],
    )?;
    Ok(())
}

/// Émet le brouillon à la date donnée (le jour même, en général) : il reçoit le numéro suivant.
pub fn emettre(base: &Base, id: &str, date: &str) -> Result<Facture, ErreurFacture> {
    base.atomique(|| {
        let avant = lire(base, id)?;
        if avant.etat != EtatFacture::Brouillon {
            return Err(ErreurFacture::Invalide("cette facture est déjà émise"));
        }
        // Le brouillon a pu attendre : la séance a peut-être été facturée entre-temps.
        let mut saisie = avant.saisie.clone();
        verifier_liens(base, &mut saisie, Some(id))?;
        numeroter(base, id, date)?;
        let apres = lire(base, id)?;
        journaliser(base, "facture.emise", id, None, Some(&en_json(&apres)?))?;
        Ok(apres)
    })
}

/// Facture la séance en une fois, depuis la fin de séance : brouillon (ou celui qui attendait),
/// émission, et règlement s'il est déjà reçu.
pub fn facturer_seance(
    base: &Base,
    seance_id: &str,
    lignes: &[LigneFacture],
    reglement: Option<&SaisieReglement>,
    date: &str,
) -> Result<Facture, ErreurFacture> {
    base.atomique(|| {
        let en_cours: Option<(String, String)> = base
            .connexion()
            .query_row(
                "SELECT id, etat FROM factures WHERE seance_id = ?1 AND nature = 'facture' AND etat IN ('brouillon', 'emise')",
                [seance_id],
                |l| Ok((l.get(0)?, l.get(1)?)),
            )
            .optional()?;
        let id = match en_cours {
            Some((_, etat)) if etat == "emise" => return Err(ErreurFacture::Invalide("cette séance est déjà facturée")),
            Some((id, _)) => {
                let mut saisie = lire(base, &id)?.saisie;
                saisie.lignes = lignes.to_vec();
                modifier_brouillon(base, &id, &saisie)?.id
            }
            None => {
                let patient_id: Option<String> =
                    base.connexion().query_row("SELECT patient_id FROM seances WHERE id = ?1", [seance_id], |l| l.get(0)).optional()?;
                let patient = patients::lire(base, &patient_id.ok_or(ErreurFacture::Invalide("cette séance n'existe plus"))?)?;
                let saisie = SaisieFacture {
                    patient_id: Some(patient.id.clone()),
                    seance_id: Some(seance_id.to_owned()),
                    destinataire: Destinataire::des_factures(base, &patient),
                    lignes: lignes.to_vec(),
                    ..Default::default()
                };
                creer_brouillon(base, &saisie)?.id
            }
        };
        emettre(base, &id, date)?;
        if let Some(reglement) = reglement {
            ajouter_reglement(base, &id, reglement)?;
        }
        lire(base, &id)
    })
}

/// Annule la facture émise par un avoir du même montant, numéroté à la suite.
fn emettre_avoir(base: &Base, originale: &Facture, date: &str) -> Result<String, ErreurFacture> {
    if originale.nature != Nature::Facture || originale.etat != EtatFacture::Emise {
        return Err(ErreurFacture::Invalide("seule une facture émise peut être corrigée ou annulée"));
    }
    base.connexion().execute(
        "UPDATE factures SET etat = 'annulee', modifie_le = ?2 WHERE id = ?1",
        rusqlite::params![originale.id, maintenant()],
    )?;
    let saisie = SaisieFacture { commentaire_imprime: String::new(), commentaire_interne: String::new(), ..originale.saisie.clone() };
    let avoir = inserer(base, Nature::Avoir, &saisie, -originale.total_centimes, Some(&originale.id))?;
    numeroter(base, &avoir, date)?;
    journaliser(base, "avoir.emis", &avoir, None, Some(&en_json(&lire(base, &avoir)?)?))?;
    Ok(avoir)
}

/// Annule la facture par un avoir total. Les règlements reçus restent comptés : un remboursement
/// se note sur l'avoir.
pub fn annuler(base: &Base, id: &str, date: &str) -> Result<Facture, ErreurFacture> {
    base.atomique(|| {
        let originale = lire(base, id)?;
        let avoir = emettre_avoir(base, &originale, date)?;
        let avoir = lire(base, &avoir)?;
        journaliser(base, "facture.annulee", id, None, Some(&serde_json::json!({ "numero": avoir.numero })))?;
        Ok(avoir)
    })
}

/// Corrige une facture émise : un avoir l'annule, une facture rectificative la remplace et
/// reprend ses règlements. Rend la facture rectificative.
pub fn corriger(base: &Base, id: &str, saisie: &SaisieFacture, date: &str) -> Result<Facture, ErreurFacture> {
    let (saisie, total) = saisie.verifier()?;
    base.atomique(|| {
        let originale = lire(base, id)?;
        // La facture rectificative concerne le même patient et la même séance.
        let saisie = SaisieFacture {
            patient_id: originale.saisie.patient_id.clone(),
            seance_id: originale.saisie.seance_id.clone(),
            date_seance: saisie.date_seance.clone().or(originale.saisie.date_seance.clone()),
            ..saisie.clone()
        };
        emettre_avoir(base, &originale, date)?;
        let rectificative = inserer(base, Nature::Facture, &saisie, total, Some(id))?;
        numeroter(base, &rectificative, date)?;
        base.connexion().execute(
            "UPDATE reglements SET facture_id = ?2, modifie_le = ?3 WHERE facture_id = ?1",
            rusqlite::params![id, rectificative, maintenant()],
        )?;
        let apres = lire(base, &rectificative)?;
        journaliser(base, "facture.emise", &rectificative, None, Some(&en_json(&apres)?))?;
        journaliser(base, "facture.corrigee", id, None, Some(&serde_json::json!({ "numero": apres.numero })))?;
        Ok(apres)
    })
}

/// Le règlement est-il possible sur cette facture ? `remplace` : montant du règlement modifié.
fn verifier_montant(facture: &Facture, remplace: i64, montant: i64) -> Result<(), ErreurFacture> {
    match facture.etat {
        EtatFacture::Brouillon => return Err(ErreurFacture::Invalide("émettez la facture avant d'y noter un règlement")),
        EtatFacture::Annulee => {
            return Err(ErreurFacture::Invalide("cette facture est annulée : un remboursement se note sur son avoir"));
        }
        EtatFacture::Emise => {}
    }
    let regle = facture.regle_centimes - remplace + montant;
    match facture.nature {
        Nature::Facture if montant > 0 && regle > facture.total_centimes => {
            Err(ErreurFacture::Invalide("le règlement dépasse le reste à régler"))
        }
        Nature::Facture if regle < 0 => Err(ErreurFacture::Invalide("le remboursement dépasse ce qui a été réglé")),
        Nature::Avoir if montant > 0 => Err(ErreurFacture::Invalide("sur un avoir, notez un remboursement : un montant négatif")),
        Nature::Avoir if regle < facture.total_centimes => {
            Err(ErreurFacture::Invalide("le remboursement dépasse le montant de l'avoir"))
        }
        Nature::Avoir if montant < 0 && -montant > facture.remboursable_centimes + remplace.abs() => {
            Err(ErreurFacture::Invalide("le remboursement dépasse ce que le patient avait réglé sur la facture annulée"))
        }
        _ => Ok(()),
    }
}

fn lire_reglement(base: &Base, id: &str) -> Result<Reglement, ErreurFacture> {
    base.connexion()
        .query_row("SELECT * FROM reglements WHERE id = ?1", [id], reglement_depuis_ligne)
        .optional()?
        .ok_or(ErreurFacture::Invalide("ce règlement n'existe plus"))
}

pub fn ajouter_reglement(base: &Base, facture_id: &str, saisie: &SaisieReglement) -> Result<Facture, ErreurFacture> {
    let saisie = saisie.verifier()?;
    base.atomique(|| {
        let facture = lire(base, facture_id)?;
        verifier_montant(&facture, 0, saisie.montant_centimes)?;
        let id = identifiant::nouveau()?;
        let s = &saisie;
        base.connexion().execute(
            "INSERT INTO reglements (id, facture_id, moyen, montant_centimes, encaisse_le, reference, payeur, commentaire, cree_le, modifie_le)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            rusqlite::params![id, facture_id, s.moyen.texte(), s.montant_centimes, s.encaisse_le, s.reference, s.payeur, s.commentaire, maintenant()],
        )?;
        journaliser(base, "reglement.ajoute", facture_id, None, Some(&en_json(&lire_reglement(base, &id)?)?))?;
        lire(base, facture_id)
    })
}

pub fn modifier_reglement(base: &Base, id: &str, saisie: &SaisieReglement) -> Result<Facture, ErreurFacture> {
    let saisie = saisie.verifier()?;
    base.atomique(|| {
        let avant = lire_reglement(base, id)?;
        let facture = lire(base, &avant.facture_id)?;
        verifier_montant(&facture, avant.saisie.montant_centimes, saisie.montant_centimes)?;
        let s = &saisie;
        base.connexion().execute(
            "UPDATE reglements SET moyen = ?2, montant_centimes = ?3, encaisse_le = ?4, reference = ?5, payeur = ?6, commentaire = ?7,
                    modifie_le = ?8
             WHERE id = ?1",
            rusqlite::params![id, s.moyen.texte(), s.montant_centimes, s.encaisse_le, s.reference, s.payeur, s.commentaire, maintenant()],
        )?;
        let apres = lire_reglement(base, id)?;
        journaliser(base, "reglement.modifie", &avant.facture_id, Some(&en_json(&avant)?), Some(&en_json(&apres)?))?;
        lire(base, &avant.facture_id)
    })
}

pub fn supprimer_reglement(base: &Base, id: &str) -> Result<Facture, ErreurFacture> {
    base.atomique(|| {
        let avant = lire_reglement(base, id)?;
        let facture = lire(base, &avant.facture_id)?;
        if facture.nature == Nature::Facture && facture.regle_centimes - avant.saisie.montant_centimes < 0 {
            return Err(ErreurFacture::Invalide("supprimez d'abord le remboursement"));
        }
        base.connexion().execute("DELETE FROM reglements WHERE id = ?1", [id])?;
        journaliser(base, "reglement.supprime", &avant.facture_id, Some(&en_json(&avant)?), None)?;
        lire(base, &avant.facture_id)
    })
}

fn lister_ou(base: &Base, condition: &str, parametres: &[&dyn rusqlite::ToSql]) -> Result<Vec<ResumeFacture>, ErreurFacture> {
    let mut requete = base.connexion().prepare(&format!(
        "SELECT f.*, p.nom AS patient_nom, p.prenom AS patient_prenom,
                coalesce((SELECT sum(r.montant_centimes) FROM reglements r WHERE r.facture_id = f.id), 0) AS regle,
                coalesce((SELECT group_concat(DISTINCT r.moyen) FROM reglements r WHERE r.facture_id = f.id), '') AS moyens,
                (SELECT o.numero FROM factures o WHERE o.id = f.origine_id) AS origine_numero
         FROM factures f LEFT JOIN patients p ON p.id = f.patient_id
         WHERE {condition}
         ORDER BY f.numero IS NULL DESC, f.date_emission DESC, f.annee DESC, f.sequence DESC, f.cree_le DESC"
    ))?;
    let lignes = requete.query_map(parametres, |l| {
        let (facture, _) = depuis_ligne(l)?;
        let regle: i64 = l.get("regle")?;
        let moyens: String = l.get("moyens")?;
        let premiere = facture.saisie.lignes.first().map(|l| l.designation.clone()).unwrap_or_default();
        Ok(ResumeFacture {
            reste_centimes: reste(facture.nature, facture.etat, facture.total_centimes, regle),
            regle_centimes: regle,
            moyens: moyens.split(',').filter(|m| !m.is_empty()).map(Moyen::depuis).collect(),
            designation: if facture.saisie.lignes.len() > 1 { format!("{premiere}…") } else { premiere },
            destinataire: facture.saisie.destinataire.nom_complet(),
            patient_nom: l.get::<_, Option<String>>("patient_nom")?.unwrap_or_default(),
            patient_prenom: l.get::<_, Option<String>>("patient_prenom")?.unwrap_or_default(),
            origine_numero: l.get("origine_numero")?,
            id: facture.id,
            nature: facture.nature,
            etat: facture.etat,
            numero: facture.numero,
            date_emission: facture.date_emission,
            patient_id: facture.saisie.patient_id,
            seance_id: facture.saisie.seance_id,
            date_seance: facture.saisie.date_seance,
            total_centimes: facture.total_centimes,
            importee: facture.importee,
        })
    })?;
    Ok(lignes.collect::<Result<_, _>>()?)
}

/// Factures et avoirs émis entre deux dates comprises (`AAAA-MM-JJ`), et tous les brouillons.
pub fn lister(base: &Base, du: &str, au: &str) -> Result<Vec<ResumeFacture>, ErreurFacture> {
    lister_ou(base, "f.etat = 'brouillon' OR (f.date_emission >= ?1 AND f.date_emission <= ?2)", &[&du, &au])
}

/// Factures émises qui attendent tout ou partie de leur règlement.
pub fn en_attente(base: &Base) -> Result<Vec<ResumeFacture>, ErreurFacture> {
    lister_ou(
        base,
        "f.nature = 'facture' AND f.etat = 'emise'
         AND f.total_centimes > coalesce((SELECT sum(r.montant_centimes) FROM reglements r WHERE r.facture_id = f.id), 0)",
        &[],
    )
}

pub fn du_patient(base: &Base, patient_id: &str) -> Result<Vec<ResumeFacture>, ErreurFacture> {
    lister_ou(base, "f.patient_id = ?1", &[&patient_id])
}

/// La facture en cours de la séance : brouillon ou émise.
pub fn de_la_seance(base: &Base, seance_id: &str) -> Result<Option<Facture>, ErreurFacture> {
    let id: Option<String> = base
        .connexion()
        .query_row(
            "SELECT id FROM factures WHERE seance_id = ?1 AND nature = 'facture' AND etat IN ('brouillon', 'emise')",
            [seance_id],
            |l| l.get(0),
        )
        .optional()?;
    id.map(|id| lire(base, &id)).transpose()
}

/// Règlements encaissés entre deux dates comprises, du plus récent au plus ancien.
pub fn recettes(base: &Base, du: &str, au: &str) -> Result<Vec<LigneRecette>, ErreurFacture> {
    let mut requete = base.connexion().prepare(
        "SELECT r.*, f.numero, f.date_emission, f.nature, f.patient_id, f.destinataire, p.nom AS patient_nom, p.prenom AS patient_prenom
         FROM reglements r JOIN factures f ON f.id = r.facture_id LEFT JOIN patients p ON p.id = f.patient_id
         WHERE r.encaisse_le >= ?1 AND r.encaisse_le <= ?2
         ORDER BY r.encaisse_le DESC, r.cree_le DESC",
    )?;
    let lignes = requete.query_map([du, au], |l| {
        let reglement = reglement_depuis_ligne(l)?;
        let destinataire: Destinataire = json(l, "destinataire")?;
        let patient = [l.get::<_, Option<String>>("patient_prenom")?, l.get::<_, Option<String>>("patient_nom")?]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        Ok(LigneRecette {
            id: reglement.id,
            facture_id: reglement.facture_id,
            facture_numero: l.get("numero")?,
            facture_date: l.get("date_emission")?,
            nature: nature_de(l)?,
            patient_id: l.get("patient_id")?,
            nom: if patient.is_empty() { destinataire.nom_complet() } else { patient },
            reglement: reglement.saisie,
            importe: reglement.importe,
        })
    })?;
    Ok(lignes.collect::<Result<_, _>>()?)
}

/// Ce qui est arrivé à la facture, du plus ancien au plus récent.
pub fn historique(base: &Base, facture_id: &str) -> Result<Vec<EvenementFacture>, ErreurFacture> {
    let mut requete = base.connexion().prepare("SELECT le, action, avant, apres FROM journal WHERE entite = ?1 ORDER BY id")?;
    let lignes = requete.query_map([facture_id], |l| {
        Ok((l.get::<_, String>(0)?, l.get::<_, String>(1)?, l.get::<_, Option<String>>(2)?, l.get::<_, Option<String>>(3)?))
    })?;
    let mut evenements = Vec::new();
    for ligne in lignes {
        let (le, action, avant, apres) = ligne?;
        let detail: Value = apres.or(avant).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        evenements.push(EvenementFacture {
            le: le.parse().unwrap_or(0),
            numero: detail.get("numero").and_then(Value::as_str).map(str::to_owned),
            montant_centimes: detail.get("montant_centimes").and_then(Value::as_i64),
            moyen: detail.get("moyen").and_then(|m| serde_json::from_value(m.clone()).ok()),
            action,
        });
    }
    Ok(evenements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cabinet::IdentiteCabinet;
    use crate::chiffrement::CleDonnees;
    use crate::modeles::{self, installer_modeles_fournis};
    use crate::patients::FichePatient;
    use crate::seances::{self, Facturation, SaisieSeance};

    struct Cabinet {
        _dossier: tempfile::TempDir,
        base: Base,
        patient: String,
    }

    fn identite() -> IdentiteCabinet {
        IdentiteCabinet {
            prenom: "Alexandre".into(),
            nom: "Roux".into(),
            profession: "Ostéopathe D.O.".into(),
            adresse: "12 place de la Halle".into(),
            code_postal: "47150".into(),
            ville: "Lacapelle-Biron".into(),
            siret: "12345678900012".into(),
            rpps: "10000000000".into(),
            ..Default::default()
        }
    }

    fn cabinet() -> Cabinet {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        base.ecrire_parametre(PARAMETRE_IDENTITE, &identite()).unwrap();
        installer_modeles_fournis(&base).unwrap();
        let fiche = FichePatient {
            sexe: "F".into(),
            nom: "Martin".into(),
            prenom: "Camille".into(),
            adresse: "12 rue des Tilleuls".into(),
            complement_adresse: "Bâtiment B".into(),
            code_postal: "47500".into(),
            ville: "Fumel".into(),
            ..Default::default()
        };
        let patient = patients::creer(&base, &fiche).unwrap().id;
        Cabinet { _dossier: dossier, base, patient }
    }

    fn seance(c: &Cabinet, debut: &str) -> String {
        let modele = modeles::lister(&c.base).unwrap().remove(0);
        let saisie = SaisieSeance { debut: debut.into(), modele_id: modele.id, modele_version: modele.version, ..Default::default() };
        seances::creer(&c.base, &c.patient, &saisie).unwrap().id
    }

    fn consultation(prix: i64) -> Vec<LigneFacture> {
        vec![LigneFacture { designation: "Consultation d’ostéopathie".into(), quantite: 1, prix_unitaire_centimes: prix, ..Default::default() }]
    }

    fn carte(montant: i64, le: &str) -> SaisieReglement {
        SaisieReglement { moyen: Moyen::Carte, montant_centimes: montant, encaisse_le: le.into(), ..Default::default() }
    }

    #[test]
    fn la_facture_d_un_enfant_va_au_parent_qui_la_recoit() {
        let c = cabinet();
        let lucas = patients::creer(&c.base, &FichePatient { nom: "Martin".into(), prenom: "Lucas".into(), ..Default::default() }).unwrap();
        crate::familles::lier(&c.base, &lucas.id, &c.patient, "parent").unwrap();
        crate::familles::definir_payeur(&c.base, &lucas.id, Some(&c.patient)).unwrap();
        let lucas = patients::lire(&c.base, &lucas.id).unwrap();
        let d = Destinataire::des_factures(&c.base, &lucas);
        assert_eq!((d.civilite.as_str(), d.prenom.as_str(), d.patient.as_str()), ("Mme", "Camille", "Lucas Martin"));
        assert_eq!(d.adresse, "12 rue des Tilleuls\nBâtiment B");
        let camille = patients::lire(&c.base, &c.patient).unwrap();
        assert_eq!(Destinataire::des_factures(&c.base, &camille).patient, "");
    }

    #[test]
    fn facture_une_seance_en_une_fois() {
        let c = cabinet();
        let s = seance(&c, "2026-10-06T14:30");
        let f = facturer_seance(&c.base, &s, &consultation(5500), Some(&carte(5500, "2026-10-06")), "2026-10-06").unwrap();
        assert_eq!((f.numero.as_deref(), f.etat, f.total_centimes, f.reste_centimes), (Some("2026-10-1"), EtatFacture::Emise, 5500, 0));
        assert_eq!(f.saisie.date_seance.as_deref(), Some("2026-10-06"));
        assert_eq!(f.saisie.destinataire.civilite, "Mme");
        assert_eq!(f.saisie.destinataire.adresse, "12 rue des Tilleuls\nBâtiment B");
        assert_eq!(f.praticien.as_ref().unwrap().siret, "12345678900012");
        assert_eq!(de_la_seance(&c.base, &s).unwrap().unwrap().id, f.id);
        // Une seconde facture pour la même séance est refusée.
        assert!(facturer_seance(&c.base, &s, &consultation(5500), None, "2026-10-06").is_err());

        let s2 = seance(&c, "2026-10-06T15:30");
        let f2 = facturer_seance(&c.base, &s2, &consultation(5500), None, "2026-10-06").unwrap();
        assert_eq!((f2.numero.as_deref(), f2.reste_centimes), (Some("2026-10-2"), 5500));
        assert_eq!(en_attente(&c.base).unwrap().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), [f2.id.as_str()]);
    }

    #[test]
    fn un_brouillon_se_modifie_puis_s_emet() {
        let c = cabinet();
        let saisie = SaisieFacture {
            patient_id: Some(c.patient.clone()),
            destinataire: Destinataire { civilite: "M.".into(), prenom: "Paul".into(), nom: "Martin".into(), ..Default::default() },
            lignes: vec![LigneFacture {
                designation: "  Consultation   enfant ".into(),
                quantite: 2,
                prix_unitaire_centimes: 4500,
                reduction_centimes: 1000,
                ..Default::default()
            }],
            commentaire_imprime: "Facture adressée au père de l’enfant.".into(),
            ..Default::default()
        };
        let brouillon = creer_brouillon(&c.base, &saisie).unwrap();
        assert_eq!((brouillon.etat, brouillon.numero.as_deref(), brouillon.total_centimes), (EtatFacture::Brouillon, None, 8000));
        assert_eq!(brouillon.saisie.lignes[0].designation, "Consultation enfant");
        assert!(ajouter_reglement(&c.base, &brouillon.id, &carte(8000, "2026-10-06")).is_err());

        let mut autre = saisie.clone();
        autre.lignes[0].reduction_centimes = 0;
        assert_eq!(modifier_brouillon(&c.base, &brouillon.id, &autre).unwrap().total_centimes, 9000);
        let emise = emettre(&c.base, &brouillon.id, "2026-10-06").unwrap();
        assert_eq!(emise.numero.as_deref(), Some("2026-10-1"));
        assert!(modifier_brouillon(&c.base, &emise.id, &autre).is_err());
        assert!(supprimer_brouillon(&c.base, &emise.id).is_err());
        // Le commentaire interne se modifie toujours.
        assert_eq!(annoter(&c.base, &emise.id, " Réglé par le père ").unwrap().saisie.commentaire_interne, "Réglé par le père");
    }

    #[test]
    fn refuse_les_saisies_impossibles() {
        let c = cabinet();
        let base = SaisieFacture {
            destinataire: Destinataire { nom: "Martin".into(), ..Default::default() },
            lignes: consultation(5500),
            ..Default::default()
        };
        assert!(creer_brouillon(&c.base, &SaisieFacture { lignes: vec![], ..base.clone() }).is_err());
        assert!(creer_brouillon(&c.base, &SaisieFacture { destinataire: Destinataire::default(), ..base.clone() }).is_err());
        let mut reduction = base.clone();
        reduction.lignes[0].reduction_centimes = 6000;
        assert!(creer_brouillon(&c.base, &reduction).is_err());
        let mut gratuite = base.clone();
        gratuite.seance_id = Some(seance(&c, "2026-10-06T14:30"));
        let modele = modeles::lister(&c.base).unwrap().remove(0);
        let acte_gratuit = SaisieSeance {
            debut: "2026-10-06T16:00".into(),
            modele_id: modele.id,
            modele_version: modele.version,
            facturation: Facturation::Gratuit,
            ..Default::default()
        };
        let s = seances::creer(&c.base, &c.patient, &acte_gratuit).unwrap().id;
        assert!(matches!(creer_brouillon(&c.base, &SaisieFacture { seance_id: Some(s), ..base.clone() }), Err(ErreurFacture::Invalide(_))));
        // Facture sans séance ni patient : possible.
        assert!(creer_brouillon(&c.base, &base).is_ok());
    }

    #[test]
    fn exige_les_mentions_du_cabinet_pour_emettre() {
        let c = cabinet();
        c.base.ecrire_parametre(PARAMETRE_IDENTITE, &IdentiteCabinet { siret: String::new(), rpps: String::new(), ..identite() }).unwrap();
        let s = seance(&c, "2026-10-06T14:30");
        let erreur = facturer_seance(&c.base, &s, &consultation(5500), None, "2026-10-06").unwrap_err();
        assert_eq!(erreur.to_string(), "mentions obligatoires à compléter dans Paramètres › Cabinet avant d'émettre : SIRET, RPPS");
        // Rien n'est resté de la tentative.
        assert!(de_la_seance(&c.base, &s).unwrap().is_none());
    }

    #[test]
    fn numerotation_chronologique_et_reglages() {
        let c = cabinet();
        facturer_seance(&c.base, &seance(&c, "2026-10-06T14:30"), &consultation(5500), None, "2026-10-06").unwrap();
        let s = seance(&c, "2026-10-05T14:30");
        assert!(matches!(
            facturer_seance(&c.base, &s, &consultation(5500), None, "2026-10-05"),
            Err(ErreurFacture::Numerotation(ErreurNumerotation::AvantDerniere(_)))
        ));
        assert!(facturer_seance(&c.base, &s, &consultation(5500), None, "2099-01-01").is_err());

        let reglages = ReglagesNumerotation {
            format: FormatNumero { modele: "F{AA}-{N}".into(), chiffres: 4 },
            depart: Some(CompteurDepart { annee: 2027, compteur: 250 }),
        };
        enregistrer_reglages(&c.base, &reglages).unwrap();
        assert_eq!(numero_suivant(&c.base, "2026-10-07").unwrap().numero, "F26-0002");
        assert_eq!(numero_suivant(&c.base, "2027-01-04").unwrap().numero, "F27-0250");
        assert!(enregistrer_reglages(&c.base, &ReglagesNumerotation { format: FormatNumero { modele: "F-{N}".into(), chiffres: 1 }, depart: None }).is_err());
    }

    #[test]
    fn reglements_partiels_remboursement_et_depassement() {
        let c = cabinet();
        let f = facturer_seance(&c.base, &seance(&c, "2026-10-06T14:30"), &consultation(5500), None, "2026-10-06").unwrap();
        let cheque = SaisieReglement { moyen: Moyen::Cheque, reference: " 0004512 ".into(), ..carte(3000, "2026-10-07") };
        let f = ajouter_reglement(&c.base, &f.id, &cheque).unwrap();
        assert_eq!((f.regle_centimes, f.reste_centimes, f.reglements[0].saisie.reference.as_str()), (3000, 2500, "0004512"));
        assert!(ajouter_reglement(&c.base, &f.id, &carte(3000, "2026-10-07")).is_err());
        let f = ajouter_reglement(&c.base, &f.id, &carte(2500, "2026-10-07")).unwrap();
        assert_eq!(f.reste_centimes, 0);
        assert!(en_attente(&c.base).unwrap().is_empty());
        let f = modifier_reglement(&c.base, &f.reglements[1].id, &carte(2000, "2026-10-08")).unwrap();
        assert_eq!(f.reste_centimes, 500);
        assert!(ajouter_reglement(&c.base, &f.id, &carte(-6000, "2026-10-08")).is_err());
        let f = supprimer_reglement(&c.base, &f.reglements[1].id).unwrap();
        assert_eq!(f.regle_centimes, 3000);
    }

    #[test]
    fn corriger_emet_un_avoir_et_une_rectificative_qui_reprend_le_reglement() {
        let c = cabinet();
        let s = seance(&c, "2026-10-06T14:30");
        let f = facturer_seance(&c.base, &s, &consultation(5500), Some(&carte(5500, "2026-10-06")), "2026-10-06").unwrap();
        let mut saisie = f.saisie.clone();
        saisie.destinataire = Destinataire { civilite: "M.".into(), prenom: "Paul".into(), nom: "Martin".into(), ..Default::default() };
        let rectificative = corriger(&c.base, &f.id, &saisie, "2026-10-07").unwrap();
        assert_eq!(rectificative.numero.as_deref(), Some("2026-10-3"));
        assert_eq!((rectificative.regle_centimes, rectificative.reste_centimes), (5500, 0));
        assert_eq!(rectificative.origine.as_ref().unwrap().numero, "2026-10-1");
        assert_eq!(rectificative.saisie.seance_id.as_deref(), Some(s.as_str()));

        let originale = lire(&c.base, &f.id).unwrap();
        assert_eq!(originale.etat, EtatFacture::Annulee);
        assert!(originale.reglements.is_empty());
        let avoir = originale.avoir.unwrap();
        assert_eq!(avoir.numero, "2026-10-2");
        assert_eq!(originale.rectificative.unwrap().id, rectificative.id);
        let avoir = lire(&c.base, &avoir.id).unwrap();
        assert_eq!((avoir.nature, avoir.total_centimes, avoir.reste_centimes), (Nature::Avoir, -5500, 0));
        // Le règlement est reporté sur la rectificative : rien à rembourser sur l'avoir.
        assert_eq!(avoir.remboursable_centimes, 0);
        assert!(ajouter_reglement(&c.base, &avoir.id, &carte(-5500, "2026-10-07")).is_err());
        // Le règlement n'est compté qu'une fois dans les recettes.
        let recettes = recettes(&c.base, "2026-10-01", "2026-10-31").unwrap();
        assert_eq!(recettes.len(), 1);
        assert_eq!((recettes[0].facture_numero.as_deref(), recettes[0].nom.as_str()), (Some("2026-10-3"), "Camille Martin"));
        assert_eq!(de_la_seance(&c.base, &s).unwrap().unwrap().id, rectificative.id);
        assert!(corriger(&c.base, &f.id, &saisie, "2026-10-07").is_err());

        let actions: Vec<String> = historique(&c.base, &f.id).unwrap().into_iter().map(|e| e.action).collect();
        assert_eq!(actions, ["facture.brouillon", "facture.emise", "reglement.ajoute", "facture.corrigee"]);
        assert_eq!(historique(&c.base, &f.id).unwrap()[2].montant_centimes, Some(5500));
    }

    #[test]
    fn annuler_par_un_avoir_rend_la_seance_a_facturer_et_accepte_un_remboursement() {
        let c = cabinet();
        let s = seance(&c, "2026-10-06T14:30");
        let f = facturer_seance(&c.base, &s, &consultation(5500), Some(&carte(5500, "2026-10-06")), "2026-10-06").unwrap();
        let avoir = annuler(&c.base, &f.id, "2026-10-06").unwrap();
        assert_eq!(avoir.remboursable_centimes, 5500);
        assert_eq!((avoir.nature, avoir.numero.as_deref(), avoir.origine.unwrap().numero.as_str()), (Nature::Avoir, Some("2026-10-2"), "2026-10-1"));
        assert!(de_la_seance(&c.base, &s).unwrap().is_none());
        assert!(ajouter_reglement(&c.base, &f.id, &carte(100, "2026-10-07")).is_err());
        assert!(ajouter_reglement(&c.base, &avoir.id, &carte(5500, "2026-10-07")).is_err());
        assert!(ajouter_reglement(&c.base, &avoir.id, &carte(-6000, "2026-10-07")).is_err());
        let avoir = ajouter_reglement(&c.base, &avoir.id, &SaisieReglement { moyen: Moyen::Especes, ..carte(-5500, "2026-10-07") }).unwrap();
        assert_eq!(avoir.regle_centimes, -5500);
        let total: i64 = recettes(&c.base, "2026-10-01", "2026-10-31").unwrap().iter().map(|r| r.reglement.montant_centimes).sum();
        assert_eq!(total, 0);
        // La séance peut de nouveau être facturée, au numéro suivant.
        let nouvelle = facturer_seance(&c.base, &s, &consultation(5000), None, "2026-10-07").unwrap();
        assert_eq!(nouvelle.numero.as_deref(), Some("2026-10-3"));
    }

    #[test]
    fn listes_et_reprise_apres_l_historique_importe() {
        let c = cabinet();
        c.base
            .connexion()
            .execute(
                "INSERT INTO factures (id, nature, etat, numero, annee, sequence, date_emission, destinataire, lignes, total_centimes, importee, cree_le, modifie_le)
                 VALUES ('ancienne', 'facture', 'emise', '2026-10-1771', 2026, 1771, '2026-10-05', '{\"nom\":\"Dupont\"}', '[]', 5500, 1, 0, 0)",
                [],
            )
            .unwrap();
        let s = seance(&c, "2026-10-06T14:30");
        let f = facturer_seance(&c.base, &s, &consultation(5500), Some(&carte(5500, "2026-10-06")), "2026-10-06").unwrap();
        assert_eq!(f.numero.as_deref(), Some("2026-10-1772"));
        creer_brouillon(
            &c.base,
            &SaisieFacture { destinataire: Destinataire { nom: "Lemaire".into(), ..Default::default() }, lignes: consultation(4500), ..Default::default() },
        )
        .unwrap();
        let liste = lister(&c.base, "2026-10-01", "2026-10-31").unwrap();
        assert_eq!(liste.iter().map(|r| r.numero.clone().unwrap_or_default()).collect::<Vec<_>>(), ["", "2026-10-1772", "2026-10-1771"]);
        assert_eq!((liste[1].moyens.as_slice(), liste[1].patient_prenom.as_str()), ([Moyen::Carte].as_slice(), "Camille"));
        assert_eq!(liste[2].destinataire, "Dupont");
        assert_eq!(du_patient(&c.base, &c.patient).unwrap().len(), 1);
    }

    #[test]
    fn les_seances_suivent_leur_facture() {
        let c = cabinet();
        let a = seance(&c, "2026-10-05T10:00");
        let b = seance(&c, "2026-10-06T10:00");
        let a_facturer = |c: &Cabinet| seances::lister_a_facturer(&c.base).unwrap().into_iter().map(|s| s.id).collect::<Vec<_>>();
        assert_eq!(a_facturer(&c), [b.clone(), a.clone()]);

        let f = facturer_seance(&c.base, &a, &consultation(5500), None, "2026-10-06").unwrap();
        assert_eq!(a_facturer(&c), std::slice::from_ref(&b));
        let resume = seances::lister_patient(&c.base, &c.patient).unwrap().into_iter().find(|s| s.id == a).unwrap();
        assert_eq!(resume.facture.unwrap().numero.as_deref(), Some("2026-10-1"));
        // Facturée : ni corbeille, ni acte gratuit.
        assert!(seances::supprimer(&c.base, &a).is_err());
        let mut saisie = seances::lire(&c.base, &a).unwrap().saisie;
        saisie.facturation = Facturation::Gratuit;
        assert!(seances::enregistrer(&c.base, &a, &saisie).is_err());
        annuler(&c.base, &f.id, "2026-10-06").unwrap();
        assert!(seances::supprimer(&c.base, &a).is_err());

        // Un brouillon part à la corbeille avec sa séance.
        let brouillon = creer_brouillon(
            &c.base,
            &SaisieFacture { seance_id: Some(b.clone()), destinataire: Destinataire { nom: "Martin".into(), ..Default::default() }, lignes: consultation(5500), ..Default::default() },
        )
        .unwrap();
        assert_eq!(a_facturer(&c), [b.clone(), a.clone()]);
        seances::supprimer(&c.base, &b).unwrap();
        assert!(matches!(lire(&c.base, &brouillon.id), Err(ErreurFacture::Introuvable)));
    }
}
