//! Monde Typst minimal : un seul fichier source, les polices embarquées, aucun accès disque
//! ni réseau. Les données arrivent par `sys.inputs`.

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
        if id == self.principal { Ok(Bytes::from_string(self.source.clone())) } else { Err(FileError::AccessDenied) }
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

/// Compose le modèle avec ses données (un document JSON) et rend le PDF.
pub fn pdf(modele: &str, donnees_json: String) -> Result<Vec<u8>, ErreurMiseEnPage> {
    let mut entrees = Dict::new();
    entrees.insert("donnees".into(), donnees_json.into_value());
    let chemin = VirtualPath::new("/modele.typ").map_err(|e| ErreurMiseEnPage::Typst(format!("{e:?}")))?;
    let principal = RootedPath::new(VirtualRoot::Project, chemin).intern();
    let monde = Monde {
        bibliotheque: LazyHash::new(Library::builder().with_inputs(entrees).build()),
        principal,
        source: Source::new(principal, modele.to_owned()),
    };
    let document: PagedDocument = typst::compile(&monde).output.map_err(messages)?;
    typst_pdf::pdf(&document, &PdfOptions::default()).map_err(messages)
}
