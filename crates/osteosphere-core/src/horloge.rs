//! Heure légale française, pour nommer les sauvegardes et décider d'une sauvegarde « du jour » :
//! UTC+1 en hiver, UTC+2 du dernier dimanche de mars au dernier dimanche d'octobre (règle européenne,
//! changement à 1 h UTC). Le cœur n'a pas d'autre fuseau à connaître.

use crate::numerotation::Date;

/// Jour du dernier dimanche du mois, en jours depuis 1970.
fn dernier_dimanche(annee: i32, mois: u32) -> i64 {
    let premier_suivant = if mois == 12 { (annee + 1, 1) } else { (annee, mois + 1) };
    let dernier = Date::lire(&format!("{:04}-{:02}-01", premier_suivant.0, premier_suivant.1)).map(|d| d.jours_unix() - 1).unwrap_or(0);
    // Le 1er janvier 1970 était un jeudi : (jours + 4) mod 7 vaut 0 le dimanche.
    dernier - (dernier + 4).rem_euclid(7)
}

/// Décalage de l'heure légale française sur le temps universel, en secondes.
pub fn decalage_paris(secondes: i64) -> i64 {
    let annee = Date::depuis_jours_unix(secondes.div_euclid(86_400)).annee();
    let debut_ete = dernier_dimanche(annee, 3) * 86_400 + 3_600;
    let fin_ete = dernier_dimanche(annee, 10) * 86_400 + 3_600;
    if (debut_ete..fin_ete).contains(&secondes) { 7_200 } else { 3_600 }
}

/// Date, heure et minute à Paris.
pub fn paris(secondes: i64) -> (Date, u32, u32) {
    let local = secondes + decalage_paris(secondes);
    let dans_le_jour = local.rem_euclid(86_400);
    (Date::depuis_jours_unix(local.div_euclid(86_400)), (dans_le_jour / 3_600) as u32, (dans_le_jour % 3_600 / 60) as u32)
}

/// Lundi de la semaine, à Paris : deux instants de la même semaine ont le même lundi.
pub fn lundi_paris(secondes: i64) -> i64 {
    let jour = paris(secondes).0.jours_unix();
    // (jours + 3) mod 7 vaut 0 le lundi.
    jour - (jour + 3).rem_euclid(7)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instant(date: &str, heure: i64, minute: i64) -> i64 {
        Date::lire(date).unwrap().jours_unix() * 86_400 + heure * 3_600 + minute * 60
    }

    #[test]
    fn heure_d_ete_et_d_hiver() {
        // 7 octobre 2026, 18 h 30 UTC : 20 h 30 à Paris.
        let (date, h, m) = paris(instant("2026-10-07", 18, 30));
        assert_eq!((date.to_string(), h, m), ("2026-10-07".into(), 20, 30));
        // 15 janvier 2026, 23 h 30 UTC : déjà le 16 à Paris.
        let (date, h, _) = paris(instant("2026-01-15", 23, 30));
        assert_eq!((date.to_string(), h), ("2026-01-16".into(), 0));
        // Changements d'heure 2026 : 29 mars et 25 octobre, à 1 h UTC.
        assert_eq!(decalage_paris(instant("2026-03-29", 0, 59)), 3_600);
        assert_eq!(decalage_paris(instant("2026-03-29", 1, 0)), 7_200);
        assert_eq!(decalage_paris(instant("2026-10-25", 0, 59)), 7_200);
        assert_eq!(decalage_paris(instant("2026-10-25", 1, 0)), 3_600);
    }

    #[test]
    fn meme_semaine() {
        let lundi = lundi_paris(instant("2026-10-05", 8, 0));
        assert_eq!(Date::depuis_jours_unix(lundi).to_string(), "2026-10-05");
        assert_eq!(lundi_paris(instant("2026-10-11", 20, 0)), lundi);
        assert_ne!(lundi_paris(instant("2026-10-11", 22, 30)), lundi);
    }
}
