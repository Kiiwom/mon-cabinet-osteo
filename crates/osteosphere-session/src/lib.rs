//! Protection d'une clé par la session de l'ordinateur.
//!
//! Sous Windows, DPAPI chiffre la clé avec un secret lié au compte Windows du praticien :
//! elle ne se relit que dans sa session, sur ce poste. C'est ce qui permet d'ouvrir
//! Osteosphere directement, sans mot de passe, tout en gardant la base illisible
//! pour qui emporterait le disque ou une copie du dossier.
//!
//! Sous Linux, le trousseau de la session (GNOME, KDE…) joue ce rôle, par l'interface
//! Secret Service : il s'ouvre avec la session de l'utilisateur.
//!
//! Sous macOS, cette protection n'est pas encore écrite (Trousseau macOS prévu) : la clé est
//! gardée telle quelle, pour le développement seulement.

use zeroize::Zeroizing;

/// Session du compte courant sur cet ordinateur.
#[derive(Clone, Copy, Debug, Default)]
pub struct SessionOrdinateur;

impl SessionOrdinateur {
    /// Nom enregistré dans le trousseau avec la clé protégée.
    pub const NOM: &'static str = if cfg!(windows) {
        "dpapi"
    } else if cfg!(target_os = "linux") {
        "secret-service"
    } else {
        "developpement-non-protege"
    };

    /// Vrai quand le système peut protéger la clé maintenant. Sous Linux, le trousseau de
    /// la session doit répondre : la question part sur le bus de la session, hors du fil de
    /// l'interface de préférence.
    pub fn protection_disponible() -> bool {
        systeme::disponible()
    }

    pub fn proteger(&self, donnees: &[u8]) -> Result<Vec<u8>, String> {
        systeme::proteger(donnees)
    }

    pub fn deproteger(&self, protege: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        systeme::deproteger(protege)
    }
}

#[cfg(windows)]
mod systeme {
    use std::ffi::c_void;
    use std::ptr;

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    use zeroize::Zeroizing;

    /// Entropie propre à Osteosphere : un autre programme de la même session ne peut pas
    /// relire la clé sans la connaître.
    const ENTROPIE: &[u8] = b"Osteosphere - cle de la base - v1";

    pub fn disponible() -> bool {
        true
    }

    fn blob(donnees: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: donnees.len() as u32, pbData: donnees.as_ptr() as *mut u8 }
    }

    pub fn proteger(donnees: &[u8]) -> Result<Vec<u8>, String> {
        let entree = blob(donnees);
        let entropie = blob(ENTROPIE);
        let mut sortie = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        // SAFETY : les blobs d'entrée pointent sur des tranches valides pendant tout l'appel ;
        // la sortie est allouée par Windows et libérée ci-dessous par LocalFree.
        let reussi = unsafe {
            CryptProtectData(
                &entree,
                ptr::null(),
                &entropie,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut sortie,
            )
        };
        if reussi == 0 {
            return Err(format!("CryptProtectData : {}", std::io::Error::last_os_error()));
        }
        // SAFETY : Windows garantit cbData octets lisibles à pbData.
        let protege = unsafe { std::slice::from_raw_parts(sortie.pbData, sortie.cbData as usize) }.to_vec();
        // SAFETY : pbData a été alloué par CryptProtectData avec LocalAlloc.
        unsafe { LocalFree(sortie.pbData as *mut c_void) };
        Ok(protege)
    }

    pub fn deproteger(protege: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        let entree = blob(protege);
        let entropie = blob(ENTROPIE);
        let mut sortie = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        // SAFETY : comme pour CryptProtectData.
        let reussi = unsafe {
            CryptUnprotectData(
                &entree,
                ptr::null_mut(),
                &entropie,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut sortie,
            )
        };
        if reussi == 0 {
            return Err(format!("CryptUnprotectData : {}", std::io::Error::last_os_error()));
        }
        let longueur = sortie.cbData as usize;
        // SAFETY : Windows garantit cbData octets lisibles et modifiables à pbData.
        let clair = Zeroizing::new(unsafe { std::slice::from_raw_parts(sortie.pbData, longueur) }.to_vec());
        // SAFETY : le tampon de Windows est effacé avant d'être rendu au système.
        unsafe {
            ptr::write_bytes(sortie.pbData, 0, longueur);
            LocalFree(sortie.pbData as *mut c_void);
        }
        Ok(clair)
    }
}

/// La clé est scellée par une clé d'emballage tirée au hasard, rangée dans le trousseau de la
/// session. Le trousseau d'Osteosphere garde l'enveloppe ; il faut les deux pour relire la clé.
/// Une enveloppe retirée (mot de passe activé) rend donc inutile ce qui reste dans le trousseau.
///
/// Enveloppe : version (1 octet), identifiant (16), nonce (24), clé chiffrée et étiquette.
#[cfg(target_os = "linux")]
mod systeme {
    use std::collections::HashMap;

    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};
    use secret_service::blocking::{Item, SecretService};
    use secret_service::{EncryptionType, Error};
    use zeroize::Zeroizing;

    const VERSION: u8 = 1;
    const TAILLE_ID: usize = 16;
    const TAILLE_NONCE: usize = 24;
    const TAILLE_CLE: usize = 32;
    const ENTETE: usize = 1 + TAILLE_ID;
    const APPLICATION: &str = "fr.pierre-besnier.osteosphere";
    /// Nom affiché par « Mots de passe et clés » (Seahorse) ou KWallet.
    const LIBELLE: &str = "Osteosphere — clé d’ouverture du cabinet";

    fn expliquer(erreur: Error) -> String {
        match erreur {
            Error::Unavailable => "le trousseau de la session (GNOME, KDE…) ne répond pas".into(),
            Error::Prompt | Error::PromptDisconnected => "le déverrouillage du trousseau de la session a été annulé".into(),
            Error::Locked => "le trousseau de la session est verrouillé".into(),
            autre => format!("trousseau de la session : {autre}"),
        }
    }

    fn aleatoire<const N: usize>() -> Result<[u8; N], String> {
        let mut octets = [0u8; N];
        getrandom::fill(&mut octets).map_err(|e| format!("tirage aléatoire : {e}"))?;
        Ok(octets)
    }

    fn hexa(octets: &[u8]) -> String {
        octets.iter().map(|o| format!("{o:02x}")).collect()
    }

    fn attributs(id: &str) -> HashMap<&str, &str> {
        HashMap::from([("application", APPLICATION), ("enveloppe", id)])
    }

    fn connecter() -> Result<SecretService<'static>, String> {
        SecretService::connect(EncryptionType::Dh).map_err(expliquer)
    }

    pub fn disponible() -> bool {
        connecter().and_then(|service| service.get_any_collection().map(|_| ()).map_err(expliquer)).is_ok()
    }

    fn lire_entete(protege: &[u8]) -> Result<&[u8], String> {
        match protege.first() {
            Some(&VERSION) if protege.len() > ENTETE + TAILLE_NONCE => Ok(&protege[..ENTETE]),
            _ => Err("enveloppe du trousseau de session illisible".into()),
        }
    }

    /// Cherche la clé d'emballage, en déverrouillant le trousseau au besoin (le système le demande).
    fn avec_element<T>(protege: &[u8], action: impl FnOnce(&Item) -> Result<T, String>) -> Result<T, String> {
        let id = hexa(&lire_entete(protege)?[1..]);
        let service = connecter()?;
        let trouves = service.search_items(attributs(&id)).map_err(expliquer)?;
        let element = trouves
            .unlocked
            .first()
            .or(trouves.locked.first())
            .ok_or("la clé n’est plus dans le trousseau de la session")?;
        if element.is_locked().map_err(expliquer)? {
            element.unlock().map_err(expliquer)?;
        }
        action(element)
    }

    pub fn proteger(donnees: &[u8]) -> Result<Vec<u8>, String> {
        let cle = Zeroizing::new(aleatoire::<TAILLE_CLE>()?);
        let nonce = aleatoire::<TAILLE_NONCE>()?;
        let id = aleatoire::<TAILLE_ID>()?;
        let mut protege = Vec::with_capacity(ENTETE + TAILLE_NONCE + donnees.len() + 16);
        protege.push(VERSION);
        protege.extend_from_slice(&id);
        let chiffre = XChaCha20Poly1305::new(cle.as_ref().into())
            .encrypt(XNonce::from_slice(&nonce), Payload { msg: donnees, aad: &protege[..ENTETE] })
            .map_err(|_| "chiffrement de la clé".to_string())?;

        let service = connecter()?;
        let trousseau = service
            .get_default_collection()
            .or_else(|_| service.get_any_collection())
            .map_err(expliquer)?;
        if trousseau.is_locked().map_err(expliquer)? {
            trousseau.unlock().map_err(expliquer)?;
        }
        let id = hexa(&id);
        trousseau
            .create_item(LIBELLE, attributs(&id), cle.as_ref(), true, "application/octet-stream")
            .map_err(expliquer)?;

        protege.extend_from_slice(&nonce);
        protege.extend_from_slice(&chiffre);
        Ok(protege)
    }

    pub fn deproteger(protege: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        let cle = avec_element(protege, |element| Ok(Zeroizing::new(element.get_secret().map_err(expliquer)?)))?;
        let cle: &[u8; TAILLE_CLE] =
            cle.as_slice().try_into().map_err(|_| "clé du trousseau de la session abîmée".to_string())?;
        let (entete, reste) = protege.split_at(ENTETE);
        let (nonce, chiffre) = reste.split_at(TAILLE_NONCE);
        XChaCha20Poly1305::new(cle.into())
            .decrypt(XNonce::from_slice(nonce), Payload { msg: chiffre, aad: entete })
            .map(Zeroizing::new)
            .map_err(|_| "enveloppe du trousseau de session abîmée ou modifiée".into())
    }

    /// Retire la clé d'emballage du trousseau de la session.
    #[cfg(test)]
    pub fn oublier(protege: &[u8]) -> Result<(), String> {
        avec_element(protege, |element| element.delete().map_err(expliquer))
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod systeme {
    use zeroize::Zeroizing;

    pub fn disponible() -> bool {
        false
    }

    pub fn proteger(donnees: &[u8]) -> Result<Vec<u8>, String> {
        Ok(donnees.to_vec())
    }

    pub fn deproteger(protege: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        Ok(Zeroizing::new(protege.to_vec()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relit_ce_qu_elle_a_protege() {
        let cle = [7u8; 32];
        let protege = SessionOrdinateur.proteger(&cle).unwrap();
        assert_eq!(SessionOrdinateur.deproteger(&protege).unwrap().as_slice(), &cle);
        #[cfg(target_os = "linux")]
        systeme::oublier(&protege).unwrap();
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[test]
    fn la_cle_n_apparait_pas_en_clair_et_resiste_aux_modifications() {
        assert!(SessionOrdinateur::protection_disponible());
        let cle = [7u8; 32];
        let protege = SessionOrdinateur.proteger(&cle).unwrap();
        assert!(!protege.windows(cle.len()).any(|w| w == cle));
        let mut modifie = protege.clone();
        let dernier = modifie.len() - 1;
        modifie[dernier] ^= 1;
        assert!(SessionOrdinateur.deproteger(&modifie).is_err());
        #[cfg(target_os = "linux")]
        systeme::oublier(&protege).unwrap();
    }

    /// Clé effacée du trousseau, ou trousseau d'un autre compte : l'enveloppe seule ne suffit pas.
    #[cfg(target_os = "linux")]
    #[test]
    fn sous_linux_l_enveloppe_seule_ne_suffit_pas() {
        let protege = SessionOrdinateur.proteger(&[7u8; 32]).unwrap();
        systeme::oublier(&protege).unwrap();
        let erreur = SessionOrdinateur.deproteger(&protege).unwrap_err();
        assert!(erreur.contains("plus dans le trousseau"), "{erreur}");
    }
}
