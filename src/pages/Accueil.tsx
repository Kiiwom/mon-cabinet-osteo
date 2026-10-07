import { useEffect, useState } from "react";

import { lireInfosApplication, type InfosApplication } from "../lib/application";
import type { IdentiteCabinet } from "../lib/coeur";

type Etat = "fait" | "en-cours" | "a-venir";

/** « de » devient « d’ » devant une voyelle ou un h muet : Cabinet d’Alexandre Roux. */
export function deOuD(mot: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(mot) ? "d’" : "de ";
}

const LIBELLES: Record<Etat, string> = { fait: "Fait", "en-cours": "En cours", "a-venir": "À venir" };

/** Accueil provisoire : l'avancement de la phase 2, tant que les vrais écrans ne sont pas branchés. */
export function Accueil({ cabinet }: { cabinet: IdentiteCabinet }) {
  const [infos, setInfos] = useState<InfosApplication | null>(null);

  useEffect(() => {
    lireInfosApplication().then(setInfos, () => setInfos(null));
  }, []);

  const reel = infos?.dans_tauri ?? false;
  const etapes: { titre: string; detail: string; etat: Etat }[] = [
    {
      titre: "Fenêtre de l’application",
      detail: reel ? "Osteosphere tourne dans sa propre fenêtre." : "Interface ouverte dans un navigateur, sans le cœur.",
      etat: reel ? "fait" : "en-cours",
    },
    {
      titre: "Premier démarrage, base chiffrée et clé de secours",
      detail: reel
        ? "Cabinet créé et chiffré sur cet ordinateur ; ouverture directe ou par mot de passe, clé de secours remise."
        : "Parcours simulé dans le navigateur : rien n’est enregistré.",
      etat: reel ? "fait" : "en-cours",
    },
    { titre: "Trame interactive", detail: "Menu @, pastilles de choix, blancs à compléter, validation.", etat: "a-venir" },
    { titre: "Facture PDF", detail: "Mise en page de la maquette, mentions obligatoires.", etat: "a-venir" },
  ];

  return (
    <main className="page">
      <div>
        <h1 className="page-titre">Bienvenue, {cabinet.prenom}</h1>
        <p className="page-sous-titre">
          Cabinet {deOuD(cabinet.prenom)}
          {cabinet.prenom} {cabinet.nom} · prototype de la phase 2, avec des données fictives uniquement
        </p>
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
