//! Écriture atomique : un fichier est soit l'ancienne version, soit la nouvelle, jamais à moitié écrit,
//! même après une coupure de courant.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

pub fn ecrire_atomiquement(chemin: &Path, contenu: &[u8]) -> io::Result<()> {
    let mut provisoire = chemin.as_os_str().to_owned();
    provisoire.push(".provisoire");
    let provisoire = Path::new(&provisoire);
    {
        let mut fichier = File::create(provisoire)?;
        fichier.write_all(contenu)?;
        fichier.sync_all()?;
    }
    fs::rename(provisoire, chemin)
}
