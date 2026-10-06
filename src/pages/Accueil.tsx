import { useEffect, useState } from "react";

import { lireInfosApplication, type InfosApplication } from "../lib/application";

type Etat = "fait" | "en-cours" | "a-venir";

const LIBELLES: Record<Etat, string> = { fait: "Fait", "en-cours": "En cours", "a-venir": "À venir" };

/** Accueil provisoire : l'avancement de la phase 2, tant que les vrais écrans ne sont pas branchés. */
export function Accueil() {
  const [infos, setInfos] = useState<InfosApplication | null>(null);

  useEffect(() => {
    lireInfosApplication().then(setInfos, () => setInfos(null));
  }, []);

  const etapes: { titre: string; detail: string; etat: Etat }[] = [
    {
      titre: "Fenêtre de l’application",
      detail: infos?.dans_tauri ? "Osteosphere tourne dans sa propre fenêtre." : "Interface ouverte dans un navigateur, sans le cœur.",
      etat: infos?.dans_tauri ? "fait" : "en-cours",
    },
    {
      titre: "Base chiffrée et clé de secours",
      detail: "Cœur prêt et testé : SQLCipher, clé de secours, mot de passe facultatif. Reste à le brancher à l’écran.",
      etat: "en-cours",
    },
    { titre: "Trame interactive", detail: "Menu @, pastilles de choix, blancs à compléter, validation.", etat: "a-venir" },
    { titre: "Facture PDF", detail: "Mise en page de la maquette, mentions obligatoires.", etat: "a-venir" },
  ];

  return (
    <main className="page">
      <div>
        <h1 className="page-titre">Bienvenue dans Osteosphere</h1>
        <p className="page-sous-titre">Prototype de la phase 2, avec des données fictives uniquement</p>
      </div>
      <section className="carte" aria-labelledby="titre-avancement">
        <h2 id="titre-avancement">Avancement du prototype</h2>
        <ol className="etapes">
          {etapes.map(({ titre, detail, etat }) => (
            <li key={titre} className="etape">
              <span className="etape-etat" data-etat={etat}>
                {LIBELLES[etat]}
              </span>
              <span>
                <strong>{titre}</strong>
                <br />
                <span className="discret">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
        {infos && (
          <p className="discret">
            Version {infos.version} · cœur {infos.version_coeur}
          </p>
        )}
      </section>
    </main>
  );
}
