//! Écrit une facture fictive : `cargo run -p osteosphere-documents --example facture_fictive -- facture.pdf [essai]`.

use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_documents::{Destinataire, Facture, LigneFacture, Reglement, facture_pdf};

fn main() {
    let mut arguments = std::env::args().skip(1);
    let chemin = arguments.next().unwrap_or_else(|| "facture-fictive.pdf".into());
    let essai = arguments.next().as_deref() == Some("essai");
    let facture = Facture {
        numero: "2026-10-1772".into(),
        date_emission: "2026-10-06".into(),
        date_seance: Some("2026-10-06".into()),
        praticien: IdentiteCabinet {
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
        },
        destinataire: Destinataire {
            civilite: "Mme".into(),
            prenom: "Camille".into(),
            nom: "Martin".into(),
            adresse: "12 rue des Tilleuls".into(),
            code_postal: "47500".into(),
            ville: "Fumel".into(),
        },
        lignes: vec![LigneFacture { designation: "Consultation d’ostéopathie".into(), quantite: 1, prix_unitaire_centimes: 5500 }],
        reglements: vec![Reglement { moyen: "carte".into(), date: "2026-10-06".into(), montant_centimes: 5500 }],
        commentaire: String::new(),
        essai,
    };
    let pdf = facture_pdf(&facture).expect("facture");
    std::fs::write(&chemin, pdf).expect("écriture");
    println!("{chemin}");
}
