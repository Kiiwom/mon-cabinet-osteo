import { useEffect, useId, useState } from "react";

import { lireInfosApplication, type InfosApplication } from "../lib/application";
import type { Coeur, ReponseMiseAJour } from "../lib/coeur";
import { ecrireDateFr } from "../lib/dates";
import { adresse } from "../lib/navigation";
import { toutEnregistrer } from "../lib/verrouillage";

/**
 * Paramètres › Version et mises à jour. La recherche se fait seulement au clic : sans lui, Osteosphere
 * ne se connecte jamais à internet.
 */
export function PageParametresMisesAJour({ coeur }: { coeur: Coeur }) {
  const id = useId();
  const [infos, setInfos] = useState<InfosApplication | null>(null);
  const [reponse, setReponse] = useState<ReponseMiseAJour | null>(null);
  const [enCours, setEnCours] = useState<"recherche" | "installation" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurInstallation, setErreurInstallation] = useState<string | null>(null);

  useEffect(() => {
    lireInfosApplication().then(setInfos, () => setInfos(null));
  }, []);

  const rechercher = async () => {
    setErreur(null);
    setErreurInstallation(null);
    setReponse(null);
    setEnCours("recherche");
    try {
      setReponse(await coeur.rechercherMiseAJour());
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnCours(null);
    }
  };

  const installer = async () => {
    setErreurInstallation(null);
    setEnCours("installation");
    try {
      // La séance ouverte dans un autre écran est enregistrée avant la sauvegarde.
      await toutEnregistrer();
      await coeur.installerMiseAJour();
    } catch (e) {
      setErreurInstallation((e as Error).message);
      setEnCours(null);
    }
  };

  const linux = infos?.systeme === "linux";
  return (
    <main className="page">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> Version et mises à jour
      </nav>
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Version et mises à jour</h1>
          <p className="page-sous-titre">{infos ? `Osteosphere ${infos.version}, logiciel libre sous licence GPL-3.0` : "Osteosphere"}</p>
        </div>
      </div>

      <section className="carte pile" aria-labelledby={`${id}-recherche`}>
        <h2 id={`${id}-recherche`}>Rechercher une mise à jour</h2>
        <p>
          Osteosphere ne se connecte à internet que lorsque vous cliquez sur ce bouton&nbsp;: il consulte la page des versions publiées, sans rien envoyer de
          vos données.
        </p>
        <div className="rangee">
          <button type="button" className="bouton" onClick={() => void rechercher()} disabled={enCours !== null}>
            {enCours === "recherche" ? "Recherche…" : "Rechercher une mise à jour"}
          </button>
        </div>
        {erreur && (
          <p className="alerte" role="alert">
            {erreur}
          </p>
        )}
        {reponse?.etat === "a_jour" && (
          <p className="succes" role="status">
            Vous avez la dernière version, {reponse.version}.
          </p>
        )}
      </section>

      {reponse?.etat === "disponible" && (
        <section className="carte pile" aria-labelledby={`${id}-disponible`}>
          <h2 id={`${id}-disponible`}>La version {reponse.version} est disponible</h2>
          <p className="discret">
            Vous avez la version {reponse.version_actuelle}
            {reponse.date && ` · publiée le ${ecrireDateFr(reponse.date)}`}.
          </p>
          {reponse.notes && <p className="notes-version">{reponse.notes}</p>}
          <ul className="liste-points">
            <li>La saisie en cours est enregistrée, puis une sauvegarde complète est faite avant l’installation.</li>
            <li>Vos patients, séances et factures restent sur cet ordinateur&nbsp;: la mise à jour ne remplace que le logiciel.</li>
            <li>Seule une version signée par Osteosphere est installée&nbsp;; un fichier modifié en route est refusé.</li>
            <li>
              {linux
                ? "Linux vous demandera le mot de passe administrateur de l’ordinateur, puis Osteosphere redémarrera."
                : "Osteosphere se ferme pendant l’installation, puis se rouvre."}
            </li>
          </ul>
          {erreurInstallation && (
            <p className="alerte" role="alert">
              {erreurInstallation}
            </p>
          )}
          <div className="rangee">
            <button type="button" className="bouton bouton-principal" onClick={() => void installer()} disabled={enCours !== null}>
              {enCours === "installation" ? "Sauvegarde, téléchargement et vérification…" : `Installer la version ${reponse.version}`}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
