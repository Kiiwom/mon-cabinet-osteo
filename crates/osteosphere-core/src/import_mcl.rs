//! Reprise des données de MonCabinetLibéral, depuis son export (archive zip de fichiers CSV).
//!
//! Règles : l'archive est d'abord lue et vérifiée sans rien écrire ; le praticien choisit ce qu'il
//! importe ; l'archive n'est jamais modifiée ; chaque enregistrement créé garde le lien vers sa ligne
//! d'origine, si bien qu'un second import ne recopie rien ; les doublons probables sont gardés et
//! signalés ; les factures gardent leur numéro, et la numérotation reprend après le dernier ; un
//! champ de séance sans équivalent devient un champ du modèle « Reprise MonCabinetLibéral » ; un
//! rapport dit tout ce qui a été fait et tout ce qui a été laissé de côté. La sauvegarde avant
//! import est faite par l'application, juste avant [`importer`].

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Cursor, Read};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::antecedents::{self, SaisieAntecedent};
use crate::base::{Base, ErreurBase, maintenant};
use crate::facturation::{Destinataire, LigneFacture, Moyen};
use crate::horloge;
use crate::identifiant;
use crate::modeles::{self, Champ, Definition, SaisieModele, TypeChamp};
use crate::numerotation::Date;
use crate::patients::{self, FichePatient};
use crate::seances::{self, Facturation, SaisieSeance, TypeSeance};

const TAILLE_MAX: u64 = 512 * 1024 * 1024;
pub const NOM_MODELE: &str = "Reprise MonCabinetLibéral";

const PATIENTS: &str = "view_patient.csv";
const RENDEZ_VOUS: &str = "rdv.csv";
const CHAMPS: &str = "consultation_champ.csv";
const ANTECEDENTS: &str = "antecedent_patient.csv";
const FACTURES: &str = "facture.csv";
const PAIEMENTS: &str = "paiement.csv";

type Ligne = HashMap<String, String>;

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

fn donnees(erreur: impl std::fmt::Display) -> ErreurImport {
    ErreurImport::Donnees(erreur.to_string())
}

/// Ce que l'archive contient, lu sans rien écrire.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Analyse {
    pub cabinet: String,
    pub patients: i64,
    pub patients_actifs: i64,
    pub patients_archives: i64,
    pub seances: i64,
    pub premiere_seance: Option<String>,
    pub derniere_seance: Option<String>,
    pub antecedents: i64,
    pub factures: i64,
    pub avoirs: i64,
    pub reglements: i64,
    /// Libellés des champs de séance, repris dans le modèle « Reprise MonCabinetLibéral ».
    pub champs: Vec<String>,
    /// Lignes déjà importées par un import précédent : elles ne seront pas recopiées.
    pub deja_importes: i64,
    pub doublons: Vec<String>,
    /// Ce qui demande l'attention du praticien avant d'importer.
    pub points: Vec<String>,
    pub apercu: Vec<ApercuPatient>,
    /// « La numérotation reprendra après 2026-10-1771. »
    pub numerotation: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ApercuPatient {
    pub nom: String,
    pub prenom: String,
    pub naissance: Option<String>,
    pub ville: String,
    pub seances: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoixImport {
    pub patients: bool,
    pub antecedents: bool,
    pub seances: bool,
    pub factures: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Compteur {
    pub crees: i64,
    pub deja: i64,
    pub ignores: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Rapport {
    pub patients: Compteur,
    pub antecedents: Compteur,
    pub seances: Compteur,
    pub factures: Compteur,
    pub reglements: Compteur,
    pub modele: Option<String>,
    /// Tout ce qui a été laissé de côté ou corrigé, ligne par ligne.
    pub avertissements: Vec<String>,
}

impl Rapport {
    /// Le rapport lisible, rangé avec les documents du cabinet.
    pub fn en_texte(&self, archive: &str, sauvegarde: &str, maintenant: i64) -> String {
        let (date, h, m) = horloge::paris(maintenant);
        let ligne = |nom: &str, c: &Compteur| format!("{nom} : {} créé(s), {} déjà importé(s), {} laissé(s) de côté.", c.crees, c.deja, c.ignores);
        let mut texte = vec![
            format!("Import MonCabinetLibéral du {} à {h:02}h{m:02}", date.en_toutes_lettres()),
            format!("Archive : {archive}"),
            format!("Sauvegarde faite juste avant l’import : {sauvegarde}"),
            String::new(),
            ligne("Patients", &self.patients),
            ligne("Antécédents", &self.antecedents),
            ligne("Séances", &self.seances),
            ligne("Factures et avoirs", &self.factures),
            ligne("Règlements", &self.reglements),
        ];
        if let Some(modele) = &self.modele {
            texte.push(format!("Les champs des séances importées sont dans le modèle « {modele} »."));
        }
        if !self.avertissements.is_empty() {
            texte.push(String::new());
            texte.push("À vérifier :".into());
            texte.extend(self.avertissements.iter().map(|a| format!("- {a}")));
        }
        texte.join("\n") + "\n"
    }
}

/// Les tables de l'archive, par nom de fichier.
struct Archive {
    tables: HashMap<&'static str, Vec<Ligne>>,
    source: String,
}

impl Archive {
    fn table(&self, nom: &str) -> &[Ligne] {
        self.tables.get(nom).map(Vec::as_slice).unwrap_or(&[])
    }
}

fn champ<'a>(ligne: &'a Ligne, nom: &str) -> &'a str {
    ligne.get(nom).map(String::as_str).unwrap_or("").trim()
}

/// Lit l'archive : les six fichiers connus, sans chemin dangereux, d'un seul cabinet.
fn lire_archive(contenu: &[u8]) -> Result<Archive, ErreurImport> {
    let invalide = |m: &str| ErreurImport::Archive(m.to_owned());
    let mut zip = zip::ZipArchive::new(Cursor::new(contenu)).map_err(|_| invalide("Ce fichier n’est pas une archive zip lisible."))?;
    let mut total = 0u64;
    let mut tables: HashMap<&'static str, Vec<Ligne>> = HashMap::new();
    for rang in 0..zip.len() {
        let mut entree = zip.by_index(rang).map_err(|_| invalide("Archive abîmée."))?;
        let chemin = entree.name().replace('\\', "/");
        if chemin.split('/').any(|p| p == "..") || chemin.starts_with('/') {
            return Err(invalide("Chemin d’archive invalide."));
        }
        let nom_fichier = chemin.rsplit('/').next().unwrap_or_default().to_owned();
        let Some(nom) = [PATIENTS, RENDEZ_VOUS, CHAMPS, ANTECEDENTS, FACTURES, PAIEMENTS].into_iter().find(|n| *n == nom_fichier) else { continue };
        if tables.contains_key(nom) {
            return Err(invalide("L’archive contient plusieurs fichiers du même nom : un seul cabinet à la fois."));
        }
        total += entree.size();
        if total > TAILLE_MAX {
            return Err(invalide("Archive trop volumineuse pour cet import."));
        }
        let mut octets = Vec::new();
        entree.read_to_end(&mut octets).map_err(|_| invalide("Archive abîmée."))?;
        let texte = String::from_utf8(octets).map_err(|_| invalide(&format!("{nom} n’est pas encodé en UTF-8.")))?;
        let texte = texte.strip_prefix('\u{feff}').unwrap_or(&texte);
        // Comme le lecteur de la version 0.4 : une ligne plus courte ou plus longue que l'en-tête est acceptée.
        let mut lecteur = csv::ReaderBuilder::new().delimiter(b';').flexible(true).from_reader(texte.as_bytes());
        let entetes: Vec<String> = lecteur.headers().map_err(|_| invalide(&format!("En-têtes illisibles dans {nom}.")))?.iter().map(|e| e.trim().to_owned()).collect();
        let mut lignes = Vec::new();
        for enregistrement in lecteur.records() {
            let enregistrement = enregistrement.map_err(|_| invalide(&format!("Ligne CSV mal formée dans {nom}.")))?;
            lignes.push(entetes.iter().cloned().zip(enregistrement.iter().map(str::to_owned)).collect::<Ligne>());
        }
        tables.insert(nom, lignes);
    }
    for (nom, colonnes) in [
        (PATIENTS, ["id", "nom", "prenom"].as_slice()),
        (RENDEZ_VOUS, ["rdv_id", "rdv_patient", "rdv_start"].as_slice()),
        (CHAMPS, ["consultation_id", "champ_libelle", "valeur"].as_slice()),
    ] {
        let Some(lignes) = tables.get(nom) else {
            return Err(invalide(&format!("L’archive ne contient pas {nom} : est-ce bien l’export complet de MonCabinetLibéral ?")));
        };
        if let Some(premiere) = lignes.first()
            && let Some(manquante) = colonnes.iter().find(|c| !premiere.contains_key(**c))
        {
            return Err(invalide(&format!("Colonne {manquante} absente de {nom}.")));
        }
    }
    let cabinets: HashSet<&str> = tables[PATIENTS].iter().map(|l| champ(l, "id_cabinet")).filter(|c| !c.is_empty()).collect();
    if cabinets.len() > 1 {
        return Err(invalide("L’archive contient plusieurs cabinets : importez-les un par un."));
    }
    let source = format!("mcl/{}", cabinets.into_iter().next().unwrap_or("cabinet"));
    Ok(Archive { tables, source })
}

/// Entités HTML courantes, pour les textes saisis dans l'éditeur de MonCabinetLibéral.
fn entite(nom: &str) -> Option<char> {
    if let Some(nombre) = nom.strip_prefix("#x").or_else(|| nom.strip_prefix("#X")) {
        return u32::from_str_radix(nombre, 16).ok().and_then(char::from_u32);
    }
    if let Some(nombre) = nom.strip_prefix('#') {
        return nombre.parse().ok().and_then(char::from_u32);
    }
    Some(match nom {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        "eacute" => 'é',
        "egrave" => 'è',
        "ecirc" => 'ê',
        "euml" => 'ë',
        "agrave" => 'à',
        "acirc" => 'â',
        "ccedil" => 'ç',
        "icirc" => 'î',
        "iuml" => 'ï',
        "ocirc" => 'ô',
        "ugrave" => 'ù',
        "ucirc" => 'û',
        "uuml" => 'ü',
        "oelig" => 'œ',
        "Eacute" => 'É',
        "Egrave" => 'È',
        "Agrave" => 'À',
        "Ccedil" => 'Ç',
        "laquo" => '«',
        "raquo" => '»',
        "rsquo" => '’',
        "lsquo" => '‘',
        "ldquo" => '“',
        "rdquo" => '”',
        "hellip" => '…',
        "deg" => '°',
        "euro" => '€',
        "ndash" => '–',
        "mdash" => '—',
        _ => return None,
    })
}

/// Texte simple tiré d'une valeur MonCabinetLibéral : balises retirées (un paragraphe par ligne),
/// entités décodées, espaces superflus retirés.
pub fn texte_simple(valeur: &str) -> String {
    let mut sortie = String::with_capacity(valeur.len());
    let mut caracteres = valeur.chars().peekable();
    while let Some(c) = caracteres.next() {
        match c {
            '<' => {
                let mut balise = String::new();
                for c in caracteres.by_ref() {
                    if c == '>' {
                        break;
                    }
                    balise.push(c);
                }
                let fermante = balise.starts_with('/');
                let nom: String = balise.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
                // Un bloc commence sur une nouvelle ligne et se termine par un retour ; `<br>` aussi.
                let bloc = ["p", "div", "li", "tr", "h1", "h2", "h3"].contains(&nom.as_str());
                let ouvre_en_cours_de_ligne = bloc && !fermante && !sortie.is_empty() && !sortie.ends_with('\n');
                if nom == "br" || (bloc && fermante) || ouvre_en_cours_de_ligne {
                    sortie.push('\n');
                }
            }
            '&' => {
                let mut nom = String::new();
                while let Some(&s) = caracteres.peek() {
                    if s == ';' || nom.len() > 8 || !(s.is_ascii_alphanumeric() || s == '#') {
                        break;
                    }
                    nom.push(s);
                    caracteres.next();
                }
                match (caracteres.peek(), entite(&nom)) {
                    (Some(';'), Some(decode)) => {
                        caracteres.next();
                        sortie.push(decode);
                    }
                    _ => {
                        sortie.push('&');
                        sortie.push_str(&nom);
                    }
                }
            }
            '\r' => {}
            autre => sortie.push(autre),
        }
    }
    let lignes: Vec<String> = sortie.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).collect();
    let mut propre = Vec::new();
    for ligne in lignes {
        if ligne.is_empty() && propre.last().is_none_or(|l: &String| l.is_empty()) {
            continue;
        }
        propre.push(ligne);
    }
    while propre.last().is_some_and(|l| l.is_empty()) {
        propre.pop();
    }
    propre.join("\n")
}

/// Date MonCabinetLibéral `AAAAMMJJ`, avec ou sans heure : rend `AAAA-MM-JJ` et `HH:MM`.
fn date_mcl(valeur: &str) -> Option<(String, String)> {
    let v = valeur.trim();
    if !(v.len() == 8 || v.len() == 12 || v.len() == 14) || !v.bytes().all(|o| o.is_ascii_digit()) {
        return None;
    }
    let date = format!("{}-{}-{}", &v[..4], &v[4..6], &v[6..8]);
    Date::lire(&date).ok().filter(|d| d.annee() >= 1900)?;
    let heure = if v.len() >= 12 {
        let (h, m) = (&v[8..10], &v[10..12]);
        if h.parse::<u32>().ok()? > 23 || m.parse::<u32>().ok()? > 59 {
            return None;
        }
        format!("{h}:{m}")
    } else {
        "12:00".to_owned()
    };
    Some((date, heure))
}

/// Secondes depuis 1970 pour une date MonCabinetLibéral, heure de Paris approchée.
fn instant_mcl(valeur: &str) -> Option<i64> {
    let (date, heure) = date_mcl(valeur)?;
    let jours = Date::lire(&date).ok()?.jours_unix();
    let (h, m) = heure.split_once(':')?;
    Some(jours * 86_400 + h.parse::<i64>().ok()? * 3_600 + m.parse::<i64>().ok()? * 60 - 3_600)
}

/// « 55 », « 55.00 », « -55,5 » en centimes.
fn centimes(valeur: &str) -> Option<i64> {
    let v = valeur.trim().replace(',', ".").replace(' ', "");
    if v.is_empty() {
        return Some(0);
    }
    let negatif = v.starts_with('-');
    let v = v.trim_start_matches(['-', '+']);
    let (entiers, decimales) = v.split_once('.').unwrap_or((v, ""));
    if entiers.is_empty() && decimales.is_empty() || !entiers.bytes().all(|o| o.is_ascii_digit()) || !decimales.bytes().all(|o| o.is_ascii_digit()) {
        return None;
    }
    let decimales = format!("{decimales:0<2}");
    if decimales[2..].bytes().any(|o| o != b'0') {
        return None;
    }
    let montant = entiers.parse::<i64>().unwrap_or(0).checked_mul(100)?.checked_add(decimales[..2].parse::<i64>().ok()?)?;
    Some(if negatif { -montant } else { montant })
}

/// Numéro `AAAA-MM-N` : année et compteur.
fn numero_mcl(numero: &str) -> Option<(i32, u32)> {
    let mut parties = numero.trim().split('-');
    let (Some(a), Some(m), Some(n), None) = (parties.next(), parties.next(), parties.next(), parties.next()) else { return None };
    if a.len() != 4 || m.len() != 2 || n.is_empty() || ![a, m, n].iter().all(|p| p.bytes().all(|o| o.is_ascii_digit())) {
        return None;
    }
    Some((a.parse().ok()?, n.parse().ok()?))
}

fn moyen_mcl(moyen: &str) -> Option<Moyen> {
    let m = normaliser(moyen);
    if m == "avoir" {
        return None;
    }
    Some(if m.contains("cb") || m.contains("carte") {
        Moyen::Carte
    } else if m.contains("cheque") {
        Moyen::Cheque
    } else if m.contains("espece") {
        Moyen::Especes
    } else if m.contains("virement") {
        Moyen::Virement
    } else {
        Moyen::Autre
    })
}

/// Minuscules sans accents, mots séparés par une espace.
fn normaliser(texte: &str) -> String {
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

/// Identifiant de champ tiré du libellé : `mcl_motif_de_consultation`.
fn identifiant_champ(libelle: &str, pris: &mut HashSet<String>) -> String {
    let base: String = format!("mcl_{}", normaliser(libelle).replace(' ', "_")).chars().take(36).collect();
    let base = base.trim_end_matches('_').to_owned();
    let mut id = base.clone();
    let mut rang = 2;
    while !pris.insert(id.clone()) {
        id = format!("{base}_{rang}");
        rang += 1;
    }
    id
}

/// Document d'éditeur d'un paragraphe par ligne, pour les textes importés.
fn document(texte: &str) -> Value {
    json!({
        "type": "doc",
        "content": texte.split('\n').map(|l| if l.is_empty() { json!({ "type": "paragraph" }) } else { json!({ "type": "paragraph", "content": [{ "type": "text", "text": l }] }) }).collect::<Vec<_>>(),
    })
}

fn lien(base: &Base, source: &str, nature: &str, cle: &str) -> Result<Option<String>, ErreurImport> {
    Ok(base
        .connexion()
        .query_row("SELECT id FROM liens_import WHERE source = ?1 AND nature = ?2 AND cle = ?3", [source, nature, cle], |l| l.get(0))
        .optional()?)
}

fn lier(base: &Base, source: &str, nature: &str, cle: &str, id: &str) -> Result<(), ErreurImport> {
    base.connexion().execute(
        "INSERT INTO liens_import (source, nature, cle, id, importe_le) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![source, nature, cle, id, maintenant()],
    )?;
    Ok(())
}

/// Champs de chaque consultation, dans l'ordre de l'archive.
fn consultations(archive: &Archive) -> BTreeMap<String, Vec<&Ligne>> {
    let mut groupes: BTreeMap<String, Vec<&Ligne>> = BTreeMap::new();
    for ligne in archive.table(CHAMPS) {
        groupes.entry(champ(ligne, "consultation_id").to_owned()).or_default().push(ligne);
    }
    groupes
}

/// Libellés des champs, dans l'ordre de première apparition.
fn libelles(archive: &Archive) -> Vec<String> {
    let mut vus = HashSet::new();
    let mut liste = Vec::new();
    for ligne in archive.table(CHAMPS) {
        let libelle = texte_simple(champ(ligne, "champ_libelle"));
        if !libelle.is_empty() && vus.insert(normaliser(&libelle)) {
            liste.push(libelle);
        }
    }
    liste
}

fn cle_antecedent(ligne: &Ligne) -> String {
    ["patient_id", "famille_antecedent_libelle", "antecedent_libelle", "date_start", "date_end", "valeur", "remarques"]
        .iter()
        .map(|c| champ(ligne, c))
        .collect::<Vec<_>>()
        .join("|")
}

/// Les documents comptables repris : factures et avoirs enregistrés ou annulés (remplacés). Les
/// brouillons et devis restent de côté.
fn document_repris(f: &Ligne) -> bool {
    matches!(champ(f, "facture_famille"), "factures" | "avoirs") && matches!(champ(f, "facture_etat"), "enregistree" | "annulee")
}

/// Pourquoi une ligne de paiement n'est pas reprise.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Exclusion {
    /// Compensation par un avoir, ou règlement porté sur un avoir : déjà compté dans l'avoir.
    Compensation,
    /// Règlement d'une facture remplacée : il figure aussi sur la facture qui la remplace.
    Remplacee,
    /// Opération sans facture.
    SansFacture,
}

/// Un règlement compte s'il paie une facture enregistrée, autrement que par compensation d'avoir.
fn exclusion(p: &Ligne, documents: &HashMap<&str, &Ligne>) -> Option<Exclusion> {
    let Some(f) = documents.get(champ(p, "paiement_facture")).filter(|_| champ(p, "paiement_destination") == "facture") else {
        return Some(Exclusion::SansFacture);
    };
    if moyen_mcl(champ(p, "paiement_moyen")).is_none() || champ(f, "facture_famille") != "factures" {
        return Some(Exclusion::Compensation);
    }
    if champ(f, "facture_etat") != "enregistree" {
        return Some(Exclusion::Remplacee);
    }
    None
}

fn documents_repris(archive: &Archive) -> HashMap<&str, &Ligne> {
    archive.table(FACTURES).iter().filter(|f| document_repris(f)).map(|f| (champ(f, "id_facture"), f)).collect()
}

/// Clés des règlements : les lignes identiques sont numérotées, pour ne rien perdre ni doubler.
fn cles_reglements(archive: &Archive) -> Vec<String> {
    let mut vus: HashMap<String, usize> = HashMap::new();
    archive
        .table(PAIEMENTS)
        .iter()
        .map(|l| {
            let base = ["paiement_facture", "paiement_destination", "paiement_montant", "paiement_moyen", "paiement_date", "paiement_date_encaissement"]
                .iter()
                .map(|c| champ(l, c))
                .collect::<Vec<_>>()
                .join("|");
            let rang = vus.entry(base.clone()).or_default();
            *rang += 1;
            format!("{base}|{rang}")
        })
        .collect()
}

/// Lit et vérifie l'archive, sans rien écrire.
pub fn analyser(base: &Base, contenu: &[u8]) -> Result<Analyse, ErreurImport> {
    let archive = lire_archive(contenu)?;
    let source = &archive.source;
    let patients = archive.table(PATIENTS);
    let rendez_vous = archive.table(RENDEZ_VOUS);
    let groupes = consultations(&archive);
    let ids_patients: HashSet<&str> = patients.iter().map(|p| champ(p, "id")).collect();
    let mut points = Vec::new();
    let mut deja = 0i64;

    // Patients : doublons, adresses à revoir.
    let mut identites: HashMap<String, Vec<String>> = HashMap::new();
    let (mut emails, mut codes) = (0, 0);
    for p in patients {
        let cle = format!("{}|{}|{}", normaliser(champ(p, "nom")), normaliser(champ(p, "prenom")), champ(p, "date_naissance"));
        identites.entry(cle).or_default().push(format!("{} {}", texte_simple(champ(p, "prenom")), texte_simple(champ(p, "nom"))));
        let email = champ(p, "email");
        if !email.is_empty() && !email.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.')) {
            emails += 1;
        }
        let cp = champ(p, "code_postal");
        if !cp.is_empty() && !(cp.len() == 5 && cp.bytes().all(|o| o.is_ascii_digit())) {
            codes += 1;
        }
        if lien(base, source, "patient", champ(p, "id"))?.is_some() {
            deja += 1;
        }
    }
    let mut doublons: Vec<String> = identites.values().filter(|v| v.len() > 1).map(|v| format!("{} : {} dossiers", v[0], v.len())).collect();
    doublons.sort();
    if emails > 0 {
        points.push(format!("{emails} adresse(s) email incomplète(s) : gardée(s) dans les remarques du patient."));
    }
    if codes > 0 {
        points.push(format!("{codes} code(s) postal(aux) hors format français : gardé(s) dans les remarques du patient."));
    }

    // Séances : rendez-vous avec des champs de consultation.
    let ids_rdv: HashSet<&str> = rendez_vous.iter().map(|r| champ(r, "rdv_id")).collect();
    let mut seances = 0;
    let mut dates = Vec::new();
    let mut par_patient: HashMap<&str, i64> = HashMap::new();
    let mut dates_invalides = 0;
    for r in rendez_vous {
        if !groupes.contains_key(champ(r, "rdv_id")) {
            continue;
        }
        if !ids_patients.contains(champ(r, "rdv_patient")) {
            points.push(format!("Le rendez-vous {} désigne un patient absent de l’archive : il ne sera pas importé.", champ(r, "rdv_id")));
            continue;
        }
        match date_mcl(champ(r, "rdv_start")) {
            Some((date, _)) => dates.push(date),
            None => {
                dates_invalides += 1;
                continue;
            }
        }
        seances += 1;
        *par_patient.entry(champ(r, "rdv_patient")).or_default() += 1;
        if lien(base, source, "seance", champ(r, "rdv_id"))?.is_some() {
            deja += 1;
        }
    }
    if dates_invalides > 0 {
        points.push(format!("{dates_invalides} séance(s) sans date lisible : laissée(s) de côté."));
    }
    let orphelines = groupes.keys().filter(|c| !ids_rdv.contains(c.as_str())).count();
    if orphelines > 0 {
        points.push(format!("{orphelines} consultation(s) sans rendez-vous dans l’archive : impossible de les dater ni de les rattacher, elles ne sont pas importées."));
    }
    let sans_consultation = rendez_vous.iter().filter(|r| !groupes.contains_key(champ(r, "rdv_id"))).count();
    if sans_consultation > 0 {
        points.push(format!("{sans_consultation} rendez-vous sans consultation saisie (agenda) : non importés."));
    }
    dates.sort();

    // Antécédents.
    let antecedents = archive.table(ANTECEDENTS);
    for a in antecedents {
        if lien(base, source, "antecedent", &cle_antecedent(a))?.is_some() {
            deja += 1;
        }
    }

    // Factures, avoirs et règlements.
    let documents = documents_repris(&archive);
    let factures: Vec<&Ligne> = archive.table(FACTURES).iter().filter(|f| document_repris(f)).collect();
    let hors_documents = archive.table(FACTURES).len() - factures.len();
    if hors_documents > 0 {
        points.push(format!("{hors_documents} brouillon(s) ou devis de MonCabinetLibéral : non repris."));
    }
    let mut reserve: HashMap<i32, (u32, String)> = HashMap::new();
    let mut numeros_hors_format = 0;
    let mut montants_illisibles = 0;
    for f in &factures {
        if lien(base, source, "facture", champ(f, "id_facture"))?.is_some() {
            deja += 1;
        }
        if centimes(champ(f, "facture_montant_ttc")).is_none() {
            montants_illisibles += 1;
        }
        match numero_mcl(champ(f, "facture_numero")) {
            Some((annee, sequence)) => {
                let entree = reserve.entry(annee).or_insert((0, String::new()));
                if sequence >= entree.0 {
                    *entree = (sequence, champ(f, "facture_numero").to_owned());
                }
            }
            None => numeros_hors_format += 1,
        }
    }
    if numeros_hors_format > 0 {
        points.push(format!("{numeros_hors_format} numéro(s) de facture hors du format AAAA-MM-N : importé(s) tel(s) quel(s), sans réserver de compteur."));
    }
    if montants_illisibles > 0 {
        points.push(format!("{montants_illisibles} facture(s) au montant illisible : laissée(s) de côté."));
    }
    let paiements = archive.table(PAIEMENTS);
    let cles = cles_reglements(&archive);
    let mut reglements = 0;
    let mut exclus: HashMap<Exclusion, usize> = HashMap::new();
    let mut regle: HashMap<&str, i64> = HashMap::new();
    for (p, cle) in paiements.iter().zip(&cles) {
        if let Some(raison) = exclusion(p, &documents) {
            *exclus.entry(raison).or_default() += 1;
            continue;
        }
        reglements += 1;
        *regle.entry(champ(p, "paiement_facture")).or_default() += centimes(champ(p, "paiement_montant")).unwrap_or(0);
        if lien(base, source, "reglement", cle)?.is_some() {
            deja += 1;
        }
    }
    if let Some(n) = exclus.get(&Exclusion::Remplacee) {
        points.push(format!("{n} règlement(s) de factures remplacées : non comptés, l’encaissement figure sur la facture qui les remplace."));
    }
    let autres = exclus.get(&Exclusion::Compensation).unwrap_or(&0) + exclus.get(&Exclusion::SansFacture).unwrap_or(&0);
    if autres > 0 {
        points.push(format!("{autres} ligne(s) de paiement non reprise(s) : compensations par avoir, déjà comptées dans l’avoir, ou opérations sans facture."));
    }
    // Le solde tenu par MonCabinetLibéral doit correspondre aux règlements repris.
    let ecarts: Vec<&str> = factures
        .iter()
        .filter(|f| champ(f, "facture_famille") == "factures" && champ(f, "facture_etat") == "enregistree")
        .filter(|f| match (centimes(champ(f, "facture_montant_ttc")), centimes(champ(f, "facture_balance"))) {
            (Some(total), Some(solde)) => regle.get(champ(f, "id_facture")).copied().unwrap_or(0) != total - solde,
            _ => false,
        })
        .map(|f| champ(f, "facture_numero"))
        .collect();
    if !ecarts.is_empty() {
        let exemples = ecarts.iter().take(5).copied().collect::<Vec<_>>().join(", ");
        let suite = if ecarts.len() > 5 { "…" } else { "" };
        points.push(format!(
            "{} facture(s) dont les règlements ne correspondent pas au solde indiqué par MonCabinetLibéral ({exemples}{suite}) : importée(s) telle(s) quelle(s), à vérifier dans Facturation.",
            ecarts.len()
        ));
    }
    let numerotation = reserve.iter().max_by_key(|(annee, _)| **annee).map(|(_, (_, numero))| format!("La numérotation reprendra après la facture {numero}."));

    let mut apercu: Vec<ApercuPatient> = patients
        .iter()
        .map(|p| ApercuPatient {
            nom: texte_simple(champ(p, "nom")),
            prenom: texte_simple(champ(p, "prenom")),
            naissance: date_mcl(champ(p, "date_naissance")).map(|d| d.0),
            ville: texte_simple(champ(p, "ville")),
            seances: par_patient.get(champ(p, "id")).copied().unwrap_or(0),
        })
        .collect();
    apercu.sort_by(|a, b| b.seances.cmp(&a.seances).then(a.nom.cmp(&b.nom)));
    apercu.truncate(8);

    Ok(Analyse {
        cabinet: archive.source.trim_start_matches("mcl/").to_owned(),
        patients: patients.len() as i64,
        patients_actifs: patients.iter().filter(|p| champ(p, "statut") == "1").count() as i64,
        patients_archives: patients.iter().filter(|p| champ(p, "statut") != "1").count() as i64,
        seances,
        premiere_seance: dates.first().cloned(),
        derniere_seance: dates.last().cloned(),
        antecedents: antecedents.len() as i64,
        factures: factures.iter().filter(|f| champ(f, "facture_famille") == "factures").count() as i64,
        avoirs: factures.iter().filter(|f| champ(f, "facture_famille") == "avoirs").count() as i64,
        reglements,
        champs: libelles(&archive),
        deja_importes: deja,
        doublons,
        points,
        apercu,
        numerotation,
    })
}

/// La fiche du patient, corrigée pour passer les vérifications : ce qui ne rentre pas va aux remarques.
fn fiche_patient(p: &Ligne, avertissements: &mut Vec<String>) -> FichePatient {
    let mut remarques = vec![texte_simple(champ(p, "remarques"))];
    let mut nom = texte_simple(champ(p, "nom"));
    let mut prenom = texte_simple(champ(p, "prenom"));
    if nom.is_empty() {
        nom = "Nom inconnu".into();
        avertissements.push(format!("Patient {} sans nom : « Nom inconnu ».", champ(p, "id")));
    }
    if prenom.is_empty() {
        prenom = "Prénom inconnu".into();
        avertissements.push(format!("Patient {nom} sans prénom : « Prénom inconnu ».",));
    }
    let mut email = champ(p, "email").to_owned();
    if !email.is_empty() && !email.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with('.') && !b.ends_with('.')) {
        remarques.push(format!("Email repris de MonCabinetLibéral, incomplet : {email}"));
        email.clear();
    }
    let mut code_postal: String = champ(p, "code_postal").split_whitespace().collect();
    if !code_postal.is_empty() && !(code_postal.len() == 5 && code_postal.bytes().all(|o| o.is_ascii_digit())) {
        remarques.push(format!("Code postal repris de MonCabinetLibéral : {code_postal}"));
        code_postal.clear();
    }
    let mut naissance = date_mcl(champ(p, "date_naissance")).map(|d| d.0);
    if naissance.as_deref().and_then(|n| Date::lire(n).ok()).is_some_and(|n| n > Date::du_jour_utc(1)) {
        remarques.push(format!("Date de naissance reprise de MonCabinetLibéral, dans le futur : {}", champ(p, "date_naissance")));
        naissance = None;
    }
    FichePatient {
        sexe: match champ(p, "sexe") {
            "f" | "F" => "F",
            "m" | "M" => "M",
            _ => "",
        }
        .into(),
        nom,
        prenom,
        naissance,
        adresse: texte_simple(champ(p, "adresse1")),
        complement_adresse: texte_simple(champ(p, "adresse2")),
        code_postal,
        ville: texte_simple(champ(p, "ville")),
        portable: texte_simple(champ(p, "telephone1")),
        fixe: texte_simple(champ(p, "telephone2")),
        email,
        profession: texte_simple(champ(p, "profession")),
        activites: texte_simple(champ(p, "activites")),
        remarques: remarques.into_iter().filter(|r| !r.is_empty()).collect::<Vec<_>>().join("\n"),
        remarques_antecedents: texte_simple(champ(p, "remarques_antecedents")),
        ..Default::default()
    }
}

/// Catégorie d'antécédent d'après la famille MonCabinetLibéral.
fn categorie(famille: &str) -> &'static str {
    let f = normaliser(famille);
    if f.contains("chirurg") {
        "chirurgicaux"
    } else if f.contains("trauma") {
        "traumatiques"
    } else if f.contains("famil") {
        "familiaux"
    } else if f.contains("psy") {
        "psychologiques"
    } else {
        "medicaux"
    }
}

/// Le modèle « Reprise MonCabinetLibéral », créé au premier import et complété ensuite si de
/// nouveaux champs apparaissent.
fn modele_de_reprise(base: &Base, source: &str, libelles: &[String]) -> Result<(String, i64, HashMap<String, String>), ErreurImport> {
    let existant = lien(base, source, "modele", "seances")?;
    let mut champs: Vec<Champ> = match &existant {
        Some(id) => modeles::lire(base, id).map_err(donnees)?.definition.champs,
        None => Vec::new(),
    };
    let mut pris: HashSet<String> = champs.iter().map(|c| c.id.clone()).collect();
    let mut par_libelle: HashMap<String, String> = champs.iter().map(|c| (normaliser(&c.libelle), c.id.clone())).collect();
    let mut ajoute = false;
    for libelle in libelles.iter().map(String::as_str).chain(["Commentaire du rendez-vous"]) {
        if par_libelle.contains_key(&normaliser(libelle)) {
            continue;
        }
        let id = identifiant_champ(libelle, &mut pris);
        let role = if normaliser(libelle) == "motif de consultation" && !champs.iter().any(|c| c.role == "motif") { "motif" } else { "" };
        champs.push(Champ {
            id: id.clone(),
            type_champ: TypeChamp::TexteEnrichi,
            libelle: libelle.chars().take(120).collect(),
            visible: true,
            obligatoire: false,
            imprimer: true,
            role: role.into(),
            options: Vec::new(),
            min: None,
            max: None,
            pas: None,
            unite: String::new(),
        });
        par_libelle.insert(normaliser(libelle), id);
        ajoute = true;
    }
    let saisie = SaisieModele { nom: NOM_MODELE.into(), age_min: None, age_max: None, actif: false, definition: Definition { champs } };
    let modele = match existant {
        Some(id) if !ajoute => modeles::lire(base, &id).map_err(donnees)?,
        Some(id) => modeles::enregistrer(base, Some(&id), &saisie).map_err(donnees)?,
        None => {
            let modele = modeles::enregistrer(base, None, &saisie).map_err(donnees)?;
            lier(base, source, "modele", "seances", &modele.id)?;
            modele
        }
    };
    Ok((modele.id, modele.version, par_libelle))
}

/// Importe ce que le praticien a choisi. Tout ou rien : une erreur annule l'import entier.
pub fn importer(base: &Base, contenu: &[u8], choix: ChoixImport) -> Result<Rapport, ErreurImport> {
    let archive = lire_archive(contenu)?;
    let source = archive.source.clone();
    let mut rapport = Rapport::default();
    base.atomique(|| {
        // Patients.
        let mut patients_locaux: HashMap<String, String> = HashMap::new();
        for p in archive.table(PATIENTS) {
            let id_mcl = champ(p, "id");
            if let Some(local) = lien(base, &source, "patient", id_mcl)? {
                patients_locaux.insert(id_mcl.to_owned(), local);
                rapport.patients.deja += 1;
                continue;
            }
            if !choix.patients {
                rapport.patients.ignores += 1;
                continue;
            }
            let fiche = fiche_patient(p, &mut rapport.avertissements);
            let patient = patients::creer(base, &fiche).map_err(|e| ErreurImport::Donnees(format!("patient {} {} : {e}", fiche.prenom, fiche.nom)))?;
            let cree = instant_mcl(champ(p, "created")).unwrap_or_else(maintenant);
            let modifie = instant_mcl(champ(p, "updated")).unwrap_or(cree);
            base.connexion().execute("UPDATE patients SET cree_le = ?2, modifie_le = ?3 WHERE id = ?1", rusqlite::params![patient.id, cree, modifie])?;
            if champ(p, "statut") != "1" {
                patients::archiver(base, &patient.id, true).map_err(donnees)?;
            }
            lier(base, &source, "patient", id_mcl, &patient.id)?;
            patients_locaux.insert(id_mcl.to_owned(), patient.id);
            rapport.patients.crees += 1;
        }

        // Antécédents.
        for a in archive.table(ANTECEDENTS) {
            let cle = cle_antecedent(a);
            if lien(base, &source, "antecedent", &cle)?.is_some() {
                rapport.antecedents.deja += 1;
                continue;
            }
            let Some(patient) = patients_locaux.get(champ(a, "patient_id")).filter(|_| choix.antecedents) else {
                rapport.antecedents.ignores += 1;
                continue;
            };
            let mut texte = texte_simple(champ(a, "valeur"));
            if let Ok(Value::Object(objet)) = serde_json::from_str::<Value>(&texte) {
                texte = texte_simple(objet.get("texte").and_then(Value::as_str).unwrap_or_default());
            }
            let precision = [texte, texte_simple(champ(a, "remarques"))].into_iter().filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" · ");
            let debut = date_mcl(champ(a, "date_start")).map(|d| d.0);
            let en_cours = champ(a, "en_cours") == "1";
            let fin = date_mcl(champ(a, "date_end")).map(|d| d.0).filter(|f| !en_cours && debut.as_ref().is_some_and(|d| f >= d));
            let rubrique = texte_simple(champ(a, "antecedent_libelle"));
            let saisie = SaisieAntecedent {
                categorie: categorie(champ(a, "famille_antecedent_libelle")).into(),
                rubrique: if rubrique.is_empty() { "Antécédent repris".into() } else { rubrique },
                precision,
                debut,
                fin,
                en_cours,
                couleur: String::new(),
                important: champ(a, "important") == "1",
            };
            let antecedent = antecedents::enregistrer(base, patient, None, &saisie).map_err(donnees)?;
            lier(base, &source, "antecedent", &cle, &antecedent.id)?;
            rapport.antecedents.crees += 1;
        }

        // Séances.
        let groupes = consultations(&archive);
        let a_importer: Vec<&Ligne> = archive
            .table(RENDEZ_VOUS)
            .iter()
            .filter(|r| groupes.contains_key(champ(r, "rdv_id")))
            .collect();
        let nouvelles: Vec<&&Ligne> = a_importer.iter().filter(|r| !matches!(lien(base, &source, "seance", champ(r, "rdv_id")), Ok(Some(_)))).collect();
        rapport.seances.deja = (a_importer.len() - nouvelles.len()) as i64;
        if choix.seances && !nouvelles.is_empty() {
            let (modele_id, version, par_libelle) = modele_de_reprise(base, &source, &libelles(&archive))?;
            rapport.modele = Some(NOM_MODELE.into());
            // La première séance de chaque patient, toutes dates confondues, est une « première séance ».
            let mut premieres: HashMap<&str, String> = HashMap::new();
            for r in &a_importer {
                if let Some((date, heure)) = date_mcl(champ(r, "rdv_start")) {
                    let debut = format!("{date}T{heure}");
                    let entree = premieres.entry(champ(r, "rdv_patient")).or_insert_with(|| debut.clone());
                    if debut < *entree {
                        *entree = debut;
                    }
                }
            }
            let deja_suivis: HashSet<String> = base.connexion().prepare("SELECT DISTINCT patient_id FROM seances WHERE importee = 0")?.query_map([], |l| l.get(0))?.collect::<Result<_, _>>()?;
            for r in nouvelles {
                let id_rdv = champ(r, "rdv_id");
                let Some(patient) = patients_locaux.get(champ(r, "rdv_patient")) else {
                    rapport.seances.ignores += 1;
                    continue;
                };
                let Some((date, heure)) = date_mcl(champ(r, "rdv_start")) else {
                    rapport.seances.ignores += 1;
                    rapport.avertissements.push(format!("Séance {id_rdv} : date illisible, non importée."));
                    continue;
                };
                let debut = format!("{date}T{heure}");
                let mut valeurs = serde_json::Map::new();
                for ligne in &groupes[id_rdv] {
                    let texte = texte_simple(champ(ligne, "valeur"));
                    let Some(id) = par_libelle.get(&normaliser(&texte_simple(champ(ligne, "champ_libelle")))) else { continue };
                    if texte.is_empty() {
                        continue;
                    }
                    // Deux lignes pour le même champ : les textes se suivent.
                    let precedent = valeurs.get(id).map(seances::texte_de).unwrap_or_default();
                    let complet = if precedent.is_empty() { texte } else { format!("{precedent}\n{texte}") };
                    valeurs.insert(id.clone(), document(&complet));
                }
                let commentaire = texte_simple(champ(r, "rdv_comment"));
                if !commentaire.is_empty()
                    && let Some(id) = par_libelle.get(&normaliser("Commentaire du rendez-vous"))
                {
                    valeurs.insert(id.clone(), document(&commentaire));
                }
                let gratuit = champ(r, "facturation_possible") == "0" && champ(r, "etat_facturation") != "facture";
                let saisie = SaisieSeance {
                    debut: debut.clone(),
                    modele_id: modele_id.clone(),
                    modele_version: version,
                    type_seance: if premieres.get(champ(r, "rdv_patient")) == Some(&debut) && !deja_suivis.contains(patient) {
                        TypeSeance::Premiere
                    } else {
                        TypeSeance::Suivi
                    },
                    titre: String::new(),
                    importante: false,
                    valeurs,
                    facturation: if gratuit { Facturation::Gratuit } else { Facturation::AFacturer },
                    commentaire_gratuit: String::new(),
                };
                let seance = seances::creer(base, patient, &saisie).map_err(|e| ErreurImport::Donnees(format!("séance du {date} : {e}")))?;
                let cree = instant_mcl(champ(r, "rdv_created")).unwrap_or(seance.cree_le);
                base.connexion().execute("UPDATE seances SET importee = 1, cree_le = ?2 WHERE id = ?1", rusqlite::params![seance.id, cree])?;
                lier(base, &source, "seance", id_rdv, &seance.id)?;
                rapport.seances.crees += 1;
            }
        } else if !choix.seances {
            rapport.seances.ignores = nouvelles.len() as i64;
        }

        // Factures et avoirs : numéros gardés, numérotation réservée.
        let factures = archive.table(FACTURES);
        let mut factures_locales: HashMap<String, String> = HashMap::new();
        let noms_patients: Vec<(String, String)> = base
            .connexion()
            .prepare("SELECT id, nom || ' ' || prenom FROM patients")?
            .query_map([], |l| Ok((l.get(0)?, l.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for f in factures {
            let id_mcl = champ(f, "id_facture");
            if !document_repris(f) {
                rapport.factures.ignores += 1;
                continue;
            }
            if let Some(local) = lien(base, &source, "facture", id_mcl)? {
                factures_locales.insert(id_mcl.to_owned(), local);
                rapport.factures.deja += 1;
                continue;
            }
            if !choix.factures {
                rapport.factures.ignores += 1;
                continue;
            }
            let numero = champ(f, "facture_numero").to_owned();
            let (Some(total), false) = (centimes(champ(f, "facture_montant_ttc")), numero.is_empty()) else {
                rapport.factures.ignores += 1;
                rapport.avertissements.push(format!("Facture {id_mcl} : montant ou numéro illisible, non importée."));
                continue;
            };
            let pris: Option<i64> = base.connexion().query_row("SELECT 1 FROM factures WHERE numero = ?1", [&numero], |l| l.get(0)).optional()?;
            if pris.is_some() {
                rapport.factures.ignores += 1;
                rapport.avertissements.push(format!("Facture {numero} : ce numéro existe déjà dans Osteosphere, non importée."));
                continue;
            }
            let avoir = champ(f, "facture_famille") == "avoirs";
            let date = date_mcl(champ(f, "facture_date_finalisation")).or_else(|| date_mcl(champ(f, "facture_created"))).map(|d| d.0);
            let client = texte_simple(champ(f, "facture_client"));
            // Le destinataire ne désigne un patient que s'il en désigne un seul.
            let mots: HashSet<String> = normaliser(&client).split(' ').map(str::to_owned).collect();
            let candidats: Vec<&String> = noms_patients
                .iter()
                .filter(|(_, nom)| {
                    let n: HashSet<String> = normaliser(nom).split(' ').map(str::to_owned).collect();
                    !n.is_empty() && n == mots
                })
                .map(|(id, _)| id)
                .collect();
            let patient = (candidats.len() == 1).then(|| candidats[0].clone());
            let (annee, sequence) = numero_mcl(&numero).map(|(a, s)| (Some(a), Some(s))).unwrap_or((None, None));
            let id = identifiant::nouveau().map_err(donnees)?;
            let etat = if champ(f, "facture_etat") == "annulee" { "annulee" } else { "emise" };
            let commentaire = texte_simple(champ(f, "facture_commentaire"));
            base.connexion().execute(
                "INSERT INTO factures (id, nature, etat, numero, annee, sequence, date_emission, patient_id, destinataire, lignes, total_centimes,
                                       commentaire_imprime, commentaire_interne, importee, cree_le, modifie_le)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'Reprise MonCabinetLibéral', 1, ?13, ?13)",
                rusqlite::params![
                    id,
                    if avoir { "avoir" } else { "facture" },
                    etat,
                    numero,
                    annee,
                    sequence,
                    date,
                    patient,
                    serde_json::to_string(&Destinataire { nom: client, ..Default::default() }).map_err(donnees)?,
                    serde_json::to_string(&[LigneFacture {
                        prestation_id: None,
                        designation: if avoir { "Avoir repris de MonCabinetLibéral".into() } else { "Facture reprise de MonCabinetLibéral".into() },
                        quantite: 1,
                        prix_unitaire_centimes: total.abs(),
                        reduction_centimes: 0,
                    }])
                    .map_err(donnees)?,
                    if avoir { -total.abs() } else { total },
                    commentaire,
                    maintenant()
                ],
            )?;
            lier(base, &source, "facture", id_mcl, &id)?;
            factures_locales.insert(id_mcl.to_owned(), id);
            rapport.factures.crees += 1;
        }
        // Les avoirs pointent vers la facture qu'ils annulent.
        for f in factures {
            let origine = champ(f, "facture_origine");
            if let (Some(local), Some(origine_locale)) = (factures_locales.get(champ(f, "id_facture")), factures_locales.get(origine)) {
                base.connexion().execute("UPDATE factures SET origine_id = ?2 WHERE id = ?1 AND origine_id IS NULL", [local, origine_locale])?;
            }
        }

        // Règlements des factures enregistrées : compensations, factures remplacées et opérations sans
        // facture restent de côté.
        let documents = documents_repris(&archive);
        for (p, cle) in archive.table(PAIEMENTS).iter().zip(cles_reglements(&archive)) {
            if exclusion(p, &documents).is_some() {
                rapport.reglements.ignores += 1;
                continue;
            }
            if lien(base, &source, "reglement", &cle)?.is_some() {
                rapport.reglements.deja += 1;
                continue;
            }
            let (Some(facture), Some(moyen)) = (
                factures_locales.get(champ(p, "paiement_facture")).filter(|_| choix.factures),
                moyen_mcl(champ(p, "paiement_moyen")),
            ) else {
                rapport.reglements.ignores += 1;
                continue;
            };
            let montant = centimes(champ(p, "paiement_montant")).unwrap_or(0);
            let Some((date, _)) = date_mcl(champ(p, "paiement_date_encaissement")).or_else(|| date_mcl(champ(p, "paiement_date"))) else {
                rapport.reglements.ignores += 1;
                rapport.avertissements.push(format!("Règlement de la facture {} sans date : non importé.", champ(p, "paiement_facture")));
                continue;
            };
            if montant == 0 {
                rapport.reglements.ignores += 1;
                continue;
            }
            let id = identifiant::nouveau().map_err(donnees)?;
            base.connexion().execute(
                "INSERT INTO reglements (id, facture_id, moyen, montant_centimes, encaisse_le, commentaire, importe, cree_le, modifie_le)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
                rusqlite::params![id, facture, moyen.texte(), montant, date, texte_simple(champ(p, "paiement_commentaire")), maintenant()],
            )?;
            lier(base, &source, "reglement", &cle, &id)?;
            rapport.reglements.crees += 1;
        }

        let resume = serde_json::to_string(&rapport).map_err(donnees)?;
        base.journaliser("import.mcl", &source, None, Some(&resume))?;
        Ok::<_, ErreurImport>(())
    })?;
    Ok(rapport)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;
    use crate::cabinet::{IdentiteCabinet, PARAMETRE_IDENTITE};
    use crate::chiffrement::CleDonnees;
    use crate::facturation;

    /// Archive fictive, au format de l'export MonCabinetLibéral.
    fn archive(tables: &[(&str, &[&str])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (nom, lignes) in tables {
            zip.start_file(format!("cabinet_fictif/{nom}"), zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(format!("\u{feff}{}\r\n", lignes.join("\r\n")).as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn export_fictif() -> Vec<u8> {
        archive(&[
            (
                PATIENTS,
                &[
                    "id_cabinet;id;nom;prenom;statut;date_naissance;remarques_antecedents;remarques;sexe;created;updated;email;telephone1;telephone2;adresse1;adresse2;code_postal;ville;profession;activites",
                    "cab1;p1;MARTIN;Camille;1;19880314;\"Notes &eacute;crites\";\"Pr&eacute;f&egrave;re le soir\";f;20240101120000;20250102150000;camille@exemple.fr;06 00 00 00 01;;12 rue des Tilleuls;;47500;Fumel;Infirmière;Course",
                    "cab1;p2;PETIT;Louis;0;20140920;;;m;20240101120000;;ancienne-adresse;;;;;4750;Fumel;;",
                    "cab1;p3;MARTIN;Camille;1;19880314;;;f;20240301120000;;;;;;;47500;Fumel;;",
                ],
            ),
            (
                RENDEZ_VOUS,
                &[
                    "id_cabinet;rdv_id;rdv_patient;rdv_start;etat_facturation;facturation_possible;rdv_created;rdv_comment",
                    "cab1;r1;p1;202510061430;facture;1;20251001120000;Venue avec sa fille",
                    "cab1;r2;p1;202605041000;facture;1;20260501120000;",
                    "cab1;r3;p2;202501031000;;0;20250101120000;",
                    "cab1;r4;p1;202606011000;;1;20260501120000;",
                ],
            ),
            (
                CHAMPS,
                &[
                    "consultation_id;champ_id;champ_libelle;champ_type;valeur",
                    "r1;c1;Motif de consultation;textarea;<p>Lombalgie <strong>basse</strong></p><p>depuis 3 jours</p>",
                    "r1;c2;Traitements;textarea;Techniques fonctionnelles",
                    "r2;c1;Motif de consultation;textarea;Cervicalgie",
                    "r3;c1;Motif de consultation;textarea;Bilan",
                    "r9;c1;Motif de consultation;textarea;Sans rendez-vous",
                ],
            ),
            (
                ANTECEDENTS,
                &[
                    "patient_id;valeur;remarques;famille_antecedent_libelle;antecedent_libelle;date_start;date_end;en_cours;important",
                    "p1;\"{&quot;checked&quot;:&quot;1&quot;,&quot;texte&quot;:&quot;poignet G&quot;}\";Plâtre 6 semaines;Traumatiques;Fracture;20090101;;0;1",
                    "p1;;;Chirurgicaux;Césarienne;2017;;0;0",
                ],
            ),
            (
                FACTURES,
                &[
                    "id_facture;facture_famille;facture_etat;facture_montant_ttc;facture_balance;facture_numero;facture_date_finalisation;facture_created;facture_client;facture_origine;facture_commentaire;facture_paiement",
                    "f1;factures;enregistree;55;0;2026-05-1770;20260504120000;20260504120000;MARTIN Camille;;;payee",
                    "f2;factures;annulee;55;0;2025-10-1201;20251006120000;20251006120000;Camille Martin;;;payee",
                    "f3;avoirs;enregistree;-55;0;2025-10-1202;20251007120000;20251007120000;Camille Martin;f2;;",
                    "f5;factures;enregistree;55;0;2025-10-1203;20251007120000;20251007120000;Camille Martin;;Remplace 2025-10-1201;payee",
                    "f4;factures;enregistree;50.00;0;2026-05-1771;20260505120000;20260505120000;Dupont Jean;;;payee",
                    "f6;factures;brouillon;55;55;;;20260601120000;Dupont Jean;;;attente",
                ],
            ),
            (
                PAIEMENTS,
                &[
                    "paiement_facture;paiement_destination;paiement_montant;paiement_moyen;paiement_date;paiement_date_encaissement;paiement_commentaire;paiement_montant_total",
                    "f1;facture;55;CB;20260504;20260504;;55",
                    "f2;facture;55;Chèque;20251006;20251010;;55",
                    "f2;facture;55;Avoir;20251007;20251007;;55",
                    "f5;facture;55;Chèque;20251006;20251010;;55",
                    "op;operation;12;Espèces;20260101;20260101;;12",
                ],
            ),
        ])
    }

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        modeles::installer_modeles_fournis(&base).unwrap();
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
        (dossier, base)
    }

    const TOUT: ChoixImport = ChoixImport { patients: true, antecedents: true, seances: true, factures: true };

    #[test]
    fn nettoie_les_textes_et_lit_les_formats() {
        assert_eq!(texte_simple("<p>Lombalgie <strong>basse</strong></p><p>depuis 3&nbsp;jours</p>"), "Lombalgie basse\ndepuis 3 jours");
        assert_eq!(texte_simple("Pr&eacute;f&egrave;re &amp; &#233;t&#xE9; &inconnu; R&D"), "Préfère & été &inconnu; R&D");
        assert_eq!(date_mcl("202510061430"), Some(("2025-10-06".into(), "14:30".into())));
        assert_eq!(date_mcl("20251306"), None);
        assert_eq!((centimes("55"), centimes("50.00"), centimes("-55,5"), centimes("1.234")), (Some(5500), Some(5000), Some(-5550), None));
        assert_eq!(numero_mcl("2026-05-1770"), Some((2026, 1770)));
        assert_eq!(numero_mcl("F-2026-1"), None);
        assert_eq!(moyen_mcl("Chèque"), Some(Moyen::Cheque));
        assert_eq!(moyen_mcl("Avoir"), None);
        let mut pris = HashSet::new();
        assert_eq!(identifiant_champ("Motif de consultation", &mut pris), "mcl_motif_de_consultation");
        assert_eq!(identifiant_champ("Motif de consultation !", &mut pris), "mcl_motif_de_consultation_2");
    }

    #[test]
    fn analyse_sans_rien_ecrire() {
        let (_d, base) = base();
        let analyse = analyser(&base, &export_fictif()).unwrap();
        assert_eq!((analyse.patients, analyse.patients_actifs, analyse.patients_archives), (3, 2, 1));
        assert_eq!((analyse.seances, analyse.antecedents, analyse.factures, analyse.avoirs, analyse.reglements), (3, 2, 4, 1, 2));
        assert_eq!(analyse.champs, ["Motif de consultation", "Traitements"]);
        assert_eq!(analyse.doublons, ["Camille MARTIN : 2 dossiers"]);
        assert_eq!(analyse.numerotation.as_deref(), Some("La numérotation reprendra après la facture 2026-05-1771."));
        assert!(analyse.points.iter().any(|p| p.contains("sans rendez-vous")));
        assert!(analyse.points.iter().any(|p| p.contains("email incomplète")));
        assert!(analyse.points.iter().any(|p| p.starts_with("1 brouillon(s) ou devis")));
        assert!(analyse.points.iter().any(|p| p.starts_with("1 règlement(s) de factures remplacées")));
        assert!(analyse.points.iter().any(|p| p.starts_with("1 facture(s) dont les règlements ne correspondent pas au solde indiqué par MonCabinetLibéral (2026-05-1771)")));
        assert_eq!((analyse.premiere_seance.as_deref(), analyse.derniere_seance.as_deref()), (Some("2025-01-03"), Some("2026-05-04")));
        let patients: i64 = base.connexion().query_row("SELECT count(*) FROM patients", [], |l| l.get(0)).unwrap();
        assert_eq!(patients, 0);
        assert!(matches!(analyser(&base, b"pas un zip"), Err(ErreurImport::Archive(_))));
    }

    #[test]
    fn importe_tout_une_seule_fois_et_reprend_la_numerotation() {
        let (_d, base) = base();
        let rapport = importer(&base, &export_fictif(), TOUT).unwrap();
        assert_eq!(rapport.patients, Compteur { crees: 3, deja: 0, ignores: 0 });
        assert_eq!(rapport.antecedents.crees, 2);
        assert_eq!(rapport.seances.crees, 3);
        assert_eq!((rapport.factures.crees, rapport.factures.ignores), (5, 1));
        assert_eq!((rapport.reglements.crees, rapport.reglements.ignores), (2, 3));

        let liste = patients::lister(&base).unwrap();
        let camille = liste.iter().find(|p| p.nom == "MARTIN" && p.seances == 2).unwrap();
        let fiche = patients::lire(&base, &camille.id).unwrap();
        assert_eq!((fiche.fiche.sexe.as_str(), fiche.fiche.naissance.as_deref(), fiche.fiche.remarques.as_str()), ("F", Some("1988-03-14"), "Préfère le soir"));
        assert_eq!(fiche.fiche.remarques_antecedents, "Notes écrites");
        let louis = liste.iter().find(|p| p.nom == "PETIT").unwrap();
        assert!(louis.archive);
        let louis = patients::lire(&base, &louis.id).unwrap();
        assert!(louis.fiche.remarques.contains("Email repris de MonCabinetLibéral, incomplet : ancienne-adresse"));
        assert!(louis.fiche.remarques.contains("Code postal repris de MonCabinetLibéral : 4750"));

        let seances_camille = seances::lister_patient(&base, &camille.id).unwrap();
        assert_eq!(seances_camille[1].motif, "Lombalgie basse depuis 3 jours");
        assert_eq!(seances_camille[1].type_seance, TypeSeance::Premiere);
        assert!(seances_camille.iter().all(|s| s.importee));
        // Les séances importées ne sont pas proposées à facturer.
        assert!(seances::lister_a_facturer(&base).unwrap().is_empty());
        let detail = seances::lire(&base, &seances_camille[1].id).unwrap();
        let modele = modeles::lire(&base, &detail.saisie.modele_id).unwrap();
        assert_eq!((modele.nom.as_str(), modele.actif), (NOM_MODELE, false));
        assert_eq!(modele.definition.champs.iter().map(|c| c.libelle.as_str()).collect::<Vec<_>>(), ["Motif de consultation", "Traitements", "Commentaire du rendez-vous"]);
        assert!(seances::texte_de(&detail.saisie.valeurs["mcl_commentaire_du_rendez_vous"]).contains("Venue avec sa fille"));

        let antecedents = antecedents::lister(&base, &camille.id).unwrap();
        let fracture = antecedents.iter().find(|a| a.saisie.rubrique == "Fracture").unwrap();
        assert_eq!((fracture.saisie.categorie.as_str(), fracture.saisie.precision.as_str(), fracture.saisie.important), ("traumatiques", "poignet G · Plâtre 6 semaines", true));

        let factures = facturation::lister(&base, "2025-01-01", "2026-12-31").unwrap();
        assert_eq!(factures.len(), 5);
        let avoir = factures.iter().find(|f| f.numero.as_deref() == Some("2025-10-1202")).unwrap();
        assert_eq!((avoir.total_centimes, avoir.origine_numero.as_deref()), (-5500, Some("2025-10-1201")));
        // « MARTIN Camille » désigne deux dossiers : pas de rattachement deviné.
        let payee = factures.iter().find(|f| f.numero.as_deref() == Some("2026-05-1770")).unwrap();
        assert_eq!((payee.reste_centimes, payee.patient_id.is_none()), (0, true));
        // « Dupont Jean » ne désigne aucun patient : la facture reste sans patient. Sans règlement
        // dans l'archive, elle reste à régler, quoi qu'en dise le solde de MonCabinetLibéral.
        let dupont = factures.iter().find(|f| f.numero.as_deref() == Some("2026-05-1771")).unwrap();
        assert_eq!((dupont.patient_id.is_none(), dupont.reste_centimes), (true, 5000));
        assert!(facturation::en_attente(&base).unwrap().iter().any(|f| f.id == dupont.id));
        // Le règlement de la facture remplacée n'est compté qu'une fois, sur sa remplaçante.
        let remplacee = factures.iter().find(|f| f.numero.as_deref() == Some("2025-10-1201")).unwrap();
        assert_eq!(remplacee.etat, facturation::EtatFacture::Annulee);
        let recettes = facturation::recettes(&base, "2025-01-01", "2026-12-31").unwrap();
        assert_eq!(recettes.iter().map(|r| r.reglement.montant_centimes).sum::<i64>(), 11_000);
        assert_eq!(facturation::numero_suivant(&base, "2026-10-07").unwrap().numero, "2026-10-1772");

        let texte = rapport.en_texte("export.zip", "Sauvegarde.osteosauve", 1_791_397_800);
        assert!(texte.starts_with("Import MonCabinetLibéral du 7 octobre 2026 à 20h30\n"));
        assert!(texte.contains("Patients : 3 créé(s), 0 déjà importé(s), 0 laissé(s) de côté."));

        // Second import : rien n'est recopié.
        let second = importer(&base, &export_fictif(), TOUT).unwrap();
        assert_eq!((second.patients.crees, second.patients.deja), (0, 3));
        assert_eq!((second.seances.crees, second.factures.crees, second.reglements.crees, second.antecedents.crees), (0, 0, 0, 0));
        assert_eq!(analyser(&base, &export_fictif()).unwrap().deja_importes, 3 + 3 + 2 + 5 + 2);
        assert_eq!(patients::lister(&base).unwrap().len(), 3);
    }

    #[test]
    fn les_types_decoches_ne_sont_pas_importes() {
        let (_d, base) = base();
        let rapport = importer(&base, &export_fictif(), ChoixImport { patients: true, antecedents: false, seances: false, factures: false }).unwrap();
        assert_eq!((rapport.patients.crees, rapport.antecedents.ignores, rapport.seances.ignores, rapport.factures.ignores), (3, 2, 3, 6));
        let seances: i64 = base.connexion().query_row("SELECT count(*) FROM seances", [], |l| l.get(0)).unwrap();
        assert_eq!(seances, 0);
        // Plus tard, les séances seules : elles retrouvent leurs patients.
        let suite = importer(&base, &export_fictif(), ChoixImport { patients: false, antecedents: false, seances: true, factures: false }).unwrap();
        assert_eq!((suite.patients.deja, suite.seances.crees), (3, 3));
    }
}
