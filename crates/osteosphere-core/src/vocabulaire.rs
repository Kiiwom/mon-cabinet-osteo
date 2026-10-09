//! Mots fréquents : le vocabulaire du praticien, tiré de ses séances et de ses trames, pour
//! proposer la fin d'un mot en cours de frappe (« lomb » → « lombalgie »).

use std::collections::HashMap;

use serde_json::Value;

use crate::base::{Base, ErreurBase};
use crate::seances::{texte_de, texte_riche};

/// Un mot plus court ne vaut pas d'être complété.
const LONGUEUR_MIN: usize = 6;
const LONGUEUR_MAX: usize = 40;

fn compter(texte: &str, poids: u32, comptes: &mut HashMap<String, u32>) {
    for mot in texte.split(|c: char| !(c.is_alphabetic() || c == '-')) {
        let mot = mot.trim_matches('-');
        let longueur = mot.chars().count();
        if (LONGUEUR_MIN..=LONGUEUR_MAX).contains(&longueur) && !mot.contains("--") {
            *comptes.entry(mot.to_lowercase()).or_default() += poids;
        }
    }
}

fn compter_valeur(valeur: &Value, comptes: &mut HashMap<String, u32>) {
    match valeur {
        Value::String(texte) => compter(&texte_riche(texte), 1, comptes),
        Value::Object(_) => compter(&texte_de(valeur), 1, comptes),
        Value::Array(elements) => elements.iter().for_each(|e| compter_valeur(e, comptes)),
        _ => {}
    }
}

/// Les mots du praticien, du plus fréquent au moins fréquent : ceux de ses séances écrits au
/// moins deux fois, et tous ceux de ses trames.
pub fn mots_frequents(base: &Base, limite: usize) -> Result<Vec<String>, ErreurBase> {
    let mut comptes: HashMap<String, u32> = HashMap::new();
    {
        let mut requete = base.connexion().prepare("SELECT valeurs FROM seances WHERE supprimee_le IS NULL")?;
        let mut lignes = requete.query([])?;
        while let Some(ligne) = lignes.next()? {
            let texte: String = ligne.get(0)?;
            if let Ok(Value::Object(valeurs)) = serde_json::from_str::<Value>(&texte) {
                valeurs.values().for_each(|v| compter_valeur(v, &mut comptes));
            }
        }
    }
    let mut des_trames: HashMap<String, u32> = HashMap::new();
    {
        let mut requete = base.connexion().prepare("SELECT modele FROM trames")?;
        let mut lignes = requete.query([])?;
        while let Some(ligne) = lignes.next()? {
            let modele: String = ligne.get(0)?;
            compter(&modele, 1, &mut des_trames);
        }
    }
    let mut mots: Vec<(String, u32)> = comptes.into_iter().filter(|(_, n)| *n >= 2).collect();
    for (mot, _) in des_trames {
        if !mots.iter().any(|(m, _)| *m == mot) {
            mots.push((mot, 1));
        }
    }
    mots.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    mots.truncate(limite);
    Ok(mots.into_iter().map(|(mot, _)| mot).collect())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::chiffrement::CleDonnees;
    use crate::modeles;
    use crate::patients::{self, FichePatient};
    use crate::seances::{self, SaisieSeance};
    use crate::trames::{self, SaisieTrame};

    #[test]
    fn retient_les_mots_ecrits_deux_fois_et_ceux_des_trames() {
        let dossier = tempfile::tempdir().unwrap();
        let base = Base::ouvrir(&dossier.path().join("essai.osteosphere"), &CleDonnees::generer().unwrap()).unwrap();
        modeles::installer_modeles_fournis(&base).unwrap();
        let modele = modeles::lister(&base).unwrap().remove(0);
        let patient = patients::creer(&base, &FichePatient { nom: "Martin".into(), prenom: "Camille".into(), ..Default::default() }).unwrap().id;
        let document = |texte: &str| json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": texte }] }] });
        for texte in ["Lombalgie basse, sacro-iliaque droite", "Lombalgie chronique ; cervicalgie", "Sacro-iliaque libérée"] {
            let mut saisie = SaisieSeance { debut: "2026-10-08T10:00".into(), modele_id: modele.id.clone(), modele_version: modele.version, ..Default::default() };
            saisie.valeurs.insert("motif".into(), document(texte));
            seances::creer(&base, &patient, &saisie).unwrap();
        }
        trames::enregistrer(&base, None, &SaisieTrame { code: "dors".into(), titre: "Dorsalgie".into(), modele: "Dorsalgie {haute | basse}".into(), ..Default::default() }).unwrap();

        let mots = mots_frequents(&base, 100).unwrap();
        assert_eq!(&mots[..2], ["lombalgie", "sacro-iliaque"]);
        assert!(mots.contains(&"dorsalgie".to_owned()));
        // Écrit une seule fois : pas encore un mot fréquent.
        assert!(!mots.contains(&"cervicalgie".to_owned()));
        // Trop court pour valoir une complétion.
        assert!(!mots.contains(&"basse".to_owned()));
        assert_eq!(mots_frequents(&base, 1).unwrap(), ["lombalgie"]);
    }
}
