//! Écrit un compte rendu fictif : `cargo run -p osteosphere-documents --example compte_rendu_fictif -- compte-rendu.pdf [logo.png]`.

use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_core::mise_en_page::Image;
use osteosphere_core::modeles::{Champ, Definition, TypeChamp};
use osteosphere_core::patients::FichePatient;
use osteosphere_core::seances::{Facturation, SaisieSeance, Seance, TypeSeance};
use osteosphere_documents::{DemandeCompteRendu, Habillage, compte_rendu_pdf};
use serde_json::{Map, json};

fn champ(id: &str, type_champ: TypeChamp, libelle: &str) -> Champ {
    Champ {
        id: id.into(),
        type_champ,
        libelle: libelle.into(),
        visible: true,
        obligatoire: false,
        imprimer: true,
        role: String::new(),
        options: Vec::new(),
        min: Some(0.0),
        max: Some(10.0),
        pas: None,
        unite: String::new(),
    }
}

fn paragraphe(texte: &str) -> serde_json::Value {
    json!({ "type": "paragraph", "content": [{ "type": "text", "text": texte }] })
}

fn main() {
    let chemin = std::env::args().nth(1).unwrap_or_else(|| "compte-rendu-fictif.pdf".into());
    let logo = std::env::args().nth(2).map(|c| Image { type_mime: "image/png".into(), octets: std::fs::read(c).expect("logo") });
    let habillage = Habillage { logo, ..Default::default() };
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
        ..Default::default()
    };
    let patient = FichePatient { sexe: "F".into(), nom: "Martin".into(), prenom: "Camille".into(), naissance: Some("1988-03-14".into()), ..Default::default() };
    let mut valeurs = Map::new();
    valeurs.insert(
        "motif".into(),
        json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [
                { "type": "text", "text": "Douleur lombaire " },
                { "type": "choix", "attrs": { "options": ["droite", "gauche", "bilatérale"], "multiple": false, "retenus": [0] } },
                { "type": "text", "text": ", aiguë, depuis " },
                { "type": "blanc", "attrs": { "indication": "durée", "valeur": "3 jours" } },
                { "type": "text", "text": ", après un déménagement." }
            ]}
        ]}),
    );
    valeurs.insert("douleur".into(), json!(6));
    valeurs.insert("mesures".into(), json!({ "taille": 168, "poids": 61.5 }));
    valeurs.insert(
        "examen".into(),
        json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [{ "type": "text", "text": "Tests", "marks": [{ "type": "bold" }] }] },
            { "type": "bulletList", "content": [
                { "type": "listItem", "content": [paragraphe("Lasègue négatif des deux côtés")] },
                { "type": "listItem", "content": [paragraphe("Flexion antérieure limitée, distance doigts-sol 25 cm")] }
            ]},
            paragraphe("Dysfonction sacro-iliaque droite, tension du carré des lombes droit.")
        ]}),
    );
    valeurs.insert(
        "traitement".into(),
        json!({ "type": "doc", "content": [paragraphe("Techniques fonctionnelles lombo-pelviennes, travail viscéral de la région rénale droite.")] }),
    );
    valeurs.insert(
        "conseils".into(),
        json!({ "type": "doc", "content": [
            { "type": "orderedList", "content": [
                { "type": "listItem", "content": [paragraphe("Marche douce 20 minutes par jour")] },
                { "type": "listItem", "content": [paragraphe("Éviter le port de charges lourdes pendant une semaine")] }
            ]},
            { "type": "paragraph", "content": [{ "type": "text", "text": "Revoir dans 3 semaines.", "marks": [{ "type": "italic" }] }] }
        ]}),
    );
    let definition = Definition {
        champs: vec![
            champ("t1", TypeChamp::Intertitre, "Anamnèse"),
            champ("motif", TypeChamp::TexteEnrichi, "Motif de consultation"),
            champ("douleur", TypeChamp::Curseur, "Douleur avant la séance"),
            champ("t2", TypeChamp::Intertitre, "Examen"),
            champ("mesures", TypeChamp::Mesures, "Mesures"),
            champ("examen", TypeChamp::TexteEnrichi, "Examen clinique"),
            champ("t3", TypeChamp::Intertitre, "Traitement"),
            champ("traitement", TypeChamp::TexteEnrichi, "Techniques"),
            champ("conseils", TypeChamp::TexteEnrichi, "Conseils"),
        ],
    };
    let seance = Seance {
        id: "fictive".into(),
        patient_id: "fictif".into(),
        saisie: SaisieSeance {
            debut: "2026-10-06T14:30".into(),
            modele_id: "adulte".into(),
            modele_version: 1,
            type_seance: TypeSeance::Premiere,
            titre: String::new(),
            importante: false,
            valeurs,
            facturation: Facturation::AFacturer,
            commentaire_gratuit: String::new(),
        },
        importee: false,
        supprimee_le: None,
        cree_le: 0,
        modifie_le: 0,
    };
    let demande = DemandeCompteRendu { praticien: &praticien, patient: &patient, seance: &seance, definition: &definition, champs: None, aujourdhui: "2026-10-08", habillage: &habillage };
    std::fs::write(&chemin, compte_rendu_pdf(&demande).expect("compte rendu")).expect("écriture");
    println!("{chemin}");
}
