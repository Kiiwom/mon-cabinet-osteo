import { useState } from "react";

import type { AnalyseLibreOsteo, ChoixLibreOsteo, Coeur, ResultatImportLibreOsteo } from "../lib/coeur";
import { dateCourte, ecrireDateFr } from "../lib/dates";
import { AvantImport, CaseContenu, compte, Etapes, LigneRapport, nombre, nomDeFichier, PiedRapport, TableauRapport, type EtapeImport } from "./communs";

const TOUT: ChoixLibreOsteo = { patients: true, seances: true, documents: true };

function Verification({
  chemin,
  analyse,
  choix,
  setChoix,
  enCours,
  importer,
  changer,
}: {
  chemin: string;
  analyse: AnalyseLibreOsteo;
  choix: ChoixLibreOsteo;
  setChoix: (c: ChoixLibreOsteo) => void;
  enCours: boolean;
  importer: () => void;
  changer: () => void;
}) {
  const basculer = (cle: keyof ChoixLibreOsteo) => setChoix({ ...choix, [cle]: !choix[cle] });
  const rien = !choix.patients && !choix.seances && !choix.documents;
  const periode =
    analyse.premiere_seance && analyse.derniere_seance
      ? `séances du ${dateCourte(analyse.premiere_seance)} au ${dateCourte(analyse.derniere_seance)}`
      : "aucune séance datée";
  return (
    <>
      <section className="carte" aria-labelledby="titre-fichier-libreosteo">
        <div className="import-entete">
          <div>
            <h3 id="titre-fichier-libreosteo">{nomDeFichier(chemin)}</h3>
            <p className="discret">
              Sauvegarde LibreOsteo{analyse.version && ` ${analyse.version}`} · {periode}
            </p>
          </div>
          <button type="button" className="bouton" onClick={changer} disabled={enCours}>
            Changer de fichier
          </button>
        </div>
        {analyse.deja_importes > 0 && (
          <p className="succes" role="status">
            {nombre(analyse.deja_importes)} élément(s) de cette sauvegarde sont déjà dans Osteosphere&nbsp;: ils ne seront pas recopiés.
          </p>
        )}
        <fieldset className="groupe">
          <legend>Contenu reconnu · cochez ce que vous importez</legend>
          <div className="choix-cartes">
            <CaseContenu coche={choix.patients} basculer={() => basculer("patients")} titre={compte(analyse.patients, "patient")}>
              Identité, coordonnées, médecin traitant, note importante, antécédents et enfants.
            </CaseContenu>
            <CaseContenu coche={choix.seances} basculer={() => basculer("seances")} titre={compte(analyse.seances, "séance")}>
              Motif, sphères, diagnostic, traitements, conclusion et commentaires, dans le modèle « Reprise LibreOsteo ».
            </CaseContenu>
            <CaseContenu coche={choix.documents} basculer={() => basculer("documents")} titre={compte(analyse.documents, "document")}>
              Joints aux dossiers, chiffrés avec eux.
            </CaseContenu>
          </div>
          {!choix.patients && (choix.seances || choix.documents) && (
            <p className="discret">Sans les patients, séances et documents ne sont repris que pour les patients déjà importés lors d’un import précédent.</p>
          )}
        </fieldset>
      </section>

      <section className="carte" aria-labelledby="titre-points-libreosteo">
        <h3 id="titre-points-libreosteo">Points à vérifier</h3>
        <ul className="points-import">
          {analyse.doublons.length > 0 && (
            <li data-nature="alerte">
              <strong>{analyse.doublons.length} fiche(s) en double possible</strong>
              <span>Même nom, même prénom et même date de naissance. Les fiches sont gardées&nbsp;: comparez-les après l’import.</span>
              <span className="discret">{analyse.doublons.join(" · ")}</span>
            </li>
          )}
          {analyse.points.map((p) => (
            <li key={p} data-nature="alerte">
              <span>{p}</span>
            </li>
          ))}
          <li data-nature="information">
            <strong>{analyse.champs.length} champs de séance repris</strong>
            <span>Dans un modèle «&nbsp;Reprise LibreOsteo&nbsp;», réservé aux séances importées&nbsp;: {analyse.champs.join(", ")}.</span>
          </li>
          <li data-nature="information">
            <strong>Antécédents en texte</strong>
            <span>Les antécédents médicaux, chirurgicaux, traumatiques et familiaux, saisis en texte libre dans LibreOsteo, vont dans les remarques sur les antécédents.</span>
          </li>
          <li data-nature="information">
            <strong>Séances importées, jamais proposées à facturer</strong>
            <span>Leur facturation a eu lieu dans LibreOsteo.</span>
          </li>
        </ul>
      </section>

      {analyse.apercu.length > 0 && (
        <section className="carte" aria-labelledby="titre-apercu-libreosteo">
          <h3 id="titre-apercu-libreosteo">
            Aperçu · {analyse.apercu.length} patients sur {nombre(analyse.patients)}
          </h3>
          <div className="defilement-horizontal">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Naissance</th>
                  <th scope="col">Ville</th>
                  <th scope="col" className="nombre">
                    Séances
                  </th>
                </tr>
              </thead>
              <tbody>
                {analyse.apercu.map((p, i) => (
                  <tr key={`${p.nom}-${p.prenom}-${i}`}>
                    <td>
                      {p.nom} {p.prenom}
                    </td>
                    <td>{ecrireDateFr(p.naissance)}</td>
                    <td>{p.ville}</td>
                    <td className="nombre">{p.seances}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AvantImport libelle="Importer les données" enCours={enCours} desactive={rien} importer={importer} />
    </>
  );
}

/** Reprise des données de LibreOsteo : sauvegarde, vérification sans rien écrire, import, rapport. */
export function ImportLibreOsteo({ coeur }: { coeur: Coeur }) {
  const [etape, setEtape] = useState<EtapeImport>("fichier");
  const [chemin, setChemin] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState<AnalyseLibreOsteo | null>(null);
  const [choix, setChoix] = useState<ChoixLibreOsteo>(TOUT);
  const [resultat, setResultat] = useState<ResultatImportLibreOsteo | null>(null);
  const [lecture, setLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const choisir = async () => {
    setErreur(null);
    try {
      const fichier = await coeur.choisirFichier("libreosteo");
      if (!fichier) return;
      setLecture(true);
      const lue = await coeur.analyserLibreOsteo(fichier);
      setChemin(fichier);
      setAnalyse(lue);
      setChoix(TOUT);
      setEtape("verification");
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setLecture(false);
    }
  };

  const importer = async () => {
    if (!chemin) return;
    setErreur(null);
    setEtape("import");
    try {
      setResultat(await coeur.importerLibreOsteo(chemin, choix));
      setEtape("rapport");
    } catch (e) {
      setErreur(`L’import n’a pas abouti, rien n’a été enregistré : ${(e as Error).message}`);
      setEtape("verification");
    }
  };

  const recommencer = () => {
    setEtape("fichier");
    setChemin(null);
    setAnalyse(null);
    setResultat(null);
    setErreur(null);
  };

  return (
    <div className="pile" aria-label="Import depuis LibreOsteo" role="region">
      <div className="import-entete">
        <h2>Importer depuis LibreOsteo</h2>
        <Etapes etape={etape} />
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {etape === "fichier" && (
        <section className="carte" aria-labelledby="titre-choix-libreosteo">
          <h3 id="titre-choix-libreosteo">La sauvegarde de LibreOsteo</h3>
          <p>
            Dans LibreOsteo, ouvrez <strong>Import/export</strong>, onglet «&nbsp;Archiver la base de données&nbsp;», puis «&nbsp;obtenir
            l’archive&nbsp;»&nbsp;: vous recevez un fichier qui contient toute la base et les documents joints. Choisissez-le ici tel quel.
          </p>
          <p className="discret">
            Patients, séances et documents joints sont repris. Les factures restent dans LibreOsteo&nbsp;: gardez sa sauvegarde, les pièces
            comptables se conservent dix ans.
          </p>
          <div className="rangee">
            <button type="button" className="bouton bouton-principal" onClick={choisir} disabled={lecture}>
              {lecture ? "Lecture de la sauvegarde…" : "Choisir la sauvegarde…"}
            </button>
          </div>
        </section>
      )}
      {(etape === "verification" || etape === "import") && chemin && analyse && (
        <Verification chemin={chemin} analyse={analyse} choix={choix} setChoix={setChoix} enCours={etape === "import"} importer={importer} changer={choisir} />
      )}
      {etape === "rapport" && resultat && (
        <section className="carte" aria-labelledby="titre-rapport-libreosteo">
          <h3 id="titre-rapport-libreosteo">Import terminé</h3>
          <TableauRapport>
            <LigneRapport titre="Patients" compteur={resultat.rapport.patients} />
            <LigneRapport titre="Séances" compteur={resultat.rapport.seances} />
            <LigneRapport titre="Documents" compteur={resultat.rapport.documents} />
          </TableauRapport>
          {resultat.rapport.modele && <p>Les champs des séances importées sont dans le modèle «&nbsp;{resultat.rapport.modele}&nbsp;».</p>}
          {resultat.rapport.doublons.length > 0 && (
            <p>
              <strong>Doublons possibles, gardés&nbsp;:</strong> {resultat.rapport.doublons.join(", ")}.
            </p>
          )}
          <PiedRapport
            coeur={coeur}
            avertissements={resultat.rapport.avertissements}
            sauvegarde={resultat.sauvegarde}
            fichierRapport={resultat.fichier_rapport}
            recommencer={recommencer}
          />
        </section>
      )}
    </div>
  );
}
