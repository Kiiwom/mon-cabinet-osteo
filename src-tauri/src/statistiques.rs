//! Commande des statistiques.

use std::sync::Arc;

use osteosphere_core::statistiques::{self, BaseChiffre, Statistiques};
use tauri::State;

use crate::demarrage::{EtatCabinet, en_arriere_plan, message};

/// Les statistiques entre deux dates comprises, comparées à la même période un an plus tôt.
#[tauri::command]
pub async fn statistiques(etat: State<'_, Arc<EtatCabinet>>, du: String, au: String, base: BaseChiffre) -> Result<Statistiques, String> {
    let etat = Arc::clone(&etat);
    en_arriere_plan(move || etat.avec_base(|b| statistiques::calculer(b, &du, &au, base).map_err(message))).await
}
