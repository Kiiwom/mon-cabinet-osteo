//! Écrit une facture fictive :
//! `cargo run -p osteosphere-documents --example facture_fictive -- facture.pdf [essai|-] [logo.png] [signature.png]`.

use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_core::mise_en_page::{Image, MiseEnPage, PositionLogo};
use osteosphere_documents::{Filigrane, Habillage, exemple, facture_pdf};

fn main() {
    let mut arguments = std::env::args().skip(1);
    let chemin = arguments.next().unwrap_or_else(|| "facture-fictive.pdf".into());
    let essai = arguments.next().as_deref() == Some("essai");
    let image = |chemin: Option<String>| {
        chemin.map(|c| {
            let octets = std::fs::read(&c).expect("image");
            Image { type_mime: if c.ends_with(".png") { "image/png".into() } else { "image/jpeg".into() }, octets }
        })
    };
    let (logo, signature) = (image(arguments.next()), image(arguments.next()));
    let habillage = Habillage {
        mise_en_page: MiseEnPage { couleur: if logo.is_some() { "#1f4e79".into() } else { MiseEnPage::default().couleur }, position_logo: PositionLogo::Gauche, ..Default::default() },
        logo,
        signature,
    };
    let praticien = IdentiteCabinet {
        prenom: "Alexandre".into(),
        nom: "Roux".into(),
        profession: "Ostéopathe D.O.".into(),
        adresse: "12 place de la Halle".into(),
        code_postal: "47150".into(),
        ville: "Lacapelle-Biron".into(),
        telephone: "06 00 00 00 00".into(),
        email: "cabinet@exemple.fr".into(),
        siret: "12345678900012".into(),
        rpps: "10000000000".into(),
        mentions: "Membre d'une association agréée, le règlement des honoraires par chèque est accepté.".into(),
        ..Default::default()
    };
    let mut facture = exemple("2026-10-06");
    facture.saisie.commentaire_imprime.clear();
    let pdf = facture_pdf(&facture, &praticien, essai.then_some(Filigrane::Essai), &habillage).expect("facture");
    std::fs::write(&chemin, pdf).expect("écriture");
    println!("{chemin}");
}
