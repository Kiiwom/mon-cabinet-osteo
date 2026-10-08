//! Classeurs Excel (.xlsx) des exports : une feuille par tableau, en-têtes en gras et figés,
//! filtre sur chaque colonne, montants en euros et dates au format français.

use rust_xlsxwriter::{ExcelDateTime, Format, FormatAlign, Workbook, XlsxError};
use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Genre {
    Texte,
    Nombre,
    /// En euros : `55.5` s'affiche « 55,50 € ».
    Montant,
    /// `AAAA-MM-JJ`, ou `AAAA-MM-JJTHH:MM` avec l'heure.
    Date,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Colonne {
    pub titre: String,
    pub genre: Genre,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Feuille {
    pub nom: String,
    pub colonnes: Vec<Colonne>,
    /// Une ligne par rangée : texte, nombre ou `null` pour une case vide.
    pub lignes: Vec<Vec<Value>>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurTableur {
    #[error("classeur sans feuille")]
    Vide,
    #[error("classeur Excel : {0}")]
    Xlsx(#[from] XlsxError),
}

/// Excel refuse dans un nom de feuille `[ ] : * ? / \` et plus de 31 caractères.
fn nom_de_feuille(nom: &str, rang: usize) -> String {
    let propre: String = nom.chars().map(|c| if "[]:*?/\\".contains(c) { '-' } else { c }).take(31).collect();
    let propre = propre.trim().trim_matches('\'').to_owned();
    if propre.is_empty() { format!("Feuille {}", rang + 1) } else { propre }
}

pub fn classeur(feuilles: &[Feuille]) -> Result<Vec<u8>, ErreurTableur> {
    if feuilles.is_empty() {
        return Err(ErreurTableur::Vide);
    }
    let mut classeur = Workbook::new();
    let entete = Format::new().set_bold().set_background_color("F3EDE3").set_border_bottom(rust_xlsxwriter::FormatBorder::Thin);
    let entete_nombre = entete.clone().set_align(FormatAlign::Right);
    let montant = Format::new().set_num_format("#,##0.00\\ \"€\"");
    let date = Format::new().set_num_format("dd/mm/yyyy");
    let date_heure = Format::new().set_num_format("dd/mm/yyyy hh:mm");
    let texte = Format::new();
    for (rang, feuille) in feuilles.iter().enumerate() {
        let page = classeur.add_worksheet();
        page.set_name(nom_de_feuille(&feuille.nom, rang))?;
        for (c, colonne) in feuille.colonnes.iter().enumerate() {
            let format = if matches!(colonne.genre, Genre::Montant | Genre::Nombre) { &entete_nombre } else { &entete };
            page.write_string_with_format(0, c as u16, &colonne.titre, format)?;
        }
        for (l, ligne) in feuille.lignes.iter().enumerate() {
            let rangee = l as u32 + 1;
            for (c, (valeur, colonne)) in ligne.iter().zip(&feuille.colonnes).enumerate() {
                let c = c as u16;
                match (colonne.genre, valeur) {
                    (_, Value::Null) => {}
                    (Genre::Montant, Value::Number(n)) => {
                        page.write_number_with_format(rangee, c, n.as_f64().unwrap_or_default(), &montant)?;
                    }
                    (Genre::Nombre, Value::Number(n)) => {
                        page.write_number(rangee, c, n.as_f64().unwrap_or_default())?;
                    }
                    (Genre::Date, Value::String(t)) if !t.trim().is_empty() => match ExcelDateTime::parse_from_str(t) {
                        Ok(jour) => {
                            page.write_datetime_with_format(rangee, c, &jour, if t.contains('T') || t.contains(' ') { &date_heure } else { &date })?;
                        }
                        Err(_) => {
                            page.write_string_with_format(rangee, c, t, &texte)?;
                        }
                    },
                    (_, Value::String(t)) => {
                        page.write_string_with_format(rangee, c, t, &texte)?;
                    }
                    (_, Value::Bool(b)) => {
                        page.write_string_with_format(rangee, c, if *b { "oui" } else { "non" }, &texte)?;
                    }
                    (_, autre) => {
                        page.write_string_with_format(rangee, c, autre.to_string(), &texte)?;
                    }
                }
            }
        }
        if !feuille.colonnes.is_empty() {
            let derniere = feuille.colonnes.len() as u16 - 1;
            page.set_freeze_panes(1, 0)?;
            page.autofilter(0, 0, feuille.lignes.len() as u32, derniere)?;
            page.set_autofit_max_width(400).autofit();
        }
    }
    Ok(classeur.save_to_buffer()?)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn ecrit_un_classeur() {
        let feuilles: Vec<Feuille> = serde_json::from_value(json!([{
            "nom": "Recettes: octobre/2026",
            "colonnes": [
                { "titre": "Encaissé le", "genre": "date" },
                { "titre": "Patient", "genre": "texte" },
                { "titre": "Montant", "genre": "montant" },
                { "titre": "Séances", "genre": "nombre" },
            ],
            "lignes": [["2026-10-06", "Camille Martin", 55.0, 1], ["pas une date", null, -12.5, 2]],
        }]))
        .unwrap();
        let octets = classeur(&feuilles).unwrap();
        assert!(octets.starts_with(b"PK"), "un .xlsx est une archive zip");
        assert_eq!(nom_de_feuille("Recettes: octobre/2026", 0), "Recettes- octobre-2026");
        assert_eq!(nom_de_feuille(" ", 2), "Feuille 3");
        assert!(matches!(classeur(&[]), Err(ErreurTableur::Vide)));
    }
}
