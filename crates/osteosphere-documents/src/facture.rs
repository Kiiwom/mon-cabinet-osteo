//! Facture et avoir PDF, d'après la maquette 6.
//!
//! Mentions portées : nom du praticien suivi de « EI », profession, adresse, SIRET, RPPS,
//! numéro unique, date d'émission, date de la séance, destinataire, désignation, quantité,
//! prix unitaire, remise, total, règlements, « TVA non applicable, article 261-4-1° du CGI ».
//! Un avoir cite la facture qu'il annule ; une facture rectificative, celle qu'elle remplace.
//! Un brouillon ou une facture d'essai porte un filigrane et tolère des mentions vides.

use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_core::facturation::{
    Destinataire, EtatFacture, Facture, LigneFacture, Moyen, Nature, Reglement, Renvoi, SaisieFacture, SaisieReglement,
};
use osteosphere_core::numerotation::Date;
use serde_json::{Value, json};

use crate::format::euros;
use crate::monde::{self, ErreurMiseEnPage};

const MODELE: &str = include_str!("modeles/facture.typ");
pub const MENTION_TVA: &str = "TVA non applicable, article 261-4-1° du CGI";

/// Ce qui barre la page d'un document sans valeur.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filigrane {
    Essai,
    Brouillon,
}

impl Filigrane {
    fn texte(self) -> &'static str {
        match self {
            Self::Essai => "ESSAI — SANS VALEUR",
            Self::Brouillon => "BROUILLON — SANS VALEUR",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurDocument {
    #[error("{0}")]
    Donnee(String),
    #[error("mention obligatoire manquante : {0} (à compléter dans Paramètres › Cabinet)")]
    MentionManquante(&'static str),
    #[error(transparent)]
    MiseEnPage(#[from] ErreurMiseEnPage),
}

fn date(texte: &str) -> Result<Date, ErreurDocument> {
    Date::lire(texte).map_err(|e| ErreurDocument::Donnee(e.to_string()))
}

/// « 123 456 789 00012 » : SIRET lisible, groupé comme sur l'avis de situation.
fn siret_lisible(siret: &str) -> String {
    if siret.len() != 14 {
        return siret.to_owned();
    }
    format!("{}\u{a0}{}\u{a0}{}\u{a0}{}", &siret[..3], &siret[3..6], &siret[6..9], &siret[9..])
}

fn citer(renvoi: &Renvoi) -> Result<String, ErreurDocument> {
    Ok(format!("n° {} du {}", renvoi.numero, date(&renvoi.date_emission)?.en_toutes_lettres()))
}

/// Les valeurs affichées par le modèle, déjà mises en forme.
///
/// `praticien` : l'identité gardée à l'émission ; pour un brouillon ou un essai, celle du jour.
fn vue(facture: &Facture, praticien: &IdentiteCabinet, filigrane: Option<Filigrane>) -> Result<Value, ErreurDocument> {
    let praticien = praticien.verifier().map_err(|e| ErreurDocument::Donnee(e.to_string()))?;
    if filigrane.is_none() {
        if facture.etat == EtatFacture::Brouillon {
            return Err(ErreurDocument::Donnee("un brouillon ne s'imprime qu'en aperçu".into()));
        }
        if let Some(mention) = praticien.mentions_manquantes().first() {
            return Err(ErreurDocument::MentionManquante(mention));
        }
    }
    if facture.saisie.lignes.is_empty() {
        return Err(ErreurDocument::Donnee("une facture compte au moins une ligne".into()));
    }
    let avoir = facture.nature == Nature::Avoir;
    // Un avoir montre ses montants en négatif.
    let signe = if avoir { -1 } else { 1 };

    let emission = match &facture.date_emission {
        Some(texte) => date(texte)?.en_toutes_lettres(),
        None => "à l’émission".to_owned(),
    };
    let seance = match &facture.saisie.date_seance {
        Some(texte) => format!("Séance du {}", date(texte)?.en_toutes_lettres()),
        None => String::new(),
    };
    let mention = match (&facture.origine, facture.nature) {
        (Some(origine), Nature::Avoir) => format!("Avoir annulant la facture {}", citer(origine)?),
        (Some(origine), Nature::Facture) => format!("Facture rectificative : annule et remplace la facture {}", citer(origine)?),
        (None, _) => String::new(),
    };
    let annulation = match (&facture.avoir, &facture.rectificative) {
        (Some(avoir), Some(rectificative)) => {
            format!("Annulée par l’avoir {} et remplacée par la facture n° {}", citer(avoir)?, rectificative.numero)
        }
        (Some(avoir), None) => format!("Annulée par l’avoir {}", citer(avoir)?),
        _ => String::new(),
    };

    let remise = facture.saisie.lignes.iter().any(|l| l.reduction_centimes > 0);
    let mut lignes = Vec::new();
    for ligne in &facture.saisie.lignes {
        let montant = ligne.montant().ok_or_else(|| ErreurDocument::Donnee("montant trop élevé".into()))?;
        lignes.push(json!({
            "designation": ligne.designation.trim(),
            "quantite": ligne.quantite.to_string(),
            "prix": euros(signe * ligne.prix_unitaire_centimes),
            "remise": if ligne.reduction_centimes > 0 { euros(-signe * ligne.reduction_centimes) } else { String::new() },
            "total": euros(signe * montant),
        }));
    }

    let mut reglements = Vec::new();
    for r in &facture.reglements {
        let s = &r.saisie;
        let verbe = if s.montant_centimes < 0 { "Remboursé" } else { "Réglé" };
        let moyen = if s.reference.is_empty() || s.montant_centimes < 0 {
            s.moyen.en_lettres().to_owned()
        } else {
            format!("{} n° {}", s.moyen.en_lettres(), s.reference)
        };
        let payeur = if s.payeur.is_empty() { String::new() } else { format!(" ({})", s.payeur) };
        reglements.push(format!(
            "{verbe} {moyen} le {}{payeur} : {}",
            date(&s.encaisse_le)?.en_toutes_lettres(),
            euros(s.montant_centimes.abs())
        ));
    }
    if reglements.is_empty() && !avoir && facture.etat != EtatFacture::Annulee {
        reglements.push("En attente de règlement".to_owned());
    }

    let fort = |libelle: &str, valeur: String| json!({ "libelle": libelle, "valeur": valeur, "fort": true });
    let simple = |libelle: &str, valeur: String| json!({ "libelle": libelle, "valeur": valeur, "fort": false });
    let totaux = if avoir {
        let mut totaux = vec![fort("Total de l’avoir", euros(facture.total_centimes))];
        if facture.regle_centimes != 0 {
            totaux.push(simple("Remboursé", euros(-facture.regle_centimes)));
        }
        totaux
    } else if facture.etat == EtatFacture::Annulee {
        vec![fort("Total", euros(facture.total_centimes))]
    } else {
        vec![
            fort("Total", euros(facture.total_centimes)),
            simple("Réglé", euros(facture.regle_centimes)),
            fort("Reste à régler", euros((facture.total_centimes - facture.regle_centimes).max(0))),
        ]
    };

    let ou_a_completer = |valeur: &str, mention: &str| {
        if valeur.is_empty() { format!("{mention} à compléter") } else { valeur.to_owned() }
    };
    let ville_cp = |cp: &str, ville: &str| format!("{cp} {ville}").trim().to_owned();
    let contact = [praticien.telephone.as_str(), praticien.email.as_str()]
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    let lignes_praticien: Vec<String> = [
        ou_a_completer(&praticien.adresse, "Adresse"),
        ou_a_completer(&ville_cp(&praticien.code_postal, &praticien.ville), "Code postal et ville"),
        contact,
    ]
    .into_iter()
    .filter(|v| !v.is_empty())
    .collect();

    let d = &facture.saisie.destinataire;
    let nom_destinataire = [d.civilite.trim(), d.prenom.trim(), d.nom.trim()]
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut lignes_destinataire: Vec<String> = d.adresse.lines().map(|l| l.trim().to_owned()).filter(|l| !l.is_empty()).collect();
    let cp_ville = ville_cp(d.code_postal.trim(), d.ville.trim());
    if !cp_ville.is_empty() {
        lignes_destinataire.push(cp_ville);
    }

    let initiale = praticien.prenom.chars().next().map(|c| format!("{c}. ")).unwrap_or_default();
    let lieu_date = if praticien.ville.is_empty() {
        format!("Fait le {emission}")
    } else {
        format!("Fait à {}, le {emission}", praticien.ville)
    };
    let siret = if praticien.siret.is_empty() { "à compléter".to_owned() } else { siret_lisible(&praticien.siret) };
    let rpps = if praticien.rpps.is_empty() { "à compléter".to_owned() } else { praticien.rpps.clone() };
    let profession = if praticien.profession.is_empty() { "Ostéopathe".to_owned() } else { praticien.profession.clone() };
    let titre = if avoir { "AVOIR" } else { "FACTURE" };

    Ok(json!({
        "filigrane": filigrane.map(Filigrane::texte).unwrap_or_default(),
        "titre": titre,
        "numero": facture.numero.clone().unwrap_or_else(|| "à attribuer".into()),
        "mention": mention,
        "annulation": annulation,
        "emission": emission,
        "seance": seance,
        "praticien": {
            "nom_complet": format!("{} {} EI", praticien.prenom, praticien.nom),
            "profession": profession,
            "lignes": lignes_praticien,
        },
        "destinataire": { "nom": nom_destinataire, "lignes": lignes_destinataire },
        "remise": remise,
        "lignes": lignes,
        "totaux": totaux,
        "reglements": reglements,
        "commentaire": facture.saisie.commentaire_imprime.trim(),
        "lieu_date": lieu_date,
        "signataire": format!("{initiale}{}", praticien.nom),
        "mentions": format!("SIRET {siret} · RPPS {rpps} · {MENTION_TVA}"),
    }))
}

/// Facture fictive pour l'aperçu de la mise en page : patiente et numéro inventés, rien n'est
/// enregistré ni réservé.
pub fn exemple(date: &str) -> Facture {
    Facture {
        id: "exemple".into(),
        nature: Nature::Facture,
        etat: EtatFacture::Emise,
        numero: Some(format!("{}-{}-1772", &date[..4.min(date.len())], date.get(5..7).unwrap_or("01"))),
        date_emission: Some(date.to_owned()),
        saisie: SaisieFacture {
            patient_id: None,
            seance_id: None,
            date_seance: Some(date.to_owned()),
            destinataire: Destinataire {
                civilite: "Mme".into(),
                prenom: "Camille".into(),
                nom: "Martin".into(),
                adresse: "12 rue des Tilleuls".into(),
                code_postal: "47500".into(),
                ville: "Fumel".into(),
            },
            lignes: vec![LigneFacture {
                designation: "Consultation d’ostéopathie".into(),
                quantite: 1,
                prix_unitaire_centimes: 5500,
                ..Default::default()
            }],
            commentaire_imprime: "Facture d’essai : patiente et numéro fictifs.".into(),
            commentaire_interne: String::new(),
        },
        total_centimes: 5500,
        regle_centimes: 5500,
        reste_centimes: 0,
        remboursable_centimes: 0,
        praticien: None,
        origine: None,
        avoir: None,
        rectificative: None,
        reglements: vec![Reglement {
            id: "exemple".into(),
            facture_id: "exemple".into(),
            saisie: SaisieReglement { moyen: Moyen::Carte, montant_centimes: 5500, encaisse_le: date.to_owned(), ..Default::default() },
            importe: false,
            cree_le: 0,
            modifie_le: 0,
        }],
        importee: false,
        cree_le: 0,
        modifie_le: 0,
    }
}

/// Le PDF de la facture ou de l'avoir.
pub fn facture_pdf(facture: &Facture, praticien: &IdentiteCabinet, filigrane: Option<Filigrane>) -> Result<Vec<u8>, ErreurDocument> {
    Ok(monde::pdf(MODELE, vue(facture, praticien, filigrane)?.to_string())?)
}

/// Les pages de la facture en SVG, pour l'aperçu à l'écran : la même mise en page que le PDF.
pub fn facture_svg(facture: &Facture, praticien: &IdentiteCabinet, filigrane: Option<Filigrane>) -> Result<Vec<String>, ErreurDocument> {
    Ok(monde::svg(MODELE, vue(facture, praticien, filigrane)?.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn praticien() -> IdentiteCabinet {
        IdentiteCabinet {
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
        }
    }

    fn reglement(moyen: Moyen, montant: i64) -> Reglement {
        Reglement {
            id: "r1".into(),
            facture_id: "f1".into(),
            saisie: SaisieReglement { moyen, montant_centimes: montant, encaisse_le: "2026-10-06".into(), ..Default::default() },
            importe: false,
            cree_le: 0,
            modifie_le: 0,
        }
    }

    fn facture_fictive() -> Facture {
        Facture {
            id: "f1".into(),
            nature: Nature::Facture,
            etat: EtatFacture::Emise,
            numero: Some("2026-10-1772".into()),
            date_emission: Some("2026-10-06".into()),
            saisie: SaisieFacture {
                patient_id: None,
                seance_id: None,
                date_seance: Some("2026-10-06".into()),
                destinataire: Destinataire {
                    civilite: "Mme".into(),
                    prenom: "Camille".into(),
                    nom: "Martin".into(),
                    adresse: "12 rue des Tilleuls\nBâtiment B".into(),
                    code_postal: "47500".into(),
                    ville: "Fumel".into(),
                },
                lignes: vec![LigneFacture {
                    designation: "Consultation d'ostéopathie".into(),
                    quantite: 1,
                    prix_unitaire_centimes: 5500,
                    ..Default::default()
                }],
                commentaire_imprime: String::new(),
                commentaire_interne: "jamais imprimé".into(),
            },
            total_centimes: 5500,
            regle_centimes: 5500,
            reste_centimes: 0,
            remboursable_centimes: 0,
            praticien: Some(praticien()),
            origine: None,
            avoir: None,
            rectificative: None,
            reglements: vec![reglement(Moyen::Carte, 5500)],
            importee: false,
            cree_le: 0,
            modifie_le: 0,
        }
    }

    #[test]
    fn met_en_forme_les_mentions_et_les_montants() {
        let v = vue(&facture_fictive(), &praticien(), None).unwrap();
        assert_eq!(v["titre"], "FACTURE");
        assert_eq!(v["praticien"]["nom_complet"], "Alexandre Roux EI");
        assert_eq!(v["emission"], "6 octobre 2026");
        assert_eq!(v["seance"], "Séance du 6 octobre 2026");
        assert_eq!(v["destinataire"]["nom"], "Mme Camille Martin");
        assert_eq!(v["destinataire"]["lignes"], json!(["12 rue des Tilleuls", "Bâtiment B", "47500 Fumel"]));
        assert_eq!(v["totaux"][0]["valeur"], "55,00\u{a0}€");
        assert_eq!(v["totaux"][2]["valeur"], "0,00\u{a0}€");
        assert_eq!(v["reglements"][0], "Réglé par carte le 6 octobre 2026 : 55,00\u{a0}€");
        assert_eq!(v["lieu_date"], "Fait à Lacapelle-Biron, le 6 octobre 2026");
        assert_eq!(v["signataire"], "A. Roux");
        assert_eq!(v["remise"], false);
        assert_eq!(
            v["mentions"],
            "SIRET 123\u{a0}456\u{a0}789\u{a0}00012 · RPPS 10000000000 · TVA non applicable, article 261-4-1° du CGI"
        );
        assert!(!v.to_string().contains("jamais imprimé"));
    }

    #[test]
    fn la_facture_d_exemple_s_imprime_en_essai() {
        let exemple = exemple("2026-10-06");
        assert_eq!(exemple.numero.as_deref(), Some("2026-10-1772"));
        assert!(facture_pdf(&exemple, &IdentiteCabinet { prenom: "A".into(), nom: "Roux".into(), ..Default::default() }, Some(Filigrane::Essai)).is_ok());
    }

    #[test]
    fn produit_un_pdf_et_un_apercu() {
        let pdf = facture_pdf(&facture_fictive(), &praticien(), None).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1000);
        let pages = facture_svg(&facture_fictive(), &praticien(), None).unwrap();
        assert_eq!(pages.len(), 1);
        assert!(pages[0].starts_with("<svg"));
    }

    #[test]
    fn exige_les_mentions_hors_apercu_et_les_tolere_en_essai() {
        let sans_siret = IdentiteCabinet { siret: String::new(), ..praticien() };
        assert!(matches!(facture_pdf(&facture_fictive(), &sans_siret, None), Err(ErreurDocument::MentionManquante("SIRET"))));
        let v = vue(&facture_fictive(), &sans_siret, Some(Filigrane::Essai)).unwrap();
        assert!(v["mentions"].as_str().unwrap().starts_with("SIRET à compléter"));
        assert_eq!(v["filigrane"], "ESSAI — SANS VALEUR");
        assert!(facture_pdf(&facture_fictive(), &sans_siret, Some(Filigrane::Essai)).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    fn un_brouillon_ne_s_imprime_qu_en_apercu() {
        let mut brouillon = facture_fictive();
        brouillon.etat = EtatFacture::Brouillon;
        brouillon.numero = None;
        brouillon.date_emission = None;
        brouillon.reglements.clear();
        brouillon.regle_centimes = 0;
        assert!(facture_pdf(&brouillon, &praticien(), None).is_err());
        let v = vue(&brouillon, &praticien(), Some(Filigrane::Brouillon)).unwrap();
        assert_eq!((v["numero"].as_str(), v["filigrane"].as_str()), (Some("à attribuer"), Some("BROUILLON — SANS VALEUR")));
        assert_eq!(v["reglements"][0], "En attente de règlement");
    }

    #[test]
    fn un_nom_avec_des_caracteres_typst_ne_casse_pas_la_mise_en_page() {
        let mut facture = facture_fictive();
        facture.saisie.destinataire.nom = "*Martin* #panic() $x$ [lien] \\ _".into();
        facture.saisie.commentaire_imprime = "#import \"secret.typ\": *".into();
        assert!(facture_pdf(&facture, &praticien(), None).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    fn remise_cheque_et_reste_a_regler() {
        let mut facture = facture_fictive();
        facture.saisie.lignes.push(LigneFacture {
            designation: "Séance complémentaire".into(),
            quantite: 2,
            prix_unitaire_centimes: 2000,
            reduction_centimes: 500,
            ..Default::default()
        });
        facture.total_centimes = 9000;
        let mut cheque = reglement(Moyen::Cheque, 5500);
        cheque.saisie.reference = "0004512".into();
        cheque.saisie.payeur = "Paul Martin".into();
        facture.reglements = vec![cheque];
        let v = vue(&facture, &praticien(), None).unwrap();
        assert_eq!(v["remise"], true);
        assert_eq!(v["lignes"][1]["remise"], "-5,00\u{a0}€");
        assert_eq!(v["lignes"][1]["total"], "35,00\u{a0}€");
        assert_eq!(v["totaux"][2]["valeur"], "35,00\u{a0}€");
        assert_eq!(v["reglements"][0], "Réglé par chèque n° 0004512 le 6 octobre 2026 (Paul Martin) : 55,00\u{a0}€");
        assert!(facture_pdf(&facture, &praticien(), None).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    fn avoir_et_facture_rectificative_citent_l_origine() {
        let origine = Renvoi { id: "f0".into(), numero: "2026-10-1771".into(), date_emission: "2026-10-05".into() };
        let mut avoir = facture_fictive();
        avoir.nature = Nature::Avoir;
        avoir.total_centimes = -5500;
        avoir.reglements = vec![reglement(Moyen::Especes, -5500)];
        avoir.regle_centimes = -5500;
        avoir.origine = Some(origine.clone());
        let v = vue(&avoir, &praticien(), None).unwrap();
        assert_eq!(v["titre"], "AVOIR");
        assert_eq!(v["mention"], "Avoir annulant la facture n° 2026-10-1771 du 5 octobre 2026");
        assert_eq!(v["lignes"][0]["total"], "-55,00\u{a0}€");
        assert_eq!(v["totaux"][0]["valeur"], "-55,00\u{a0}€");
        assert_eq!(v["totaux"][1]["valeur"], "55,00\u{a0}€");
        assert_eq!(v["reglements"][0], "Remboursé en espèces le 6 octobre 2026 : 55,00\u{a0}€");
        assert!(facture_pdf(&avoir, &praticien(), None).unwrap().starts_with(b"%PDF-"));

        let mut rectificative = facture_fictive();
        rectificative.origine = Some(origine);
        let v = vue(&rectificative, &praticien(), None).unwrap();
        assert_eq!(v["mention"], "Facture rectificative : annule et remplace la facture n° 2026-10-1771 du 5 octobre 2026");

        let mut annulee = facture_fictive();
        annulee.etat = EtatFacture::Annulee;
        annulee.avoir = Some(Renvoi { id: "a".into(), numero: "2026-10-1773".into(), date_emission: "2026-10-07".into() });
        let v = vue(&annulee, &praticien(), None).unwrap();
        assert_eq!(v["annulation"], "Annulée par l’avoir n° 2026-10-1773 du 7 octobre 2026");
    }
}
