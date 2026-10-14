//! Écriture hexadécimale des octets, pour les fichiers JSON et la commande `PRAGMA key`.

const CHIFFRES: &[u8; 16] = b"0123456789abcdef";

pub fn encoder(octets: &[u8]) -> String {
    let mut texte = String::with_capacity(octets.len() * 2);
    for o in octets {
        texte.push(CHIFFRES[(o >> 4) as usize] as char);
        texte.push(CHIFFRES[(o & 0x0f) as usize] as char);
    }
    texte
}

pub fn decoder(texte: &str) -> Option<Vec<u8>> {
    if !texte.len().is_multiple_of(2) {
        return None;
    }
    texte
        .as_bytes()
        .chunks(2)
        .map(|paire| {
            let fort = (paire[0] as char).to_digit(16)?;
            let faible = (paire[1] as char).to_digit(16)?;
            Some((fort * 16 + faible) as u8)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aller_retour() {
        let octets = [0u8, 1, 127, 128, 255];
        assert_eq!(encoder(&octets), "00017f80ff");
        assert_eq!(decoder("00017F80ff").unwrap(), octets);
    }

    #[test]
    fn refuse_un_texte_invalide() {
        assert_eq!(decoder("abc"), None);
        assert_eq!(decoder("zz"), None);
    }
}
