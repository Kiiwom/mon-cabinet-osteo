//! Documents PDF d'Osteosphere, mis en page par Typst.
//!
//! Le moteur tourne dans le logiciel, sans accès au disque ni au réseau ; les polices Figtree
//! (licence SIL OFL 1.1, voir `polices/OFL.txt`) sont embarquées.

pub mod facture;
mod format;
mod monde;

pub use facture::{ErreurDocument, Filigrane, exemple, facture_pdf, facture_svg};
pub use format::euros;
