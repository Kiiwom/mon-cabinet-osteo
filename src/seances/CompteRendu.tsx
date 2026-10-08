import { useEffect, useId, useRef, useState } from "react";

import { PagesApercu } from "../facturation/composants";
import type { ChampImprimable, Coeur } from "../lib/coeur";

/**
 * Compte rendu PDF de la séance : le praticien choisit les sections imprimées (les champs remplis
 * marqués « imprimé » dans le modèle sont cochés d'office), voit l'aperçu, puis l'enregistre ou
 * l'imprime.
 */
export function CompteRendu({ coeur, seanceId, fermer, surAjout }: { coeur: Coeur; seanceId: string; fermer: () => void; surAjout?: () => void }) {
  const id = useId();
  const [champs, setChamps] = useState<ChampImprimable[] | null>(null);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [joindre, setJoindre] = useState(true);
  const [pages, setPages] = useState<string[] | null>(null);
  const [erreurApercu, setErreurApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const fermeture = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fermeture.current?.focus();
    coeur.champsCompteRendu(seanceId).then(
      (liste) => {
        setChamps(liste);
        setChoisis(liste.filter((c) => c.par_defaut).map((c) => c.id));
      },
      (e: Error) => setErreur(e.message),
    );
  }, [coeur, seanceId]);

  // L'aperçu suit le choix des sections, après un court délai.
  useEffect(() => {
    if (!champs) return;
    let actif = true;
    const minuterie = setTimeout(() => {
      coeur.apercuCompteRendu(seanceId, choisis).then(
        (p) => actif && (setPages(p), setErreurApercu(null)),
        (e: Error) => actif && setErreurApercu(e.message),
      );
    }, 250);
    return () => {
      actif = false;
      clearTimeout(minuterie);
    };
  }, [coeur, seanceId, champs, choisis]);

  async function agir(action: () => Promise<void>) {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  const ordonner = (ids: string[]) => (champs ?? []).map((c) => c.id).filter((c) => ids.includes(c));

  return (
    <div className="voile" role="presentation" onClick={fermer} onKeyDown={(e) => e.key === "Escape" && fermer()}>
      <section className="carte compte-rendu" role="dialog" aria-modal="true" aria-labelledby={`${id}-titre`} onClick={(e) => e.stopPropagation()}>
        <div className="entete-carte">
          <h2 id={`${id}-titre`}>Compte rendu de la séance</h2>
          <button type="button" className="bouton bouton-petit" ref={fermeture} onClick={fermer}>
            Fermer
          </button>
        </div>
        <div className="compte-rendu-colonnes">
          <div className="pile">
            <fieldset className="groupe">
              <legend>Sections imprimées</legend>
              {champs === null ? (
                <p className="discret">Chargement…</p>
              ) : (
                <div className="choix-liste">
                  {champs.map((c) => (
                    <label key={c.id} className="case-simple" data-vide={!c.rempli || undefined}>
                      <input
                        type="checkbox"
                        disabled={!c.rempli}
                        checked={choisis.includes(c.id)}
                        onChange={(e) => setChoisis((liste) => ordonner(e.target.checked ? [...liste, c.id] : liste.filter((x) => x !== c.id)))}
                      />
                      {c.libelle}
                      {!c.rempli && <span className="discret"> (vide)</span>}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <label className="case-simple">
              <input type="checkbox" checked={joindre} onChange={(e) => setJoindre(e.target.checked)} />
              Ajouter aussi aux documents de la séance
            </label>
            {erreur && (
              <p className="alerte" role="alert">
                {erreur}
              </p>
            )}
            {message && (
              <p className="succes" role="status">
                {message}
              </p>
            )}
            <div className="rangee">
              <button
                type="button"
                className="bouton bouton-principal"
                disabled={envoi || choisis.length === 0}
                onClick={() =>
                  void agir(async () => {
                    const chemin = await coeur.enregistrerCompteRendu(seanceId, choisis, joindre);
                    setMessage(`Compte rendu enregistré : ${chemin}`);
                    if (joindre) surAjout?.();
                  })
                }
              >
                Enregistrer le PDF
              </button>
              <button type="button" className="bouton" disabled={envoi || choisis.length === 0} onClick={() => void agir(() => coeur.imprimerCompteRendu(seanceId, choisis))}>
                Imprimer…
              </button>
            </div>
          </div>
          <PagesApercu pages={choisis.length ? pages : []} erreur={choisis.length ? erreurApercu : "Cochez au moins une section."} titre="Aperçu du compte rendu" />
        </div>
      </section>
    </div>
  );
}
