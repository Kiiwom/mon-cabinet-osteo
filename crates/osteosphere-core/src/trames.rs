//! Trames : textes réutilisables appelés par un code court pendant la saisie.
//!
//! Syntaxe du modèle, la même que celle de l'interface :
//! `{droite | gauche}` choix unique, `{+ a | b}` choix multiple, `[durée]` blanc à compléter,
//! `{{prénom}}`, `{{nom}}`, `{{âge}}` et `{{date}}` remplis d'après le patient et la séance,
//! `\{`, `\}`, `\[`, `\]`, `\|` et `\\` pour écrire ces caractères tels quels.

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;

const BIBLIOTHEQUE_DE_DEPART: &str = include_str!("bibliotheque_depart.json");
const PARAMETRE_BIBLIOTHEQUE: &str = "trames.bibliotheque_installee";
/// Les codes de la bibliothèque déjà proposés au cabinet : une trame ajoutée à la bibliothèque
/// arrive aux cabinets existants, une trame supprimée par le praticien ne revient pas.
const PARAMETRE_PROPOSEES: &str = "trames.bibliotheque_proposee";
/// La première bibliothèque, proposée avant que les codes soient retenus un par un.
const PREMIERE_BIBLIOTHEQUE: [&str; 6] = ["lomb", "cerv", "eg", "nour", "post", "revoir"];
/// Les variables, sans accent : `{{âge}}` et `{{age}}` se valent.
pub const VARIABLES: [&str; 4] = ["prenom", "nom", "age", "date"];
/// Format des fichiers d'échange de trames.
pub const FORMAT_ECHANGE: &str = "osteosphere.trames";
const TRAMES_PAR_FICHIER: usize = 2_000;
const SPECIAUX: [char; 6] = ['{', '}', '[', ']', '|', '\\'];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trame {
    pub id: String,
    pub code: String,
    pub titre: String,
    pub categorie: String,
    pub modele: String,
    /// Le texte mis en forme (document de l'éditeur) ; absent pour une trame en texte simple.
    #[serde(default)]
    pub contenu: Option<Value>,
    pub origine: String,
    pub utilisations: i64,
}

/// Ce que le praticien saisit pour créer ou modifier une trame.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaisieTrame {
    pub code: String,
    pub titre: String,
    pub categorie: String,
    /// Le texte brut, un paragraphe par ligne : la syntaxe des choix et des blancs y est vérifiée.
    pub modele: String,
    #[serde(default)]
    pub contenu: Option<Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurTrame {
    #[error("le code ne contient que des lettres sans accent, des chiffres ou des tirets, 20 au plus")]
    CodeInvalide,
    #[error("le code « {0} » est déjà pris par une autre trame")]
    CodeDejaPris(String),
    #[error("donnez un titre à la trame")]
    TitreVide,
    #[error("le texte de la trame est vide")]
    ModeleVide,
    #[error("{message} (caractère {position})")]
    Syntaxe { message: &'static str, position: usize },
    #[error("le texte mis en forme de la trame est illisible")]
    ContenuInvalide,
    #[error("cette trame n'existe plus")]
    Introuvable,
    #[error("le générateur aléatoire du système est indisponible")]
    Aleatoire,
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurTrame {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

/// `prénom` donne `prenom` : le nom d'une variable sans accent ni majuscule.
pub fn nom_de_variable(texte: &str) -> String {
    texte
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'â' | 'à' | 'ä' => 'a',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'û' | 'ù' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        })
        .collect()
}

/// Vérifie la syntaxe du modèle. La position est comptée en caractères, à partir de 1.
pub fn verifier_modele(modele: &str) -> Result<(), ErreurTrame> {
    let caracteres: Vec<char> = modele.chars().collect();
    let erreur = |message, i: usize| Err(ErreurTrame::Syntaxe { message, position: i + 1 });
    let mut i = 0;
    while i < caracteres.len() {
        match caracteres[i] {
            '{' if caracteres.get(i + 1) == Some(&'{') => {
                let debut = i;
                let Some(fin) = (i + 2..caracteres.len().saturating_sub(1)).find(|&j| caracteres[j] == '}' && caracteres[j + 1] == '}') else {
                    return erreur("variable non refermée : il manque « }} »", debut);
                };
                let nom: String = caracteres[i + 2..fin].iter().collect();
                if !VARIABLES.contains(&nom_de_variable(&nom).as_str()) {
                    return erreur("variable inconnue : {{prénom}}, {{nom}}, {{âge}} ou {{date}}", debut);
                }
                i = fin + 2;
            }
            '\\' => {
                if !caracteres.get(i + 1).is_some_and(|c| SPECIAUX.contains(c)) {
                    return erreur("barre oblique inverse sans caractère à protéger", i);
                }
                i += 2;
            }
            '{' => {
                let debut = i;
                i += 1;
                if caracteres.get(i) == Some(&'+') {
                    i += 1;
                }
                let mut option_vide = true;
                let mut ferme = false;
                while i < caracteres.len() {
                    match caracteres[i] {
                        '\\' if caracteres.get(i + 1).is_some_and(|c| SPECIAUX.contains(c)) => {
                            option_vide = false;
                            i += 2;
                            continue;
                        }
                        '|' | '}' => {
                            if option_vide {
                                return erreur("option vide dans un groupe de choix", i);
                            }
                            option_vide = true;
                            if caracteres[i] == '}' {
                                ferme = true;
                                i += 1;
                                break;
                            }
                        }
                        '{' | '[' | ']' => return erreur("un groupe de choix ne peut pas contenir d'autre groupe ni de blanc", i),
                        c if !c.is_whitespace() => option_vide = false,
                        _ => {}
                    }
                    i += 1;
                }
                if !ferme {
                    return erreur("groupe de choix non refermé", debut);
                }
            }
            '[' => {
                let debut = i;
                let Some(fin) = caracteres[i + 1..].iter().position(|&c| c == ']').map(|p| p + i + 1) else {
                    return erreur("blanc non refermé", debut);
                };
                if caracteres[i + 1..fin].iter().any(|c| matches!(c, '{' | '}' | '[' | '|')) {
                    return erreur("un blanc ne contient que son indication", debut);
                }
                i = fin + 1;
            }
            '}' | ']' | '|' => return erreur("caractère isolé : protégez-le par une barre oblique inverse", i),
            _ => i += 1,
        }
    }
    Ok(())
}

/// Code en minuscules, sans le caractère d'appel : « @Lomb » devient « lomb ».
pub fn normaliser_code(code: &str) -> Result<String, ErreurTrame> {
    let code = code.trim().trim_start_matches(['@', '/']).to_lowercase();
    let valide = !code.is_empty()
        && code.chars().count() <= 20
        && code.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if valide { Ok(code) } else { Err(ErreurTrame::CodeInvalide) }
}

fn verifier(saisie: &SaisieTrame) -> Result<SaisieTrame, ErreurTrame> {
    let titre = saisie.titre.trim();
    if titre.is_empty() {
        return Err(ErreurTrame::TitreVide);
    }
    if saisie.modele.trim().is_empty() {
        return Err(ErreurTrame::ModeleVide);
    }
    verifier_modele(&saisie.modele)?;
    if let Some(contenu) = &saisie.contenu
        && (contenu.get("type").and_then(Value::as_str) != Some("doc") || contenu.to_string().len() > 200_000)
    {
        return Err(ErreurTrame::ContenuInvalide);
    }
    Ok(SaisieTrame {
        code: normaliser_code(&saisie.code)?,
        titre: titre.to_owned(),
        categorie: saisie.categorie.trim().to_owned(),
        modele: saisie.modele.trim().to_owned(),
        contenu: saisie.contenu.clone(),
    })
}

fn nouvel_identifiant() -> Result<String, ErreurTrame> {
    identifiant::nouveau().map_err(|_| ErreurTrame::Aleatoire)
}

fn depuis_ligne(ligne: &Row<'_>) -> rusqlite::Result<Trame> {
    Ok(Trame {
        id: ligne.get("id")?,
        code: ligne.get("code")?,
        titre: ligne.get("titre")?,
        categorie: ligne.get("categorie")?,
        modele: ligne.get("modele")?,
        contenu: ligne.get::<_, Option<String>>("contenu")?.and_then(|texte| serde_json::from_str(&texte).ok()),
        origine: ligne.get("origine")?,
        utilisations: ligne.get("utilisations")?,
    })
}

/// Trames triées par code.
pub fn lister(base: &Base) -> Result<Vec<Trame>, ErreurTrame> {
    let mut requete = base.connexion().prepare("SELECT * FROM trames ORDER BY code")?;
    let trames = requete.query_map([], depuis_ligne)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(trames)
}

fn lire(base: &Base, id: &str) -> Result<Option<Trame>, ErreurTrame> {
    Ok(base.connexion().query_row("SELECT * FROM trames WHERE id = ?1", [id], depuis_ligne).optional()?)
}

/// Crée une trame (`id` absent) ou modifie une trame existante.
pub fn enregistrer(base: &Base, id: Option<&str>, saisie: &SaisieTrame) -> Result<Trame, ErreurTrame> {
    let propre = verifier(saisie)?;
    let pris: Option<String> = base
        .connexion()
        .query_row("SELECT id FROM trames WHERE code = ?1", [&propre.code], |l| l.get(0))
        .optional()?;
    if pris.is_some_and(|autre| Some(autre.as_str()) != id) {
        return Err(ErreurTrame::CodeDejaPris(propre.code));
    }
    let avant = match id {
        Some(id) => Some(lire(base, id)?.ok_or(ErreurTrame::Introuvable)?),
        None => None,
    };
    let id = match id {
        Some(id) => id.to_owned(),
        None => nouvel_identifiant()?,
    };
    let origine = avant.as_ref().map_or("praticien", |t| t.origine.as_str()).to_owned();
    base.connexion().execute(
        "INSERT INTO trames (id, code, titre, categorie, modele, contenu, origine, modifiee_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (id) DO UPDATE SET code = excluded.code, titre = excluded.titre, categorie = excluded.categorie,
           modele = excluded.modele, contenu = excluded.contenu, modifiee_le = excluded.modifiee_le",
        rusqlite::params![&id, &propre.code, &propre.titre, &propre.categorie, &propre.modele, propre.contenu.as_ref().map(Value::to_string), &origine, maintenant()],
    )?;
    let apres = lire(base, &id)?.ok_or(ErreurTrame::Introuvable)?;
    base.journaliser(
        if avant.is_some() { "trame.modifiee" } else { "trame.creee" },
        &id,
        avant.map(|t| serde_json::to_string(&t).unwrap_or_default()).as_deref(),
        Some(&serde_json::to_string(&apres).unwrap_or_default()),
    )?;
    Ok(apres)
}

pub fn supprimer(base: &Base, id: &str) -> Result<(), ErreurTrame> {
    let avant = lire(base, id)?.ok_or(ErreurTrame::Introuvable)?;
    base.connexion().execute("DELETE FROM trames WHERE id = ?1", [id])?;
    base.journaliser("trame.supprimee", id, Some(&serde_json::to_string(&avant).unwrap_or_default()), None)?;
    Ok(())
}

/// Compte une insertion, pour trier un jour les trames par usage.
pub fn noter_utilisation(base: &Base, id: &str) -> Result<(), ErreurTrame> {
    base.connexion().execute("UPDATE trames SET utilisations = utilisations + 1 WHERE id = ?1", [id])?;
    Ok(())
}

/// Installe les trames de la bibliothèque de départ que le cabinet n'a pas encore eues : une trame
/// ajoutée à la bibliothèque arrive avec la mise à jour, une trame supprimée ne revient pas.
pub fn installer_bibliotheque_de_depart(base: &Base) -> Result<usize, ErreurTrame> {
    let mut proposees: Vec<String> = match base.lire_parametre(PARAMETRE_PROPOSEES)? {
        Some(codes) => codes,
        None if base.lire_parametre::<bool>(PARAMETRE_BIBLIOTHEQUE)?.unwrap_or(false) => PREMIERE_BIBLIOTHEQUE.iter().map(|c| (*c).to_owned()).collect(),
        None => Vec::new(),
    };
    let depart: Vec<SaisieTrame> = serde_json::from_str(BIBLIOTHEQUE_DE_DEPART).map_err(ErreurBase::from)?;
    let mut installees = 0;
    let avant = proposees.len();
    for saisie in &depart {
        let code = normaliser_code(&saisie.code)?;
        if proposees.contains(&code) {
            continue;
        }
        proposees.push(code.clone());
        let deja: bool = base.connexion().query_row("SELECT count(*) > 0 FROM trames WHERE code = ?1", [&code], |l| l.get(0))?;
        if !deja {
            let trame = enregistrer(base, None, saisie)?;
            base.connexion().execute("UPDATE trames SET origine = 'depart' WHERE id = ?1", [&trame.id])?;
            installees += 1;
        }
    }
    if proposees.len() != avant || base.lire_parametre::<Vec<String>>(PARAMETRE_PROPOSEES)?.is_none() {
        base.ecrire_parametre(PARAMETRE_PROPOSEES, &proposees)?;
        base.ecrire_parametre(PARAMETRE_BIBLIOTHEQUE, &true)?;
    }
    Ok(installees)
}

/// Un fichier d'échange de trames, lisible et modifiable dans un éditeur de texte.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FichierTrames {
    pub format: String,
    pub version: u32,
    pub trames: Vec<SaisieTrame>,
}

/// Les trames choisies (toutes si `ids` est absent), en fichier d'échange JSON.
pub fn exporter(base: &Base, ids: Option<&[String]>) -> Result<String, ErreurTrame> {
    let trames = lister(base)?
        .into_iter()
        .filter(|t| ids.is_none_or(|ids| ids.contains(&t.id)))
        .map(|t| SaisieTrame { code: t.code, titre: t.titre, categorie: t.categorie, modele: t.modele, contenu: t.contenu })
        .collect();
    let fichier = FichierTrames { format: FORMAT_ECHANGE.to_owned(), version: 1, trames };
    Ok(serde_json::to_string_pretty(&fichier).map_err(ErreurBase::from)?)
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurEchange {
    #[error("ce fichier n'est pas un fichier de trames Osteosphere")]
    Format,
    #[error("ce fichier ne contient aucune trame")]
    Vide,
    #[error("deux mille trames au plus par fichier")]
    TropDeTrames,
    #[error("la trame « {code} » du fichier est invalide : {erreur}")]
    Trame { code: String, erreur: ErreurTrame },
    #[error(transparent)]
    Trames(#[from] ErreurTrame),
}

impl From<rusqlite::Error> for ErreurEchange {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Trames(erreur.into())
    }
}

impl From<ErreurBase> for ErreurEchange {
    fn from(erreur: ErreurBase) -> Self {
        Self::Trames(erreur.into())
    }
}

/// Ce que devient une trame du fichier, comparée aux trames du cabinet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EtatTrameImportee {
    /// Son code est libre.
    Nouvelle,
    /// Le cabinet a déjà la même trame, sous le même code.
    Identique,
    /// Le code est pris par une trame différente.
    Differente,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TrameImportee {
    pub code: String,
    pub titre: String,
    pub categorie: String,
    pub modele: String,
    pub etat: EtatTrameImportee,
}

/// Que faire d'une trame du fichier dont le code est pris par une trame différente.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Conflit {
    /// Garder la trame du cabinet, ignorer celle du fichier.
    #[default]
    Garder,
    /// Remplacer la trame du cabinet par celle du fichier.
    Remplacer,
    /// Ajouter celle du fichier sous un code libre : `lomb-2`.
    Renommer,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct BilanEchange {
    pub ajoutees: usize,
    pub remplacees: usize,
    pub renommees: usize,
    /// Déjà là à l'identique, ou gardées en cas de conflit.
    pub ignorees: usize,
}

/// Lit un fichier d'échange (ou une simple liste de trames) et vérifie chaque trame.
fn lire_fichier(contenu: &str) -> Result<Vec<SaisieTrame>, ErreurEchange> {
    let valeur: Value = serde_json::from_str(contenu).map_err(|_| ErreurEchange::Format)?;
    let trames: Vec<SaisieTrame> = match &valeur {
        Value::Array(_) => serde_json::from_value(valeur).map_err(|_| ErreurEchange::Format)?,
        Value::Object(objet) if objet.get("format").and_then(Value::as_str) == Some(FORMAT_ECHANGE) => {
            serde_json::from_value::<FichierTrames>(valeur).map_err(|_| ErreurEchange::Format)?.trames
        }
        _ => return Err(ErreurEchange::Format),
    };
    if trames.is_empty() {
        return Err(ErreurEchange::Vide);
    }
    if trames.len() > TRAMES_PAR_FICHIER {
        return Err(ErreurEchange::TropDeTrames);
    }
    let mut propres: Vec<SaisieTrame> = Vec::with_capacity(trames.len());
    for trame in &trames {
        let propre = verifier(trame).map_err(|erreur| ErreurEchange::Trame { code: trame.code.clone(), erreur })?;
        // Le même code deux fois dans le fichier : la première l'emporte.
        if !propres.iter().any(|p| p.code == propre.code) {
            propres.push(propre);
        }
    }
    Ok(propres)
}

fn comparer(base: &Base, trame: &SaisieTrame) -> Result<(EtatTrameImportee, Option<Trame>), ErreurEchange> {
    let existante: Option<Trame> = base.connexion().query_row("SELECT * FROM trames WHERE code = ?1", [&trame.code], depuis_ligne).optional()?;
    let etat = match &existante {
        None => EtatTrameImportee::Nouvelle,
        Some(t) if t.titre == trame.titre && t.categorie == trame.categorie && t.modele == trame.modele && t.contenu == trame.contenu => EtatTrameImportee::Identique,
        Some(_) => EtatTrameImportee::Differente,
    };
    Ok((etat, existante))
}

/// Les trames du fichier et ce qu'elles deviendraient, sans rien changer.
pub fn analyser_import(base: &Base, contenu: &str) -> Result<Vec<TrameImportee>, ErreurEchange> {
    lire_fichier(contenu)?
        .into_iter()
        .map(|t| {
            let (etat, _) = comparer(base, &t)?;
            Ok(TrameImportee { code: t.code, titre: t.titre, categorie: t.categorie, modele: t.modele, etat })
        })
        .collect()
}

/// Importe les trames du fichier, toutes ou aucune.
pub fn importer(base: &Base, contenu: &str, conflit: Conflit) -> Result<BilanEchange, ErreurEchange> {
    let trames = lire_fichier(contenu)?;
    base.atomique(|| {
        let mut bilan = BilanEchange::default();
        for trame in &trames {
            let (etat, existante) = comparer(base, trame)?;
            let id = match (etat, conflit) {
                (EtatTrameImportee::Nouvelle, _) => {
                    bilan.ajoutees += 1;
                    enregistrer(base, None, trame)?.id
                }
                (EtatTrameImportee::Identique, _) | (EtatTrameImportee::Differente, Conflit::Garder) => {
                    bilan.ignorees += 1;
                    continue;
                }
                (EtatTrameImportee::Differente, Conflit::Remplacer) => {
                    bilan.remplacees += 1;
                    let existante = existante.ok_or(ErreurTrame::Introuvable)?;
                    enregistrer(base, Some(&existante.id), trame)?;
                    continue;
                }
                (EtatTrameImportee::Differente, Conflit::Renommer) => {
                    bilan.renommees += 1;
                    let code = code_libre(base, &trame.code)?;
                    enregistrer(base, None, &SaisieTrame { code, ..trame.clone() })?.id
                }
            };
            base.connexion().execute("UPDATE trames SET origine = 'importee' WHERE id = ?1", [&id])?;
        }
        Ok::<_, ErreurEchange>(bilan)
    })
}

/// `lomb-2`, `lomb-3`… : le premier code libre, raccourci pour tenir en vingt caractères.
fn code_libre(base: &Base, code: &str) -> Result<String, ErreurTrame> {
    for rang in 2.. {
        let suffixe = format!("-{rang}");
        let debut: String = code.chars().take(20 - suffixe.len()).collect();
        let candidat = format!("{}{suffixe}", debut.trim_end_matches('-'));
        let pris: bool = base.connexion().query_row("SELECT count(*) > 0 FROM trames WHERE code = ?1", [&candidat], |l| l.get(0))?;
        if !pris {
            return Ok(candidat);
        }
    }
    unreachable!("un code finit toujours par être libre")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;

    fn base() -> (tempfile::TempDir, Base) {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("cabinet.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        (dossier, base)
    }

    fn saisie(code: &str, modele: &str) -> SaisieTrame {
        SaisieTrame { code: code.into(), titre: "Essai".into(), categorie: "Examen".into(), modele: modele.into(), contenu: None }
    }

    #[test]
    fn verifie_la_syntaxe_comme_l_interface() {
        assert!(verifier_modele("Douleur {droite | gauche}, {+ a | b}, depuis [durée].").is_ok());
        assert!(verifier_modele("Accolade \\{ et option {a \\| b | c}").is_ok());
        assert!(matches!(verifier_modele("Douleur {droite | gauche"), Err(ErreurTrame::Syntaxe { position: 9, .. })));
        assert!(verifier_modele("Douleur {droite || gauche}").is_err());
        assert!(verifier_modele("depuis [durée").is_err());
        assert!(matches!(verifier_modele("a } b"), Err(ErreurTrame::Syntaxe { position: 3, .. })));
        assert!(verifier_modele("{a | [b]}").is_err());
        assert!(verifier_modele("fin \\").is_err());
        // Variables : connues, avec ou sans accent.
        assert!(verifier_modele("{{prénom}}, {{Age}}, vu le {{date}} ({{nom}}).").is_ok());
        assert!(matches!(verifier_modele("Bonjour {{surnom}}"), Err(ErreurTrame::Syntaxe { position: 9, .. })));
        assert!(verifier_modele("Bonjour {{prénom}").is_err());
    }

    #[test]
    fn garde_le_texte_mis_en_forme() {
        let (_dossier, base) = base();
        let contenu = serde_json::json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [
            { "type": "text", "text": "Douleur ", "marks": [{ "type": "bold" }] },
            { "type": "text", "text": "{droite | gauche}" }
        ]}]});
        let trame = enregistrer(&base, None, &SaisieTrame { contenu: Some(contenu.clone()), ..saisie("dlr", "Douleur {droite | gauche}") }).unwrap();
        assert_eq!(lister(&base).unwrap()[0].contenu.as_ref(), Some(&contenu));
        assert_eq!(trame.contenu, Some(contenu));
        let illisible = SaisieTrame { contenu: Some(serde_json::json!({ "type": "paragraph" })), ..saisie("x", "texte") };
        assert!(matches!(enregistrer(&base, None, &illisible), Err(ErreurTrame::ContenuInvalide)));
    }

    #[test]
    fn normalise_le_code() {
        assert_eq!(normaliser_code(" @Lomb ").unwrap(), "lomb");
        assert_eq!(normaliser_code("/dn-4").unwrap(), "dn-4");
        assert!(normaliser_code("épaule").is_err());
        assert!(normaliser_code("deux mots").is_err());
        assert!(normaliser_code("").is_err());
    }

    #[test]
    fn cree_modifie_et_supprime_en_journalisant() {
        let (_dossier, base) = base();
        let trame = enregistrer(&base, None, &saisie("Essai", "Texte {a | b}")).unwrap();
        assert_eq!(trame.code, "essai");
        assert_eq!(trame.origine, "praticien");

        let modifiee = enregistrer(&base, Some(&trame.id), &saisie("essai2", "Texte {a | b | c}")).unwrap();
        assert_eq!(modifiee.id, trame.id);
        assert_eq!(lister(&base).unwrap(), vec![modifiee]);

        supprimer(&base, &trame.id).unwrap();
        assert!(lister(&base).unwrap().is_empty());
        let actions: Vec<String> = base
            .connexion()
            .prepare("SELECT action FROM journal ORDER BY id")
            .unwrap()
            .query_map([], |l| l.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actions, ["trame.creee", "trame.modifiee", "trame.supprimee"]);
    }

    #[test]
    fn refuse_un_code_deja_pris_et_une_syntaxe_fausse() {
        let (_dossier, base) = base();
        enregistrer(&base, None, &saisie("lomb", "a")).unwrap();
        assert!(matches!(enregistrer(&base, None, &saisie("LOMB", "b")), Err(ErreurTrame::CodeDejaPris(_))));
        assert!(matches!(enregistrer(&base, None, &saisie("autre", "{a")), Err(ErreurTrame::Syntaxe { .. })));
        assert!(matches!(enregistrer(&base, None, &saisie("vide", "  ")), Err(ErreurTrame::ModeleVide)));
    }

    #[test]
    fn la_bibliotheque_compte_une_vingtaine_de_trames_valides() {
        let depart: Vec<SaisieTrame> = serde_json::from_str(BIBLIOTHEQUE_DE_DEPART).unwrap();
        assert!(depart.len() >= 20, "{} trames", depart.len());
        for trame in &depart {
            verifier(trame).unwrap_or_else(|e| panic!("{} : {e}", trame.code));
        }
        let codes: std::collections::HashSet<&str> = depart.iter().map(|t| t.code.as_str()).collect();
        assert_eq!(codes.len(), depart.len());
        assert!(PREMIERE_BIBLIOTHEQUE.iter().all(|c| codes.contains(c)));
    }

    #[test]
    fn le_catalogue_du_depot_reprend_la_bibliotheque() {
        let catalogue = include_str!("../../../catalogue/trames/bibliotheque-de-depart.json");
        let fichier: FichierTrames = serde_json::from_str(catalogue).unwrap();
        let depart: Vec<SaisieTrame> = serde_json::from_str(BIBLIOTHEQUE_DE_DEPART).unwrap();
        assert_eq!((fichier.format.as_str(), fichier.version), (FORMAT_ECHANGE, 1));
        assert_eq!(fichier.trames, depart, "catalogue/trames/bibliotheque-de-depart.json à refaire d'après la bibliothèque");
        assert_eq!(lire_fichier(catalogue).unwrap().len(), depart.len());
    }

    #[test]
    fn un_cabinet_existant_recoit_les_nouvelles_trames_sauf_celles_supprimees() {
        let (_dossier, base) = base();
        // Un cabinet de la version précédente : la première bibliothèque, dont « eg » supprimée depuis.
        for code in PREMIERE_BIBLIOTHEQUE.iter().filter(|c| **c != "eg") {
            enregistrer(&base, None, &saisie(code, "texte")).unwrap();
        }
        base.ecrire_parametre(PARAMETRE_BIBLIOTHEQUE, &true).unwrap();
        let depart: Vec<SaisieTrame> = serde_json::from_str(BIBLIOTHEQUE_DE_DEPART).unwrap();
        assert_eq!(installer_bibliotheque_de_depart(&base).unwrap(), depart.len() - 6);
        let codes: Vec<String> = lister(&base).unwrap().into_iter().map(|t| t.code).collect();
        assert!(codes.contains(&"dors".to_owned()) && !codes.contains(&"eg".to_owned()));
        assert_eq!(installer_bibliotheque_de_depart(&base).unwrap(), 0);
    }

    #[test]
    fn exporte_et_importe_les_trames() {
        let (_dossier, base) = base();
        let lomb = enregistrer(&base, None, &saisie("lomb", "Douleur {droite | gauche}")).unwrap();
        enregistrer(&base, None, &saisie("cerv", "Cervicalgie")).unwrap();
        let fichier = exporter(&base, Some(std::slice::from_ref(&lomb.id))).unwrap();
        assert!(fichier.contains("\"format\": \"osteosphere.trames\""));
        assert!(!fichier.contains("cerv"));

        // Chez un confrère : une trame identique, une autre sous le même code, une nouvelle.
        let (_autre_dossier, autre) = base_seule();
        enregistrer(&autre, None, &saisie("lomb", "Douleur {droite | gauche}")).unwrap();
        let tout = exporter(&base, None).unwrap();
        enregistrer(&autre, None, &saisie("cerv", "Cou")).unwrap();
        let apercu = analyser_import(&autre, &tout).unwrap();
        assert_eq!(apercu.iter().map(|t| (t.code.as_str(), t.etat)).collect::<Vec<_>>(), [
            ("cerv", EtatTrameImportee::Differente),
            ("lomb", EtatTrameImportee::Identique)
        ]);
        let bilan = importer(&autre, &tout, Conflit::Renommer).unwrap();
        assert_eq!(bilan, BilanEchange { ajoutees: 0, remplacees: 0, renommees: 1, ignorees: 1 });
        let cerv2 = lister(&autre).unwrap().into_iter().find(|t| t.code == "cerv-2").unwrap();
        assert_eq!((cerv2.modele.as_str(), cerv2.origine.as_str()), ("Cervicalgie", "importee"));
        assert_eq!(importer(&autre, &tout, Conflit::Remplacer).unwrap().remplacees, 1);
        assert_eq!(lister(&autre).unwrap().into_iter().find(|t| t.code == "cerv").unwrap().modele, "Cervicalgie");

        // Une simple liste se lit aussi ; un fichier faux ne change rien.
        let liste = r#"[{"code": "Nouv", "titre": "Nouvelle", "categorie": "", "modele": "Texte {a | b}"}]"#;
        assert_eq!(importer(&autre, liste, Conflit::Garder).unwrap().ajoutees, 1);
        let faux = r#"[{"code": "ok", "titre": "Bonne", "categorie": "", "modele": "a"}, {"code": "x", "titre": "Fausse", "categorie": "", "modele": "{a"}]"#;
        assert!(matches!(importer(&autre, faux, Conflit::Garder), Err(ErreurEchange::Trame { .. })));
        assert!(lister(&autre).unwrap().iter().all(|t| t.code != "ok"));
        assert!(matches!(analyser_import(&autre, "{\"a\": 1}"), Err(ErreurEchange::Format)));
        assert!(matches!(analyser_import(&autre, "[]"), Err(ErreurEchange::Vide)));
    }

    fn base_seule() -> (tempfile::TempDir, Base) {
        base()
    }

    #[test]
    fn trouve_un_code_libre() {
        let (_dossier, base) = base();
        enregistrer(&base, None, &saisie("lomb", "a")).unwrap();
        enregistrer(&base, None, &saisie("lomb-2", "a")).unwrap();
        assert_eq!(code_libre(&base, "lomb").unwrap(), "lomb-3");
        assert_eq!(code_libre(&base, "abcdefghijklmnopqrst").unwrap(), "abcdefghijklmnopqr-2");
    }

    #[test]
    fn installe_la_bibliotheque_une_seule_fois() {
        let (_dossier, base) = base();
        let installees = installer_bibliotheque_de_depart(&base).unwrap();
        assert!(installees >= 20);
        let lomb = lister(&base).unwrap().into_iter().find(|t| t.code == "lomb").unwrap();
        assert_eq!(lomb.origine, "depart");

        supprimer(&base, &lomb.id).unwrap();
        assert_eq!(installer_bibliotheque_de_depart(&base).unwrap(), 0);
        assert!(lister(&base).unwrap().iter().all(|t| t.code != "lomb"));
    }

    #[test]
    fn compte_les_utilisations() {
        let (_dossier, base) = base();
        let trame = enregistrer(&base, None, &saisie("essai", "a")).unwrap();
        noter_utilisation(&base, &trame.id).unwrap();
        noter_utilisation(&base, &trame.id).unwrap();
        assert_eq!(lister(&base).unwrap()[0].utilisations, 2);
    }
}
