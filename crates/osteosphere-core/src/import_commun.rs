//! Ce que partagent les imports (MonCabinetLibéral, tableur, LibreOsteo) : erreurs, compteurs du
//! rapport, liens vers les lignes d'origine pour qu'un second import ne recopie rien, et la fiche
//! patient rendue admissible sans rien perdre.

use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{Value, json};

use crate::base::{Base, ErreurBase, maintenant};
use crate::numerotation::Date;
use crate::patients::FichePatient;

#[derive(Debug, thiserror::Error)]
pub enum ErreurImport {
    #[error("{0}")]
    Archive(String),
    #[error("import : {0}")]
    Donnees(String),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurImport {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

pub(crate) fn donnees(erreur: impl std::fmt::Display) -> ErreurImport {
    ErreurImport::Donnees(erreur.to_string())
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Compteur {
    pub crees: i64,
    pub deja: i64,
    pub ignores: i64,
}

/// Minuscules sans accents, mots séparés par une espace.
pub(crate) fn normaliser(texte: &str) -> String {
    texte
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'À' | 'Â' | 'Ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'î' | 'ï' | 'Î' | 'Ï' => 'i',
            'ô' | 'ö' | 'Ô' | 'Ö' => 'o',
            'ù' | 'û' | 'ü' | 'Ù' | 'Û' | 'Ü' => 'u',
            'ç' | 'Ç' => 'c',
            c if c.is_alphanumeric() => c.to_ascii_lowercase(),
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Document d'éditeur d'un paragraphe par ligne, pour les textes importés.
pub(crate) fn document(texte: &str) -> Value {
    json!({
        "type": "doc",
        "content": texte.split('\n').map(|l| if l.is_empty() { json!({ "type": "paragraph" }) } else { json!({ "type": "paragraph", "content": [{ "type": "text", "text": l }] }) }).collect::<Vec<_>>(),
    })
}

pub(crate) fn lien(base: &Base, source: &str, nature: &str, cle: &str) -> Result<Option<String>, ErreurImport> {
    Ok(base
        .connexion()
        .query_row("SELECT id FROM liens_import WHERE source = ?1 AND nature = ?2 AND cle = ?3", [source, nature, cle], |l| l.get(0))
        .optional()?)
}

pub(crate) fn lier(base: &Base, source: &str, nature: &str, cle: &str, id: &str) -> Result<(), ErreurImport> {
    base.connexion().execute(
        "INSERT INTO liens_import (source, nature, cle, id, importe_le) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![source, nature, cle, id, maintenant()],
    )?;
    Ok(())
}

/// Identité qui signale un doublon possible : nom, prénom et date de naissance, sans accents.
pub(crate) fn cle_identite(nom: &str, prenom: &str, naissance: Option<&str>) -> String {
    format!("{}|{}|{}", normaliser(nom), normaliser(prenom), naissance.unwrap_or(""))
}

fn email_complet(email: &str) -> bool {
    email.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with('.') && !b.ends_with('.'))
}

/// La fiche rendue admissible : ce qui est hors format (email incomplet, code postal étranger,
/// naissance dans le futur ou avant 1900) part dans les remarques, avec l'origine, au lieu d'être perdu.
pub(crate) fn fiche_admissible(mut fiche: FichePatient, origine: &str) -> FichePatient {
    let mut remarques: Vec<String> = vec![fiche.remarques.trim().to_owned()];
    if !fiche.email.trim().is_empty() && !email_complet(fiche.email.trim()) {
        remarques.push(format!("Email repris {origine}, incomplet : {}", fiche.email.trim()));
        fiche.email.clear();
    }
    let code_postal: String = fiche.code_postal.split_whitespace().collect();
    let francais = fiche.pays.trim().is_empty() || fiche.pays.trim().eq_ignore_ascii_case("france");
    if francais && !code_postal.is_empty() && !(code_postal.len() == 5 && code_postal.bytes().all(|o| o.is_ascii_digit())) {
        remarques.push(format!("Code postal repris {origine} : {code_postal}"));
        fiche.code_postal.clear();
    } else {
        fiche.code_postal = code_postal;
    }
    if let Some(naissance) = fiche.naissance.clone() {
        let lue = Date::lire(&naissance).ok();
        let admissible = lue.is_some_and(|d| d.annee() >= 1900 && d <= Date::du_jour_utc(1));
        if !admissible {
            remarques.push(format!("Date de naissance reprise {origine}, invalide : {naissance}"));
            fiche.naissance = None;
        }
    }
    if let Some(consentement) = fiche.consentement_le.clone()
        && Date::lire(&consentement).map_or(true, |d| d.annee() < 1900)
    {
        fiche.consentement_le = None;
    }
    fiche.remarques = remarques.into_iter().filter(|r| !r.is_empty()).collect::<Vec<_>>().join("\n");
    fiche
}
