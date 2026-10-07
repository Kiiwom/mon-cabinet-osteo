//! Écrit une facture fictive : `cargo run -p osteosphere-documents --example facture_fictive -- facture.pdf [essai]`.

use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_documents::{Filigrane, exemple, facture_pdf};

fn main() {
    let mut arguments = std::env::args().skip(1);
    let chemin = arguments.next().unwrap_or_else(|| "facture-fictive.pdf".into());
    let essai = arguments.next().as_deref() == Some("essai");
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
    };
    let mut facture = exemple("2026-10-06");
    facture.saisie.commentaire_imprime.clear();
    let pdf = facture_pdf(&facture, &praticien, essai.then_some(Filigrane::Essai)).expect("facture");
    std::fs::write(&chemin, pdf).expect("écriture");
    println!("{chemin}");
}
