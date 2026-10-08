//! En-tête du cabinet, commun aux factures et aux comptes rendus.

use osteosphere_core::cabinet::IdentiteCabinet;
use serde_json::{Value, json};

/// Nom (suivi de « EI » sur une facture), profession, adresse, code postal et ville, contact.
/// Une mention vide reste visible, « à compléter », pour ne pas passer inaperçue.
pub fn entete_praticien(praticien: &IdentiteCabinet, entreprise_individuelle: bool) -> Value {
    let ou_a_completer = |valeur: &str, mention: &str| if valeur.is_empty() { format!("{mention} à compléter") } else { valeur.to_owned() };
    let cp_ville = format!("{} {}", praticien.code_postal, praticien.ville).trim().to_owned();
    let contact = [praticien.telephone.as_str(), praticien.email.as_str()].into_iter().filter(|v| !v.is_empty()).collect::<Vec<_>>().join(" · ");
    let lignes: Vec<String> = [ou_a_completer(&praticien.adresse, "Adresse"), ou_a_completer(&cp_ville, "Code postal et ville"), contact]
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect();
    let profession = if praticien.profession.is_empty() { "Ostéopathe".to_owned() } else { praticien.profession.clone() };
    let nom = format!("{} {}", praticien.prenom, praticien.nom);
    json!({
        "nom_complet": if entreprise_individuelle { format!("{nom} EI") } else { nom },
        "profession": profession,
        "lignes": lignes,
    })
}
