//! Liste de patients depuis un tableur : CSV (UTF-8 ou Windows), classeur Excel (.xlsx) ou
//! LibreOffice (.ods).
//!
//! Comme tout import : le fichier est lu et vérifié sans rien écrire ; chaque colonne est rapprochée
//! d'un champ de la fiche, et le praticien peut changer ce choix ; une colonne sans équivalent part
//! dans les remarques ; les doublons possibles sont gardés et signalés ; un second import ne recopie
//! pas les patients déjà repris ; le fichier n'est jamais modifié. La sauvegarde avant l'import est
//! faite par l'application, juste avant [`importer`].

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};

use serde::{Deserialize, Serialize};

use crate::base::Base;
use crate::horloge;
use crate::import_commun::{Compteur, ErreurImport, cle_identite, fiche_admissible, lien, lier, normaliser};
use crate::numerotation::Date;
use crate::patients::{self, FichePatient};

const SOURCE: &str = "tableur";
const ORIGINE: &str = "du tableur";
const LIGNES_MAX: usize = 50_000;
const COLONNES_MAX: usize = 200;
const TAILLE_MAX: u64 = 64 * 1024 * 1024;

/// Le champ de la fiche patient qui reçoit une colonne.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cible {
    Ignorer,
    /// « Titre de la colonne : valeur », dans les remarques de la fiche.
    Remarques,
    Nom,
    Prenom,
    /// « MARTIN Camille » dans une seule colonne.
    NomPrenom,
    NomNaissance,
    Naissance,
    Sexe,
    Adresse,
    ComplementAdresse,
    CodePostal,
    Ville,
    Pays,
    /// Rangé en portable ou en fixe d'après le numéro.
    Telephone,
    Portable,
    Fixe,
    Email,
    Profession,
    Activites,
    MedecinTraitant,
    NotesImportantes,
    Consentement,
}

impl Cible {
    /// Les cibles qu'une seule colonne peut recevoir.
    fn unique(self) -> bool {
        !matches!(self, Cible::Ignorer | Cible::Remarques | Cible::Telephone)
    }
}

/// Le tableau lu, toutes cellules en texte ; les dates des classeurs sont en `AAAA-MM-JJ`.
#[derive(Debug, Default)]
struct Tableau {
    feuille: String,
    lignes: Vec<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ColonneTableur {
    pub titre: String,
    pub cible: Cible,
    /// Trois premières valeurs non vides, pour reconnaître la colonne.
    pub exemples: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EtatLigne {
    Nouveau,
    /// Même nom, prénom et naissance qu'un dossier du cabinet ou qu'une autre ligne : gardé et signalé.
    DoublonPossible,
    DejaImporte,
    /// Sans nom ou sans prénom : laissée de côté.
    Incomplet,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ApercuLigne {
    pub ligne: usize,
    pub nom: String,
    pub prenom: String,
    pub naissance: Option<String>,
    pub ville: String,
    pub etat: EtatLigne,
}

/// Ce que le tableur contient, lu sans rien écrire, avec la correspondance des colonnes.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AnalyseTableur {
    pub format: String,
    pub feuille: String,
    pub colonnes: Vec<ColonneTableur>,
    /// Lignes de patients, sans la ligne des titres ni les lignes vides.
    pub lignes: usize,
    pub nouveaux: usize,
    pub doublons: usize,
    pub deja_importes: usize,
    pub incompletes: usize,
    /// Faux tant qu'aucune colonne ne donne le nom et le prénom.
    pub importable: bool,
    pub points: Vec<String>,
    pub apercu: Vec<ApercuLigne>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct RapportTableur {
    pub patients: Compteur,
    pub doublons: Vec<String>,
    pub avertissements: Vec<String>,
}

impl RapportTableur {
    pub fn en_texte(&self, fichier: &str, sauvegarde: &str, maintenant: i64) -> String {
        let (date, h, m) = horloge::paris(maintenant);
        let c = &self.patients;
        let mut texte = vec![
            format!("Import d’un tableur du {} à {h:02}h{m:02}", date.en_toutes_lettres()),
            format!("Fichier : {fichier}"),
            format!("Sauvegarde faite juste avant l’import : {sauvegarde}"),
            String::new(),
            format!("Patients : {} créé(s), {} déjà importé(s), {} laissé(s) de côté.", c.crees, c.deja, c.ignores),
        ];
        if !self.doublons.is_empty() {
            texte.push(String::new());
            texte.push("Doublons possibles, gardés, à comparer dans la liste des patients :".into());
            texte.extend(self.doublons.iter().map(|d| format!("- {d}")));
        }
        if !self.avertissements.is_empty() {
            texte.push(String::new());
            texte.push("À vérifier :".into());
            texte.extend(self.avertissements.iter().map(|a| format!("- {a}")));
        }
        texte.join("\n") + "\n"
    }
}

fn invalide(message: impl Into<String>) -> ErreurImport {
    ErreurImport::Archive(message.into())
}

// ---------------------------------------------------------------------------------------------
// Lecture des fichiers
// ---------------------------------------------------------------------------------------------

/// Windows-1252, l'encodage des CSV enregistrés par Excel en français.
fn depuis_windows_1252(octets: &[u8]) -> String {
    const SPECIAUX: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜',
        '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    octets
        .iter()
        .map(|&o| if (0x80..0xa0).contains(&o) { SPECIAUX[(o - 0x80) as usize] } else { o as char })
        .collect()
}

fn lire_csv(contenu: &[u8]) -> Result<Tableau, ErreurImport> {
    let contenu = contenu.strip_prefix(b"\xef\xbb\xbf").unwrap_or(contenu);
    let texte = match std::str::from_utf8(contenu) {
        Ok(texte) => texte.to_owned(),
        Err(_) => depuis_windows_1252(contenu),
    };
    // Le séparateur le plus présent dans la première ligne : « ; » pour Excel en français.
    let premiere = texte.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let separateur = b";,\t|"
        .iter()
        .copied()
        .max_by_key(|s| (premiere.bytes().filter(|o| o == s).count(), *s == b';'))
        .unwrap_or(b';');
    let mut lecteur = csv::ReaderBuilder::new().delimiter(separateur).has_headers(false).flexible(true).from_reader(texte.as_bytes());
    let mut lignes = Vec::new();
    for enregistrement in lecteur.records() {
        let enregistrement = enregistrement.map_err(|_| invalide("Ce fichier CSV contient une ligne mal formée (guillemet non refermé ?)."))?;
        lignes.push(enregistrement.iter().take(COLONNES_MAX).map(|c| c.trim().to_owned()).collect());
        if lignes.len() > LIGNES_MAX {
            return Err(invalide("Plus de 50 000 lignes : découpez le fichier en plusieurs parties."));
        }
    }
    Ok(Tableau { feuille: String::new(), lignes })
}

fn entree_zip(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, nom: &str) -> Result<Option<String>, ErreurImport> {
    let Ok(mut entree) = zip.by_name(nom) else { return Ok(None) };
    if entree.size() > TAILLE_MAX {
        return Err(invalide("Classeur trop volumineux pour cet import."));
    }
    let mut texte = String::new();
    entree.read_to_string(&mut texte).map_err(|_| invalide("Classeur abîmé."))?;
    Ok(Some(texte))
}

fn xml(texte: &str) -> Result<roxmltree::Document<'_>, ErreurImport> {
    roxmltree::Document::parse(texte).map_err(|_| invalide("Classeur abîmé : XML illisible."))
}

/// « AB » → 27 : rang de colonne d'une référence de cellule Excel (« AB12 »).
fn rang_colonne(reference: &str) -> Option<usize> {
    let lettres: String = reference.chars().take_while(char::is_ascii_alphabetic).collect();
    if lettres.is_empty() {
        return None;
    }
    lettres.chars().try_fold(0usize, |rang, c| Some(rang * 26 + (c.to_ascii_uppercase() as usize - 'A' as usize + 1))).map(|r| r - 1)
}

/// Date Excel (jours depuis le 30 décembre 1899) en `AAAA-MM-JJ`.
fn date_excel(valeur: f64) -> Option<String> {
    if !(1.0..2_958_466.0).contains(&valeur) {
        return None;
    }
    Some(Date::depuis_jours_unix(valeur.floor() as i64 - 25_569).to_string())
}

/// Les styles de cellule qui affichent une date : formats intégrés 14 à 22, 45 à 47, ou format
/// personnalisé avec jour, mois ou année.
fn styles_de_date(styles: Option<&str>) -> Result<Vec<bool>, ErreurImport> {
    let Some(styles) = styles else { return Ok(Vec::new()) };
    let document = xml(styles)?;
    let mut formats_date: HashSet<u32> = (14..=22).chain(45..=47).collect();
    for format in document.descendants().filter(|n| n.has_tag_name("numFmt")) {
        let code = format.attribute("formatCode").unwrap_or("").to_lowercase();
        // Sans les textes entre guillemets ni les couleurs entre crochets.
        let mut propre = String::new();
        let mut dans = None;
        for c in code.chars() {
            match (dans, c) {
                (None, '"') => dans = Some('"'),
                (None, '[') => dans = Some(']'),
                (Some('"'), '"') | (Some(']'), ']') => dans = None,
                (None, c) => propre.push(c),
                _ => {}
            }
        }
        let date = propre.contains('d') || propre.contains('y') || (propre.contains('m') && !propre.contains('h') && !propre.contains('s'));
        if date && let Some(id) = format.attribute("numFmtId").and_then(|i| i.parse().ok()) {
            formats_date.insert(id);
        }
    }
    let Some(xfs) = document.descendants().find(|n| n.has_tag_name("cellXfs")) else { return Ok(Vec::new()) };
    Ok(xfs
        .children()
        .filter(|n| n.has_tag_name("xf"))
        .map(|xf| xf.attribute("numFmtId").and_then(|i| i.parse().ok()).is_some_and(|id: u32| formats_date.contains(&id)))
        .collect())
}

fn texte_des_t(noeud: roxmltree::Node<'_, '_>) -> String {
    // Le texte d'une chaîne Excel, sans les indications phonétiques (`rPh`).
    noeud
        .descendants()
        .filter(|n| n.has_tag_name("t") && !n.ancestors().any(|a| a.has_tag_name("rPh")))
        .filter_map(|n| n.text())
        .collect()
}

fn lire_xlsx(contenu: &[u8]) -> Result<Tableau, ErreurImport> {
    let mut zip = zip::ZipArchive::new(Cursor::new(contenu)).map_err(|_| invalide("Classeur Excel illisible."))?;
    let classeur = entree_zip(&mut zip, "xl/workbook.xml")?.ok_or_else(|| invalide("Ce fichier n’est pas un classeur Excel .xlsx."))?;
    let liens = entree_zip(&mut zip, "xl/_rels/workbook.xml.rels")?.unwrap_or_default();
    let (feuille, cible) = {
        let classeur = xml(&classeur)?;
        let premiere = classeur.descendants().find(|n| n.has_tag_name("sheet")).ok_or_else(|| invalide("Ce classeur ne contient aucune feuille."))?;
        let nom = premiere.attribute("name").unwrap_or("").to_owned();
        let id = premiere.attributes().find(|a| a.name() == "id").map(|a| a.value().to_owned()).unwrap_or_default();
        let liens = xml(if liens.is_empty() { "<Relationships/>" } else { &liens })?;
        let cible = liens
            .descendants()
            .find(|n| n.has_tag_name("Relationship") && n.attribute("Id") == Some(id.as_str()))
            .and_then(|n| n.attribute("Target"))
            .map(|t| if let Some(absolu) = t.strip_prefix('/') { absolu.to_owned() } else { format!("xl/{t}") })
            .unwrap_or_else(|| "xl/worksheets/sheet1.xml".into());
        (nom, cible)
    };
    if cible.split('/').any(|p| p == "..") {
        return Err(invalide("Chemin de feuille invalide dans le classeur."));
    }
    let partagees: Vec<String> = match entree_zip(&mut zip, "xl/sharedStrings.xml")? {
        Some(texte) => xml(&texte)?.root_element().children().filter(|n| n.has_tag_name("si")).map(texte_des_t).collect(),
        None => Vec::new(),
    };
    let styles_xml = entree_zip(&mut zip, "xl/styles.xml")?;
    let dates = styles_de_date(styles_xml.as_deref())?;
    let feuille_xml = entree_zip(&mut zip, &cible)?.ok_or_else(|| invalide("La première feuille du classeur est introuvable."))?;
    let document = xml(&feuille_xml)?;
    let mut lignes: Vec<Vec<String>> = Vec::new();
    for ligne in document.descendants().filter(|n| n.has_tag_name("row")) {
        let mut cellules: Vec<String> = Vec::new();
        for cellule in ligne.children().filter(|n| n.has_tag_name("c")) {
            let rang = cellule.attribute("r").and_then(rang_colonne).unwrap_or(cellules.len());
            if rang >= COLONNES_MAX {
                continue;
            }
            let v = cellule.children().find(|n| n.has_tag_name("v")).and_then(|n| n.text()).unwrap_or("");
            let valeur = match cellule.attribute("t") {
                Some("s") => v.parse::<usize>().ok().and_then(|i| partagees.get(i)).cloned().unwrap_or_default(),
                Some("inlineStr") => cellule.children().find(|n| n.has_tag_name("is")).map(texte_des_t).unwrap_or_default(),
                Some("b") => if v == "1" { "oui" } else { "non" }.to_owned(),
                Some("e") => String::new(),
                Some(_) => v.to_owned(),
                None => {
                    let style = cellule.attribute("s").and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
                    match v.parse::<f64>() {
                        Ok(nombre) if dates.get(style).copied().unwrap_or(false) => date_excel(nombre).unwrap_or_else(|| v.to_owned()),
                        // Un entier stocké en nombre (code postal, téléphone) garde ses chiffres.
                        Ok(nombre) if nombre.fract() == 0.0 && nombre.abs() < 1e15 => format!("{}", nombre as i64),
                        _ => v.to_owned(),
                    }
                }
            };
            if cellules.len() <= rang {
                cellules.resize(rang + 1, String::new());
            }
            cellules[rang] = valeur.trim().to_owned();
        }
        let rang = ligne.attribute("r").and_then(|r| r.parse::<usize>().ok()).map(|r| r.saturating_sub(1)).unwrap_or(lignes.len());
        if rang > LIGNES_MAX {
            return Err(invalide("Plus de 50 000 lignes : découpez le fichier en plusieurs parties."));
        }
        if lignes.len() < rang {
            lignes.resize(rang, Vec::new());
        }
        lignes.push(cellules);
    }
    Ok(Tableau { feuille, lignes })
}

/// Texte d'une cellule LibreOffice : paragraphes, espaces répétées (`text:s`), retours (`text:line-break`).
fn texte_ods(noeud: roxmltree::Node<'_, '_>) -> String {
    let mut sortie = String::new();
    for paragraphe in noeud.children().filter(|n| n.has_tag_name("p")) {
        if !sortie.is_empty() {
            sortie.push('\n');
        }
        for n in paragraphe.descendants().skip(1) {
            if n.is_text() {
                sortie.push_str(n.text().unwrap_or(""));
            } else if n.has_tag_name("s") {
                let nombre = n.attributes().find(|a| a.name() == "c").and_then(|a| a.value().parse().ok()).unwrap_or(1usize);
                sortie.extend(std::iter::repeat_n(' ', nombre.min(100)));
            } else if n.has_tag_name("line-break") {
                sortie.push('\n');
            } else if n.has_tag_name("tab") {
                sortie.push(' ');
            }
        }
    }
    sortie
}

fn attribut<'a>(noeud: roxmltree::Node<'a, '_>, nom: &str) -> Option<&'a str> {
    noeud.attributes().find(|a| a.name() == nom).map(|a| a.value())
}

fn lire_ods(contenu: &[u8]) -> Result<Tableau, ErreurImport> {
    let mut zip = zip::ZipArchive::new(Cursor::new(contenu)).map_err(|_| invalide("Classeur LibreOffice illisible."))?;
    let texte = entree_zip(&mut zip, "content.xml")?.ok_or_else(|| invalide("Ce fichier n’est pas un classeur LibreOffice .ods."))?;
    let document = xml(&texte)?;
    let table = document.descendants().find(|n| n.has_tag_name("table")).ok_or_else(|| invalide("Ce classeur ne contient aucune feuille."))?;
    let feuille = attribut(table, "name").unwrap_or("").to_owned();
    let mut lignes: Vec<Vec<String>> = Vec::new();
    for ligne in table.descendants().filter(|n| n.has_tag_name("table-row")) {
        let mut cellules: Vec<String> = Vec::new();
        for cellule in ligne.children().filter(|n| n.has_tag_name("table-cell") || n.has_tag_name("covered-table-cell")) {
            let repete = attribut(cellule, "number-columns-repeated").and_then(|r| r.parse().ok()).unwrap_or(1usize);
            let valeur = match attribut(cellule, "value-type") {
                Some("date") => attribut(cellule, "date-value").map(|d| d.chars().take(10).collect()).unwrap_or_default(),
                Some("float" | "percentage" | "currency") => attribut(cellule, "value").map(str::to_owned).unwrap_or_else(|| texte_ods(cellule)),
                _ => texte_ods(cellule),
            };
            let valeur = valeur.trim().to_owned();
            // Les cellules vides répétées jusqu'au bout de la ligne sont retirées ensuite.
            for _ in 0..repete.min(COLONNES_MAX) {
                if cellules.len() >= COLONNES_MAX {
                    break;
                }
                cellules.push(valeur.clone());
            }
        }
        while cellules.last().is_some_and(String::is_empty) {
            cellules.pop();
        }
        let repete = attribut(ligne, "number-rows-repeated").and_then(|r| r.parse().ok()).unwrap_or(1usize);
        if cellules.is_empty() {
            // Les lignes vides répétées (souvent par milliers en fin de feuille) n'en font qu'une.
            lignes.push(Vec::new());
            continue;
        }
        for _ in 0..repete.min(LIGNES_MAX) {
            lignes.push(cellules.clone());
        }
        if lignes.len() > LIGNES_MAX {
            return Err(invalide("Plus de 50 000 lignes : découpez le fichier en plusieurs parties."));
        }
    }
    Ok(Tableau { feuille, lignes })
}

/// Lit le fichier d'après son extension, ou son contenu à défaut.
fn lire(nom: &str, contenu: &[u8]) -> Result<(String, Tableau), ErreurImport> {
    let extension = nom.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    let zip = contenu.starts_with(b"PK\x03\x04");
    match extension.as_str() {
        "xls" => Err(invalide("Les classeurs .xls (Excel 97-2003) ne sont pas lus : enregistrez-le au format .xlsx ou .csv.")),
        "xlsx" | "xlsm" => Ok(("Classeur Excel".into(), lire_xlsx(contenu)?)),
        "ods" => Ok(("Classeur LibreOffice".into(), lire_ods(contenu)?)),
        _ if zip => {
            let mut archive = zip::ZipArchive::new(Cursor::new(contenu)).map_err(|_| invalide("Fichier illisible."))?;
            if archive.by_name("xl/workbook.xml").is_ok() {
                Ok(("Classeur Excel".into(), lire_xlsx(contenu)?))
            } else if archive.by_name("content.xml").is_ok() {
                Ok(("Classeur LibreOffice".into(), lire_ods(contenu)?))
            } else {
                Err(invalide("Ce fichier n’est ni un tableur CSV, ni un classeur Excel ou LibreOffice."))
            }
        }
        _ => Ok(("Fichier CSV".into(), lire_csv(contenu)?)),
    }
}

// ---------------------------------------------------------------------------------------------
// Correspondance des colonnes
// ---------------------------------------------------------------------------------------------

/// La cible proposée pour un titre de colonne.
fn cible_proposee(titre: &str) -> Cible {
    let t = normaliser(titre);
    let mots: Vec<&str> = t.split(' ').collect();
    let a = |mot: &str| mots.contains(&mot);
    match t.as_str() {
        "" => return Cible::Remarques,
        "id" | "n" | "no" | "num" | "numero" | "identifiant" | "code patient" | "n dossier" | "numero de dossier" | "dossier" => return Cible::Ignorer,
        "nom" | "nom de famille" | "nom d usage" | "nom patient" | "patient nom" | "last name" | "lastname" | "family name" | "surname" => return Cible::Nom,
        "prenom" | "prenoms" | "first name" | "firstname" | "given name" => return Cible::Prenom,
        "patient" | "nom prenom" | "nom et prenom" | "nom complet" | "identite" | "prenom nom" => return Cible::NomPrenom,
        "nom de naissance" | "nom de jeune fille" | "nee" | "nom naissance" | "original name" => return Cible::NomNaissance,
        "sexe" | "genre" | "civilite" | "sex" | "gender" | "titre" => return Cible::Sexe,
        "adresse" | "adresse 1" | "adresse1" | "rue" | "voie" | "adresse postale" | "street" | "address" => return Cible::Adresse,
        "adresse 2" | "adresse2" | "complement" | "complement d adresse" | "complement adresse" | "lieu dit" => return Cible::ComplementAdresse,
        "code postal" | "cp" | "zip" | "zipcode" | "code" | "postal" => return Cible::CodePostal,
        "ville" | "commune" | "localite" | "city" => return Cible::Ville,
        "pays" | "country" => return Cible::Pays,
        "profession" | "metier" | "emploi" | "job" | "activite professionnelle" => return Cible::Profession,
        "activites" | "loisirs" | "sport" | "sports" | "hobbies" | "activite physique" => return Cible::Activites,
        "medecin" | "medecin traitant" | "docteur" | "generaliste" | "medecin generaliste" => return Cible::MedecinTraitant,
        "allergie" | "allergies" | "contre indication" | "contre indications" | "note importante" | "notes importantes" | "alerte" => return Cible::NotesImportantes,
        "consentement" | "date de consentement" | "date du consentement" | "rgpd" => return Cible::Consentement,
        _ => {}
    }
    if t.contains("naissance") && !a("lieu") && !t.starts_with("nom") || a("ddn") || t.contains("birth") || t == "ne le" || t == "nee le" {
        Cible::Naissance
    } else if t.contains("mail") || t.contains("courriel") {
        Cible::Email
    } else if a("portable") || a("mobile") || a("gsm") {
        Cible::Portable
    } else if a("fixe") || a("domicile") {
        Cible::Fixe
    } else if a("tel") || a("telephone") || a("phone") {
        Cible::Telephone
    } else if t.contains("postal") {
        Cible::CodePostal
    } else if a("prenom") {
        Cible::Prenom
    } else if mots.first() == Some(&"nom") {
        Cible::Nom
    } else {
        Cible::Remarques
    }
}

/// Une cible par colonne : la proposée, une seule fois chacune ; les suivantes vont aux remarques.
fn correspondance_proposee(titres: &[String]) -> Vec<Cible> {
    let mut prises = HashSet::new();
    titres
        .iter()
        .map(|t| {
            let cible = cible_proposee(t);
            if cible.unique() && !prises.insert(cible) { Cible::Remarques } else { cible }
        })
        .collect()
}

/// Date de cellule : `AAAA-MM-JJ`, `JJ/MM/AAAA`, `JJ-MM-AAAA`, `JJ.MM.AAAA`, année sur deux chiffres
/// comprise, heure ignorée.
fn date_cellule(valeur: &str) -> Option<String> {
    let v = valeur.trim().split([' ', 'T']).next().unwrap_or("");
    if v.len() == 10 && v.as_bytes()[4] == b'-' {
        return Date::lire(v).ok().map(|d| d.to_string());
    }
    let parties: Vec<&str> = v.split(['/', '-', '.']).collect();
    let [jour, mois, annee] = parties.as_slice() else { return None };
    let (jour, mois): (u32, u32) = (jour.parse().ok()?, mois.parse().ok()?);
    let annee: i32 = match annee.len() {
        4 => annee.parse().ok()?,
        2 => {
            let a: i32 = annee.parse().ok()?;
            let siecle = if a > Date::du_jour_utc(0).annee() % 100 { 1900 } else { 2000 };
            siecle + a
        }
        _ => return None,
    };
    Date::lire(&format!("{annee:04}-{mois:02}-{jour:02}")).ok().map(|d| d.to_string())
}

fn sexe_cellule(valeur: &str) -> Option<&'static str> {
    match normaliser(valeur).as_str() {
        "m" | "h" | "homme" | "masculin" | "monsieur" | "mr" | "male" | "garcon" => Some("M"),
        "f" | "femme" | "feminin" | "madame" | "mme" | "mlle" | "mademoiselle" | "female" | "fille" => Some("F"),
        _ => None,
    }
}

/// Numéro de portable en France : 06, 07, ou leur forme internationale.
fn est_portable(numero: &str) -> bool {
    let chiffres: String = numero.chars().filter(char::is_ascii_digit).collect();
    let national = if let Some(reste) = chiffres.strip_prefix("0033") {
        format!("0{reste}")
    } else if numero.trim_start().starts_with('+') && chiffres.starts_with("33") {
        format!("0{}", &chiffres[2..])
    } else {
        chiffres
    };
    national.starts_with("06") || national.starts_with("07")
}

/// « MARTIN Camille » ou « Martin Camille » : les mots en capitales font le nom, sinon le premier.
fn separer_nom_prenom(valeur: &str) -> (String, String) {
    let mots: Vec<&str> = valeur.split_whitespace().collect();
    let capitales = |m: &str| m.chars().any(char::is_alphabetic) && m.chars().filter(|c| c.is_alphabetic()).all(char::is_uppercase) && m.chars().filter(|c| c.is_alphabetic()).count() > 1;
    let en_capitales = mots.iter().take_while(|m| capitales(m)).count();
    let coupe = if en_capitales > 0 && en_capitales < mots.len() { en_capitales } else { 1.min(mots.len()) };
    (mots[..coupe].join(" "), mots[coupe..].join(" "))
}

/// Une ligne du tableur devenue fiche patient.
struct LigneLue {
    numero: usize,
    fiche: FichePatient,
}

fn fiche_de_ligne(titres: &[String], cibles: &[Cible], cellules: &[String], numero: usize) -> LigneLue {
    let mut fiche = FichePatient::default();
    let mut remarques = Vec::new();
    let mut notes = Vec::new();
    for (rang, cible) in cibles.iter().enumerate() {
        let valeur = cellules.get(rang).map(|v| v.trim()).unwrap_or("");
        if valeur.is_empty() {
            continue;
        }
        let titre = titres.get(rang).map(String::as_str).filter(|t| !t.is_empty()).unwrap_or("Colonne");
        match cible {
            Cible::Ignorer => {}
            Cible::Remarques => remarques.push(format!("{titre} : {valeur}")),
            Cible::Nom => fiche.nom = valeur.into(),
            Cible::Prenom => fiche.prenom = valeur.into(),
            Cible::NomPrenom => {
                let (nom, prenom) = separer_nom_prenom(valeur);
                if fiche.nom.is_empty() {
                    fiche.nom = nom;
                }
                if fiche.prenom.is_empty() {
                    fiche.prenom = prenom;
                }
            }
            Cible::NomNaissance => fiche.nom_naissance = valeur.into(),
            Cible::Naissance => match date_cellule(valeur) {
                Some(date) => fiche.naissance = Some(date),
                None => remarques.push(format!("{titre} (date illisible) : {valeur}")),
            },
            Cible::Consentement => match date_cellule(valeur) {
                Some(date) => fiche.consentement_le = Some(date),
                None => remarques.push(format!("{titre} : {valeur}")),
            },
            Cible::Sexe => match sexe_cellule(valeur) {
                Some(sexe) => fiche.sexe = sexe.into(),
                None => remarques.push(format!("{titre} : {valeur}")),
            },
            Cible::Adresse => fiche.adresse = valeur.into(),
            Cible::ComplementAdresse => fiche.complement_adresse = valeur.into(),
            Cible::CodePostal => fiche.code_postal = valeur.into(),
            Cible::Ville => fiche.ville = valeur.into(),
            Cible::Pays => fiche.pays = valeur.into(),
            Cible::Telephone => {
                let place = if est_portable(valeur) { &mut fiche.portable } else { &mut fiche.fixe };
                if place.is_empty() {
                    *place = valeur.into();
                } else {
                    remarques.push(format!("{titre} : {valeur}"));
                }
            }
            Cible::Portable => fiche.portable = valeur.into(),
            Cible::Fixe => fiche.fixe = valeur.into(),
            Cible::Email => fiche.email = valeur.into(),
            Cible::Profession => fiche.profession = valeur.into(),
            Cible::Activites => fiche.activites = valeur.into(),
            Cible::MedecinTraitant => fiche.medecin_traitant = valeur.into(),
            Cible::NotesImportantes => notes.push(valeur.to_owned()),
        }
    }
    // Un code postal Excel stocké en nombre a perdu son zéro : 1000 → 01000.
    if fiche.code_postal.len() == 4 && fiche.code_postal.bytes().all(|o| o.is_ascii_digit()) {
        fiche.code_postal = format!("0{}", fiche.code_postal);
    }
    fiche.remarques = remarques.join("\n");
    fiche.notes_importantes = notes.join("\n");
    LigneLue { numero, fiche: fiche_admissible(fiche, ORIGINE) }
}

/// Le tableau prêt à importer : titres, cibles et lignes de patients.
struct Lecture {
    format: String,
    feuille: String,
    titres: Vec<String>,
    cibles: Vec<Cible>,
    /// Trois premières valeurs non vides de chaque colonne.
    exemples: Vec<Vec<String>>,
    lignes: Vec<LigneLue>,
}

fn lecture(nom: &str, contenu: &[u8], correspondance: Option<&[Cible]>) -> Result<Lecture, ErreurImport> {
    let (format, tableau) = lire(nom, contenu)?;
    let mut rangees = tableau.lignes.into_iter().enumerate().filter(|(_, l)| l.iter().any(|c| !c.trim().is_empty()));
    let Some((_, titres)) = rangees.next() else {
        return Err(invalide("Ce fichier est vide : la première ligne doit donner le titre des colonnes."));
    };
    let lignes: Vec<(usize, Vec<String>)> = rangees.collect();
    let largeur = lignes.iter().map(|(_, l)| l.len()).chain([titres.len()]).max().unwrap_or(0);
    let mut titres = titres;
    titres.resize(largeur, String::new());
    let cibles = match correspondance {
        Some(choisies) if choisies.len() == largeur => choisies.to_vec(),
        Some(_) => return Err(invalide("Le nombre de colonnes a changé : choisissez de nouveau le fichier.")),
        None => correspondance_proposee(&titres),
    };
    let mut exemples: Vec<Vec<String>> = vec![Vec::new(); largeur];
    for (_, cellules) in lignes.iter().take(200) {
        for (rang, valeur) in cellules.iter().enumerate() {
            if !valeur.is_empty() && exemples[rang].len() < 3 {
                exemples[rang].push(valeur.chars().take(40).collect());
            }
        }
    }
    let lignes = lignes.into_iter().map(|(rang, cellules)| fiche_de_ligne(&titres, &cibles, &cellules, rang + 1)).collect();
    Ok(Lecture { format, feuille: tableau.feuille, titres, cibles, exemples, lignes })
}

/// Clé de chaque ligne pour les liens d'import : identité, numérotée si elle revient dans le fichier.
fn cles(lignes: &[LigneLue]) -> Vec<String> {
    let mut vues: HashMap<String, usize> = HashMap::new();
    lignes
        .iter()
        .map(|l| {
            let base = cle_identite(&l.fiche.nom, &l.fiche.prenom, l.fiche.naissance.as_deref());
            let rang = vues.entry(base.clone()).or_default();
            *rang += 1;
            format!("{base}#{rang}")
        })
        .collect()
}

fn identites_du_cabinet(base: &Base) -> Result<HashSet<String>, ErreurImport> {
    Ok(patients::lister(base)
        .map_err(|e| ErreurImport::Donnees(e.to_string()))?
        .iter()
        .map(|p| cle_identite(&p.nom, &p.prenom, p.naissance.as_deref()))
        .collect())
}

fn complete(fiche: &FichePatient) -> bool {
    !fiche.nom.trim().is_empty() && !fiche.prenom.trim().is_empty()
}

/// Lit le fichier et propose une correspondance des colonnes, ou applique celle du praticien.
/// Rien n'est écrit.
pub fn analyser(base: &Base, nom: &str, contenu: &[u8], correspondance: Option<&[Cible]>) -> Result<AnalyseTableur, ErreurImport> {
    let lecture = lecture(nom, contenu, correspondance)?;
    let cles = cles(&lecture.lignes);
    let cabinet = identites_du_cabinet(base)?;
    let mut dans_le_fichier: HashMap<String, usize> = HashMap::new();
    for l in &lecture.lignes {
        *dans_le_fichier.entry(cle_identite(&l.fiche.nom, &l.fiche.prenom, l.fiche.naissance.as_deref())).or_default() += 1;
    }
    let mut etats = Vec::with_capacity(lecture.lignes.len());
    for (l, cle) in lecture.lignes.iter().zip(&cles) {
        let identite = cle_identite(&l.fiche.nom, &l.fiche.prenom, l.fiche.naissance.as_deref());
        etats.push(if !complete(&l.fiche) {
            EtatLigne::Incomplet
        } else if lien(base, SOURCE, "patient", cle)?.is_some() {
            EtatLigne::DejaImporte
        } else if cabinet.contains(&identite) || dans_le_fichier.get(&identite).copied().unwrap_or(0) > 1 {
            EtatLigne::DoublonPossible
        } else {
            EtatLigne::Nouveau
        });
    }
    let compter = |e: EtatLigne| etats.iter().filter(|x| **x == e).count();
    let importable = lecture.cibles.iter().any(|c| matches!(c, Cible::Nom | Cible::NomPrenom)) && lecture.cibles.iter().any(|c| matches!(c, Cible::Prenom | Cible::NomPrenom));
    let mut points = Vec::new();
    if !importable {
        points.push("Indiquez la colonne du nom et celle du prénom : sans elles, rien ne peut être importé.".to_owned());
    }
    let naissances = lecture.lignes.iter().filter(|l| l.fiche.naissance.is_some()).count();
    if lecture.cibles.contains(&Cible::Naissance) && naissances < lecture.lignes.len() / 2 {
        points.push(format!("Seules {naissances} date(s) de naissance sur {} sont lisibles : vérifiez la colonne choisie.", lecture.lignes.len()));
    }
    let hors_format = lecture.lignes.iter().filter(|l| l.fiche.remarques.contains(&format!("repris {ORIGINE}"))).count();
    if hors_format > 0 {
        points.push(format!("{hors_format} fiche(s) avec un email, un code postal ou une date hors format : la valeur est gardée dans les remarques."));
    }
    let colonnes = lecture
        .titres
        .iter()
        .zip(&lecture.cibles)
        .zip(&lecture.exemples)
        .enumerate()
        .map(|(rang, ((titre, cible), exemples))| ColonneTableur {
            titre: if titre.is_empty() { format!("Colonne {}", rang + 1) } else { titre.clone() },
            cible: *cible,
            exemples: exemples.clone(),
        })
        .collect();
    let apercu = lecture
        .lignes
        .iter()
        .zip(&etats)
        .take(8)
        .map(|(l, etat)| ApercuLigne {
            ligne: l.numero,
            nom: l.fiche.nom.clone(),
            prenom: l.fiche.prenom.clone(),
            naissance: l.fiche.naissance.clone(),
            ville: l.fiche.ville.clone(),
            etat: *etat,
        })
        .collect();
    Ok(AnalyseTableur {
        format: lecture.format,
        feuille: lecture.feuille,
        colonnes,
        lignes: lecture.lignes.len(),
        nouveaux: compter(EtatLigne::Nouveau),
        doublons: compter(EtatLigne::DoublonPossible),
        deja_importes: compter(EtatLigne::DejaImporte),
        incompletes: compter(EtatLigne::Incomplet),
        importable,
        points,
        apercu,
    })
}

/// Importe les patients du tableur, avec la correspondance choisie. Tout ou rien.
pub fn importer(base: &Base, nom: &str, contenu: &[u8], correspondance: &[Cible]) -> Result<RapportTableur, ErreurImport> {
    let lecture = lecture(nom, contenu, Some(correspondance))?;
    if !lecture.cibles.iter().any(|c| matches!(c, Cible::Nom | Cible::NomPrenom)) || !lecture.cibles.iter().any(|c| matches!(c, Cible::Prenom | Cible::NomPrenom)) {
        return Err(invalide("Indiquez la colonne du nom et celle du prénom."));
    }
    let cles = cles(&lecture.lignes);
    let mut rapport = RapportTableur::default();
    base.atomique(|| {
        let mut identites = identites_du_cabinet(base)?;
        let mut incompletes = Vec::new();
        for (ligne, cle) in lecture.lignes.iter().zip(&cles) {
            if !complete(&ligne.fiche) {
                incompletes.push(ligne.numero);
                rapport.patients.ignores += 1;
                continue;
            }
            if let Some(local) = lien(base, SOURCE, "patient", cle)? {
                // Un dossier effacé à la demande du patient ne revient pas.
                if patients::lire(base, &local).is_ok() {
                    rapport.patients.deja += 1;
                } else {
                    rapport.patients.ignores += 1;
                }
                continue;
            }
            let fiche = match ligne.fiche.verifier() {
                Ok(fiche) => fiche,
                Err(erreur) => {
                    rapport.avertissements.push(format!("Ligne {} ({} {}) : {erreur}, laissée de côté.", ligne.numero, ligne.fiche.prenom, ligne.fiche.nom));
                    rapport.patients.ignores += 1;
                    continue;
                }
            };
            let identite = cle_identite(&fiche.nom, &fiche.prenom, fiche.naissance.as_deref());
            if !identites.insert(identite) {
                let naissance = fiche.naissance.as_deref().and_then(|n| Date::lire(n).ok()).map(|d| format!(", né(e) le {}", d.en_toutes_lettres())).unwrap_or_default();
                rapport.doublons.push(format!("{} {}{naissance} (ligne {})", fiche.prenom, fiche.nom, ligne.numero));
            }
            let patient = patients::creer(base, &fiche).map_err(|e| ErreurImport::Donnees(format!("ligne {} : {e}", ligne.numero)))?;
            lier(base, SOURCE, "patient", cle, &patient.id)?;
            rapport.patients.crees += 1;
        }
        if !incompletes.is_empty() {
            let liste = incompletes.iter().take(10).map(usize::to_string).collect::<Vec<_>>().join(", ");
            let suite = if incompletes.len() > 10 { "…" } else { "" };
            rapport.avertissements.push(format!("{} ligne(s) sans nom ou sans prénom, laissée(s) de côté : {liste}{suite}.", incompletes.len()));
        }
        Ok::<_, ErreurImport>(())
    })?;
    Ok(rapport)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;
    use crate::chiffrement::CleDonnees;

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        (dossier, base)
    }

    /// Patients fictifs, comme un export d'Excel en français : point-virgule, Windows-1252.
    fn csv_windows() -> Vec<u8> {
        let texte = "N°;Nom;Prénom;Né le;Sexe;Adresse;CP;Ville;Téléphone;Mail;Loisirs\r\n\
                     1;MARTIN;Camille;14/03/1988;F;3 rue des Lilas;47500;Fumel;06 12 34 56 78;camille.martin@exemple.fr;Randonnée\r\n\
                     2;Girard;Thomas;02/11/79;Homme;;47300;Villeneuve-sur-Lot;05 53 00 00 01;thomas@;\r\n\
                     3;;Sans nom;01/01/1990;;;;;;;\r\n\
                     4;Lemaire;Hugo;21/06/2015;M;;B-1000;Bruxelles;;;Judo\r\n";
        texte.chars().map(|c| match c {
            'é' => 0xe9u8,
            'É' => 0xc9,
            '°' => 0xb0,
            c => c as u8,
        }).collect()
    }

    #[test]
    fn lit_un_csv_windows_et_propose_les_colonnes() {
        let (_d, base) = base();
        let analyse = analyser(&base, "patients.csv", &csv_windows(), None).unwrap();
        let cibles: Vec<Cible> = analyse.colonnes.iter().map(|c| c.cible).collect();
        assert_eq!(
            cibles,
            [Cible::Ignorer, Cible::Nom, Cible::Prenom, Cible::Naissance, Cible::Sexe, Cible::Adresse, Cible::CodePostal, Cible::Ville, Cible::Telephone, Cible::Email, Cible::Activites]
        );
        assert_eq!(analyse.colonnes[2].titre, "Prénom");
        assert_eq!(analyse.colonnes[1].exemples, ["MARTIN", "Girard", "Lemaire"]);
        assert_eq!((analyse.lignes, analyse.nouveaux, analyse.incompletes), (4, 3, 1));
        assert!(analyse.importable);
        assert_eq!(analyse.apercu[1].naissance.as_deref(), Some("1979-11-02"));
        assert_eq!(analyse.apercu[2].etat, EtatLigne::Incomplet);
    }

    #[test]
    fn importe_une_fois_corrige_ce_qui_est_hors_format_et_signale_les_doublons() {
        let (_d, base) = base();
        // Un dossier déjà dans le cabinet, au même nom : doublon possible, gardé.
        let existant = FichePatient { nom: "Martin".into(), prenom: "Camille".into(), naissance: Some("1988-03-14".into()), ..Default::default() };
        patients::creer(&base, &existant).unwrap();
        let correspondance = correspondance_proposee(&["N°", "Nom", "Prénom", "Né le", "Sexe", "Adresse", "CP", "Ville", "Téléphone", "Mail", "Loisirs"].map(String::from));
        let rapport = importer(&base, "patients.csv", &csv_windows(), &correspondance).unwrap();
        assert_eq!(rapport.patients, Compteur { crees: 3, deja: 0, ignores: 1 });
        assert_eq!(rapport.doublons, ["Camille MARTIN, né(e) le 14 mars 1988 (ligne 2)"]);
        assert!(rapport.avertissements[0].contains("sans nom ou sans prénom"));

        let liste = patients::lister(&base).unwrap();
        let fiche = |nom: &str| patients::lire(&base, &liste.iter().find(|p| p.nom == nom).unwrap().id).unwrap().fiche;
        let thomas = fiche("Girard");
        assert_eq!((thomas.sexe.as_str(), thomas.fixe.as_str(), thomas.email.as_str()), ("M", "05 53 00 00 01", ""));
        assert!(thomas.remarques.contains("Email repris du tableur, incomplet : thomas@"));
        let hugo = fiche("Lemaire");
        assert_eq!((hugo.code_postal.as_str(), hugo.activites.as_str()), ("", "Judo"));
        assert!(hugo.remarques.contains("Code postal repris du tableur : B-1000"));
        assert_eq!(liste.iter().find(|p| p.nom == "MARTIN").unwrap().portable, "06 12 34 56 78");

        // Relancé, l'import ne recopie rien.
        let second = importer(&base, "patients.csv", &csv_windows(), &correspondance).unwrap();
        assert_eq!(second.patients, Compteur { crees: 0, deja: 3, ignores: 1 });
        assert_eq!(analyser(&base, "patients.csv", &csv_windows(), None).unwrap().deja_importes, 3);
    }

    #[test]
    fn refuse_sans_nom_ni_prenom_et_suit_le_choix_du_praticien() {
        let (_d, base) = base();
        let csv = "Patient;Naissance;Notes\nMARTIN Camille;1988-03-14;Allergie au latex\nDupont Jean Pierre;;\n".as_bytes();
        let analyse = analyser(&base, "liste.csv", csv, None).unwrap();
        assert_eq!(analyse.colonnes.iter().map(|c| c.cible).collect::<Vec<_>>(), [Cible::NomPrenom, Cible::Naissance, Cible::Remarques]);
        assert_eq!((analyse.apercu[0].nom.as_str(), analyse.apercu[0].prenom.as_str()), ("MARTIN", "Camille"));
        assert_eq!((analyse.apercu[1].nom.as_str(), analyse.apercu[1].prenom.as_str()), ("Dupont", "Jean Pierre"));
        let sans_nom = [Cible::Remarques, Cible::Naissance, Cible::Remarques];
        assert!(!analyser(&base, "liste.csv", csv, Some(&sans_nom)).unwrap().importable);
        assert!(importer(&base, "liste.csv", csv, &sans_nom).is_err());
        let choisie = [Cible::NomPrenom, Cible::Naissance, Cible::NotesImportantes];
        assert_eq!(importer(&base, "liste.csv", csv, &choisie).unwrap().patients.crees, 2);
        let camille = patients::lister(&base).unwrap().into_iter().find(|p| p.prenom == "Camille").unwrap();
        assert_eq!(camille.notes_importantes, "Allergie au latex");
    }

    fn zip(fichiers: &[(&str, &str)]) -> Vec<u8> {
        let mut sortie = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (nom, contenu) in fichiers {
            sortie.start_file(*nom, zip::write::SimpleFileOptions::default()).unwrap();
            sortie.write_all(contenu.as_bytes()).unwrap();
        }
        sortie.finish().unwrap().into_inner()
    }

    #[test]
    fn lit_un_classeur_excel() {
        let (_d, base) = base();
        let classeur = zip(&[
            ("xl/workbook.xml", r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Patients" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
            ("xl/_rels/workbook.xml.rels", r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
            ("xl/sharedStrings.xml", r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Nom</t></si><si><t>Prénom</t></si><si><t>Date de naissance</t></si><si><t>Code postal</t></si><si><r><t>Mar</t></r><r><t>tin</t></r></si><si><t>Camille</t></si></sst>"#),
            ("xl/styles.xml", r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>"#),
            ("xl/worksheets/sheet1.xml", r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c><c r="C3" s="1"><v>32216</v></c><c r="D3"><v>1000</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Girard</t></is></c><c r="B4" t="str"><v>Thomas</v></c></row></sheetData></worksheet>"#),
        ]);
        let analyse = analyser(&base, "patients.xlsx", &classeur, None).unwrap();
        assert_eq!((analyse.format.as_str(), analyse.feuille.as_str(), analyse.lignes), ("Classeur Excel", "Patients", 2));
        assert_eq!(analyse.apercu[0].ligne, 3);
        assert_eq!((analyse.apercu[0].nom.as_str(), analyse.apercu[0].naissance.as_deref()), ("Martin", Some("1988-03-14")));
        assert_eq!(analyse.apercu[1].prenom, "Thomas");
        let correspondance: Vec<Cible> = analyse.colonnes.iter().map(|c| c.cible).collect();
        importer(&base, "patients.xlsx", &classeur, &correspondance).unwrap();
        // Le code postal stocké en nombre retrouve son zéro.
        assert_eq!(patients::lister(&base).unwrap().iter().find(|p| p.nom == "Martin").unwrap().code_postal, "01000");
        assert!(matches!(analyser(&base, "ancien.xls", b"\xd0\xcf\x11\xe0", None), Err(ErreurImport::Archive(m)) if m.contains(".xlsx")));
    }

    #[test]
    fn lit_un_classeur_libreoffice() {
        let (_d, base) = base();
        let classeur = zip(&[
            ("mimetype", "application/vnd.oasis.opendocument.spreadsheet"),
            ("content.xml", r#"<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Feuille1"><table:table-row><table:table-cell office:value-type="string"><text:p>Nom</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Prénom</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Naissance</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1020"/></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>Haddad</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Nadia</text:p></table:table-cell><table:table-cell office:value-type="date" office:date-value="1968-08-30"><text:p>30/08/68</text:p></table:table-cell></table:table-row><table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#),
        ]);
        let analyse = analyser(&base, "patients.ods", &classeur, None).unwrap();
        assert_eq!((analyse.format.as_str(), analyse.lignes, analyse.colonnes.len()), ("Classeur LibreOffice", 1, 3));
        assert_eq!(analyse.apercu[0].naissance.as_deref(), Some("1968-08-30"));
    }

    #[test]
    fn dates_et_telephones() {
        assert_eq!(date_cellule("14/03/1988").as_deref(), Some("1988-03-14"));
        assert_eq!(date_cellule("1.2.2015 10:30").as_deref(), Some("2015-02-01"));
        assert_eq!(date_cellule("31/02/2000"), None);
        assert_eq!(date_cellule("02/11/79").as_deref(), Some("1979-11-02"));
        assert!(est_portable("+33 6 12 34 56 78") && est_portable("07.00.00.00.00") && !est_portable("05 53 00 00 01"));
        assert_eq!(separer_nom_prenom("DE LA TOUR Anne-Marie"), ("DE LA TOUR".into(), "Anne-Marie".into()));
        assert_eq!(cible_proposee("Lieu de naissance"), Cible::Remarques);
        assert_eq!(cible_proposee("Téléphone portable"), Cible::Portable);
    }
}
