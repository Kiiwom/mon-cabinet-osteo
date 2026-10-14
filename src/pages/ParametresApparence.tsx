import { useEffect, useId, useRef, useState } from "react";

import { CarteChoix } from "../demarrage/PremierDemarrage";
import { ACCENTS, appliquerApparence, ecranTactileDetecte, TAILLES_TEXTE, type Apparence, type Tactile, type Theme } from "../lib/apparence";
import type { Coeur } from "../lib/coeur";
import { adresse } from "../lib/navigation";

const THEMES: { valeur: Theme; titre: string; detail: string }[] = [
  { valeur: "systeme", titre: "Comme l’ordinateur", detail: "Clair le jour, sombre le soir si votre ordinateur change de lui-même." },
  { valeur: "clair", titre: "Clair", detail: "Fond crème, texte brun : le thème des maquettes." },
  { valeur: "sombre", titre: "Sombre", detail: "Moins de lumière dans une salle tamisée. Les pense-bêtes restent clairs." },
];

const TACTILES: { valeur: Tactile; titre: string; detail: (detecte: boolean) => string }[] = [
  {
    valeur: "auto",
    titre: "Automatique",
    detail: (detecte) => (detecte ? "Un écran tactile est détecté : boutons, cases et pastilles sont agrandis." : "Aucun écran tactile détecté : affichage normal."),
  },
  { valeur: "toujours", titre: "Toujours agrandi", detail: () => "Cibles d’au moins 44 pixels partout, pour le doigt ou le stylet." },
  { valeur: "jamais", titre: "Jamais", detail: () => "Affichage normal, même sur un écran tactile." },
];

/** Paramètres › Apparence : thème, couleur d'accent, taille du texte, écran tactile. Chaque choix s'applique tout de suite. */
export function PageParametresApparence({ coeur }: { coeur: Coeur }) {
  const id = useId();
  const [apparence, setApparence] = useState<Apparence | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const tactileDetecte = ecranTactileDetecte();
  // Plusieurs choix peuvent partir coup sur coup : seule la réponse au dernier compte.
  const dernier = useRef(0);
  const enregistree = useRef<Apparence | null>(null);

  useEffect(() => {
    coeur.apparence().then((a) => {
      enregistree.current = a;
      setApparence(a);
    }, (e: Error) => setErreur(e.message));
  }, [coeur]);

  async function changer(modification: Partial<Apparence>) {
    if (!apparence) return;
    setErreur(null);
    setMessage(null);
    const nouvelle = { ...apparence, ...modification };
    const numero = ++dernier.current;
    // L'aperçu est immédiat ; en cas d'erreur, la dernière apparence enregistrée revient.
    appliquerApparence(nouvelle);
    setApparence(nouvelle);
    try {
      const reponse = await coeur.enregistrerApparence(nouvelle);
      enregistree.current = reponse;
      if (numero === dernier.current) setMessage("Apparence enregistrée");
    } catch (e) {
      if (numero !== dernier.current || !enregistree.current) return;
      appliquerApparence(enregistree.current);
      setApparence(enregistree.current);
      setErreur((e as Error).message);
    }
  }

  return (
    <main className="page">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> Apparence
      </nav>
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Apparence</h1>
          <p className="page-sous-titre">Thème, couleur d’accent, taille du texte et écran tactile, appliqués tout de suite</p>
        </div>
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {apparence && (
        <div className="pile">
          <section className="carte pile" aria-labelledby={`${id}-theme`}>
            <h2 id={`${id}-theme`}>Thème</h2>
            <div className="choix-cartes" role="radiogroup" aria-labelledby={`${id}-theme`}>
              {THEMES.map((t) => (
                <CarteChoix key={t.valeur} nom={`${id}-theme`} coche={apparence.theme === t.valeur} choisir={() => void changer({ theme: t.valeur })} titre={t.titre}>
                  {t.detail}
                </CarteChoix>
              ))}
            </div>
          </section>

          <section className="carte pile" aria-labelledby={`${id}-accent`}>
            <h2 id={`${id}-accent`}>Couleur d’accent</h2>
            <div className="nuancier" role="radiogroup" aria-labelledby={`${id}-accent`}>
              {ACCENTS.map((a) => (
                <label key={a.valeur} className="teinte">
                  <input type="radio" name={`${id}-accent`} checked={apparence.accent === a.valeur} onChange={() => void changer({ accent: a.valeur })} />
                  <span className="echantillon" style={{ background: a.couleur }} aria-hidden="true" />
                  {a.nom}
                  {a.valeur === "ocre" && <span className="discret"> (par défaut)</span>}
                </label>
              ))}
            </div>
            <p className="discret">Boutons principaux, liens, cadre de l’élément choisi. Les contrastes restent lisibles dans les deux thèmes.</p>
          </section>

          <section className="carte pile" aria-labelledby={`${id}-taille`}>
            <h2 id={`${id}-taille`}>Taille du texte</h2>
            <div className="segments" role="group" aria-labelledby={`${id}-taille`}>
              {TAILLES_TEXTE.map((taille) => (
                <button key={taille} type="button" aria-pressed={apparence.taille_texte === taille} onClick={() => void changer({ taille_texte: taille })}>
                  {taille}&nbsp;%
                </button>
              ))}
            </div>
            <p className="discret">Tout grandit ensemble, texte, boutons et marges, comme un zoom. La mise en page s’adapte à la place restante.</p>
          </section>

          <section className="carte pile" aria-labelledby={`${id}-tactile`}>
            <h2 id={`${id}-tactile`}>Écran tactile</h2>
            <div className="choix-cartes" role="radiogroup" aria-labelledby={`${id}-tactile`}>
              {TACTILES.map((t) => (
                <CarteChoix key={t.valeur} nom={`${id}-tactile`} coche={apparence.tactile === t.valeur} choisir={() => void changer({ tactile: t.valeur })} titre={t.titre}>
                  {t.detail(tactileDetecte)}
                </CarteChoix>
              ))}
            </div>
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
