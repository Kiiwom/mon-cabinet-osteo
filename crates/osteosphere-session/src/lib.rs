//! Protection d'une clé par la session de l'ordinateur.
//!
//! Sous Windows, DPAPI chiffre la clé avec un secret lié au compte Windows du praticien :
//! elle ne se relit que dans sa session, sur ce poste. C'est ce qui permet d'ouvrir
//! Osteosphere directement, sans mot de passe, tout en gardant la base illisible
//! pour qui emporterait le disque ou une copie du dossier.
//!
//! Sous macOS et Linux, cette protection n'est pas encore écrite (Trousseau macOS et
//! Secret Service prévus) : la clé est gardée telle quelle, pour le développement seulement.

use zeroize::Zeroizing;

/// Session du compte courant sur cet ordinateur.
#[derive(Clone, Copy, Debug, Default)]
pub struct SessionOrdinateur;

impl SessionOrdinateur {
    /// Nom enregistré dans le trousseau avec la clé protégée.
    pub const NOM: &'static str = if cfg!(windows) { "dpapi" } else { "developpement-non-protege" };

    /// Vrai quand la clé est réellement protégée par le système.
    pub const fn protege_vraiment() -> bool {
        cfg!(windows)
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

#[cfg(not(windows))]
mod systeme {
    use zeroize::Zeroizing;

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
    }

    #[cfg(windows)]
    #[test]
    fn sous_windows_la_cle_n_apparait_pas_en_clair_et_resiste_aux_modifications() {
        let cle = [7u8; 32];
        let mut protege = SessionOrdinateur.proteger(&cle).unwrap();
        assert!(!protege.windows(cle.len()).any(|w| w == cle));
        let dernier = protege.len() - 1;
        protege[dernier] ^= 1;
        assert!(SessionOrdinateur.deproteger(&protege).is_err());
    }
}
