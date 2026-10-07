//! Numérotation des factures : continue, chronologique, avec un compteur par année civile.
//!
//! Reprend les règles de la version 0.4 : modèle réglable (`{AAAA}`, `{AA}`, `{MM}`, `{N}`),
//! compteur de départ pour la première année, numéros de l'historique importé réservés.
//! Une facture émise ne change jamais de numéro ; une correction passe par un avoir.

use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatNumero {
    /// Exemple : `{AAAA}-{MM}-{N}` donne `2026-10-1772`.
    pub modele: String,
    /// Nombre minimal de chiffres du compteur, complété par des zéros.
    pub chiffres: usize,
}

impl Default for FormatNumero {
    fn default() -> Self {
        Self { modele: "{AAAA}-{MM}-{N}".into(), chiffres: 1 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Date {
    annee: i32,
    mois: u32,
    jour: u32,
}

impl Date {
    /// Lit une date au format `AAAA-MM-JJ`.
    pub fn lire(texte: &str) -> Result<Self, ErreurNumerotation> {
        let invalide = || ErreurNumerotation::DateInvalide(texte.to_owned());
        let mut parties = texte.split('-');
        let (Some(a), Some(m), Some(j), None) = (parties.next(), parties.next(), parties.next(), parties.next()) else {
            return Err(invalide());
        };
        if a.len() != 4 || m.len() != 2 || j.len() != 2 {
            return Err(invalide());
        }
        let annee: i32 = a.parse().map_err(|_| invalide())?;
        let mois: u32 = m.parse().map_err(|_| invalide())?;
        let jour: u32 = j.parse().map_err(|_| invalide())?;
        let bissextile = (annee % 4 == 0 && annee % 100 != 0) || annee % 400 == 0;
        let jours_du_mois = match mois {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if bissextile => 29,
            2 => 28,
            _ => return Err(invalide()),
        };
        if jour == 0 || jour > jours_du_mois {
            return Err(invalide());
        }
        Ok(Self { annee, mois, jour })
    }

    pub fn annee(&self) -> i32 {
        self.annee
    }

    pub fn mois(&self) -> u32 {
        self.mois
    }

    pub fn jour(&self) -> u32 {
        self.jour
    }

    /// « 6 octobre 2026 », « 1er mars 2026 ».
    pub fn en_toutes_lettres(&self) -> String {
        const MOIS: [&str; 12] = [
            "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre",
            "décembre",
        ];
        let jour = if self.jour == 1 { "1er".to_owned() } else { self.jour.to_string() };
        format!("{jour} {} {}", MOIS[(self.mois - 1) as usize], self.annee)
    }
}

impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.annee, self.mois, self.jour)
    }
}

/// Dernier numéro de l'historique importé pour une année : ses compteurs restent réservés.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reserve {
    pub sequence_max: u32,
    pub derniere_date: Date,
}

/// Ce que la base sait déjà de l'année de la facture à émettre.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EtatAnnee {
    /// Compteur et date de la dernière facture émise dans l'année.
    pub derniere: Option<(u32, Date)>,
    pub reserve: Option<Reserve>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NumeroFacture {
    pub numero: String,
    pub annee: i32,
    pub sequence: u32,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ErreurNumerotation {
    #[error("date invalide : « {0} », attendu AAAA-MM-JJ")]
    DateInvalide(String),
    #[error("cette date précède la facture du {0}, déjà émise : l'ordre chronologique doit être respecté")]
    AvantDerniere(Date),
    #[error("cette date précède la dernière facture de l'historique importé, du {0}")]
    AvantHistorique(Date),
    #[error("le modèle de numéro doit contenir {{N}}")]
    ModeleSansCompteur,
    #[error("le compteur annuel est épuisé")]
    Depassement,
}

/// Calcule le numéro de la prochaine facture.
///
/// `compteur_initial` sert seulement quand l'année n'a encore aucune facture : 1 en temps normal,
/// ou le compteur de départ choisi par le praticien qui change de logiciel en cours d'année.
pub fn prochain_numero(
    format: &FormatNumero,
    date: Date,
    etat: &EtatAnnee,
    compteur_initial: u32,
) -> Result<NumeroFacture, ErreurNumerotation> {
    if !format.modele.contains("{N}") {
        return Err(ErreurNumerotation::ModeleSansCompteur);
    }
    if let Some((_, derniere_date)) = etat.derniere
        && date < derniere_date
    {
        return Err(ErreurNumerotation::AvantDerniere(derniere_date));
    }
    if let Some(reserve) = etat.reserve
        && date < reserve.derniere_date
    {
        return Err(ErreurNumerotation::AvantHistorique(reserve.derniere_date));
    }
    let mut sequence = match etat.derniere {
        Some((derniere, _)) => derniere.checked_add(1).ok_or(ErreurNumerotation::Depassement)?,
        None => compteur_initial.max(1),
    };
    if let Some(reserve) = etat.reserve {
        sequence = sequence.max(reserve.sequence_max.checked_add(1).ok_or(ErreurNumerotation::Depassement)?);
    }
    let numero = format
        .modele
        .replace("{AAAA}", &format!("{:04}", date.annee))
        .replace("{AA}", &format!("{:02}", date.annee.rem_euclid(100)))
        .replace("{MM}", &format!("{:02}", date.mois))
        .replace("{N}", &format!("{:0largeur$}", sequence, largeur = format.chiffres));
    Ok(NumeroFacture { numero, annee: date.annee, sequence })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(texte: &str) -> Date {
        Date::lire(texte).unwrap()
    }

    #[test]
    fn premiere_facture_de_l_annee() {
        let n = prochain_numero(&FormatNumero::default(), date("2026-01-05"), &EtatAnnee::default(), 1).unwrap();
        assert_eq!(n, NumeroFacture { numero: "2026-01-1".into(), annee: 2026, sequence: 1 });
    }

    #[test]
    fn le_compteur_continue_sur_toute_l_annee() {
        let etat = EtatAnnee { derniere: Some((1771, date("2026-10-06"))), reserve: None };
        let n = prochain_numero(&FormatNumero::default(), date("2026-10-06"), &etat, 1).unwrap();
        assert_eq!(n.numero, "2026-10-1772");
    }

    #[test]
    fn refuse_une_date_anterieure_a_la_derniere_facture() {
        let etat = EtatAnnee { derniere: Some((12, date("2026-03-10"))), reserve: None };
        let erreur = prochain_numero(&FormatNumero::default(), date("2026-03-09"), &etat, 1).unwrap_err();
        assert_eq!(erreur, ErreurNumerotation::AvantDerniere(date("2026-03-10")));
    }

    #[test]
    fn reprend_apres_l_historique_importe() {
        let etat = EtatAnnee {
            derniere: None,
            reserve: Some(Reserve { sequence_max: 1771, derniere_date: date("2026-10-05") }),
        };
        let n = prochain_numero(&FormatNumero::default(), date("2026-10-06"), &etat, 1).unwrap();
        assert_eq!(n.sequence, 1772);
        let erreur = prochain_numero(&FormatNumero::default(), date("2026-10-04"), &etat, 1).unwrap_err();
        assert_eq!(erreur, ErreurNumerotation::AvantHistorique(date("2026-10-05")));
    }

    #[test]
    fn compteur_de_depart_et_zeros() {
        let format = FormatNumero { modele: "F{AA}{MM}-{N}".into(), chiffres: 4 };
        let n = prochain_numero(&format, date("2026-10-06"), &EtatAnnee::default(), 250).unwrap();
        assert_eq!(n.numero, "F2610-0250");
    }

    #[test]
    fn refuse_un_modele_sans_compteur() {
        let format = FormatNumero { modele: "{AAAA}-{MM}".into(), chiffres: 1 };
        let erreur = prochain_numero(&format, date("2026-10-06"), &EtatAnnee::default(), 1).unwrap_err();
        assert_eq!(erreur, ErreurNumerotation::ModeleSansCompteur);
    }

    #[test]
    fn ecrit_les_dates_en_toutes_lettres() {
        assert_eq!(date("2026-10-06").en_toutes_lettres(), "6 octobre 2026");
        assert_eq!(date("2026-03-01").en_toutes_lettres(), "1er mars 2026");
        assert_eq!(date("2026-08-15").en_toutes_lettres(), "15 août 2026");
    }

    #[test]
    fn lit_les_dates() {
        assert!(Date::lire("2028-02-29").is_ok());
        assert!(Date::lire("2026-02-29").is_err());
        assert!(Date::lire("2026-13-01").is_err());
        assert!(Date::lire("6/10/2026").is_err());
        assert_eq!(date("2026-10-06").to_string(), "2026-10-06");
    }
}
