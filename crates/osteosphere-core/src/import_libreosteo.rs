//! Reprise des données de LibreOsteo, depuis sa sauvegarde : une archive zip qui contient
//! `dump.json` (les données, au format « dumpdata » de Django), `meta` (la version) et les documents
//! joints ; les anciennes versions donnent `dump.json` seul.
//!
//! Sont repris : les patients (identité, coordonnées, médecin traitant, antécédents en texte, note
//! importante, enfants), leurs séances, dans un modèle « Reprise LibreOsteo » aux champs de
//! LibreOsteo (motif, sphères, diagnostic, traitements…), et les documents joints aux dossiers. Les
//! factures restent dans LibreOsteo : elles sont comptées et signalées. Mêmes règles que tout
//! import : rien n'est écrit avant la confirmation, l'archive n'est jamais modifiée, un second import
//! ne recopie rien, les doublons possibles sont gardés et signalés.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Cursor, Read};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::base::Base;
use crate::documents;
use crate::horloge;
use crate::import_commun::{Compteur, ErreurImport, cle_identite, document, donnees, fiche_admissible, lien, lier};
use crate::import_mcl::ApercuPatient;
use crate::modeles::{self, Champ, Definition, SaisieModele, TypeChamp};
use crate::numerotation::Date;
use crate::patients::{self, FichePatient};
use crate::seances::{self, Facturation, SaisieSeance, TypeSeance};

const SOURCE: &str = "libreosteo";
const ORIGINE: &str = "de LibreOsteo";
pub const NOM_MODELE: &str = "Reprise LibreOsteo";
const TAILLE_DUMP_MAX: u64 = 256 * 1024 * 1024;

/// Les champs d'une séance LibreOsteo, avec leur libellé français dans LibreOsteo.
const CHAMPS_SEANCE: [(&str, &str, &str); 12] = [
    ("reason", "lo_motif", "Motif"),
    ("reason_description", "lo_contexte", "Détail du motif de consultation / Contexte"),
    ("general_state", "lo_etat_general", "État général"),
    ("medical_examination", "lo_examen_medical", "Examen médical"),
    ("orl", "lo_orl", "Sphère ORL"),
    ("visceral", "lo_viscerale", "Sphère viscérale"),
    ("pulmo", "lo_cardio_pulmonaire", "Sphère cardio-pulmonaire"),
    ("uro_gyneco", "lo_uro_gyneco", "Sphère uro-gynéco"),
    ("periphery", "lo_peripherique", "Sphère périphérique"),
    ("diagnosis", "lo_diagnostic", "Diagnostic ostéopathique"),
    ("treatments", "lo_traitements", "Traitements"),
    ("conclusion", "lo_conclusion", "Conclusion"),
];
const CHAMP_COMMENTAIRES: (&str, &str) = ("lo_commentaires", "Commentaires");

/// Les antécédents de la fiche LibreOsteo, en texte libre : repris dans les remarques sur les antécédents.
const ANTECEDENTS: [(&str, &str); 6] = [
    ("medical_history", "Antécédents médicaux"),
    ("surgical_history", "Antécédents chirurgicaux"),
    ("trauma_history", "Antécédents traumatiques"),
    ("family_history", "Antécédents familiaux"),
    ("current_treatment", "Traitement en cours"),
    ("medical_reports", "Comptes rendus médicaux"),
];

/// Une ligne de `dump.json`.
#[derive(Debug, Deserialize)]
struct Objet {
    model: String,
    pk: Value,
    #[serde(default)]
    fields: Map<String, Value>,
}

/// Les objets de la sauvegarde, rangés par modèle Django, et les documents joints de l'archive.
struct Sauvegarde {
    version: Option<String>,
    par_modele: HashMap<String, Vec<Objet>>,
    fichiers: HashSet<String>,
    archive: Option<Vec<u8>>,
}

impl Sauvegarde {
    fn objets(&self, modele: &str) -> &[Objet] {
        self.par_modele.get(&format!("libreosteoweb.{modele}")).map(Vec::as_slice).unwrap_or(&[])
    }

    fn contenu(&self, chemin: &str) -> Option<Vec<u8>> {
        let archive = self.archive.as_ref()?;
        let mut zip = zip::ZipArchive::new(Cursor::new(archive.as_slice())).ok()?;
        let mut entree = zip.by_name(chemin).ok()?;
        let mut octets = Vec::new();
        entree.read_to_end(&mut octets).ok()?;
        Some(octets)
    }
}

fn invalide(message: impl Into<String>) -> ErreurImport {
    ErreurImport::Archive(message.into())
}

fn cle(pk: &Value) -> String {
    match pk {
        Value::String(s) => s.clone(),
        autre => autre.to_string(),
    }
}

fn texte<'a>(objet: &'a Objet, champ: &str) -> &'a str {
    objet.fields.get(champ).and_then(Value::as_str).unwrap_or("").trim()
}

fn reference(objet: &Objet, champ: &str) -> Option<String> {
    objet.fields.get(champ).filter(|v| !v.is_null()).map(cle)
}

fn lire_sauvegarde(contenu: &[u8]) -> Result<Sauvegarde, ErreurImport> {
    let (dump, version, fichiers, archive) = if contenu.starts_with(b"PK\x03\x04") {
        let mut zip = zip::ZipArchive::new(Cursor::new(contenu)).map_err(|_| invalide("Archive LibreOsteo illisible."))?;
        let mut dump = None;
        let mut version = None;
        let mut fichiers = HashSet::new();
        for rang in 0..zip.len() {
            let mut entree = zip.by_index(rang).map_err(|_| invalide("Archive abîmée."))?;
            let nom = entree.name().to_owned();
            match nom.as_str() {
                "dump.json" => {
                    if entree.size() > TAILLE_DUMP_MAX {
                        return Err(invalide("Les données de cette sauvegarde sont trop volumineuses."));
                    }
                    let mut texte = Vec::new();
                    entree.read_to_end(&mut texte).map_err(|_| invalide("Archive abîmée."))?;
                    dump = Some(texte);
                }
                "meta" => {
                    let mut texte = String::new();
                    entree.read_to_string(&mut texte).map_err(|_| invalide("Archive abîmée."))?;
                    version = Some(texte.trim().to_owned()).filter(|v| !v.is_empty());
                }
                _ if !entree.is_dir() => {
                    fichiers.insert(nom);
                }
                _ => {}
            }
        }
        let dump = dump.ok_or_else(|| invalide("Cette archive ne contient pas dump.json : est-ce bien une sauvegarde de LibreOsteo ?"))?;
        (dump, version, fichiers, Some(contenu.to_vec()))
    } else {
        (contenu.to_vec(), None, HashSet::new(), None)
    };
    let objets: Vec<Objet> = serde_json::from_slice(&dump).map_err(|_| invalide("Ce fichier n’est pas une sauvegarde LibreOsteo lisible (dump.json attendu)."))?;
    if !objets.iter().any(|o| o.model.starts_with("libreosteoweb.")) {
        return Err(invalide("Ce fichier ne contient aucune donnée de LibreOsteo."));
    }
    let mut par_modele: HashMap<String, Vec<Objet>> = HashMap::new();
    for objet in objets {
        par_modele.entry(objet.model.clone()).or_default().push(objet);
    }
    Ok(Sauvegarde { version, par_modele, fichiers, archive })
}

/// Date et heure Django (`2024-03-12T13:30:00Z`, `…+02:00`, `…123456`) en heure du cabinet :
/// `AAAA-MM-JJ` et `HH:MM`.
fn date_heure(valeur: &str) -> Option<(String, String)> {
    let v = valeur.trim();
    let date = Date::lire(v.get(..10)?).ok()?;
    let reste = v.get(11..).unwrap_or("");
    let (h, m): (i64, i64) = (reste.get(..2).and_then(|h| h.parse().ok()).unwrap_or(12), reste.get(3..5).and_then(|m| m.parse().ok()).unwrap_or(0));
    if !(0..24).contains(&h) || !(0..60).contains(&m) {
        return None;
    }
    let decalage = if reste.ends_with('Z') {
        Some(0)
    } else {
        reste.rfind(['+', '-']).filter(|&i| i >= 5).and_then(|i| {
            let signe = if &reste[i..=i] == "-" { -1 } else { 1 };
            let (hh, mm) = reste[i + 1..].split_once(':').unwrap_or((&reste[i + 1..], "0"));
            Some(signe * (hh.parse::<i64>().ok()? * 3_600 + mm.parse::<i64>().ok()? * 60))
        })
    };
    let (date, h, m) = match decalage {
        Some(decalage) => {
            let (jour, h, m) = horloge::paris(date.jours_unix() * 86_400 + h * 3_600 + m * 60 - decalage);
            (jour, i64::from(h), i64::from(m))
        }
        None => (date, h, m),
    };
    Some((date.to_string(), format!("{h:02}:{m:02}")))
}

fn date_seule(valeur: Option<&Value>) -> Option<String> {
    valeur.and_then(Value::as_str).and_then(|v| v.get(..10)).and_then(|d| Date::lire(d).ok()).map(|d| d.to_string())
}

/// Ce que la sauvegarde contient, lu sans rien écrire.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct AnalyseLibreOsteo {
    pub version: Option<String>,
    pub patients: i64,
    pub seances: i64,
    pub premiere_seance: Option<String>,
    pub derniere_seance: Option<String>,
    /// Documents joints aux dossiers et présents dans l'archive.
    pub documents: i64,
    /// Factures de LibreOsteo : non reprises.
    pub factures: i64,
    /// Les champs des séances, repris dans le modèle « Reprise LibreOsteo ».
    pub champs: Vec<String>,
    pub deja_importes: i64,
    pub doublons: Vec<String>,
    pub points: Vec<String>,
    pub apercu: Vec<ApercuPatient>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoixLibreOsteo {
    pub patients: bool,
    pub seances: bool,
    pub documents: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct RapportLibreOsteo {
    pub patients: Compteur,
    pub seances: Compteur,
    pub documents: Compteur,
    pub modele: Option<String>,
    pub doublons: Vec<String>,
    pub avertissements: Vec<String>,
}

impl RapportLibreOsteo {
    pub fn en_texte(&self, archive: &str, sauvegarde: &str, maintenant: i64) -> String {
        let (date, h, m) = horloge::paris(maintenant);
        let ligne = |nom: &str, c: &Compteur| format!("{nom} : {} créé(s), {} déjà importé(s), {} laissé(s) de côté.", c.crees, c.deja, c.ignores);
        let mut texte = vec![
            format!("Import LibreOsteo du {} à {h:02}h{m:02}", date.en_toutes_lettres()),
            format!("Archive : {archive}"),
            format!("Sauvegarde faite juste avant l’import : {sauvegarde}"),
            String::new(),
            ligne("Patients", &self.patients),
            ligne("Séances", &self.seances),
            ligne("Documents", &self.documents),
        ];
        if let Some(modele) = &self.modele {
            texte.push(format!("Les champs des séances importées sont dans le modèle « {modele} »."));
        }
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

/// Le document joint d'un dossier : son chemin dans l'archive et le nom à lui donner.
struct DocumentJoint<'a> {
    cle: String,
    patient: String,
    chemin: String,
    nom: String,
    notes: &'a str,
}

fn documents_joints(sauvegarde: &Sauvegarde) -> Vec<DocumentJoint<'_>> {
    let documents: HashMap<String, &Objet> = sauvegarde.objets("document").iter().map(|d| (cle(&d.pk), d)).collect();
    sauvegarde
        .objets("patientdocument")
        .iter()
        .filter_map(|lien| {
            let document = documents.get(&reference(lien, "document")?)?;
            let chemin = texte(document, "document_file").to_owned();
            let extension = chemin.rsplit_once('.').map(|(_, e)| e.to_lowercase()).filter(|e| e.len() <= 5).unwrap_or_default();
            let titre = texte(document, "title");
            let titre = if titre.is_empty() { chemin.rsplit('/').next().unwrap_or("Document") } else { titre };
            let nom = if extension.is_empty() || titre.to_lowercase().ends_with(&format!(".{extension}")) { titre.to_owned() } else { format!("{titre}.{extension}") };
            Some(DocumentJoint { cle: cle(&document.pk), patient: reference(lien, "patient")?, chemin, nom, notes: texte(document, "notes") })
        })
        .collect()
}

/// Lit et vérifie la sauvegarde, sans rien écrire.
pub fn analyser(base: &Base, contenu: &[u8]) -> Result<AnalyseLibreOsteo, ErreurImport> {
    let sauvegarde = lire_sauvegarde(contenu)?;
    let patients = sauvegarde.objets("patient");
    let examens = sauvegarde.objets("examination");
    let ids: HashSet<String> = patients.iter().map(|p| cle(&p.pk)).collect();
    let mut deja = 0;
    let mut points = Vec::new();

    let cabinet: HashSet<String> = patients::lister(base).map_err(donnees)?.iter().map(|p| cle_identite(&p.nom, &p.prenom, p.naissance.as_deref())).collect();
    let mut identites: HashMap<String, Vec<String>> = HashMap::new();
    for p in patients {
        let naissance = date_seule(p.fields.get("birth_date"));
        identites.entry(cle_identite(texte(p, "family_name"), texte(p, "first_name"), naissance.as_deref())).or_default().push(format!("{} {}", texte(p, "first_name"), texte(p, "family_name")));
        if lien(base, SOURCE, "patient", &cle(&p.pk))?.is_some() {
            deja += 1;
        }
    }
    let mut doublons: Vec<String> = identites
        .iter()
        .filter(|(identite, noms)| noms.len() > 1 || cabinet.contains(*identite))
        .map(|(identite, noms)| if cabinet.contains(identite) { format!("{} : déjà dans le cabinet", noms[0]) } else { format!("{} : {} dossiers", noms[0], noms.len()) })
        .collect();
    doublons.sort();

    let mut dates = Vec::new();
    let mut par_patient: HashMap<String, i64> = HashMap::new();
    let mut sans_date = 0;
    let mut orphelines = 0;
    for e in examens {
        let Some(patient) = reference(e, "patient").filter(|p| ids.contains(p)) else {
            orphelines += 1;
            continue;
        };
        match e.fields.get("date").and_then(Value::as_str).and_then(date_heure) {
            Some((date, _)) => dates.push(date),
            None => {
                sans_date += 1;
                continue;
            }
        }
        *par_patient.entry(patient).or_default() += 1;
        if lien(base, SOURCE, "seance", &cle(&e.pk))?.is_some() {
            deja += 1;
        }
    }
    dates.sort();
    if sans_date > 0 {
        points.push(format!("{sans_date} séance(s) sans date lisible : laissée(s) de côté."));
    }
    if orphelines > 0 {
        points.push(format!("{orphelines} séance(s) sans patient dans la sauvegarde : laissée(s) de côté."));
    }

    let joints = documents_joints(&sauvegarde);
    let presents = joints.iter().filter(|d| sauvegarde.fichiers.contains(&d.chemin)).count();
    if presents < joints.len() {
        points.push(format!("{} document(s) absent(s) de l’archive : seuls leurs titres sont repris dans les remarques du patient.", joints.len() - presents));
    }
    for d in &joints {
        if lien(base, SOURCE, "document", &d.cle)?.is_some() {
            deja += 1;
        }
    }
    let factures = sauvegarde.objets("invoice").len() as i64;
    if factures > 0 {
        points.push(format!(
            "{factures} facture(s) de LibreOsteo ne sont pas reprises : gardez la sauvegarde de LibreOsteo, les pièces comptables se conservent dix ans."
        ));
    }

    let mut apercu: Vec<ApercuPatient> = patients
        .iter()
        .map(|p| ApercuPatient {
            nom: texte(p, "family_name").to_owned(),
            prenom: texte(p, "first_name").to_owned(),
            naissance: date_seule(p.fields.get("birth_date")),
            ville: texte(p, "address_city").to_owned(),
            seances: par_patient.get(&cle(&p.pk)).copied().unwrap_or(0),
        })
        .collect();
    apercu.sort_by(|a, b| b.seances.cmp(&a.seances).then(a.nom.cmp(&b.nom)));
    apercu.truncate(8);

    Ok(AnalyseLibreOsteo {
        version: sauvegarde.version.clone(),
        patients: patients.len() as i64,
        seances: dates.len() as i64,
        premiere_seance: dates.first().cloned(),
        derniere_seance: dates.last().cloned(),
        documents: presents as i64,
        factures,
        champs: CHAMPS_SEANCE.iter().map(|(_, _, libelle)| (*libelle).to_owned()).chain([CHAMP_COMMENTAIRES.1.to_owned()]).collect(),
        deja_importes: deja,
        doublons,
        points,
        apercu,
    })
}

/// La fiche patient : identité et coordonnées, médecin traitant, latéralité, note importante,
/// antécédents et enfants en texte.
fn fiche_patient(p: &Objet, medecins: &HashMap<String, &Objet>, enfants: &[&Objet]) -> FichePatient {
    let mut remarques = Vec::new();
    let mut nom = texte(p, "family_name").to_owned();
    let mut prenom = texte(p, "first_name").to_owned();
    if nom.is_empty() {
        nom = "Nom inconnu".into();
    }
    if prenom.is_empty() {
        prenom = "Prénom inconnu".into();
    }
    let medecin = reference(p, "doctor").and_then(|id| medecins.get(&id)).map(|m| {
        let nom = [texte(m, "first_name"), texte(m, "family_name")].iter().filter(|t| !t.is_empty()).copied().collect::<Vec<_>>().join(" ");
        let details = [texte(m, "city"), texte(m, "phone")].iter().filter(|t| !t.is_empty()).copied().collect::<Vec<_>>().join(", ");
        if details.is_empty() { format!("Dr {nom}") } else { format!("Dr {nom}, {details}") }
    });
    let mut antecedents: Vec<String> = ANTECEDENTS
        .iter()
        .filter(|(champ, _)| !texte(p, champ).is_empty())
        .map(|(champ, titre)| format!("{titre} :\n{}", texte(p, champ)))
        .collect();
    if p.fields.get("smoker").and_then(Value::as_bool) == Some(true) {
        antecedents.insert(0, "Fumeur.".into());
    }
    if !enfants.is_empty() {
        let liste = enfants
            .iter()
            .map(|e| {
                let nom = [texte(e, "first_name"), texte(e, "family_name")].iter().filter(|t| !t.is_empty()).copied().collect::<Vec<_>>().join(" ");
                match date_seule(e.fields.get("birthday_date")).and_then(|d| Date::lire(&d).ok()) {
                    Some(d) => format!("{nom} (né(e) le {})", d.en_toutes_lettres()),
                    None => nom,
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        remarques.push(format!("Enfants : {liste}"));
    }
    FichePatient {
        sexe: match texte(p, "sex") {
            "F" => "F",
            "M" => "M",
            _ => "",
        }
        .into(),
        nom,
        nom_naissance: texte(p, "original_name").into(),
        prenom,
        naissance: date_seule(p.fields.get("birth_date")),
        adresse: texte(p, "address_street").into(),
        complement_adresse: texte(p, "address_complement").into(),
        code_postal: texte(p, "address_zipcode").into(),
        ville: texte(p, "address_city").into(),
        portable: texte(p, "mobile_phone").into(),
        fixe: texte(p, "phone").into(),
        email: texte(p, "email").into(),
        profession: texte(p, "job").into(),
        enfants: (!enfants.is_empty()).then_some(enfants.len() as u32),
        lateralite: match texte(p, "laterality") {
            "L" => "gaucher",
            "R" => "droitier",
            _ => "",
        }
        .into(),
        activites: texte(p, "hobbies").into(),
        medecin_traitant: medecin.unwrap_or_default(),
        notes_importantes: texte(p, "important_info").into(),
        remarques: remarques.join("\n"),
        remarques_antecedents: antecedents.join("\n\n"),
        consentement_le: date_seule(p.fields.get("consent")),
        ..Default::default()
    }
}

/// Le modèle « Reprise LibreOsteo », créé au premier import, réservé aux séances importées.
fn modele_de_reprise(base: &Base) -> Result<(String, i64), ErreurImport> {
    if let Some(id) = lien(base, SOURCE, "modele", "seances")?
        && let Ok(modele) = modeles::lire(base, &id)
    {
        return Ok((modele.id, modele.version));
    }
    let champs = CHAMPS_SEANCE
        .iter()
        .map(|(_, id, libelle)| (*id, *libelle))
        .chain([CHAMP_COMMENTAIRES])
        .map(|(id, libelle)| Champ {
            id: id.into(),
            type_champ: TypeChamp::TexteEnrichi,
            libelle: libelle.into(),
            visible: true,
            obligatoire: false,
            imprimer: true,
            role: if id == "lo_motif" { "motif".into() } else { String::new() },
            options: Vec::new(),
            min: None,
            max: None,
            pas: None,
            unite: String::new(),
        })
        .collect();
    let saisie = SaisieModele { nom: NOM_MODELE.into(), age_min: None, age_max: None, actif: false, definition: Definition { champs } };
    let modele = modeles::enregistrer(base, None, &saisie).map_err(donnees)?;
    // Le lien est remplacé si le modèle d'un import précédent a été supprimé.
    base.connexion().execute("DELETE FROM liens_import WHERE source = ?1 AND nature = 'modele' AND cle = 'seances'", [SOURCE])?;
    lier(base, SOURCE, "modele", "seances", &modele.id)?;
    Ok((modele.id, modele.version))
}

/// Importe ce que le praticien a choisi. Tout ou rien : une erreur annule l'import entier.
pub fn importer(base: &Base, contenu: &[u8], choix: ChoixLibreOsteo) -> Result<RapportLibreOsteo, ErreurImport> {
    let sauvegarde = lire_sauvegarde(contenu)?;
    let mut rapport = RapportLibreOsteo::default();
    base.atomique(|| {
        // Patients.
        let medecins: HashMap<String, &Objet> = sauvegarde.objets("regulardoctor").iter().map(|m| (cle(&m.pk), m)).collect();
        let mut enfants: HashMap<String, Vec<&Objet>> = HashMap::new();
        for e in sauvegarde.objets("children") {
            if let Some(parent) = reference(e, "parent") {
                enfants.entry(parent).or_default().push(e);
            }
        }
        let mut identites: HashSet<String> = patients::lister(base).map_err(donnees)?.iter().map(|p| cle_identite(&p.nom, &p.prenom, p.naissance.as_deref())).collect();
        let mut locaux: HashMap<String, String> = HashMap::new();
        let mut effaces = 0;
        for p in sauvegarde.objets("patient") {
            let id = cle(&p.pk);
            if let Some(local) = lien(base, SOURCE, "patient", &id)? {
                if patients::lire(base, &local).is_ok() {
                    locaux.insert(id, local);
                    rapport.patients.deja += 1;
                } else {
                    effaces += 1;
                    rapport.patients.ignores += 1;
                }
                continue;
            }
            if !choix.patients {
                rapport.patients.ignores += 1;
                continue;
            }
            let fiche = fiche_admissible(fiche_patient(p, &medecins, enfants.get(&id).map(Vec::as_slice).unwrap_or(&[])), ORIGINE);
            if !identites.insert(cle_identite(&fiche.nom, &fiche.prenom, fiche.naissance.as_deref())) {
                rapport.doublons.push(format!("{} {}", fiche.prenom, fiche.nom));
            }
            let patient = patients::creer(base, &fiche).map_err(|e| ErreurImport::Donnees(format!("patient {} {} : {e}", fiche.prenom, fiche.nom)))?;
            if let Some(creation) = date_seule(p.fields.get("creation_date")).and_then(|d| Date::lire(&d).ok()) {
                let instant = creation.jours_unix() * 86_400 + 12 * 3_600;
                base.connexion().execute("UPDATE patients SET cree_le = ?2 WHERE id = ?1", rusqlite::params![patient.id, instant])?;
            }
            lier(base, SOURCE, "patient", &id, &patient.id)?;
            locaux.insert(id, patient.id);
            rapport.patients.crees += 1;
        }
        if effaces > 0 {
            rapport.avertissements.push(format!("{effaces} dossier(s) effacé(s) à la demande du patient : non réimporté(s), ni leurs séances."));
        }

        // Séances, dans l'ordre des dates : la première de chaque patient est une « première séance ».
        let mut commentaires: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for c in sauvegarde.objets("examinationcomment") {
            if let Some(examen) = reference(c, "examination") {
                let date = c.fields.get("date").and_then(Value::as_str).and_then(date_heure).map(|(d, _)| d).unwrap_or_default();
                commentaires.entry(examen).or_default().push((date, texte(c, "comment").to_owned()));
            }
        }
        let mut examens: Vec<(&Objet, String, String)> = sauvegarde
            .objets("examination")
            .iter()
            .filter_map(|e| e.fields.get("date").and_then(Value::as_str).and_then(date_heure).map(|(d, h)| (e, d, h)))
            .collect();
        examens.sort_by(|a, b| (&a.1, &a.2).cmp(&(&b.1, &b.2)));
        let mut modele = None;
        let mut deja_vus: HashSet<String> = base.connexion().prepare("SELECT DISTINCT patient_id FROM seances")?.query_map([], |l| l.get(0))?.collect::<Result<_, _>>()?;
        for (e, date, heure) in examens {
            let id = cle(&e.pk);
            if lien(base, SOURCE, "seance", &id)?.is_some() {
                rapport.seances.deja += 1;
                continue;
            }
            let Some(patient) = reference(e, "patient").and_then(|p| locaux.get(&p)).filter(|_| choix.seances) else {
                rapport.seances.ignores += 1;
                continue;
            };
            let (modele_id, version) = match &modele {
                Some(m) => m,
                None => modele.insert(modele_de_reprise(base)?),
            };
            let mut valeurs = Map::new();
            for (champ, id_champ, _) in CHAMPS_SEANCE {
                let valeur = texte(e, champ);
                if !valeur.is_empty() {
                    valeurs.insert(id_champ.into(), document(valeur));
                }
            }
            let mut notes: Vec<String> = commentaires
                .get(&id)
                .map(|c| {
                    c.iter()
                        .filter(|(_, t)| !t.is_empty())
                        .map(|(d, t)| match Date::lire(d) {
                            Ok(d) => format!("{} : {t}", d.en_toutes_lettres()),
                            Err(_) => t.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !texte(e, "status_reason").is_empty() {
                notes.push(texte(e, "status_reason").to_owned());
            }
            if !notes.is_empty() {
                valeurs.insert(CHAMP_COMMENTAIRES.0.into(), document(&notes.join("\n")));
            }
            let premiere = deja_vus.insert(patient.clone());
            let saisie = SaisieSeance {
                debut: format!("{date}T{heure}"),
                modele_id: modele_id.clone(),
                modele_version: *version,
                type_seance: if premiere {
                    TypeSeance::Premiere
                } else if e.fields.get("type").and_then(Value::as_i64) == Some(4) {
                    TypeSeance::Urgence
                } else {
                    TypeSeance::Suivi
                },
                titre: String::new(),
                importante: false,
                valeurs,
                facturation: Facturation::AFacturer,
                commentaire_gratuit: String::new(),
            };
            let seance = seances::creer(base, patient, &saisie).map_err(|e| ErreurImport::Donnees(format!("séance du {date} : {e}")))?;
            base.connexion().execute("UPDATE seances SET importee = 1 WHERE id = ?1", [&seance.id])?;
            lier(base, SOURCE, "seance", &id, &seance.id)?;
            rapport.seances.crees += 1;
        }
        if modele.is_some() {
            rapport.modele = Some(NOM_MODELE.into());
        }

        // Documents joints aux dossiers.
        let mut absents: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for d in documents_joints(&sauvegarde) {
            if lien(base, SOURCE, "document", &d.cle)?.is_some() {
                rapport.documents.deja += 1;
                continue;
            }
            let Some(patient) = locaux.get(&d.patient).filter(|_| choix.documents) else {
                rapport.documents.ignores += 1;
                continue;
            };
            let Some(octets) = sauvegarde.fichiers.contains(&d.chemin).then(|| sauvegarde.contenu(&d.chemin)).flatten() else {
                // Le titre du document absent n'est noté qu'une fois, même si l'import est relancé.
                if lien(base, SOURCE, "document_absent", &d.cle)?.is_none() {
                    absents.entry(patient.clone()).or_default().push(d.nom.clone());
                    lier(base, SOURCE, "document_absent", &d.cle, patient)?;
                }
                rapport.documents.ignores += 1;
                continue;
            };
            match documents::ajouter(base, patient, None, &d.nom, &octets) {
                Ok(document) => {
                    lier(base, SOURCE, "document", &d.cle, &document.id)?;
                    if !d.notes.is_empty() {
                        ajouter_remarque(base, patient, &format!("Document « {} » : {}", d.nom, d.notes))?;
                    }
                    rapport.documents.crees += 1;
                }
                Err(documents::ErreurDocument::Invalide(raison)) => {
                    rapport.avertissements.push(format!("Document « {} » : {raison}.", d.nom));
                    rapport.documents.ignores += 1;
                }
                Err(autre) => return Err(donnees(autre)),
            }
        }
        for (patient, noms) in absents.into_iter().filter(|(_, n)| !n.is_empty()) {
            ajouter_remarque(base, &patient, &format!("Documents de LibreOsteo absents de la sauvegarde : {}", noms.join(", ")))?;
        }
        let factures = sauvegarde.objets("invoice").len();
        if factures > 0 {
            rapport.avertissements.push(format!("{factures} facture(s) de LibreOsteo non reprise(s) : gardez sa sauvegarde, les pièces comptables se conservent dix ans."));
        }
        let resume = serde_json::to_string(&rapport).map_err(donnees)?;
        base.journaliser("import.libreosteo", SOURCE, None, Some(&resume))?;
        Ok::<_, ErreurImport>(())
    })?;
    Ok(rapport)
}

/// Ajoute une ligne aux remarques du patient, sans toucher au reste de la fiche.
fn ajouter_remarque(base: &Base, patient_id: &str, ligne: &str) -> Result<(), ErreurImport> {
    let patient = patients::lire(base, patient_id).map_err(donnees)?;
    let mut fiche = patient.fiche;
    fiche.remarques = [fiche.remarques.trim(), ligne].iter().filter(|r| !r.is_empty()).copied().collect::<Vec<_>>().join("\n");
    patients::modifier(base, patient_id, &fiche).map_err(donnees)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::json;

    use super::*;
    use crate::chiffrement::CleDonnees;

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        (dossier, base)
    }

    /// Sauvegarde LibreOsteo fictive : deux patients, trois séances, un document, une facture.
    fn dump() -> Value {
        json!([
            { "model": "libreosteoweb.regulardoctor", "pk": 1, "fields": { "family_name": "Durand", "first_name": "Paul", "phone": "05 53 00 00 00", "city": "Fumel" } },
            { "model": "libreosteoweb.patient", "pk": 1, "fields": {
                "family_name": "Martin", "original_name": "", "first_name": "Camille", "birth_date": "1988-03-14", "consent": "2024-01-10",
                "address_street": "3 rue des Lilas", "address_complement": "", "address_zipcode": "47500", "address_city": "Fumel",
                "email": "camille@exemple.fr", "phone": "", "mobile_phone": "06 00 00 00 01", "job": "Infirmière", "hobbies": "Randonnée",
                "doctor": 1, "smoker": true, "laterality": "R", "important_info": "Allergie au latex", "current_treatment": "",
                "surgical_history": "Appendicectomie 2005", "medical_history": "Asthme", "family_history": "", "trauma_history": "Entorse cheville G 2019",
                "medical_reports": "", "creation_date": "2024-01-10", "sex": "F" } },
            { "model": "libreosteoweb.patient", "pk": 2, "fields": {
                "family_name": "Girard", "first_name": "Thomas", "birth_date": "1979-11-02", "consent": null, "address_zipcode": "B-1000",
                "address_city": "Bruxelles", "email": "thomas@", "doctor": null, "smoker": false, "laterality": null, "sex": "M" } },
            { "model": "libreosteoweb.children", "pk": 1, "fields": { "family_name": "Martin", "first_name": "Léo", "birthday_date": "2016-05-02", "parent": 1 } },
            { "model": "libreosteoweb.examination", "pk": 10, "fields": {
                "reason": "Lombalgie", "reason_description": "Port de charge", "orl": "", "visceral": "", "pulmo": "", "uro_gyneco": "",
                "periphery": "", "general_state": "Bon", "medical_examination": "", "diagnosis": "Dysfonction L5", "treatments": "Structurel",
                "conclusion": "Revoir dans un mois", "date": "2024-03-12T13:30:00Z", "status": 2, "status_reason": null, "type": 1, "invoices": [7], "patient": 1, "therapeut": 1 } },
            { "model": "libreosteoweb.examination", "pk": 11, "fields": {
                "reason": "Contrôle", "date": "2024-04-15T08:00:00.123456+02:00", "status": 3, "type": 4, "patient": 1 } },
            { "model": "libreosteoweb.examination", "pk": 12, "fields": { "reason": "Cervicalgie", "date": "2023-12-01T17:15:00Z", "status": 2, "type": 1, "patient": 2 } },
            { "model": "libreosteoweb.examinationcomment", "pk": 1, "fields": { "comment": "Patiente rassurée", "date": "2024-03-13T09:00:00Z", "examination": 10, "user": 1 } },
            { "model": "libreosteoweb.document", "pk": 5, "fields": { "document_file": "documents/a1b2c3.pdf", "title": "Radio lombaire", "notes": "Pas de fracture", "internal_date": "2024-03-12T13:40:00Z", "document_date": "2024-03-01", "mime_type": "application/pdf" } },
            { "model": "libreosteoweb.document", "pk": 6, "fields": { "document_file": "documents/perdu.jpg", "title": "Photo posture", "internal_date": "2024-03-12T13:40:00Z" } },
            { "model": "libreosteoweb.patientdocument", "pk": 5, "fields": { "patient": 1, "document": 5, "attachment_type": 1 } },
            { "model": "libreosteoweb.patientdocument", "pk": 6, "fields": { "patient": 1, "document": 6, "attachment_type": 1 } },
            { "model": "libreosteoweb.invoice", "pk": 7, "fields": { "number": "10001", "amount": 55.0 } },
            { "model": "auth.user", "pk": 1, "fields": { "username": "osteo" } }
        ])
    }

    fn archive() -> Vec<u8> {
        let mut sortie = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        sortie.start_file("dump.json", options).unwrap();
        sortie.write_all(dump().to_string().as_bytes()).unwrap();
        sortie.start_file("meta", options).unwrap();
        sortie.write_all(b"0.6.4").unwrap();
        sortie.start_file("documents/a1b2c3.pdf", options).unwrap();
        sortie.write_all(b"%PDF-1.4 radio fictive").unwrap();
        sortie.finish().unwrap().into_inner()
    }

    const TOUT: ChoixLibreOsteo = ChoixLibreOsteo { patients: true, seances: true, documents: true };

    #[test]
    fn analyse_sans_rien_ecrire() {
        let (_d, base) = base();
        let analyse = analyser(&base, &archive()).unwrap();
        assert_eq!((analyse.version.as_deref(), analyse.patients, analyse.seances, analyse.documents, analyse.factures), (Some("0.6.4"), 2, 3, 1, 1));
        assert_eq!((analyse.premiere_seance.as_deref(), analyse.derniere_seance.as_deref()), (Some("2023-12-01"), Some("2024-04-15")));
        assert_eq!(analyse.apercu[0].nom, "Martin");
        assert_eq!(analyse.apercu[0].seances, 2);
        assert!(analyse.points.iter().any(|p| p.contains("1 document(s) absent(s)")));
        assert!(analyse.points.iter().any(|p| p.contains("1 facture(s) de LibreOsteo ne sont pas reprises")));
        assert!(patients::lister(&base).unwrap().is_empty());
        assert!(matches!(analyser(&base, b"{}"), Err(ErreurImport::Archive(_))));
        assert!(matches!(analyser(&base, b"[]"), Err(ErreurImport::Archive(m)) if m.contains("aucune donnée")));
    }

    #[test]
    fn importe_patients_seances_et_documents_une_seule_fois() {
        let (_d, base) = base();
        let rapport = importer(&base, &archive(), TOUT).unwrap();
        assert_eq!(rapport.patients, Compteur { crees: 2, deja: 0, ignores: 0 });
        assert_eq!(rapport.seances, Compteur { crees: 3, deja: 0, ignores: 0 });
        assert_eq!(rapport.documents, Compteur { crees: 1, deja: 0, ignores: 1 });
        assert_eq!(rapport.modele.as_deref(), Some(NOM_MODELE));

        let liste = patients::lister(&base).unwrap();
        let camille = patients::lire(&base, &liste.iter().find(|p| p.prenom == "Camille").unwrap().id).unwrap();
        let f = &camille.fiche;
        assert_eq!((f.sexe.as_str(), f.lateralite.as_str(), f.portable.as_str(), f.profession.as_str()), ("F", "droitier", "06 00 00 00 01", "Infirmière"));
        assert_eq!(f.medecin_traitant, "Dr Paul Durand, Fumel, 05 53 00 00 00");
        assert_eq!(f.notes_importantes, "Allergie au latex");
        assert_eq!(f.consentement_le.as_deref(), Some("2024-01-10"));
        assert_eq!(f.enfants, Some(1));
        assert!(f.remarques_antecedents.starts_with("Fumeur.\n\nAntécédents médicaux :\nAsthme"));
        assert!(f.remarques_antecedents.contains("Antécédents traumatiques :\nEntorse cheville G 2019"));
        assert!(f.remarques.contains("Enfants : Léo Martin (né(e) le 2 mai 2016)"));
        assert!(f.remarques.contains("Documents de LibreOsteo absents de la sauvegarde : Photo posture.jpg"));
        assert!(f.remarques.contains("Document « Radio lombaire.pdf » : Pas de fracture"));
        let thomas = patients::lire(&base, &liste.iter().find(|p| p.prenom == "Thomas").unwrap().id).unwrap().fiche;
        assert!(thomas.remarques.contains("Email repris de LibreOsteo, incomplet : thomas@"));
        assert!(thomas.remarques.contains("Code postal repris de LibreOsteo : B-1000"));

        let seances = seances::lister_patient(&base, &camille.id).unwrap();
        assert_eq!(seances.len(), 2);
        let premiere = seances::lire(&base, &seances.iter().find(|s| s.debut.starts_with("2024-03-12")).unwrap().id).unwrap();
        // 13 h 30 en temps universel : 14 h 30 à Paris en mars.
        assert_eq!(premiere.saisie.debut, "2024-03-12T14:30");
        assert_eq!(premiere.saisie.type_seance, TypeSeance::Premiere);
        assert!(premiere.importee);
        assert_eq!(seances::texte_de(&premiere.saisie.valeurs["lo_motif"]), "Lombalgie");
        assert_eq!(seances::texte_de(&premiere.saisie.valeurs["lo_diagnostic"]), "Dysfonction L5");
        assert_eq!(seances::texte_de(&premiere.saisie.valeurs["lo_commentaires"]), "13 mars 2024 : Patiente rassurée");
        let controle = seances::lire(&base, &seances.iter().find(|s| s.debut.starts_with("2024-04-15")).unwrap().id).unwrap();
        assert_eq!((controle.saisie.debut.as_str(), controle.saisie.type_seance), ("2024-04-15T08:00", TypeSeance::Urgence));
        let documents = documents::lister(&base, &camille.id).unwrap();
        assert_eq!(documents.iter().map(|d| d.nom.as_str()).collect::<Vec<_>>(), ["Radio lombaire.pdf"]);

        let second = importer(&base, &archive(), TOUT).unwrap();
        assert_eq!((second.patients.deja, second.seances.deja, second.documents.deja, second.patients.crees), (2, 3, 1, 0));
        assert_eq!(analyser(&base, &archive()).unwrap().deja_importes, 2 + 3 + 1);
        assert_eq!(patients::lister(&base).unwrap().len(), 2);
    }

    #[test]
    fn suit_les_cases_et_lit_un_dump_seul() {
        let (_d, base) = base();
        let seul = dump().to_string();
        let rapport = importer(&base, seul.as_bytes(), ChoixLibreOsteo { patients: true, seances: false, documents: true }).unwrap();
        assert_eq!((rapport.patients.crees, rapport.seances.ignores, rapport.documents.ignores), (2, 3, 2));
        assert!(rapport.modele.is_none());
        // Les séances viennent ensuite, rattachées aux patients déjà importés.
        let suite = importer(&base, seul.as_bytes(), ChoixLibreOsteo { patients: false, seances: true, documents: false }).unwrap();
        assert_eq!((suite.patients.deja, suite.seances.crees), (2, 3));
        // Les titres des documents absents ne sont notés qu'une fois.
        importer(&base, seul.as_bytes(), TOUT).unwrap();
        let camille = patients::lister(&base).unwrap().into_iter().find(|p| p.prenom == "Camille").unwrap();
        let remarques = patients::lire(&base, &camille.id).unwrap().fiche.remarques;
        assert_eq!(remarques.matches("absents de la sauvegarde").count(), 1, "{remarques}");
    }

    #[test]
    fn dates_django() {
        assert_eq!(date_heure("2024-03-12T13:30:00Z"), Some(("2024-03-12".into(), "14:30".into())));
        assert_eq!(date_heure("2024-07-01T22:30:00+00:00"), Some(("2024-07-02".into(), "00:30".into())));
        assert_eq!(date_heure("2024-04-15T08:00:00.123456+02:00"), Some(("2024-04-15".into(), "08:00".into())));
        assert_eq!(date_heure("2024-04-15T08:00:00"), Some(("2024-04-15".into(), "08:00".into())));
        assert_eq!(date_heure("pas une date"), None);
    }
}
