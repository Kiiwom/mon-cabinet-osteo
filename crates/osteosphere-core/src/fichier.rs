//! Écriture atomique : un fichier est soit l'ancienne version, soit la nouvelle, jamais à moitié écrit,
//! même après une coupure de courant.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

pub fn ecrire_atomiquement(chemin: &Path, contenu: &[u8]) -> io::Result<()> {
    ecrire_atomiquement_par(chemin, |fichier| fichier.write_all(contenu))
}

/// Comme [`ecrire_atomiquement`], pour un contenu écrit par morceaux : une sauvegarde de plusieurs
/// centaines de Mo n'a pas à tenir en mémoire.
pub fn ecrire_atomiquement_par(chemin: &Path, ecrire: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    let mut provisoire = chemin.as_os_str().to_owned();
    provisoire.push(".provisoire");
    let provisoire = Path::new(&provisoire);
    {
        let mut fichier = File::create(provisoire)?;
        if let Err(erreur) = ecrire(&mut fichier).and_then(|()| fichier.sync_all()) {
            drop(fichier);
            let _ = fs::remove_file(provisoire);
            return Err(erreur);
        }
    }
    fs::rename(provisoire, chemin)
}
