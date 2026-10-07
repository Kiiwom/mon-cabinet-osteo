//! Séances : saisies selon une version précise d'un modèle de consultation, enregistrées au fil
//! de la frappe, mises à la corbeille 30 jours avant d'être effacées.
//!
//! Les listes (dossier, séances d'une période) reprennent le motif et les douleurs avant et après
//! d'après le rôle des champs du modèle.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;
use crate::modeles::{self, Definition, ErreurModele, TypeChamp};
use crate::numerotation::Date;

/// Taille maximale des valeurs d'une séance, en octets de JSON : un garde-fou, très au-delà d'une vraie séance.
const TAILLE_MAX: usize = 2_000_000;
/// Une séance modifiée plusieurs fois dans ce délai n'occupe qu'une ligne du journal.
const REGROUPEMENT_JOURNAL: i64 = 600;
/// Durée de la corbeille, en secondes.
pub const DUREE_CORBEILLE: i64 = 30 * 86_400;
const LONGUEUR_MOTIF: usize = 160;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TypeSeance {
    Premiere,
    #[default]
    Suivi,
    Urgence,
}

impl TypeSeance {
    fn en_texte(self) -> &'static str {
        match self {
            Self::Premiere => "premiere",
            Self::Suivi => "suivi",
            Self::Urgence => "urgence",
        }
    }

    fn depuis_texte(texte: &str) -> Self {
        match texte {
            "premiere" => Self::Premiere,
            "urgence" => Self::Urgence,
            _ => Self::Suivi,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Facturation {
    #[default]
    AFacturer,
    Gratuit,
}

impl Facturation {
    fn en_texte(self) -> &'static str {
        match self {
            Self::AFacturer => "a_facturer",
            Self::Gratuit => "gratuit",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SaisieSeance {
    /// `AAAA-MM-JJTHH:MM`, heure du cabinet.
    pub debut: String,
    pub modele_id: String,
    pub modele_version: i64,
    #[serde(rename = "type")]
    pub type_seance: TypeSeance,
    pub titre: String,
    pub importante: bool,
    /// Clé du champ → valeur : texte, nombre, document de l'éditeur, liste de cases…
    pub valeurs: Map<String, Value>,
    pub facturation: Facturation,
    pub commentaire_gratuit: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Seance {
    pub id: String,
    pub patient_id: String,
    #[serde(flatten)]
    pub saisie: SaisieSeance,
    pub supprimee_le: Option<i64>,
    pub cree_le: i64,
    pub modifie_le: i64,
}

/// Une ligne des listes de séances.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ResumeSeance {
    pub id: String,
    pub patient_id: String,
    pub patient_nom: String,
    pub patient_prenom: String,
    pub debut: String,
    pub modele_nom: String,
    #[serde(rename = "type")]
    pub type_seance: TypeSeance,
    pub titre: String,
    pub importante: bool,
    pub motif: String,
    pub douleur_avant: Option<f64>,
    pub douleur_apres: Option<f64>,
    pub facturation: Facturation,
    pub commentaire_gratuit: String,
    pub supprimee_le: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurSeance {
    #[error("{0}")]
    Invalide(&'static str),
    #[error("cette séance n'existe plus")]
    Introuvable,
    #[error("ce dossier patient n'existe plus")]
    PatientIntrouvable,
    #[error(transparent)]
    Modele(#[from] ErreurModele),
    #[error(transparent)]
    Aleatoire(#[from] identifiant::ErreurAleatoire),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurSeance {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

impl From<serde_json::Error> for ErreurSeance {
    fn from(erreur: serde_json::Error) -> Self {
        Self::Base(erreur.into())
    }
}

/// `AAAA-MM-JJTHH:MM` avec une date et une heure possibles.
fn debut_valide(debut: &str) -> bool {
    let Some((date, heure)) = debut.split_once('T') else { return false };
    let Some((h, m)) = heure.split_once(':') else { return false };
    Date::lire(date).is_ok_and(|d| d.annee() >= 1900)
        && h.len() == 2
        && m.len() == 2
        && h.parse::<u32>().is_ok_and(|h| h < 24)
        && m.parse::<u32>().is_ok_and(|m| m < 60)
}

impl SaisieSeance {
    pub fn verifier(&self) -> Result<Self, ErreurSeance> {
        if !debut_valide(&self.debut) {
            return Err(ErreurSeance::Invalide("date ou heure de séance invalide"));
        }
        if serde_json::to_vec(&self.valeurs)?.len() > TAILLE_MAX {
            return Err(ErreurSeance::Invalide("la séance dépasse la taille admise"));
        }
        Ok(Self {
            titre: self.titre.split_whitespace().collect::<Vec<_>>().join(" "),
            commentaire_gratuit: self.commentaire_gratuit.trim().to_owned(),
            ..self.clone()
        })
    }
}

/// Texte lisible d'une valeur : texte simple, ou document de l'éditeur (paragraphes, listes,
/// choix retenus d'une trame, blancs complétés).
pub fn texte_de(valeur: &Value) -> String {
    match valeur {
        Value::String(texte) => texte.clone(),
        Value::Object(_) => {
            let mut blocs = Vec::new();
            texte_des_blocs(valeur, &mut blocs);
            blocs.join("\n").trim().to_owned()
        }
        _ => String::new(),
    }
}

fn texte_des_blocs(noeud: &Value, blocs: &mut Vec<String>) {
    let enfants = noeud.get("content").and_then(Value::as_array);
    match noeud.get("type").and_then(Value::as_str) {
        Some("paragraph") => {
            let mut ligne = String::new();
            for enfant in enfants.into_iter().flatten() {
                ligne.push_str(&texte_en_ligne(enfant));
            }
            blocs.push(nettoyer(&ligne));
        }
        _ => {
            for enfant in enfants.into_iter().flatten() {
                texte_des_blocs(enfant, blocs);
            }
        }
    }
}

/// Espaces doublés et ponctuation orpheline laissés par un choix ou un blanc vides : la même
/// règle que l'interface au moment de valider une trame.
fn nettoyer(texte: &str) -> String {
    let mut propre = String::with_capacity(texte.len());
    for c in texte.chars() {
        match c {
            ' ' if propre.ends_with(' ') => {}
            ',' | '.' => {
                while propre.ends_with(' ') {
                    propre.pop();
                }
                if propre.ends_with(',') {
                    if c == '.' {
                        propre.pop();
                        propre.push('.');
                    }
                } else {
                    propre.push(c);
                }
            }
            _ => propre.push(c),
        }
    }
    propre
}

fn texte_en_ligne(noeud: &Value) -> String {
    let attribut = |nom: &str| noeud.get("attrs").and_then(|a| a.get(nom));
    match noeud.get("type").and_then(Value::as_str) {
        Some("text") => noeud.get("text").and_then(Value::as_str).unwrap_or_default().to_owned(),
        Some("hardBreak") => "\n".into(),
        Some("blanc") => attribut("valeur").and_then(Value::as_str).unwrap_or_default().to_owned(),
        Some("choix") => {
            let retenus: Vec<&str> = attribut("retenus").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
            match retenus.as_slice() {
                [] => String::new(),
                [seul] => (*seul).to_owned(),
                [debut @ .., dernier] => format!("{} et {dernier}", debut.join(", ")),
            }
        }
        _ => String::new(),
    }
}

fn abreger(texte: &str) -> String {
    let une_ligne = texte.split_whitespace().collect::<Vec<_>>().join(" ");
    if une_ligne.chars().count() <= LONGUEUR_MOTIF {
        return une_ligne;
    }
    let mut court: String = une_ligne.chars().take(LONGUEUR_MOTIF - 1).collect();
    court.push('…');
    court
}

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<(Seance, String)> {
    Ok((
        Seance {
            id: ligne.get("id")?,
            patient_id: ligne.get("patient_id")?,
            saisie: SaisieSeance {
                debut: ligne.get("debut")?,
                modele_id: ligne.get("modele_id")?,
                modele_version: ligne.get("modele_version")?,
                type_seance: TypeSeance::depuis_texte(&ligne.get::<_, String>("type")?),
                titre: ligne.get("titre")?,
                importante: ligne.get("importante")?,
                valeurs: Map::new(),
                facturation: if ligne.get::<_, String>("facturation")? == "gratuit" { Facturation::Gratuit } else { Facturation::AFacturer },
                commentaire_gratuit: ligne.get("commentaire_gratuit")?,
            },
            supprimee_le: ligne.get("supprimee_le")?,
            cree_le: ligne.get("cree_le")?,
            modifie_le: ligne.get("modifie_le")?,
        },
        ligne.get("valeurs")?,
    ))
}

fn avec_valeurs((mut seance, valeurs): (Seance, String)) -> Result<Seance, ErreurSeance> {
    seance.saisie.valeurs = serde_json::from_str(&valeurs)?;
    Ok(seance)
}

pub fn lire(base: &Base, id: &str) -> Result<Seance, ErreurSeance> {
    let ligne = base.connexion().query_row("SELECT * FROM seances WHERE id = ?1", [id], depuis_ligne).optional()?.ok_or(ErreurSeance::Introuvable)?;
    avec_valeurs(ligne)
}

fn verifier_references(base: &Base, patient_id: &str, saisie: &SaisieSeance) -> Result<(), ErreurSeance> {
    let patient: Option<i64> = base.connexion().query_row("SELECT 1 FROM patients WHERE id = ?1", [patient_id], |l| l.get(0)).optional()?;
    if patient.is_none() {
        return Err(ErreurSeance::PatientIntrouvable);
    }
    modeles::lire_version(base, &saisie.modele_id, saisie.modele_version)?;
    Ok(())
}

/// Inscrit la modification au journal, en regroupant celles d'une même séance faites coup sur coup.
fn journaliser(base: &Base, action: &str, avant: Option<&Seance>, apres: &Seance) -> Result<(), ErreurSeance> {
    let apres_json = serde_json::to_string(apres)?;
    if action == "seance.modifiee" {
        let derniere: Option<(i64, String, String)> = base
            .connexion()
            .query_row("SELECT id, action, le FROM journal WHERE entite = ?1 ORDER BY id DESC LIMIT 1", [&apres.id], |l| {
                Ok((l.get(0)?, l.get(1)?, l.get(2)?))
            })
            .optional()?;
        if let Some((ligne, action_precedente, le)) = derniere
            && action_precedente == action
            && le.parse::<i64>().is_ok_and(|le| maintenant() - le < REGROUPEMENT_JOURNAL)
        {
            base.connexion().execute("UPDATE journal SET apres = ?2 WHERE id = ?1", rusqlite::params![ligne, apres_json])?;
            return Ok(());
        }
    }
    let avant = avant.map(serde_json::to_string).transpose()?;
    base.journaliser(action, &apres.id, avant.as_deref(), Some(&apres_json))?;
    Ok(())
}

pub fn creer(base: &Base, patient_id: &str, saisie: &SaisieSeance) -> Result<Seance, ErreurSeance> {
    let saisie = saisie.verifier()?;
    verifier_references(base, patient_id, &saisie)?;
    let id = identifiant::nouveau()?;
    let s = &saisie;
    base.connexion().execute(
        "INSERT INTO seances (id, patient_id, debut, modele_id, modele_version, type, titre, importante, valeurs, facturation,
                              commentaire_gratuit, cree_le, modifie_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        rusqlite::params![
            id,
            patient_id,
            s.debut,
            s.modele_id,
            s.modele_version,
            s.type_seance.en_texte(),
            s.titre,
            s.importante,
            serde_json::to_string(&s.valeurs)?,
            s.facturation.en_texte(),
            s.commentaire_gratuit,
            maintenant()
        ],
    )?;
    let seance = lire(base, &id)?;
    journaliser(base, "seance.creee", None, &seance)?;
    Ok(seance)
}

/// Enregistre la séance telle qu'elle est à l'écran : appelé au fil de la saisie.
pub fn enregistrer(base: &Base, id: &str, saisie: &SaisieSeance) -> Result<Seance, ErreurSeance> {
    let saisie = saisie.verifier()?;
    let avant = lire(base, id)?;
    if avant.supprimee_le.is_some() {
        return Err(ErreurSeance::Invalide("cette séance est à la corbeille : restaurez-la pour la modifier"));
    }
    if avant.saisie == saisie {
        return Ok(avant);
    }
    verifier_references(base, &avant.patient_id, &saisie)?;
    let s = &saisie;
    base.connexion().execute(
        "UPDATE seances SET debut = ?2, modele_id = ?3, modele_version = ?4, type = ?5, titre = ?6, importante = ?7, valeurs = ?8,
                facturation = ?9, commentaire_gratuit = ?10, modifie_le = ?11
         WHERE id = ?1",
        rusqlite::params![
            id,
            s.debut,
            s.modele_id,
            s.modele_version,
            s.type_seance.en_texte(),
            s.titre,
            s.importante,
            serde_json::to_string(&s.valeurs)?,
            s.facturation.en_texte(),
            s.commentaire_gratuit,
            maintenant()
        ],
    )?;
    let apres = lire(base, id)?;
    journaliser(base, "seance.modifiee", Some(&avant), &apres)?;
    Ok(apres)
}

/// Met la séance à la corbeille. Elle reste restaurable pendant 30 jours.
pub fn supprimer(base: &Base, id: &str) -> Result<(), ErreurSeance> {
    let avant = lire(base, id)?;
    if avant.supprimee_le.is_some() {
        return Ok(());
    }
    base.connexion().execute("UPDATE seances SET supprimee_le = ?2 WHERE id = ?1", rusqlite::params![id, maintenant()])?;
    let apres = lire(base, id)?;
    journaliser(base, "seance.corbeille", Some(&avant), &apres)
}

pub fn restaurer(base: &Base, id: &str) -> Result<Seance, ErreurSeance> {
    let avant = lire(base, id)?;
    base.connexion().execute("UPDATE seances SET supprimee_le = NULL WHERE id = ?1", [id])?;
    let apres = lire(base, id)?;
    journaliser(base, "seance.restauree", Some(&avant), &apres)?;
    Ok(apres)
}

/// Efface les séances restées plus de 30 jours à la corbeille. Rend le nombre de séances effacées.
pub fn vider_corbeille_ancienne(base: &Base) -> Result<usize, ErreurSeance> {
    let limite = maintenant() - DUREE_CORBEILLE;
    let anciennes: Vec<String> = base
        .connexion()
        .prepare("SELECT id FROM seances WHERE supprimee_le IS NOT NULL AND supprimee_le < ?1")?
        .query_map([limite], |l| l.get(0))?
        .collect::<Result<_, _>>()?;
    for id in &anciennes {
        let avant = lire(base, id)?;
        base.connexion().execute("DELETE FROM seances WHERE id = ?1", [id])?;
        base.journaliser("seance.effacee", id, Some(&serde_json::to_string(&avant)?), None)?;
    }
    Ok(anciennes.len())
}

/// Définitions de modèle lues une fois pour toute une liste.
struct Definitions<'a> {
    base: &'a Base,
    cache: HashMap<(String, i64), Option<Definition>>,
    noms: HashMap<String, String>,
}

impl<'a> Definitions<'a> {
    fn new(base: &'a Base) -> Result<Self, ErreurSeance> {
        let noms = base
            .connexion()
            .prepare("SELECT id, nom FROM modeles")?
            .query_map([], |l| Ok((l.get(0)?, l.get(1)?)))?
            .collect::<Result<_, _>>()?;
        Ok(Self { base, cache: HashMap::new(), noms })
    }

    fn resumer(&mut self, seance: &Seance, patient_nom: String, patient_prenom: String) -> ResumeSeance {
        let cle = (seance.saisie.modele_id.clone(), seance.saisie.modele_version);
        let definition = self
            .cache
            .entry(cle)
            .or_insert_with(|| modeles::lire_version(self.base, &seance.saisie.modele_id, seance.saisie.modele_version).ok());
        let champ_de_role = |role: &str| definition.as_ref().and_then(|d| d.champs.iter().find(|c| c.role == role));
        let valeur = |role: &str| champ_de_role(role).and_then(|c| seance.saisie.valeurs.get(&c.id));
        let douleur = |role: &str| {
            champ_de_role(role).filter(|c| c.type_champ == TypeChamp::Curseur).and_then(|c| seance.saisie.valeurs.get(&c.id)).and_then(Value::as_f64)
        };
        ResumeSeance {
            id: seance.id.clone(),
            patient_id: seance.patient_id.clone(),
            patient_nom,
            patient_prenom,
            debut: seance.saisie.debut.clone(),
            modele_nom: self.noms.get(&seance.saisie.modele_id).cloned().unwrap_or_default(),
            type_seance: seance.saisie.type_seance,
            titre: seance.saisie.titre.clone(),
            importante: seance.saisie.importante,
            motif: valeur("motif").map(texte_de).map(|t| abreger(&t)).unwrap_or_default(),
            douleur_avant: douleur("douleur_avant"),
            douleur_apres: douleur("douleur_apres"),
            facturation: seance.saisie.facturation,
            commentaire_gratuit: seance.saisie.commentaire_gratuit.clone(),
            supprimee_le: seance.supprimee_le,
        }
    }
}

fn lister_ou(base: &Base, condition: &str, parametres: &[&dyn rusqlite::ToSql]) -> Result<Vec<ResumeSeance>, ErreurSeance> {
    let mut requete = base.connexion().prepare(&format!(
        "SELECT s.*, p.nom AS patient_nom, p.prenom AS patient_prenom FROM seances s JOIN patients p ON p.id = s.patient_id
         WHERE {condition} ORDER BY s.debut DESC"
    ))?;
    let lignes = requete
        .query_map(parametres, |l| Ok((depuis_ligne(l)?, l.get::<_, String>("patient_nom")?, l.get::<_, String>("patient_prenom")?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut definitions = Definitions::new(base)?;
    lignes
        .into_iter()
        .map(|(ligne, nom, prenom)| Ok(definitions.resumer(&avec_valeurs(ligne)?, nom, prenom)))
        .collect()
}

/// Séances du patient, de la plus récente à la plus ancienne, corbeille exclue.
pub fn lister_patient(base: &Base, patient_id: &str) -> Result<Vec<ResumeSeance>, ErreurSeance> {
    lister_ou(base, "s.patient_id = ?1 AND s.supprimee_le IS NULL", &[&patient_id])
}

/// Séances de tous les patients entre deux dates comprises (`AAAA-MM-JJ`), corbeille exclue.
pub fn lister_periode(base: &Base, du: &str, au: &str) -> Result<Vec<ResumeSeance>, ErreurSeance> {
    let fin = format!("{au}T99");
    lister_ou(base, "s.debut >= ?1 AND s.debut < ?2 AND s.supprimee_le IS NULL", &[&du, &fin])
}

pub fn corbeille(base: &Base) -> Result<Vec<ResumeSeance>, ErreurSeance> {
    lister_ou(base, "s.supprimee_le IS NOT NULL", &[])
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::chiffrement::CleDonnees;
    use crate::modeles::installer_modeles_fournis;
    use crate::patients::{self, FichePatient};

    struct Cabinet {
        _dossier: tempfile::TempDir,
        base: Base,
        patient: String,
        adulte: modeles::Modele,
    }

    fn cabinet() -> Cabinet {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        installer_modeles_fournis(&base).unwrap();
        let fiche = FichePatient { nom: "Martin".into(), prenom: "Camille".into(), ..Default::default() };
        let patient = patients::creer(&base, &fiche).unwrap().id;
        let adulte = modeles::lister(&base).unwrap().remove(0);
        Cabinet { _dossier: dossier, base, patient, adulte }
    }

    fn saisie(c: &Cabinet, debut: &str) -> SaisieSeance {
        SaisieSeance { debut: debut.into(), modele_id: c.adulte.id.clone(), modele_version: c.adulte.version, ..Default::default() }
    }

    fn motif(texte: &str) -> Value {
        json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": texte }] }] })
    }

    #[test]
    fn tire_le_texte_d_un_document_avec_trames() {
        let document = json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [
                { "type": "text", "text": "Douleur lombaire " },
                { "type": "choix", "attrs": { "options": ["droite", "gauche"], "multiple": false, "retenus": ["droite"] } },
                { "type": "text", "text": ", " },
                { "type": "choix", "attrs": { "options": ["a", "b", "c"], "multiple": true, "retenus": ["aiguë", "matinale", "positionnelle"] } },
                { "type": "text", "text": ", depuis " },
                { "type": "blanc", "attrs": { "indication": "durée", "valeur": "3 jours" } }
            ]},
            { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "EVA 6/10" }] }] }] }
        ]});
        assert_eq!(texte_de(&document), "Douleur lombaire droite, aiguë, matinale et positionnelle, depuis 3 jours\nEVA 6/10");
        assert_eq!(texte_de(&json!("texte simple")), "texte simple");
        // Trame pas encore validée : pas de virgules orphelines dans le motif des listes.
        let inachevee = json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [
            { "type": "text", "text": "Douleur lombaire " },
            { "type": "choix", "attrs": { "options": ["droite", "gauche"], "multiple": false, "retenus": [] } },
            { "type": "text", "text": ", " },
            { "type": "choix", "attrs": { "options": ["aiguë", "chronique"], "multiple": false, "retenus": [] } },
            { "type": "text", "text": ", depuis " },
            { "type": "blanc", "attrs": { "indication": "durée", "valeur": "" } },
            { "type": "text", "text": "." }
        ]}]});
        assert_eq!(texte_de(&inachevee), "Douleur lombaire, depuis.");
        assert_eq!(nettoyer("depuis  3 jours , EVA ."), "depuis 3 jours, EVA.");
        assert_eq!(nettoyer("a, , b"), "a, b");
        assert_eq!(texte_de(&json!(6)), "");
    }

    #[test]
    fn cree_enregistre_et_resume_selon_le_role_des_champs() {
        let c = cabinet();
        let mut s = saisie(&c, "2026-10-06T14:30");
        s.type_seance = TypeSeance::Premiere;
        let seance = creer(&c.base, &c.patient, &s).unwrap();
        s.valeurs.insert("motif".into(), motif("Lombalgie basse après un déménagement"));
        s.valeurs.insert("douleur_avant".into(), json!(6));
        s.valeurs.insert("douleur_apres".into(), json!(2));
        s.titre = "  Lombalgie   basse ".into();
        let enregistree = enregistrer(&c.base, &seance.id, &s).unwrap();
        assert_eq!(enregistree.saisie.titre, "Lombalgie basse");

        let liste = lister_patient(&c.base, &c.patient).unwrap();
        assert_eq!(liste.len(), 1);
        let r = &liste[0];
        assert_eq!((r.motif.as_str(), r.douleur_avant, r.douleur_apres), ("Lombalgie basse après un déménagement", Some(6.0), Some(2.0)));
        assert_eq!((r.modele_nom.as_str(), r.type_seance, r.patient_prenom.as_str()), ("Adulte", TypeSeance::Premiere, "Camille"));

        let resume = &patients::lister(&c.base).unwrap()[0];
        assert_eq!((resume.seances, resume.derniere_seance.as_deref()), (1, Some("2026-10-06")));
    }

    #[test]
    fn refuse_une_date_impossible_un_patient_ou_un_modele_inconnu() {
        let c = cabinet();
        for debut in ["2026-10-06", "2026-13-06T14:30", "2026-10-06T24:00", "2026-10-06T14:3"] {
            assert!(matches!(creer(&c.base, &c.patient, &saisie(&c, debut)), Err(ErreurSeance::Invalide(_))), "{debut}");
        }
        assert!(matches!(creer(&c.base, "inconnu", &saisie(&c, "2026-10-06T14:30")), Err(ErreurSeance::PatientIntrouvable)));
        let mut autre_version = saisie(&c, "2026-10-06T14:30");
        autre_version.modele_version = 9;
        assert!(matches!(creer(&c.base, &c.patient, &autre_version), Err(ErreurSeance::Modele(ErreurModele::Introuvable))));
    }

    #[test]
    fn regroupe_les_enregistrements_rapproches_dans_le_journal() {
        let c = cabinet();
        let mut s = saisie(&c, "2026-10-06T14:30");
        let seance = creer(&c.base, &c.patient, &s).unwrap();
        for lettre in ["L", "Lo", "Lom", "Lomb"] {
            s.valeurs.insert("motif".into(), motif(lettre));
            enregistrer(&c.base, &seance.id, &s).unwrap();
        }
        let lignes: Vec<(String, String)> = c
            .base
            .connexion()
            .prepare("SELECT action, apres FROM journal WHERE entite = ?1 ORDER BY id")
            .unwrap()
            .query_map([&seance.id], |l| Ok((l.get(0)?, l.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(lignes.iter().map(|(a, _)| a.as_str()).collect::<Vec<_>>(), ["seance.creee", "seance.modifiee"]);
        assert!(lignes[1].1.contains("Lomb"));
    }

    #[test]
    fn corbeille_restauration_et_effacement_apres_trente_jours() {
        let c = cabinet();
        let s = saisie(&c, "2026-10-06T14:30");
        let seance = creer(&c.base, &c.patient, &s).unwrap();
        supprimer(&c.base, &seance.id).unwrap();
        assert!(lister_patient(&c.base, &c.patient).unwrap().is_empty());
        assert_eq!(corbeille(&c.base).unwrap().len(), 1);
        assert!(matches!(enregistrer(&c.base, &seance.id, &s), Err(ErreurSeance::Invalide(_))));
        restaurer(&c.base, &seance.id).unwrap();
        assert_eq!(lister_patient(&c.base, &c.patient).unwrap().len(), 1);

        supprimer(&c.base, &seance.id).unwrap();
        assert_eq!(vider_corbeille_ancienne(&c.base).unwrap(), 0);
        c.base
            .connexion()
            .execute("UPDATE seances SET supprimee_le = ?1", [maintenant() - DUREE_CORBEILLE - 1])
            .unwrap();
        assert_eq!(vider_corbeille_ancienne(&c.base).unwrap(), 1);
        assert!(matches!(lire(&c.base, &seance.id), Err(ErreurSeance::Introuvable)));
    }

    #[test]
    fn liste_les_seances_d_une_periode() {
        let c = cabinet();
        for debut in ["2026-09-30T18:00", "2026-10-01T08:45", "2026-10-31T19:30", "2026-11-01T09:00"] {
            creer(&c.base, &c.patient, &saisie(&c, debut)).unwrap();
        }
        let octobre = lister_periode(&c.base, "2026-10-01", "2026-10-31").unwrap();
        assert_eq!(octobre.iter().map(|s| s.debut.as_str()).collect::<Vec<_>>(), ["2026-10-31T19:30", "2026-10-01T08:45"]);
    }
}
