//! Modèle de l'email qui accompagne une facture : objet et message, avec des variables
//! entre accolades, `{prénom}`, `{numéro}`…, remplacées à l'envoi.

use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase};

pub const PARAMETRE_EMAIL_FACTURE: &str = "emails.facture";

/// Les variables proposées, dans l'ordre où les montre l'écran de réglage.
pub const VARIABLES: [&str; 8] = ["prénom", "nom", "document", "numéro", "date", "montant", "praticien", "téléphone"];

#[derive(Debug, thiserror::Error)]
pub enum ErreurEmail {
    #[error("{0}")]
    Invalide(&'static str),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ModeleEmail {
    pub objet: String,
    pub message: String,
}

impl Default for ModeleEmail {
    fn default() -> Self {
        Self {
            objet: "Votre {document} n° {numéro}".into(),
            message: "Bonjour {prénom} {nom},\n\nVeuillez trouver ci-joint votre {document} n° {numéro} du {date}, d'un montant de {montant}.\n\nBien cordialement,\n{praticien}\n{téléphone}".into(),
        }
    }
}

pub fn lire(base: &Base) -> Result<ModeleEmail, ErreurEmail> {
    Ok(base.lire_parametre(PARAMETRE_EMAIL_FACTURE)?.unwrap_or_default())
}

/// Un objet ou un message vide reprend le texte proposé d'origine.
pub fn enregistrer(base: &Base, modele: &ModeleEmail) -> Result<ModeleEmail, ErreurEmail> {
    let origine = ModeleEmail::default();
    let objet = modele.objet.trim();
    let message = modele.message.trim().replace("\r\n", "\n");
    if objet.chars().count() > 200 || message.chars().count() > 4000 {
        return Err(ErreurEmail::Invalide("l'objet tient en 200 caractères, le message en 4 000"));
    }
    let propre = ModeleEmail {
        objet: if objet.is_empty() { origine.objet } else { objet.to_owned() },
        message: if message.is_empty() { origine.message } else { message },
    };
    let avant = lire(base)?;
    base.ecrire_parametre(PARAMETRE_EMAIL_FACTURE, &propre)?;
    let json = |m: &ModeleEmail| serde_json::to_string(m).ok();
    base.journaliser("emails.modele", PARAMETRE_EMAIL_FACTURE, json(&avant).as_deref(), json(&propre).as_deref())?;
    Ok(propre)
}

/// Sans accents ni majuscules : `{Prénom}`, `{prenom}` et `{PRÉNOM}` désignent la même variable.
fn cle(nom: &str) -> String {
    nom.trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            autre => autre,
        })
        .collect()
}

/// Remplace les variables connues ; une accolade sans variable connue reste telle quelle.
/// Une variable vide (pas de téléphone, par exemple) laisse sa ligne vide disparaître.
pub fn remplir(texte: &str, valeurs: &[(&str, String)]) -> String {
    let mut sortie = String::with_capacity(texte.len());
    let mut reste = texte;
    while let Some(debut) = reste.find('{') {
        sortie.push_str(&reste[..debut]);
        let apres = &reste[debut + 1..];
        match apres.find(['}', '{', '\n']).filter(|&fin| apres.as_bytes()[fin] == b'}') {
            Some(fin) => {
                let nom = &apres[..fin];
                match valeurs.iter().find(|(v, _)| cle(v) == cle(nom)) {
                    Some((_, valeur)) => sortie.push_str(valeur),
                    None => sortie.push_str(&reste[debut..debut + fin + 2]),
                }
                reste = &apres[fin + 1..];
            }
            None => {
                sortie.push('{');
                reste = apres;
            }
        }
    }
    sortie.push_str(reste);
    let lignes: Vec<&str> = sortie.split('\n').collect();
    let originales: Vec<&str> = texte.split('\n').collect();
    if lignes.len() != originales.len() {
        return sortie;
    }
    lignes
        .iter()
        .zip(&originales)
        .filter(|(remplie, origine)| !(remplie.trim().is_empty() && !origine.trim().is_empty()))
        .map(|(remplie, _)| remplie.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;

    fn valeurs() -> Vec<(&'static str, String)> {
        vec![
            ("prénom", "Camille".into()),
            ("nom", "Martin".into()),
            ("document", "facture".into()),
            ("numéro", "2026-10-1772".into()),
            ("date", "6 octobre 2026".into()),
            ("montant", "55,00 €".into()),
            ("praticien", "Alexandre Roux".into()),
            ("téléphone", String::new()),
        ]
    }

    #[test]
    fn remplit_les_variables() {
        let modele = ModeleEmail::default();
        assert_eq!(remplir(&modele.objet, &valeurs()), "Votre facture n° 2026-10-1772");
        assert_eq!(
            remplir(&modele.message, &valeurs()),
            "Bonjour Camille Martin,\n\nVeuillez trouver ci-joint votre facture n° 2026-10-1772 du 6 octobre 2026, d'un montant de 55,00 €.\n\nBien cordialement,\nAlexandre Roux"
        );
        assert_eq!(remplir("{PRENOM} {Inconnue} {nom", &valeurs()), "Camille {Inconnue} {nom");
        assert_eq!(remplir("{ {prenom}}", &valeurs()), "{ Camille}");
    }

    #[test]
    fn garde_le_modele() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        assert_eq!(lire(&base).unwrap(), ModeleEmail::default());
        let garde = enregistrer(&base, &ModeleEmail { objet: "  Votre {document}  ".into(), message: String::new() }).unwrap();
        assert_eq!((garde.objet.as_str(), garde.message.as_str()), ("Votre {document}", ModeleEmail::default().message.as_str()));
        assert_eq!(lire(&base).unwrap(), garde);
    }
}
