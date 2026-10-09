import { useState } from "react";

import type { AnalyseImport, ChoixImport, Coeur, ResultatImport } from "../lib/coeur";
import { dateCourte, ecrireDateFr } from "../lib/dates";
import { AvantImport, CaseContenu, compte, Etapes, LigneRapport, nombre, nomDeFichier, PiedRapport, TableauRapport, type EtapeImport } from "./communs";

const TOUT: ChoixImport = { patients: true, antecedents: true, seances: true, factures: true };

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
  analyse: AnalyseImport;
  choix: ChoixImport;
  setChoix: (c: ChoixImport) => void;
  enCours: boolean;
  importer: () => void;
  changer: () => void;
}) {
  const basculer = (cle: keyof ChoixImport) => setChoix({ ...choix, [cle]: !choix[cle] });
  const rien = !choix.patients && !choix.antecedents && !choix.seances && !choix.factures;
  const periode =
    analyse.premiere_seance && analyse.derniere_seance
      ? `du ${dateCourte(analyse.premiere_seance)} au ${dateCourte(analyse.derniere_seance)}`
      : "aucune séance datée";
  return (
    <>
      <section className="carte" aria-labelledby="titre-fichier-import">
        <div className="import-entete">
          <div>
            <h3 id="titre-fichier-import">{nomDeFichier(chemin)}</h3>
            <p className="discret">Export MonCabinetLibéral · données {periode}</p>
          </div>
          <button type="button" className="bouton" onClick={changer} disabled={enCours}>
            Changer de fichier
          </button>
        </div>
        {analyse.deja_importes > 0 && (
          <p className="succes" role="status">
            {nombre(analyse.deja_importes)} élément(s) de cette archive sont déjà dans Osteosphere : ils ne seront pas recopiés.
          </p>
        )}
        <fieldset className="groupe">
          <legend>Contenu reconnu · cochez ce que vous importez</legend>
          <div className="choix-cartes">
            <CaseContenu coche={choix.patients} basculer={() => basculer("patients")} titre={compte(analyse.patients, "patient")}>
              {compte(analyse.patients_actifs, "actif")}, {compte(analyse.patients_archives, "archivé")}.
            </CaseContenu>
            <CaseContenu coche={choix.antecedents} basculer={() => basculer("antecedents")} titre={compte(analyse.antecedents, "antécédent")}>
              Rangés par catégorie, avec leurs dates.
            </CaseContenu>
            <CaseContenu coche={choix.seances} basculer={() => basculer("seances")} titre={compte(analyse.seances, "séance")}>
              Tous les champs saisis, dans le modèle « Reprise MonCabinetLibéral ».
            </CaseContenu>
            <CaseContenu
              coche={choix.factures}
              basculer={() => basculer("factures")}
              titre={`${compte(analyse.factures, "facture")}, ${compte(analyse.avoirs, "avoir")}`}
            >
              Avec {analyse.reglements > 1 ? "leurs" : "leur"} {compte(analyse.reglements, "règlement")} et leur numéro d’origine.
            </CaseContenu>
          </div>
          {(!choix.patients && (choix.antecedents || choix.seances)) && (
            <p className="discret">
              Sans les patients, antécédents et séances ne sont repris que pour les patients déjà importés lors d’un import précédent.
            </p>
          )}
        </fieldset>
      </section>

      <section className="carte" aria-labelledby="titre-points-import">
        <h3 id="titre-points-import">Points à vérifier</h3>
        <ul className="points-import">
          {analyse.doublons.length > 0 && (
            <li data-nature="alerte">
              <strong>
                {analyse.doublons.length} fiche(s) en double possible
              </strong>
              <span>Même nom et même date de naissance. Les fiches sont gardées toutes les deux&nbsp;: comparez-les après l’import.</span>
              <span className="discret">{analyse.doublons.join(" · ")}</span>
            </li>
          )}
          {analyse.points.map((p) => (
            <li key={p} data-nature="alerte">
              <span>{p}</span>
            </li>
          ))}
          {analyse.numerotation && (
            <li data-nature="information">
              <strong>Numéros de facture conservés</strong>
              <span>{analyse.numerotation}</span>
            </li>
          )}
          {analyse.champs.length > 0 && (
            <li data-nature="information">
              <strong>{analyse.champs.length} champs de séance repris</strong>
              <span>
                Dans un modèle « Reprise MonCabinetLibéral », réservé aux séances importées&nbsp;: {analyse.champs.join(", ")}.
              </span>
            </li>
          )}
          <li data-nature="information">
            <strong>Séances importées, déjà facturées</strong>
            <span>Elles ne sont pas proposées à la facturation&nbsp;: leurs factures sont reprises à part, avec leurs règlements.</span>
          </li>
        </ul>
      </section>

      {analyse.apercu.length > 0 && (
        <section className="carte" aria-labelledby="titre-apercu-import">
          <h3 id="titre-apercu-import">
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

function Rapport({ coeur, resultat, recommencer }: { coeur: Coeur; resultat: ResultatImport; recommencer: () => void }) {
  const { rapport } = resultat;
  return (
    <section className="carte" aria-labelledby="titre-rapport-import">
      <h3 id="titre-rapport-import">Import terminé</h3>
      <TableauRapport>
        <LigneRapport titre="Patients" compteur={rapport.patients} />
        <LigneRapport titre="Antécédents" compteur={rapport.antecedents} />
        <LigneRapport titre="Séances" compteur={rapport.seances} />
        <LigneRapport titre="Factures et avoirs" compteur={rapport.factures} />
        <LigneRapport titre="Règlements" compteur={rapport.reglements} />
      </TableauRapport>
      {rapport.modele && <p>Les champs des séances importées sont dans le modèle «&nbsp;{rapport.modele}&nbsp;».</p>}
      <PiedRapport coeur={coeur} avertissements={rapport.avertissements} sauvegarde={resultat.sauvegarde} fichierRapport={resultat.fichier_rapport} recommencer={recommencer} />
    </section>
  );
}

/** Reprise des données de MonCabinetLibéral : fichier, vérification sans rien écrire, import, rapport. */
export function ImportMcl({ coeur }: { coeur: Coeur }) {
  const [etape, setEtape] = useState<EtapeImport>("fichier");
  const [chemin, setChemin] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState<AnalyseImport | null>(null);
  const [choix, setChoix] = useState<ChoixImport>(TOUT);
  const [resultat, setResultat] = useState<ResultatImport | null>(null);
  const [lecture, setLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const choisir = async () => {
    setErreur(null);
    try {
      const fichier = await coeur.choisirFichier("import");
      if (!fichier) return;
      setLecture(true);
      const lue = await coeur.analyserImport(fichier);
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
      setResultat(await coeur.importerMcl(chemin, choix));
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
    <div className="pile" aria-label="Import depuis MonCabinetLibéral" role="region">
      <div className="import-entete">
        <h2>Importer depuis MonCabinetLibéral</h2>
        <Etapes etape={etape} />
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {etape === "fichier" && (
        <section className="carte" aria-labelledby="titre-choix-import">
          <h3 id="titre-choix-import">L’export de MonCabinetLibéral</h3>
          <p>
            Demandez à MonCabinetLibéral l’export complet de vos données&nbsp;: vous recevez une archive <strong>.zip</strong> de fichiers
            CSV. Choisissez-la ici telle quelle, sans la décompresser.
          </p>
          <p className="discret">
            Patients, antécédents, séances avec tous leurs champs, factures, avoirs et règlements sont repris. L’agenda et les pièces
            jointes ne font pas partie de cet import.
          </p>
          <div className="rangee">
            <button type="button" className="bouton bouton-principal" onClick={choisir} disabled={lecture}>
              {lecture ? "Lecture de l’archive…" : "Choisir l’export…"}
            </button>
          </div>
        </section>
      )}
      {(etape === "verification" || etape === "import") && chemin && analyse && (
        <Verification
          chemin={chemin}
          analyse={analyse}
          choix={choix}
          setChoix={setChoix}
          enCours={etape === "import"}
          importer={importer}
          changer={choisir}
        />
      )}
      {etape === "rapport" && resultat && <Rapport coeur={coeur} resultat={resultat} recommencer={recommencer} />}
    </div>
  );
}
