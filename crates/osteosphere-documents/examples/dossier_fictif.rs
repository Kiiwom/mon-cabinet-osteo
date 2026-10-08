//! Écrit le dossier PDF d'une patiente fictive : `cargo run -p osteosphere-documents --example dossier_fictif -- dossier.pdf`.

use osteosphere_core::antecedents::{Antecedent, CategorieAntecedents, SaisieAntecedent};
use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_core::facturation::{EtatFacture, Moyen, Nature, ResumeFacture};
use osteosphere_core::familles::Proche;
use osteosphere_core::modeles::{Champ, Definition, TypeChamp};
use osteosphere_core::patients::{FichePatient, Patient};
use osteosphere_core::seances::{Facturation, SaisieSeance, Seance, TypeSeance};
use osteosphere_documents::{DemandeDossier, Habillage, RubriquesDossier, SeanceDuDossier, dossier_pdf};
use serde_json::{Map, Value, json};

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

fn texte(t: &str) -> Value {
    json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": t }] }] })
}

fn seance(id: &str, debut: &str, type_seance: TypeSeance, motif: &str, traitement: &str, douleur: i64) -> Seance {
    let mut valeurs = Map::new();
    valeurs.insert("motif".into(), texte(motif));
    valeurs.insert("douleur".into(), json!(douleur));
    valeurs.insert("traitement".into(), texte(traitement));
    Seance {
        id: id.into(),
        patient_id: "fictive".into(),
        saisie: SaisieSeance {
            debut: debut.into(),
            modele_id: "adulte".into(),
            modele_version: 1,
            type_seance,
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
    }
}

fn antecedent(categorie: &str, rubrique: &str, precision: &str, debut: Option<&str>, en_cours: bool, important: bool) -> Antecedent {
    Antecedent {
        id: rubrique.into(),
        patient_id: "fictive".into(),
        saisie: SaisieAntecedent {
            categorie: categorie.into(),
            rubrique: rubrique.into(),
            precision: precision.into(),
            debut: debut.map(str::to_owned),
            en_cours,
            important,
            ..Default::default()
        },
    }
}

fn main() {
    let chemin = std::env::args().nth(1).unwrap_or_else(|| "dossier-fictif.pdf".into());
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
    let patient = Patient {
        id: "fictive".into(),
        fiche: FichePatient {
            sexe: "F".into(),
            nom: "Martin".into(),
            prenom: "Camille".into(),
            naissance: Some("1988-03-14".into()),
            adresse: "12 rue des Tilleuls".into(),
            code_postal: "47500".into(),
            ville: "Fumel".into(),
            portable: "06 00 00 00 01".into(),
            email: "camille.martin@exemple.fr".into(),
            profession: "Infirmière".into(),
            lateralite: "droitier".into(),
            activites: "Course à pied".into(),
            statut: "Suivi".into(),
            notes_importantes: "Allergie aux AINS".into(),
            remarques: texte("Travaille de nuit un week-end sur deux.").to_string(),
            consentement_le: Some("2026-02-18".into()),
            ..Default::default()
        },
        archive: false,
        factures_a: None,
        cree_le: 0,
        modifie_le: 0,
    };
    let formulaire = [
        CategorieAntecedents { cle: "medicaux".into(), libelle: "Médicaux".into(), rubriques: Vec::new() },
        CategorieAntecedents { cle: "chirurgicaux".into(), libelle: "Chirurgicaux".into(), rubriques: Vec::new() },
        CategorieAntecedents { cle: "traumatiques".into(), libelle: "Traumatiques".into(), rubriques: Vec::new() },
    ];
    let antecedents = [
        antecedent("medicaux", "Allergies", "AINS", None, false, true),
        antecedent("medicaux", "Traitement longue durée", "lévothyroxine", Some("2015"), true, false),
        antecedent("chirurgicaux", "Gynéco / Uro", "césarienne", Some("2017-05"), false, false),
        antecedent("traumatiques", "Fracture", "poignet G", Some("2009"), false, false),
    ];
    let proches = [Proche {
        id: "lucas".into(),
        lien: "enfant".into(),
        sexe: "M".into(),
        nom: "Martin".into(),
        prenom: "Lucas".into(),
        naissance: Some("2019-06-02".into()),
        archive: false,
        decede: false,
        recoit_les_factures: false,
    }];
    let definition = Definition {
        champs: vec![
            champ("motif", TypeChamp::TexteEnrichi, "Motif de consultation"),
            champ("douleur", TypeChamp::Curseur, "Douleur avant la séance"),
            champ("t", TypeChamp::Intertitre, "Traitement"),
            champ("traitement", TypeChamp::TexteEnrichi, "Techniques"),
        ],
    };
    let seances = [
        seance("s1", "2026-07-03T18:00", TypeSeance::Premiere, "Cervicalgie, céphalées de tension.", "Techniques fonctionnelles cervicales.", 5),
        seance("s2", "2026-09-12T17:30", TypeSeance::Suivi, "Contrôle, nette amélioration.", "Équilibration générale.", 2),
    ];
    let du_dossier: Vec<SeanceDuDossier> = seances.iter().map(|s| SeanceDuDossier { seance: s, definition: &definition }).collect();
    let factures = [ResumeFacture {
        id: "f".into(),
        nature: Nature::Facture,
        etat: EtatFacture::Emise,
        numero: Some("2026-09-1771".into()),
        date_emission: Some("2026-09-12".into()),
        patient_id: Some("fictive".into()),
        patient_nom: "Martin".into(),
        patient_prenom: "Camille".into(),
        destinataire: "Camille Martin".into(),
        seance_id: Some("s2".into()),
        date_seance: Some("2026-09-12".into()),
        designation: "Consultation".into(),
        total_centimes: 5500,
        regle_centimes: 5500,
        reste_centimes: 0,
        moyens: vec![Moyen::Carte],
        origine_numero: None,
        importee: false,
    }];
    let rubriques = RubriquesDossier {
        identite: true,
        profil: true,
        notes_importantes: true,
        remarques: true,
        antecedents: true,
        proches: true,
        documents: true,
        factures: true,
        seances: vec!["s1".into(), "s2".into()],
    };
    let habillage = Habillage::default();
    let demande = DemandeDossier {
        praticien: &praticien,
        patient: &patient,
        rubriques: &rubriques,
        antecedents: &antecedents,
        formulaire: &formulaire,
        proches: &proches,
        groupes: &[],
        seances: &du_dossier,
        documents: &[],
        factures: &factures,
        aujourdhui: "2026-10-08",
        habillage: &habillage,
    };
    std::fs::write(&chemin, dossier_pdf(&demande).expect("dossier")).expect("écriture");
    println!("{chemin}");
}
