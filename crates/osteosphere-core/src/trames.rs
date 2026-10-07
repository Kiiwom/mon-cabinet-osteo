//! Trames : textes réutilisables appelés par un code court pendant la saisie.
//!
//! Syntaxe du modèle, la même que celle de l'interface :
//! `{droite | gauche}` choix unique, `{+ a | b}` choix multiple, `[durée]` blanc à compléter,
//! `\{`, `\}`, `\[`, `\]`, `\|` et `\\` pour écrire ces caractères tels quels.

use rusqlite::{OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};
use crate::identifiant;

const BIBLIOTHEQUE_DE_DEPART: &str = include_str!("bibliotheque_depart.json");
const PARAMETRE_BIBLIOTHEQUE: &str = "trames.bibliotheque_installee";
const SPECIAUX: [char; 6] = ['{', '}', '[', ']', '|', '\\'];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trame {
    pub id: String,
    pub code: String,
    pub titre: String,
    pub categorie: String,
    pub modele: String,
    pub origine: String,
    pub utilisations: i64,
}

/// Ce que le praticien saisit pour créer ou modifier une trame.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaisieTrame {
    pub code: String,
    pub titre: String,
    pub categorie: String,
    pub modele: String,
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

/// Vérifie la syntaxe du modèle. La position est comptée en caractères, à partir de 1.
pub fn verifier_modele(modele: &str) -> Result<(), ErreurTrame> {
    let caracteres: Vec<char> = modele.chars().collect();
    let erreur = |message, i: usize| Err(ErreurTrame::Syntaxe { message, position: i + 1 });
    let mut i = 0;
    while i < caracteres.len() {
        match caracteres[i] {
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
    Ok(SaisieTrame {
        code: normaliser_code(&saisie.code)?,
        titre: titre.to_owned(),
        categorie: saisie.categorie.trim().to_owned(),
        modele: saisie.modele.trim().to_owned(),
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
        "INSERT INTO trames (id, code, titre, categorie, modele, origine, modifiee_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (id) DO UPDATE SET code = excluded.code, titre = excluded.titre,
           categorie = excluded.categorie, modele = excluded.modele, modifiee_le = excluded.modifiee_le",
        (&id, &propre.code, &propre.titre, &propre.categorie, &propre.modele, &origine, maintenant()),
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

/// Installe la bibliothèque de départ une seule fois : une trame supprimée ne revient pas.
pub fn installer_bibliotheque_de_depart(base: &Base) -> Result<usize, ErreurTrame> {
    if base.lire_parametre::<bool>(PARAMETRE_BIBLIOTHEQUE)?.unwrap_or(false) {
        return Ok(0);
    }
    let depart: Vec<SaisieTrame> = serde_json::from_str(BIBLIOTHEQUE_DE_DEPART).map_err(ErreurBase::from)?;
    let mut installees = 0;
    for saisie in &depart {
        let code = normaliser_code(&saisie.code)?;
        let deja: bool = base.connexion().query_row("SELECT count(*) > 0 FROM trames WHERE code = ?1", [&code], |l| l.get(0))?;
        if !deja {
            let trame = enregistrer(base, None, saisie)?;
            base.connexion().execute("UPDATE trames SET origine = 'depart' WHERE id = ?1", [&trame.id])?;
            installees += 1;
        }
    }
    base.ecrire_parametre(PARAMETRE_BIBLIOTHEQUE, &true)?;
    Ok(installees)
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
        SaisieTrame { code: code.into(), titre: "Essai".into(), categorie: "Examen".into(), modele: modele.into() }
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
    fn installe_la_bibliotheque_une_seule_fois() {
        let (_dossier, base) = base();
        let installees = installer_bibliotheque_de_depart(&base).unwrap();
        assert!(installees >= 6);
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
