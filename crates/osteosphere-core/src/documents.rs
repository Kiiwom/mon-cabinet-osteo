//! Pièces jointes du dossier : PDF, images et documents, rattachés au dossier ou à une séance.
//!
//! Le contenu est rangé dans la base chiffrée : il suit le cabinet dans ses sauvegardes et n'est
//! jamais écrit en clair sur le disque, sauf quand le praticien demande à l'ouvrir ou à en garder une
//! copie. Un document supprimé reste 30 jours à la corbeille, comme une séance.

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;
use crate::seances::DUREE_CORBEILLE;

/// Au-delà, mieux vaut garder le fichier ailleurs : la base et ses sauvegardes resteraient trop lourdes.
pub const TAILLE_MAX: usize = 30 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ErreurDocument {
    #[error("ce document n'existe plus")]
    Introuvable,
    #[error("{0}")]
    Invalide(String),
    #[error("le générateur aléatoire du système est indisponible")]
    Aleatoire,
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurDocument {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

/// Un document, sans son contenu.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub patient_id: String,
    pub seance_id: Option<String>,
    pub nom: String,
    pub type_mime: String,
    pub taille: i64,
    pub ajoute_le: i64,
    pub supprime_le: Option<i64>,
}

/// Type d'après l'extension : de quoi choisir l'aperçu (image, PDF) ou l'application qui l'ouvre.
pub fn type_mime(nom: &str) -> &'static str {
    let extension = nom.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match extension.as_str() {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "tif" | "tiff" => "image/tiff",
        "txt" => "text/plain",
        "rtf" => "application/rtf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "odt" => "application/vnd.oasis.opendocument.text",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "dcm" => "application/dicom",
        _ => "application/octet-stream",
    }
}

/// Nom gardé pour le document : sans chemin, sans caractère refusé par Windows, 120 caractères au plus.
pub fn nom_propre(nom: &str) -> String {
    let dernier = nom.rsplit(['/', '\\']).next().unwrap_or(nom);
    let propre: String = dernier
        .chars()
        .map(|c| if matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .collect();
    let propre = propre.trim().trim_matches('.').trim();
    if propre.is_empty() {
        return "Document".into();
    }
    if propre.chars().count() <= 120 {
        return propre.to_owned();
    }
    // Trop long : l'extension est gardée.
    match propre.rsplit_once('.') {
        Some((debut, extension)) if extension.len() <= 8 => format!("{}.{extension}", debut.chars().take(110).collect::<String>()),
        _ => propre.chars().take(120).collect(),
    }
}

const COLONNES: &str = "id, patient_id, seance_id, nom, type_mime, taille, ajoute_le, supprime_le";

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<Document> {
    Ok(Document {
        id: ligne.get("id")?,
        patient_id: ligne.get("patient_id")?,
        seance_id: ligne.get("seance_id")?,
        nom: ligne.get("nom")?,
        type_mime: ligne.get("type_mime")?,
        taille: ligne.get("taille")?,
        ajoute_le: ligne.get("ajoute_le")?,
        supprime_le: ligne.get("supprime_le")?,
    })
}

pub fn lire(base: &Base, id: &str) -> Result<Document, ErreurDocument> {
    base.connexion()
        .query_row(&format!("SELECT {COLONNES} FROM documents WHERE id = ?1"), [id], depuis_ligne)
        .optional()?
        .ok_or(ErreurDocument::Introuvable)
}

fn journaliser(base: &Base, action: &str, avant: Option<&Document>, apres: Option<&Document>) -> Result<(), ErreurDocument> {
    let json = |d: &Document| serde_json::to_string(d).ok();
    let id = apres.or(avant).map(|d| d.id.as_str()).unwrap_or_default();
    base.journaliser(action, id, avant.and_then(json).as_deref(), apres.and_then(json).as_deref())?;
    Ok(())
}

/// Ajoute un document au dossier, et à la séance si elle est donnée.
pub fn ajouter(base: &Base, patient_id: &str, seance_id: Option<&str>, nom: &str, contenu: &[u8]) -> Result<Document, ErreurDocument> {
    if contenu.is_empty() {
        return Err(ErreurDocument::Invalide("ce fichier est vide".into()));
    }
    if contenu.len() > TAILLE_MAX {
        return Err(ErreurDocument::Invalide(format!(
            "« {} » dépasse 30 Mo : gardez-le dans un dossier de l'ordinateur et notez son emplacement dans le dossier",
            nom_propre(nom)
        )));
    }
    let patient: Option<i64> = base.connexion().query_row("SELECT 1 FROM patients WHERE id = ?1", [patient_id], |l| l.get(0)).optional()?;
    if patient.is_none() {
        return Err(ErreurDocument::Invalide("ce dossier n'existe plus".into()));
    }
    if let Some(seance) = seance_id {
        let de_ce_patient: Option<i64> = base
            .connexion()
            .query_row("SELECT 1 FROM seances WHERE id = ?1 AND patient_id = ?2", [seance, patient_id], |l| l.get(0))
            .optional()?;
        if de_ce_patient.is_none() {
            return Err(ErreurDocument::Invalide("cette séance n'appartient pas à ce dossier".into()));
        }
    }
    let nom = nom_propre(nom);
    let id = identifiant::nouveau().map_err(|_| ErreurDocument::Aleatoire)?;
    base.connexion().execute(
        "INSERT INTO documents (id, patient_id, seance_id, nom, type_mime, taille, contenu, ajoute_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, patient_id, seance_id, nom, type_mime(&nom), contenu.len() as i64, contenu, maintenant()],
    )?;
    let document = lire(base, &id)?;
    journaliser(base, "document.ajoute", None, Some(&document))?;
    Ok(document)
}

/// Documents du dossier, hors corbeille, les plus récents d'abord.
pub fn lister(base: &Base, patient_id: &str) -> Result<Vec<Document>, ErreurDocument> {
    let mut requete = base
        .connexion()
        .prepare(&format!("SELECT {COLONNES} FROM documents WHERE patient_id = ?1 AND supprime_le IS NULL ORDER BY ajoute_le DESC, nom"))?;
    Ok(requete.query_map([patient_id], depuis_ligne)?.collect::<rusqlite::Result<_>>()?)
}

/// Le document et son contenu.
pub fn contenu(base: &Base, id: &str) -> Result<(Document, Vec<u8>), ErreurDocument> {
    let document = lire(base, id)?;
    let octets: Vec<u8> = base.connexion().query_row("SELECT contenu FROM documents WHERE id = ?1", [id], |l| l.get(0))?;
    Ok((document, octets))
}

/// Renomme le document et le rattache à une séance du dossier, ou au dossier seul.
pub fn modifier(base: &Base, id: &str, nom: &str, seance_id: Option<&str>) -> Result<Document, ErreurDocument> {
    let avant = lire(base, id)?;
    if let Some(seance) = seance_id {
        let de_ce_patient: Option<i64> = base
            .connexion()
            .query_row("SELECT 1 FROM seances WHERE id = ?1 AND patient_id = ?2", [seance, &avant.patient_id], |l| l.get(0))
            .optional()?;
        if de_ce_patient.is_none() {
            return Err(ErreurDocument::Invalide("cette séance n'appartient pas à ce dossier".into()));
        }
    }
    let nom = nom_propre(nom);
    base.connexion().execute(
        "UPDATE documents SET nom = ?2, type_mime = ?3, seance_id = ?4 WHERE id = ?1",
        rusqlite::params![id, nom, type_mime(&nom), seance_id],
    )?;
    let apres = lire(base, id)?;
    journaliser(base, "document.modifie", Some(&avant), Some(&apres))?;
    Ok(apres)
}

/// Met le document à la corbeille, où il reste 30 jours.
pub fn supprimer(base: &Base, id: &str) -> Result<(), ErreurDocument> {
    let avant = lire(base, id)?;
    if avant.supprime_le.is_some() {
        return Ok(());
    }
    base.connexion().execute("UPDATE documents SET supprime_le = ?2 WHERE id = ?1", rusqlite::params![id, maintenant()])?;
    let apres = lire(base, id)?;
    journaliser(base, "document.supprime", Some(&avant), Some(&apres))
}

pub fn restaurer(base: &Base, id: &str) -> Result<Document, ErreurDocument> {
    let avant = lire(base, id)?;
    base.connexion().execute("UPDATE documents SET supprime_le = NULL WHERE id = ?1", [id])?;
    let apres = lire(base, id)?;
    journaliser(base, "document.restaure", Some(&avant), Some(&apres))?;
    Ok(apres)
}

/// Documents à la corbeille, tous dossiers confondus, les plus récemment supprimés d'abord.
pub fn corbeille(base: &Base) -> Result<Vec<Document>, ErreurDocument> {
    let mut requete =
        base.connexion().prepare(&format!("SELECT {COLONNES} FROM documents WHERE supprime_le IS NOT NULL ORDER BY supprime_le DESC"))?;
    Ok(requete.query_map([], depuis_ligne)?.collect::<rusqlite::Result<_>>()?)
}

/// Efface les documents restés plus de 30 jours à la corbeille. Rend le nombre de documents effacés.
pub fn vider_corbeille_ancienne(base: &Base) -> Result<usize, ErreurDocument> {
    let limite = maintenant() - DUREE_CORBEILLE;
    let anciens: Vec<Document> = base
        .connexion()
        .prepare(&format!("SELECT {COLONNES} FROM documents WHERE supprime_le IS NOT NULL AND supprime_le < ?1"))?
        .query_map([limite], depuis_ligne)?
        .collect::<rusqlite::Result<_>>()?;
    for document in &anciens {
        base.connexion().execute("DELETE FROM documents WHERE id = ?1", [&document.id])?;
        journaliser(base, "document.efface", Some(document), None)?;
    }
    Ok(anciens.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;
    use crate::modeles::{self, installer_modeles_fournis};
    use crate::patients::{self, FichePatient};
    use crate::seances::{self, Facturation, SaisieSeance, TypeSeance};

    fn cabinet() -> (tempfile::TempDir, Base, String, String) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("cabinet.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        installer_modeles_fournis(&base).unwrap();
        let patient = patients::creer(&base, &FichePatient { nom: "Martin".into(), prenom: "Camille".into(), ..Default::default() }).unwrap();
        let modele = &modeles::lister(&base).unwrap()[0];
        let seance = seances::creer(
            &base,
            &patient.id,
            &SaisieSeance {
                debut: "2026-10-06T14:30".into(),
                modele_id: modele.id.clone(),
                modele_version: modele.version,
                type_seance: TypeSeance::Premiere,
                titre: String::new(),
                importante: false,
                valeurs: Default::default(),
                facturation: Facturation::AFacturer,
                commentaire_gratuit: String::new(),
            },
        )
        .unwrap();
        (dossier, base, patient.id, seance.id)
    }

    #[test]
    fn range_le_contenu_et_le_rend_tel_quel() {
        let (_d, base, patient, seance) = cabinet();
        let pdf = b"%PDF-1.7 compte rendu fictif".to_vec();
        let document = ajouter(&base, &patient, Some(&seance), "C:\\Scans\\Radio: genou?.PDF", &pdf).unwrap();
        assert_eq!((document.nom.as_str(), document.type_mime.as_str(), document.taille), ("Radio- genou-.PDF", "application/pdf", pdf.len() as i64));
        assert_eq!(contenu(&base, &document.id).unwrap().1, pdf);
        assert_eq!(lister(&base, &patient).unwrap(), std::slice::from_ref(&document));

        let modifie = modifier(&base, &document.id, "Radiographie du genou.pdf", None).unwrap();
        assert_eq!((modifie.nom.as_str(), modifie.seance_id), ("Radiographie du genou.pdf", None));
        assert!(ajouter(&base, &patient, Some("autre-seance"), "x.png", b"png").is_err());
        assert!(ajouter(&base, &patient, None, "vide.txt", b"").is_err());
        assert!(ajouter(&base, &patient, None, "gros.bin", &vec![0; TAILLE_MAX + 1]).is_err());
    }

    #[test]
    fn passe_par_la_corbeille_trente_jours() {
        let (_d, base, patient, seance) = cabinet();
        let document = ajouter(&base, &patient, Some(&seance), "photo.jpg", b"jpeg").unwrap();
        supprimer(&base, &document.id).unwrap();
        assert!(lister(&base, &patient).unwrap().is_empty());
        assert_eq!(corbeille(&base).unwrap().len(), 1);
        restaurer(&base, &document.id).unwrap();
        assert_eq!(lister(&base, &patient).unwrap().len(), 1);

        supprimer(&base, &document.id).unwrap();
        base.connexion().execute("UPDATE documents SET supprime_le = ?1", [maintenant() - DUREE_CORBEILLE - 1]).unwrap();
        assert_eq!(vider_corbeille_ancienne(&base).unwrap(), 1);
        assert!(matches!(lire(&base, &document.id), Err(ErreurDocument::Introuvable)));
    }

    #[test]
    fn reste_au_dossier_quand_la_seance_est_effacee() {
        let (_d, base, patient, seance) = cabinet();
        let document = ajouter(&base, &patient, Some(&seance), "bilan.pdf", b"%PDF").unwrap();
        base.connexion().execute("DELETE FROM seances WHERE id = ?1", [&seance]).unwrap();
        assert_eq!(lire(&base, &document.id).unwrap().seance_id, None);
    }

    #[test]
    fn nomme_proprement() {
        assert_eq!(nom_propre("/home/x/Ordonnance.pdf"), "Ordonnance.pdf");
        assert_eq!(nom_propre("  ..  "), "Document");
        let long = format!("{}.pdf", "a".repeat(200));
        assert_eq!(nom_propre(&long).chars().count(), 114);
        assert!(nom_propre(&long).ends_with(".pdf"));
        assert_eq!(type_mime("photo.JPEG"), "image/jpeg");
        assert_eq!(type_mime("sans-extension"), "application/octet-stream");
    }
}
