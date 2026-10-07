import { useEffect, useState } from "react";

import { lireInfosApplication, type InfosApplication } from "../lib/application";
import type { IdentiteCabinet } from "../lib/coeur";
import { adresse } from "../lib/navigation";

type Etat = "fait" | "en-cours" | "a-venir";

/** « de » devient « d’ » devant une voyelle ou un h muet : Cabinet d’Alexandre Roux. */
export function deOuD(mot: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(mot) ? "d’" : "de ";
}

const LIBELLES: Record<Etat, string> = { fait: "Fait", "en-cours": "En cours", "a-venir": "À venir" };

/** Accueil provisoire : l'avancement du prototype, en attendant l'accueil configurable de la phase 5. */
export function Accueil({ cabinet }: { cabinet: IdentiteCabinet }) {
  const [infos, setInfos] = useState<InfosApplication | null>(null);

  useEffect(() => {
    lireInfosApplication().then(setInfos, () => setInfos(null));
  }, []);

  const reel = infos?.dans_tauri ?? false;
  const etapes: { titre: string; detail: string; etat: Etat; lien?: string }[] = [
    {
      titre: "Dossiers patients",
      detail: "Recherche sans accents ni fautes, doublons, fiche complète, archives.",
      etat: "fait",
      lien: adresse("patients"),
    },
    { titre: "Antécédents et frise de vie", detail: "Par catégorie et rubrique, datés ou non, sur une frise de la naissance à aujourd’hui.", etat: "fait" },
    {
      titre: "Modèles de consultation",
      detail: "Adulte, Femme enceinte, Nourrisson repris de MonCabinetLibéral ; constructeur et versions.",
      etat: "fait",
      lien: adresse("parametres", "modeles"),
    },
    {
      titre: "Séances",
      detail: "Saisie selon le modèle avec les trames, enregistrement au fil de la frappe, reprise de la séance précédente, corbeille.",
      etat: "fait",
      lien: adresse("seances"),
    },
    {
      titre: "Socle de la phase 2",
      detail: reel
        ? "Fenêtre, base chiffrée et clé de secours, trames, facture PDF d’essai."
        : "Interface ouverte dans un navigateur, sans le cœur : rien n’est enregistré.",
      etat: reel ? "fait" : "en-cours",
    },
    { titre: "Facturation et recettes", detail: "Factures, avoirs, moyens de paiement, journal : phase 4.", etat: "a-venir" },
  ];

  return (
    <main className="page">
      <div>
        <h1 className="page-titre">Bienvenue, {cabinet.prenom}</h1>
        <p className="page-sous-titre">
          Cabinet {deOuD(cabinet.prenom)}
          {cabinet.prenom} {cabinet.nom} · prototype de la phase 3, avec des données fictives uniquement
        </p>
      </div>
      <section className="carte" aria-labelledby="titre-avancement">
        <h2 id="titre-avancement">Avancement du prototype</h2>
        <ol className="etapes">
          {etapes.map(({ titre, detail, etat, lien }) => (
            <li key={titre} className="etape">
              <span className="etape-etat" data-etat={etat}>
                {LIBELLES[etat]}
              </span>
              <span>
                {lien ? (
                  <a href={lien} className="lien-etape">
                    <strong>{titre}</strong>
                  </a>
                ) : (
                  <strong>{titre}</strong>
                )}
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
