import { useEffect, useId, useState } from "react";

import type { Coeur, Preferences } from "../lib/coeur";
import { adresse } from "../lib/navigation";
import { signalerTrames } from "../trames/contexte";

const SEUILS = [5, 10, 15, 20, 30, 50];

/** Paramètres › Saisie et dossier : mots fréquents, séances du dossier regroupées par année. */
export function PageParametresSaisie({ coeur }: { coeur: Coeur }) {
  const id = useId();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    coeur.preferences().then(setPreferences, (e: Error) => setErreur(e.message));
  }, [coeur]);

  async function enregistrer(nouvelles: Preferences) {
    setErreur(null);
    setMessage(null);
    try {
      setPreferences(await coeur.enregistrerPreferences(nouvelles));
      // Les champs texte relisent le vocabulaire : la complétion suit la préférence.
      signalerTrames();
      setMessage("Préférence enregistrée");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <main className="page">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> Saisie et dossier
      </nav>
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Saisie et dossier</h1>
          <p className="page-sous-titre">La complétion des mots pendant la saisie, la liste des séances du dossier</p>
        </div>
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {preferences && (
        <div className="pile">
          <section className="carte" aria-labelledby={`${id}-mots`}>
            <h2 id={`${id}-mots`}>Mots fréquents</h2>
            <label className="case-simple">
              <input type="checkbox" checked={preferences.mots_frequents} onChange={(e) => void enregistrer({ ...preferences, mots_frequents: e.target.checked })} />
              Proposer la fin des mots déjà saisis
            </label>
            <p className="discret">
              Après trois lettres, la fin d’un mot déjà écrit au moins deux fois dans vos séances, ou présent dans vos trames, s’affiche en grisé&nbsp;:
              «&nbsp;lomb&nbsp;» propose «&nbsp;lombalgie&nbsp;». Tab l’accepte, Échap ou la suite de la frappe l’ignore. Les mots restent sur
              l’ordinateur, dans la base chiffrée.
            </p>
          </section>
          <section className="carte" aria-labelledby={`${id}-seances`}>
            <h2 id={`${id}-seances`}>Séances du dossier</h2>
            <div className="champ">
              <label htmlFor={`${id}-seuil`}>Regrouper les séances par année</label>
              <select
                id={`${id}-seuil`}
                className="saisie-courte"
                value={preferences.regrouper_seances_au_dela ?? "jamais"}
                onChange={(e) => void enregistrer({ ...preferences, regrouper_seances_au_dela: e.target.value === "jamais" ? null : Number(e.target.value) })}
              >
                {SEUILS.map((n) => (
                  <option key={n} value={n}>
                    Au-delà de {n} séances
                  </option>
                ))}
                {preferences.regrouper_seances_au_dela !== null && !SEUILS.includes(preferences.regrouper_seances_au_dela) && (
                  <option value={preferences.regrouper_seances_au_dela}>Au-delà de {preferences.regrouper_seances_au_dela} séances</option>
                )}
                <option value="jamais">Jamais</option>
              </select>
            </div>
            <p className="discret">L’année la plus récente reste dépliée, les précédentes s’ouvrent d’un clic, avec leur nombre de séances.</p>
          </section>
          {message && (
            <p className="succes" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
