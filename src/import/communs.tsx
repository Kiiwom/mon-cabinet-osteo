import { useState, type ReactNode } from "react";

import type { Coeur, CompteurImport } from "../lib/coeur";
import { adresse } from "../lib/navigation";

/** Les étapes de tout import : le fichier, sa vérification sans rien écrire, le rapport. */
export type EtapeImport = "fichier" | "verification" | "import" | "rapport";

const ETAPES: { cle: EtapeImport; titre: string }[] = [
  { cle: "fichier", titre: "Fichier" },
  { cle: "verification", titre: "Vérification" },
  { cle: "rapport", titre: "Rapport" },
];

export function nombre(n: number): string {
  return n.toLocaleString("fr-FR");
}

/** « 1 archivé », « 0 avoir », « 2 avoirs ». */
export function compte(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${nombre(n)} ${n > 1 ? pluriel : singulier}`;
}

export function nomDeFichier(chemin: string): string {
  return chemin.split(/[\\/]/).pop() ?? chemin;
}

export function Etapes({ etape }: { etape: EtapeImport }) {
  const rang = ETAPES.findIndex((e) => e.cle === (etape === "import" ? "verification" : etape));
  return (
    <ol className="etapes-import" aria-label="Étapes de l’import">
      {ETAPES.map((e, i) => {
        const etat = i < rang ? "fait" : i === rang ? "en-cours" : "a-venir";
        return (
          <li key={e.cle} data-etat={etat} aria-current={etat === "en-cours" ? "step" : undefined}>
            <span className="numero" aria-hidden="true">
              {etat === "fait" ? "✓" : i + 1}
            </span>
            {e.titre}
            {etat === "fait" && <span className="visuellement-cache">, terminée</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Les règles de tout import, rappelées avant d'écrire, et le bouton qui lance l'import. */
export function AvantImport({ libelle, enCours, desactive, importer }: { libelle: string; enCours: boolean; desactive: boolean; importer: () => void }) {
  return (
    <section className="carte" aria-labelledby="titre-avant-import">
      <h3 id="titre-avant-import">Avant d’importer</h3>
      <ul className="liste-points">
        <li>Rien n’est écrit dans votre cabinet avant que vous cliquiez sur «&nbsp;{libelle}&nbsp;».</li>
        <li>Une sauvegarde de votre cabinet est faite juste avant l’import.</li>
        <li>Le fichier d’origine n’est jamais modifié.</li>
        <li>Un import peut être relancé&nbsp;: ce qui est déjà importé n’est pas recopié.</li>
        <li>Un rapport liste ce qui a été importé et ce qui a été laissé de côté.</li>
      </ul>
      <div className="rangee">
        <button type="button" className="bouton bouton-principal" disabled={enCours || desactive} onClick={importer}>
          {enCours ? "Import en cours…" : libelle}
        </button>
      </div>
      {enCours && (
        <p className="discret" role="status">
          Sauvegarde, puis import&nbsp;: cela peut prendre une minute pour plusieurs milliers de fiches.
        </p>
      )}
    </section>
  );
}

export function LigneRapport({ titre, compteur }: { titre: string; compteur: CompteurImport }) {
  return (
    <tr>
      <th scope="row">{titre}</th>
      <td className="nombre">{nombre(compteur.crees)}</td>
      <td className="nombre">{nombre(compteur.deja)}</td>
      <td className="nombre">{nombre(compteur.ignores)}</td>
    </tr>
  );
}

/** Tableau du rapport : importées, déjà présentes, laissées de côté. */
export function TableauRapport({ children }: { children: ReactNode }) {
  return (
    <div className="defilement-horizontal">
      <table className="tableau">
        <thead>
          <tr>
            <th scope="col">Données</th>
            <th scope="col" className="nombre">
              Importées
            </th>
            <th scope="col" className="nombre">
              Déjà présentes
            </th>
            <th scope="col" className="nombre">
              Laissées de côté
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** « À vérifier », sauvegarde faite avant l'import, rapport écrit, et la suite. */
export function PiedRapport({
  coeur,
  avertissements,
  sauvegarde,
  fichierRapport,
  recommencer,
}: {
  coeur: Coeur;
  avertissements: string[];
  sauvegarde: string;
  fichierRapport: string | null;
  recommencer: () => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <>
      {avertissements.length > 0 && (
        <div className="pile-serree">
          <p>
            <strong>À vérifier</strong>
          </p>
          <ul className="liste-points">
            {avertissements.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="discret">Sauvegarde faite juste avant l’import&nbsp;: {sauvegarde}</p>
      {fichierRapport && <p className="discret">Rapport enregistré dans {fichierRapport}</p>}
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="rangee">
        <a className="bouton bouton-principal" href={adresse("patients")}>
          Voir les patients
        </a>
        {fichierRapport && (
          <button type="button" className="bouton" onClick={() => coeur.ouvrirRapportImport(fichierRapport).catch((e: Error) => setErreur(e.message))}>
            Ouvrir le rapport
          </button>
        )}
        <button type="button" className="bouton" onClick={recommencer}>
          Importer un autre fichier
        </button>
      </div>
    </>
  );
}
