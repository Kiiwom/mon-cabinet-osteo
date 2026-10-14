import { useId, useRef, useState } from "react";

import type { AnalyseTableur, CibleTableur, Coeur, EtatLigneTableur, ResultatImportTableur } from "../lib/coeur";
import { ecrireDateFr } from "../lib/dates";
import { AvantImport, compte, Etapes, LigneRapport, nombre, nomDeFichier, PiedRapport, TableauRapport, type EtapeImport } from "./communs";

/** Les champs de la fiche proposés pour une colonne, dans l'ordre de la fiche. */
export const CIBLES: { valeur: CibleTableur; libelle: string }[] = [
  { valeur: "nom", libelle: "Nom" },
  { valeur: "prenom", libelle: "Prénom" },
  { valeur: "nom_prenom", libelle: "Nom et prénom (une seule colonne)" },
  { valeur: "nom_naissance", libelle: "Nom de naissance" },
  { valeur: "naissance", libelle: "Date de naissance" },
  { valeur: "sexe", libelle: "Sexe" },
  { valeur: "adresse", libelle: "Adresse" },
  { valeur: "complement_adresse", libelle: "Complément d’adresse" },
  { valeur: "code_postal", libelle: "Code postal" },
  { valeur: "ville", libelle: "Ville" },
  { valeur: "pays", libelle: "Pays" },
  { valeur: "telephone", libelle: "Téléphone (portable ou fixe selon le numéro)" },
  { valeur: "portable", libelle: "Portable" },
  { valeur: "fixe", libelle: "Téléphone fixe" },
  { valeur: "email", libelle: "Email" },
  { valeur: "profession", libelle: "Profession" },
  { valeur: "activites", libelle: "Activités, loisirs" },
  { valeur: "medecin_traitant", libelle: "Médecin traitant" },
  { valeur: "notes_importantes", libelle: "Notes importantes (alerte en tête du dossier)" },
  { valeur: "consentement", libelle: "Date du consentement" },
  { valeur: "remarques", libelle: "Remarques de la fiche" },
  { valeur: "ignorer", libelle: "Ne pas importer" },
];

const ETATS: Record<EtatLigneTableur, string> = {
  nouveau: "Nouveau",
  doublon_possible: "Doublon possible",
  deja_importe: "Déjà importé",
  incomplet: "Sans nom ou prénom",
};

/** Ces cibles ne reçoivent qu'une colonne : la choisir pour une autre renvoie la précédente aux remarques. */
const plusieurs = (c: CibleTableur) => c === "remarques" || c === "ignorer" || c === "telephone";

function Colonnes({
  analyse,
  cibles,
  changer,
  enCours,
}: {
  analyse: AnalyseTableur;
  cibles: CibleTableur[];
  changer: (rang: number, cible: CibleTableur) => void;
  enCours: boolean;
}) {
  const id = useId();
  const enRemarques = analyse.colonnes.filter((_, rang) => cibles[rang] === "remarques").map((c) => `« ${c.titre} »`);
  return (
    <section className="carte pile" aria-labelledby={`${id}-titre`}>
      <h3 id={`${id}-titre`}>Colonnes du fichier</h3>
      <p className="discret">
        Chaque colonne est rapprochée d’un champ de la fiche patient d’après son titre&nbsp;; changez-le si besoin. Une colonne sans
        équivalent va dans les remarques de la fiche, sous la forme «&nbsp;Titre&nbsp;: valeur&nbsp;».
      </p>
      <div className="defilement-horizontal">
        <table className="tableau tableau-colonnes">
          <thead>
            <tr>
              <th scope="col">Colonne</th>
              <th scope="col">Exemples</th>
              <th scope="col">Champ de la fiche</th>
            </tr>
          </thead>
          <tbody>
            {analyse.colonnes.map((colonne, rang) => (
              <tr key={rang} data-ignoree={cibles[rang] === "ignorer" || undefined}>
                <th scope="row">{colonne.titre}</th>
                <td className="discret">{colonne.exemples.join(" · ") || "vide"}</td>
                <td>
                  <select
                    aria-label={`Champ de la fiche pour « ${colonne.titre} »`}
                    value={cibles[rang]}
                    disabled={enCours}
                    onChange={(e) => changer(rang, e.target.value as CibleTableur)}
                  >
                    {CIBLES.map((c) => (
                      <option key={c.valeur} value={c.valeur}>
                        {c.libelle}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {enRemarques.length > 0 && (
        <p className="info">
          {enRemarques.join(", ")} {enRemarques.length > 1 ? "iront" : "ira"} dans les remarques de la fiche patient.
        </p>
      )}
    </section>
  );
}

function Verification({
  chemin,
  analyse,
  cibles,
  changer,
  enCours,
  importer,
  changerFichier,
}: {
  chemin: string;
  analyse: AnalyseTableur;
  cibles: CibleTableur[];
  changer: (rang: number, cible: CibleTableur) => void;
  enCours: boolean;
  importer: () => void;
  changerFichier: () => void;
}) {
  const aImporter = analyse.nouveaux + analyse.doublons;
  return (
    <>
      <section className="carte" aria-labelledby="titre-fichier-tableur">
        <div className="import-entete">
          <div>
            <h3 id="titre-fichier-tableur">{nomDeFichier(chemin)}</h3>
            <p className="discret">
              {analyse.format}
              {analyse.feuille && ` · feuille « ${analyse.feuille} »`} · {compte(analyse.lignes, "ligne")} de patients
            </p>
          </div>
          <button type="button" className="bouton" onClick={changerFichier} disabled={enCours}>
            Changer de fichier
          </button>
        </div>
        {analyse.deja_importes > 0 && (
          <p className="succes" role="status">
            {compte(analyse.deja_importes, "patient")} de ce fichier {analyse.deja_importes > 1 ? "sont déjà dans Osteosphere : ils ne seront pas recopiés." : "est déjà dans Osteosphere : il ne sera pas recopié."}
          </p>
        )}
      </section>

      <Colonnes analyse={analyse} cibles={cibles} changer={changer} enCours={enCours} />

      <section className="carte" aria-labelledby="titre-points-tableur">
        <h3 id="titre-points-tableur">Points à vérifier</h3>
        <ul className="points-import">
          {analyse.points.map((p) => (
            <li key={p} data-nature="alerte">
              <span>{p}</span>
            </li>
          ))}
          {analyse.doublons > 0 && (
            <li data-nature="alerte">
              <strong>{compte(analyse.doublons, "doublon possible", "doublons possibles")}</strong>
              <span>
                Même nom, même prénom et même date de naissance qu’un dossier du cabinet ou qu’une autre ligne. Les fiches sont gardées toutes
                les deux&nbsp;: comparez-les après l’import, et fusionnez-les si besoin.
              </span>
            </li>
          )}
          {analyse.incompletes > 0 && (
            <li data-nature="alerte">
              <strong>{compte(analyse.incompletes, "ligne sans nom ou sans prénom", "lignes sans nom ou sans prénom")}</strong>
              <span>{analyse.incompletes > 1 ? "Elles sont laissées de côté et listées" : "Elle est laissée de côté et listée"} dans le rapport.</span>
            </li>
          )}
          <li data-nature="information">
            <strong>Valeurs hors format gardées</strong>
            <span>Un email incomplet, un code postal étranger ou une date illisible va dans les remarques de la fiche, jamais perdu.</span>
          </li>
        </ul>
      </section>

      {analyse.apercu.length > 0 && (
        <section className="carte" aria-labelledby="titre-apercu-tableur">
          <h3 id="titre-apercu-tableur">
            Aperçu · {analyse.apercu.length} premières lignes sur {nombre(analyse.lignes)}
          </h3>
          <div className="defilement-horizontal">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col" className="nombre">
                    Ligne
                  </th>
                  <th scope="col">Patient</th>
                  <th scope="col">Naissance</th>
                  <th scope="col">Ville</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {analyse.apercu.map((p) => (
                  <tr key={p.ligne}>
                    <td className="nombre">{p.ligne}</td>
                    <td>
                      {p.nom} {p.prenom}
                    </td>
                    <td>{ecrireDateFr(p.naissance)}</td>
                    <td>{p.ville}</td>
                    <td>
                      <span className="puce" data-etat-import={p.etat}>
                        {ETATS[p.etat]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AvantImport
        libelle={aImporter > 0 ? `Importer ${compte(aImporter, "patient")}` : "Importer les patients"}
        enCours={enCours}
        desactive={!analyse.importable || aImporter === 0}
        importer={importer}
      />
    </>
  );
}

/** Liste de patients depuis un tableur : fichier, colonnes et vérification sans rien écrire, import, rapport. */
export function ImportTableur({ coeur }: { coeur: Coeur }) {
  const [etape, setEtape] = useState<EtapeImport>("fichier");
  const [chemin, setChemin] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState<AnalyseTableur | null>(null);
  /** La correspondance choisie, à jour tout de suite ; l'analyse suit, la dernière demandée seule compte. */
  const [cibles, setCibles] = useState<CibleTableur[]>([]);
  const demande = useRef(0);
  const [resultat, setResultat] = useState<ResultatImportTableur | null>(null);
  const [lecture, setLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const choisir = async () => {
    setErreur(null);
    try {
      const fichier = await coeur.choisirFichier("tableur");
      if (!fichier) return;
      setLecture(true);
      const lue = await coeur.analyserTableur(fichier);
      setChemin(fichier);
      setAnalyse(lue);
      setCibles(lue.colonnes.map((c) => c.cible));
      setEtape("verification");
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setLecture(false);
    }
  };

  const changer = async (rang: number, cible: CibleTableur) => {
    if (!chemin) return;
    const correspondance = cibles.map((c, i) => (i === rang ? cible : !plusieurs(cible) && c === cible ? "remarques" : c));
    setCibles(correspondance);
    setErreur(null);
    const numero = ++demande.current;
    try {
      const lue = await coeur.analyserTableur(chemin, correspondance);
      if (numero === demande.current) setAnalyse(lue);
    } catch (e) {
      if (numero === demande.current) setErreur((e as Error).message);
    }
  };

  const importer = async () => {
    if (!chemin || !analyse) return;
    setErreur(null);
    setEtape("import");
    try {
      setResultat(await coeur.importerTableur(chemin, cibles));
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
    <div className="pile" aria-label="Import d’un tableur" role="region">
      <div className="import-entete">
        <h2>Importer une liste de patients</h2>
        <Etapes etape={etape} />
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {etape === "fichier" && (
        <section className="carte" aria-labelledby="titre-choix-tableur">
          <h3 id="titre-choix-tableur">Votre tableur</h3>
          <p>
            Une ligne par patient, la première ligne donnant le titre des colonnes&nbsp;: Nom, Prénom, Date de naissance, Téléphone, Ville…
            Fichier <strong>CSV</strong>, classeur <strong>Excel</strong> (.xlsx) ou <strong>LibreOffice</strong> (.ods)&nbsp;; seule la première
            feuille est lue.
          </p>
          <p className="discret">Seules les fiches patients sont reprises&nbsp;: les séances et les factures restent dans le logiciel d’origine.</p>
          <div className="rangee">
            <button type="button" className="bouton bouton-principal" onClick={choisir} disabled={lecture}>
              {lecture ? "Lecture du fichier…" : "Choisir le tableur…"}
            </button>
          </div>
        </section>
      )}
      {(etape === "verification" || etape === "import") && chemin && analyse && (
        <Verification
          chemin={chemin}
          analyse={analyse}
          cibles={cibles}
          changer={changer}
          enCours={etape === "import"}
          importer={importer}
          changerFichier={choisir}
        />
      )}
      {etape === "rapport" && resultat && (
        <section className="carte" aria-labelledby="titre-rapport-tableur">
          <h3 id="titre-rapport-tableur">Import terminé</h3>
          <TableauRapport>
            <LigneRapport titre="Patients" compteur={resultat.rapport.patients} />
          </TableauRapport>
          {resultat.rapport.doublons.length > 0 && (
            <div className="pile-serree">
              <p>
                <strong>{compte(resultat.rapport.doublons.length, "doublon possible", "doublons possibles")}, gardés&nbsp;: à comparer</strong>
              </p>
              <ul className="liste-points">
                {resultat.rapport.doublons.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
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
