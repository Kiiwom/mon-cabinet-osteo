//! Monde Typst minimal : un seul fichier source, les polices embarquées, aucun accès disque
//! ni réseau. Les données arrivent par `sys.inputs`.

use std::collections::HashMap;
use std::sync::LazyLock;

use typst::diag::{FileError, FileResult, SourceDiagnostic};
use typst::foundations::{Bytes, Datetime, Dict, Duration, IntoValue};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;

static POLICES: LazyLock<Vec<Font>> = LazyLock::new(|| {
    [
        include_bytes!("../polices/Figtree-Regular.ttf").as_slice(),
        include_bytes!("../polices/Figtree-Medium.ttf").as_slice(),
        include_bytes!("../polices/Figtree-SemiBold.ttf").as_slice(),
        include_bytes!("../polices/Figtree-Bold.ttf").as_slice(),
        include_bytes!("../polices/Figtree-Italic.ttf").as_slice(),
    ]
    .into_iter()
    .flat_map(|octets| Font::iter(Bytes::new(octets)))
    .collect()
});

static CATALOGUE: LazyLock<LazyHash<FontBook>> = LazyLock::new(|| LazyHash::new(FontBook::from_fonts(POLICES.iter())));

struct Monde {
    bibliotheque: LazyHash<Library>,
    principal: FileId,
    source: Source,
    /// Images fournies au modèle (logo, signature) : seuls fichiers lisibles en plus du modèle.
    fichiers: HashMap<FileId, Bytes>,
}

impl World for Monde {
    fn library(&self) -> &LazyHash<Library> {
        &self.bibliotheque
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &CATALOGUE
    }

    fn main(&self) -> FileId {
        self.principal
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.principal { Ok(self.source.clone()) } else { Err(FileError::AccessDenied) }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.principal {
            return Ok(Bytes::from_string(self.source.clone()));
        }
        self.fichiers.get(&id).cloned().ok_or(FileError::AccessDenied)
    }

    fn font(&self, index: usize) -> Option<Font> {
        POLICES.get(index).cloned()
    }

    /// Les modèles n'utilisent pas la date du jour : elle arrive mise en forme dans les données.
    fn today(&self, _decalage: Option<Duration>) -> Option<Datetime> {
        None
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ErreurMiseEnPage {
    #[error("mise en page impossible : {0}")]
    Typst(String),
}

fn messages(diagnostics: impl IntoIterator<Item = SourceDiagnostic>) -> ErreurMiseEnPage {
    ErreurMiseEnPage::Typst(diagnostics.into_iter().map(|d| d.message.to_string()).collect::<Vec<_>>().join(" ; "))
}

fn identifiant(chemin: &str) -> Result<FileId, ErreurMiseEnPage> {
    let chemin = VirtualPath::new(chemin).map_err(|e| ErreurMiseEnPage::Typst(format!("{e:?}")))?;
    Ok(RootedPath::new(VirtualRoot::Project, chemin).intern())
}

/// Compose le modèle avec ses données (un document JSON) et ses images (nom de fichier, octets).
fn composer(modele: &str, donnees_json: String, images: &[(String, Vec<u8>)]) -> Result<PagedDocument, ErreurMiseEnPage> {
    let mut entrees = Dict::new();
    entrees.insert("donnees".into(), donnees_json.into_value());
    let principal = identifiant("/modele.typ")?;
    let mut fichiers = HashMap::new();
    for (nom, octets) in images {
        fichiers.insert(identifiant(&format!("/{nom}"))?, Bytes::new(octets.clone()));
    }
    let monde = Monde {
        bibliotheque: LazyHash::new(Library::builder().with_inputs(entrees).build()),
        principal,
        source: Source::new(principal, modele.to_owned()),
        fichiers,
    };
    typst::compile(&monde).output.map_err(messages)
}

/// Le PDF du modèle composé avec ses données.
pub fn pdf(modele: &str, donnees_json: String, images: &[(String, Vec<u8>)]) -> Result<Vec<u8>, ErreurMiseEnPage> {
    typst_pdf::pdf(&composer(modele, donnees_json, images)?, &PdfOptions::default()).map_err(messages)
}

/// Une image SVG par page, pour l'aperçu dans l'application : texte vectorisé, sans lecteur PDF.
pub fn svg(modele: &str, donnees_json: String, images: &[(String, Vec<u8>)]) -> Result<Vec<String>, ErreurMiseEnPage> {
    let document = composer(modele, donnees_json, images)?;
    Ok(document.pages().iter().map(|page| typst_svg::svg(page, &typst_svg::SvgOptions::default())).collect())
}
