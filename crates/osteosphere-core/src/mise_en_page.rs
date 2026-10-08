//! Présentation des factures et des comptes rendus : logo, signature, couleur. Les mentions
//! légales, elles, font partie de l'identité du cabinet et restent attachées à chaque facture émise.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::base::{Base, ErreurBase, maintenant};

pub const PARAMETRE_MISE_EN_PAGE: &str = "documents.mise_en_page";
/// Au-delà, l'image alourdirait chaque PDF sans gain visible.
pub const TAILLE_MAX_IMAGE: usize = 2 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ErreurMiseEnPage {
    #[error("{0}")]
    Invalide(&'static str),
    #[error(transparent)]
    Base(#[from] ErreurBase),
}

impl From<rusqlite::Error> for ErreurMiseEnPage {
    fn from(erreur: rusqlite::Error) -> Self {
        Self::Base(erreur.into())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositionLogo {
    #[default]
    Gauche,
    Droite,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MiseEnPage {
    /// Couleur du titre et des filets, `#rrggbb`.
    pub couleur: String,
    pub position_logo: PositionLogo,
    /// Imprimer le logo, s'il y en a un.
    pub logo: bool,
    /// Imprimer l'image de la signature, s'il y en a une ; sinon, le nom.
    pub signature: bool,
}

impl Default for MiseEnPage {
    fn default() -> Self {
        Self { couleur: "#6e5212".into(), position_logo: PositionLogo::Gauche, logo: true, signature: true }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuelleImage {
    Logo,
    Signature,
}

impl QuelleImage {
    fn cle(self) -> &'static str {
        match self {
            Self::Logo => "logo",
            Self::Signature => "signature",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Image {
    pub type_mime: String,
    pub octets: Vec<u8>,
}

impl Image {
    /// Le nom de fichier qu'attend le moteur de mise en page.
    pub fn nom_fichier(&self, base: &str) -> String {
        format!("{base}.{}", if self.type_mime == "image/png" { "png" } else { "jpg" })
    }
}

pub fn lire(base: &Base) -> Result<MiseEnPage, ErreurMiseEnPage> {
    Ok(base.lire_parametre(PARAMETRE_MISE_EN_PAGE)?.unwrap_or_default())
}

pub fn enregistrer(base: &Base, mise_en_page: &MiseEnPage) -> Result<MiseEnPage, ErreurMiseEnPage> {
    let couleur = mise_en_page.couleur.trim().to_lowercase();
    let valide = couleur.len() == 7 && couleur.starts_with('#') && couleur[1..].bytes().all(|o| o.is_ascii_hexdigit());
    if !valide {
        return Err(ErreurMiseEnPage::Invalide("couleur inconnue : choisissez-en une dans la liste"));
    }
    let propre = MiseEnPage { couleur, ..mise_en_page.clone() };
    let avant = lire(base)?;
    base.ecrire_parametre(PARAMETRE_MISE_EN_PAGE, &propre)?;
    let json = |m: &MiseEnPage| serde_json::to_string(m).ok();
    base.journaliser("documents.mise_en_page", PARAMETRE_MISE_EN_PAGE, json(&avant).as_deref(), json(&propre).as_deref())?;
    Ok(propre)
}

/// PNG ou JPEG, reconnus à leurs premiers octets : l'extension ne suffit pas.
fn type_image(octets: &[u8]) -> Option<&'static str> {
    if octets.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if octets.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else {
        None
    }
}

pub fn lire_image(base: &Base, quelle: QuelleImage) -> Result<Option<Image>, ErreurMiseEnPage> {
    Ok(base
        .connexion()
        .query_row("SELECT type_mime, contenu FROM images WHERE cle = ?1", [quelle.cle()], |l| Ok(Image { type_mime: l.get(0)?, octets: l.get(1)? }))
        .optional()?)
}

pub fn enregistrer_image(base: &Base, quelle: QuelleImage, octets: &[u8]) -> Result<(), ErreurMiseEnPage> {
    let Some(type_mime) = type_image(octets) else {
        return Err(ErreurMiseEnPage::Invalide("choisissez une image PNG ou JPEG"));
    };
    if octets.len() > TAILLE_MAX_IMAGE {
        return Err(ErreurMiseEnPage::Invalide("l'image dépasse 2 Mo : réduisez-la avant de l'ajouter"));
    }
    base.connexion().execute(
        "INSERT INTO images (cle, type_mime, contenu, modifiee_le) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (cle) DO UPDATE SET type_mime = excluded.type_mime, contenu = excluded.contenu, modifiee_le = excluded.modifiee_le",
        rusqlite::params![quelle.cle(), type_mime, octets, maintenant()],
    )?;
    base.journaliser("documents.image", quelle.cle(), None, Some(type_mime))?;
    Ok(())
}

pub fn supprimer_image(base: &Base, quelle: QuelleImage) -> Result<(), ErreurMiseEnPage> {
    base.connexion().execute("DELETE FROM images WHERE cle = ?1", [quelle.cle()])?;
    base.journaliser("documents.image", quelle.cle(), Some("image"), None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chiffrement::CleDonnees;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    #[test]
    fn garde_la_presentation_et_les_images() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        assert_eq!(lire(&base).unwrap(), MiseEnPage::default());
        let choisie = enregistrer(&base, &MiseEnPage { couleur: " #2A78D6 ".into(), position_logo: PositionLogo::Droite, ..Default::default() }).unwrap();
        assert_eq!((choisie.couleur.as_str(), choisie.position_logo), ("#2a78d6", PositionLogo::Droite));
        assert!(enregistrer(&base, &MiseEnPage { couleur: "bleu".into(), ..Default::default() }).is_err());

        assert_eq!(lire_image(&base, QuelleImage::Logo).unwrap(), None);
        enregistrer_image(&base, QuelleImage::Logo, PNG).unwrap();
        let logo = lire_image(&base, QuelleImage::Logo).unwrap().unwrap();
        assert_eq!((logo.type_mime.as_str(), logo.nom_fichier("logo").as_str()), ("image/png", "logo.png"));
        assert!(enregistrer_image(&base, QuelleImage::Signature, b"GIF89a").is_err());
        assert!(enregistrer_image(&base, QuelleImage::Signature, &[0xFF, 0xD8, 0xFF, 0xE0]).is_ok());
        supprimer_image(&base, QuelleImage::Logo).unwrap();
        assert_eq!(lire_image(&base, QuelleImage::Logo).unwrap(), None);
    }
}
