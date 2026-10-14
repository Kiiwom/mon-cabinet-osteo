//! Prépare un email dans la messagerie de l'ordinateur, le PDF déjà joint : le praticien relit
//! et envoie lui-même. Rien ne part sans lui, et l'application ne connaît aucun mot de passe de
//! messagerie.
//!
//! - Windows : Simple MAPI, que proposent Outlook et Thunderbird ;
//! - Linux : `xdg-email --attach`, que comprennent Thunderbird, Evolution et KMail.
//!
//! Sans messagerie compatible (messagerie web, par exemple), [`preparer`] renvoie
//! [`Indisponible`] : l'appelant ouvre alors une adresse `mailto:` et montre le PDF à joindre.

use std::fmt;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

pub struct Brouillon<'a> {
    /// Adresse du destinataire ; vide, le praticien la saisit dans sa messagerie.
    pub adresse: &'a str,
    pub nom: &'a str,
    pub objet: &'a str,
    pub message: &'a str,
    pub piece_jointe: &'a Path,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Preparation {
    /// La fenêtre de rédaction est ouverte, pièce jointe comprise.
    Ouverte,
    /// Le praticien a refermé la fenêtre sans envoyer.
    Abandonnee,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Indisponible(pub String);

impl fmt::Display for Indisponible {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "messagerie indisponible : {}", self.0)
    }
}

impl std::error::Error for Indisponible {}

/// Certaines messageries gardent la main jusqu'à l'envoi : passé ce délai sans erreur, la
/// fenêtre de rédaction est tenue pour ouverte et l'attente se poursuit en arrière-plan.
const DELAI: Duration = Duration::from_secs(4);

fn sans_attendre(travail: impl FnOnce() -> Result<Preparation, Indisponible> + Send + 'static) -> Result<Preparation, Indisponible> {
    let (envoi, reception) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = envoi.send(travail());
    });
    match reception.recv_timeout(DELAI) {
        Ok(resultat) => resultat,
        Err(mpsc::RecvTimeoutError::Timeout) => Ok(Preparation::Ouverte),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(Indisponible("la messagerie s'est arrêtée".into())),
    }
}

pub fn preparer(brouillon: &Brouillon) -> Result<Preparation, Indisponible> {
    if !brouillon.piece_jointe.is_file() {
        return Err(Indisponible(format!("pièce jointe introuvable : {}", brouillon.piece_jointe.display())));
    }
    systeme::preparer(brouillon)
}

#[cfg(target_os = "linux")]
mod systeme {
    use std::process::Command;

    use super::{Brouillon, Indisponible, Preparation, sans_attendre};

    pub fn preparer(brouillon: &Brouillon) -> Result<Preparation, Indisponible> {
        let mut commande = Command::new("xdg-email");
        commande.arg("--utf8").arg("--subject").arg(brouillon.objet).arg("--body").arg(brouillon.message).arg("--attach").arg(brouillon.piece_jointe);
        if !brouillon.adresse.trim().is_empty() {
            commande.arg(brouillon.adresse.trim());
        }
        let mut enfant = commande.spawn().map_err(|e| Indisponible(format!("xdg-email : {e}")))?;
        sans_attendre(move || match enfant.wait() {
            Ok(statut) if statut.success() => Ok(Preparation::Ouverte),
            Ok(statut) => Err(Indisponible(format!("xdg-email a échoué ({statut})"))),
            Err(e) => Err(Indisponible(format!("xdg-email : {e}"))),
        })
    }
}

#[cfg(windows)]
mod systeme {
    use std::ffi::c_void;

    use windows_sys::Win32::Foundation::FreeLibrary;
    use windows_sys::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows_sys::Win32::System::Mapi::{
        MAPI_DIALOG, MAPI_LOGON_UI, MAPI_TO, MAPI_USER_ABORT, MapiFileDescW, MapiMessageW, MapiRecipDescW, SUCCESS_SUCCESS,
    };

    use super::{Brouillon, Indisponible, Preparation, sans_attendre};

    type EnvoyerW = unsafe extern "system" fn(usize, usize, *const MapiMessageW, u32, u32) -> u32;

    fn large(texte: &str) -> Vec<u16> {
        texte.encode_utf16().chain(Some(0)).collect()
    }

    pub fn preparer(brouillon: &Brouillon) -> Result<Preparation, Indisponible> {
        let adresse = brouillon.adresse.trim().to_owned();
        let nom = if brouillon.nom.trim().is_empty() { adresse.clone() } else { brouillon.nom.trim().to_owned() };
        let objet = brouillon.objet.to_owned();
        // Les messageries Windows attendent des fins de ligne CRLF.
        let message = brouillon.message.replace("\r\n", "\n").replace('\n', "\r\n");
        let chemin = brouillon.piece_jointe.to_string_lossy().into_owned();
        let fichier = brouillon.piece_jointe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        sans_attendre(move || {
            let mut objet = large(&objet);
            let mut message = large(&message);
            let mut chemin = large(&chemin);
            let mut fichier = large(&fichier);
            let mut nom = large(&nom);
            let mut smtp = large(&format!("SMTP:{adresse}"));
            // SAFETY : chaque pointeur désigne un tampon UTF-16 terminé par zéro, vivant jusqu'à la fin
            // de l'appel ; la fonction est celle qu'exporte mapi32.dll sous ce nom, avec cette signature.
            unsafe {
                let com = CoInitializeEx(std::ptr::null::<c_void>(), COINIT_APARTMENTTHREADED as u32);
                let module = LoadLibraryW(large("mapi32.dll").as_ptr());
                if module.is_null() {
                    if com >= 0 {
                        CoUninitialize();
                    }
                    return Err(Indisponible("mapi32.dll absent".into()));
                }
                let resultat = match GetProcAddress(module, c"MAPISendMailW".as_ptr().cast()) {
                    None => Err(Indisponible("MAPISendMailW absent".into())),
                    Some(fonction) => {
                        let envoyer: EnvoyerW = std::mem::transmute::<unsafe extern "system" fn() -> isize, EnvoyerW>(fonction);
                        let mut destinataire = MapiRecipDescW {
                            ulRecipClass: MAPI_TO,
                            lpszName: nom.as_mut_ptr(),
                            lpszAddress: smtp.as_mut_ptr(),
                            ..Default::default()
                        };
                        let mut piece = MapiFileDescW { nPosition: u32::MAX, lpszPathName: chemin.as_mut_ptr(), lpszFileName: fichier.as_mut_ptr(), ..Default::default() };
                        let avec_destinataire = !adresse.is_empty();
                        let courriel = MapiMessageW {
                            lpszSubject: objet.as_mut_ptr(),
                            lpszNoteText: message.as_mut_ptr(),
                            nRecipCount: u32::from(avec_destinataire),
                            lpRecips: if avec_destinataire { &mut destinataire } else { std::ptr::null_mut() },
                            nFileCount: 1,
                            lpFiles: &mut piece,
                            ..Default::default()
                        };
                        match envoyer(0, 0, &courriel, MAPI_DIALOG | MAPI_LOGON_UI, 0) {
                            SUCCESS_SUCCESS => Ok(Preparation::Ouverte),
                            MAPI_USER_ABORT => Ok(Preparation::Abandonnee),
                            code => Err(Indisponible(format!("MAPI, code {code}"))),
                        }
                    }
                };
                FreeLibrary(module);
                if com >= 0 {
                    CoUninitialize();
                }
                resultat
            }
        })
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod systeme {
    use super::{Brouillon, Indisponible, Preparation};

    pub fn preparer(_: &Brouillon) -> Result<Preparation, Indisponible> {
        Err(Indisponible("système non pris en charge".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuse_une_piece_jointe_absente() {
        let brouillon = Brouillon { adresse: "", nom: "", objet: "Facture", message: "Bonjour", piece_jointe: Path::new("/nulle/part/facture.pdf") };
        assert!(matches!(preparer(&brouillon), Err(Indisponible(m)) if m.contains("introuvable")));
    }

    #[test]
    fn n_attend_pas_une_messagerie_qui_garde_la_main() {
        let debut = std::time::Instant::now();
        assert_eq!(sans_attendre(|| {
            std::thread::sleep(DELAI * 2);
            Ok(Preparation::Abandonnee)
        }), Ok(Preparation::Ouverte));
        assert!(debut.elapsed() < DELAI * 2);
        assert_eq!(sans_attendre(|| Err(Indisponible("essai".into()))), Err(Indisponible("essai".into())));
    }
}
