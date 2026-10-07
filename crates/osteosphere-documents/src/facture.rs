//! Facture PDF, d'après la maquette 6.
//!
//! Mentions portées : nom du praticien suivi de « EI », profession, adresse, SIRET, RPPS,
//! numéro unique, date d'émission, date de la séance, destinataire, désignation, quantité,
//! prix unitaire, total, règlements, « TVA non applicable, article 261-4-1° du CGI ».
//! Une facture d'essai porte le filigrane « ESSAI — SANS VALEUR » et tolère des mentions vides.

use osteosphere_core::cabinet::IdentiteCabinet;
use osteosphere_core::numerotation::Date;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::format::euros;
use crate::monde::{self, ErreurMiseEnPage};

const MODELE: &str = include_str!("modeles/facture.typ");
pub const MENTION_TVA: &str = "TVA non applicable, article 261-4-1° du CGI";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Destinataire {
    pub civilite: String,
    pub prenom: String,
    pub nom: String,
    pub adresse: String,
    pub code_postal: String,
    pub ville: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LigneFacture {
    pub designation: String,
    pub quantite: u32,
    pub prix_unitaire_centimes: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reglement {
    /// « carte », « chèque », « espèces » ou « virement ».
    pub moyen: String,
    pub date: String,
    pub montant_centimes: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Facture {
    pub numero: String,
    pub date_emission: String,
    pub date_seance: Option<String>,
    pub praticien: IdentiteCabinet,
    pub destinataire: Destinataire,
    pub lignes: Vec<LigneFacture>,
    pub reglements: Vec<Reglement>,
    pub commentaire: String,
    pub essai: bool,
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

fn moyen_en_lettres(moyen: &str) -> String {
    match moyen.trim().to_lowercase().as_str() {
        "carte" | "cb" => "par carte".into(),
        "chèque" | "cheque" => "par chèque".into(),
        "espèces" | "especes" => "en espèces".into(),
        "virement" => "par virement".into(),
        autre => format!("par {autre}"),
    }
}

/// « 123 456 789 00012 » : SIRET lisible, groupé comme sur l'avis de situation.
fn siret_lisible(siret: &str) -> String {
    if siret.len() != 14 {
        return siret.to_owned();
    }
    format!("{}\u{a0}{}\u{a0}{}\u{a0}{}", &siret[..3], &siret[3..6], &siret[6..9], &siret[9..])
}

/// Les valeurs affichées par le modèle, déjà mises en forme.
fn vue(facture: &Facture) -> Result<Value, ErreurDocument> {
    let praticien = facture.praticien.verifier().map_err(|e| ErreurDocument::Donnee(e.to_string()))?;
    if !facture.essai {
        for (mention, valeur) in [
            ("adresse", &praticien.adresse),
            ("code postal", &praticien.code_postal),
            ("ville", &praticien.ville),
            ("SIRET", &praticien.siret),
            ("RPPS", &praticien.rpps),
        ] {
            if valeur.is_empty() {
                return Err(ErreurDocument::MentionManquante(mention));
            }
        }
    }
    if facture.lignes.is_empty() {
        return Err(ErreurDocument::Donnee("une facture compte au moins une ligne".into()));
    }
    if facture.numero.trim().is_empty() {
        return Err(ErreurDocument::Donnee("la facture n'a pas de numéro".into()));
    }

    let emission = date(&facture.date_emission)?.en_toutes_lettres();
    let seance = match &facture.date_seance {
        Some(texte) => format!("Séance du {}", date(texte)?.en_toutes_lettres()),
        None => String::new(),
    };

    let mut total: i64 = 0;
    let mut lignes = Vec::new();
    for ligne in &facture.lignes {
        let montant = ligne
            .prix_unitaire_centimes
            .checked_mul(i64::from(ligne.quantite))
            .ok_or_else(|| ErreurDocument::Donnee("montant trop élevé".into()))?;
        total = total.checked_add(montant).ok_or_else(|| ErreurDocument::Donnee("montant trop élevé".into()))?;
        lignes.push(json!({
            "designation": ligne.designation.trim(),
            "quantite": ligne.quantite.to_string(),
            "prix": euros(ligne.prix_unitaire_centimes),
            "total": euros(montant),
        }));
    }
    let mut regle: i64 = 0;
    let mut reglements = Vec::new();
    for reglement in &facture.reglements {
        regle += reglement.montant_centimes;
        reglements.push(format!(
            "Réglé {} le {} : {}",
            moyen_en_lettres(&reglement.moyen),
            date(&reglement.date)?.en_toutes_lettres(),
            euros(reglement.montant_centimes)
        ));
    }
    if reglements.is_empty() {
        reglements.push("En attente de règlement".to_owned());
    }

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

    let d = &facture.destinataire;
    let nom_destinataire = [d.civilite.trim(), d.prenom.trim(), d.nom.trim()]
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let lignes_destinataire: Vec<String> = [d.adresse.trim().to_owned(), ville_cp(d.code_postal.trim(), d.ville.trim())]
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect();

    let initiale = praticien.prenom.chars().next().map(|c| format!("{c}. ")).unwrap_or_default();
    let lieu_date = if praticien.ville.is_empty() {
        format!("Fait le {emission}")
    } else {
        format!("Fait à {}, le {emission}", praticien.ville)
    };
    let siret = if praticien.siret.is_empty() { "à compléter".to_owned() } else { siret_lisible(&praticien.siret) };
    let rpps = if praticien.rpps.is_empty() { "à compléter".to_owned() } else { praticien.rpps.clone() };
    let profession = if praticien.profession.is_empty() { "Ostéopathe".to_owned() } else { praticien.profession.clone() };

    Ok(json!({
        "essai": facture.essai,
        "numero": facture.numero.trim(),
        "emission": emission,
        "seance": seance,
        "praticien": {
            "nom_complet": format!("{} {} EI", praticien.prenom, praticien.nom),
            "profession": profession,
            "lignes": lignes_praticien,
        },
        "destinataire": { "nom": nom_destinataire, "lignes": lignes_destinataire },
        "lignes": lignes,
        "total": euros(total),
        "regle": euros(regle),
        "reste": euros(total - regle),
        "reglements": reglements,
        "commentaire": facture.commentaire.trim(),
        "lieu_date": lieu_date,
        "signataire": format!("{initiale}{}", praticien.nom),
        "mentions": format!("SIRET {siret} · RPPS {rpps} · {MENTION_TVA}"),
    }))
}

pub fn facture_pdf(facture: &Facture) -> Result<Vec<u8>, ErreurDocument> {
    Ok(monde::pdf(MODELE, vue(facture)?.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facture_fictive() -> Facture {
        Facture {
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
            lignes: vec![LigneFacture { designation: "Consultation d'ostéopathie".into(), quantite: 1, prix_unitaire_centimes: 5500 }],
            reglements: vec![Reglement { moyen: "carte".into(), date: "2026-10-06".into(), montant_centimes: 5500 }],
            commentaire: String::new(),
            essai: false,
        }
    }

    #[test]
    fn met_en_forme_les_mentions_et_les_montants() {
        let v = vue(&facture_fictive()).unwrap();
        assert_eq!(v["praticien"]["nom_complet"], "Alexandre Roux EI");
        assert_eq!(v["emission"], "6 octobre 2026");
        assert_eq!(v["seance"], "Séance du 6 octobre 2026");
        assert_eq!(v["destinataire"]["nom"], "Mme Camille Martin");
        assert_eq!(v["total"], "55,00\u{a0}€");
        assert_eq!(v["reste"], "0,00\u{a0}€");
        assert_eq!(v["reglements"][0], "Réglé par carte le 6 octobre 2026 : 55,00\u{a0}€");
        assert_eq!(v["lieu_date"], "Fait à Lacapelle-Biron, le 6 octobre 2026");
        assert_eq!(v["signataire"], "A. Roux");
        assert_eq!(
            v["mentions"],
            "SIRET 123\u{a0}456\u{a0}789\u{a0}00012 · RPPS 10000000000 · TVA non applicable, article 261-4-1° du CGI"
        );
    }

    #[test]
    fn produit_un_pdf() {
        let pdf = facture_pdf(&facture_fictive()).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1000);
    }

    #[test]
    fn exige_les_mentions_hors_essai_et_les_tolere_en_essai() {
        let mut facture = facture_fictive();
        facture.praticien.siret.clear();
        assert!(matches!(facture_pdf(&facture), Err(ErreurDocument::MentionManquante("SIRET"))));
        facture.essai = true;
        let v = vue(&facture).unwrap();
        assert!(v["mentions"].as_str().unwrap().starts_with("SIRET à compléter"));
        assert!(facture_pdf(&facture).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    fn un_nom_avec_des_caracteres_typst_ne_casse_pas_la_mise_en_page() {
        let mut facture = facture_fictive();
        facture.destinataire.nom = "*Martin* #panic() $x$ [lien] \\ _".into();
        facture.commentaire = "#import \"secret.typ\": *".into();
        assert!(facture_pdf(&facture).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    fn signale_un_reste_a_regler() {
        let mut facture = facture_fictive();
        facture.lignes.push(LigneFacture { designation: "Séance complémentaire".into(), quantite: 2, prix_unitaire_centimes: 2000 });
        facture.reglements[0].moyen = "chèque".into();
        let v = vue(&facture).unwrap();
        assert_eq!(v["total"], "95,00\u{a0}€");
        assert_eq!(v["reste"], "40,00\u{a0}€");
        assert!(v["reglements"][0].as_str().unwrap().starts_with("Réglé par chèque"));
    }

    #[test]
    fn refuse_une_facture_sans_ligne() {
        let mut facture = facture_fictive();
        facture.lignes.clear();
        assert!(matches!(facture_pdf(&facture), Err(ErreurDocument::Donnee(_))));
    }
}
