//! Mise en forme à la française des montants.

/// « 1 250,00 € » : espace insécable entre les milliers et avant le symbole.
pub fn euros(centimes: i64) -> String {
    let signe = if centimes < 0 { "-" } else { "" };
    let absolu = centimes.unsigned_abs();
    let entiers = (absolu / 100).to_string();
    let mut groupes = Vec::new();
    let mut reste = entiers.as_str();
    while reste.len() > 3 {
        let (debut, fin) = reste.split_at(reste.len() - 3);
        groupes.push(fin);
        reste = debut;
    }
    groupes.push(reste);
    groupes.reverse();
    format!("{signe}{},{:02}\u{a0}€", groupes.join("\u{a0}"), absolu % 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecrit_les_montants_a_la_francaise() {
        assert_eq!(euros(5500), "55,00\u{a0}€");
        assert_eq!(euros(5), "0,05\u{a0}€");
        assert_eq!(euros(125_000), "1\u{a0}250,00\u{a0}€");
        assert_eq!(euros(123_456_789), "1\u{a0}234\u{a0}567,89\u{a0}€");
        assert_eq!(euros(-500), "-5,00\u{a0}€");
    }
}
