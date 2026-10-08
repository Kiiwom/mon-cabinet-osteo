//! Habillage des documents : logo, signature et couleur choisis dans Paramètres › Cabinet.

use osteosphere_core::mise_en_page::{Image, MiseEnPage, PositionLogo};
use serde_json::{Value, json};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Habillage {
    pub mise_en_page: MiseEnPage,
    pub logo: Option<Image>,
    pub signature: Option<Image>,
}

impl Habillage {
    fn logo(&self) -> Option<&Image> {
        self.logo.as_ref().filter(|_| self.mise_en_page.logo)
    }

    fn signature(&self) -> Option<&Image> {
        self.signature.as_ref().filter(|_| self.mise_en_page.signature)
    }

    /// Les images à fournir au moteur, sous les noms qu'utilise [`Habillage::vue`].
    pub(crate) fn fichiers(&self) -> Vec<(String, Vec<u8>)> {
        let mut fichiers = Vec::new();
        if let Some(logo) = self.logo() {
            fichiers.push((logo.nom_fichier("logo"), logo.octets.clone()));
        }
        if let Some(signature) = self.signature() {
            fichiers.push((signature.nom_fichier("signature"), signature.octets.clone()));
        }
        fichiers
    }

    /// Ce que le modèle lit : couleur, nom des images (vide sans image), place du logo.
    pub(crate) fn vue(&self) -> Value {
        json!({
            "couleur": self.mise_en_page.couleur,
            "logo": self.logo().map(|i| i.nom_fichier("logo")).unwrap_or_default(),
            "logo_a_droite": self.mise_en_page.position_logo == PositionLogo::Droite,
            "signature": self.signature().map(|i| i.nom_fichier("signature")).unwrap_or_default(),
        })
    }
}
