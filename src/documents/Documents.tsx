import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { Coeur, PieceJointe, ResumeSeance } from "../lib/coeur";
import { dateCourte } from "../lib/dates";

/** « 2,4 Mo », « 180 ko ». */
export function tailleLisible(octets: number): string {
  if (octets >= 1_000_000) return `${(octets / 1_000_000).toFixed(1).replace(".", ",")} Mo`;
  return `${Math.max(1, Math.round(octets / 1000))} ko`;
}

function dateDe(secondes: number): string {
  const d = new Date(secondes * 1000);
  const deux = (n: number) => String(n).padStart(2, "0");
  return dateCourte(`${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`);
}

const estImage = (d: PieceJointe) => d.type_mime.startsWith("image/") && !["image/heic", "image/tiff"].includes(d.type_mime);
const estPdf = (d: PieceJointe) => d.type_mime === "application/pdf";

function signe(d: PieceJointe): string {
  if (estPdf(d)) return "PDF";
  if (d.type_mime.startsWith("image/")) return "IMG";
  const extension = d.nom.includes(".") ? d.nom.split(".").pop()!.toUpperCase().slice(0, 4) : "DOC";
  return extension;
}

/**
 * Fichiers déposés sur la fenêtre (glisser-déposer du système) : ils sont ajoutés tant que le
 * composant est affiché. Dans un navigateur, sans le cœur, rien n'est déposé.
 */
function useDepotFichiers(surDepot: (chemins: string[]) => void): boolean {
  const [survol, setSurvol] = useState(false);
  const rappel = useRef(surDepot);
  rappel.current = surDepot;
  useEffect(() => {
    if (!isTauri()) return;
    let fin: (() => void) | null = null;
    let actif = true;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((evenement) => {
          const p = evenement.payload;
          if (p.type === "enter" || p.type === "over") setSurvol(true);
          else if (p.type === "leave") setSurvol(false);
          else if (p.type === "drop") {
            setSurvol(false);
            if (p.paths.length) rappel.current(p.paths);
          }
        })
        .then((arreter) => {
          if (actif) fin = arreter;
          else arreter();
        }),
    );
    return () => {
      actif = false;
      fin?.();
    };
  }, []);
  return survol;
}

/** Pages d'un PDF dessinées dans l'application : rien n'est écrit en clair sur le disque. */
function PagesPdf({ octets }: { octets: ArrayBuffer }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let arrete = false;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const travailleur = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = travailleur.default;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(octets.slice(0)) }).promise;
      const nombre = Math.min(pdf.numPages, 30);
      for (let i = 1; i <= nombre && !arrete; i += 1) {
        const page = await pdf.getPage(i);
        const largeur = Math.min(900, (conteneur.current?.clientWidth ?? 800) - 8);
        const echelle = largeur / page.getViewport({ scale: 1 }).width;
        const vue = page.getViewport({ scale: echelle * (window.devicePixelRatio || 1) });
        const canvas = document.createElement("canvas");
        canvas.width = vue.width;
        canvas.height = vue.height;
        canvas.style.width = `${largeur}px`;
        canvas.setAttribute("aria-label", `Page ${i} sur ${pdf.numPages}`);
        await page.render({ canvas, viewport: vue }).promise;
        if (!arrete) conteneur.current?.append(canvas);
      }
      if (pdf.numPages > nombre && !arrete) setErreur(`Les ${nombre} premières pages sont affichées sur ${pdf.numPages} : ouvrez le document pour la suite.`);
    })().catch(() => !arrete && setErreur("Ce PDF ne s’affiche pas ici : ouvrez-le dans une autre application."));
    return () => {
      arrete = true;
    };
  }, [octets]);
  return (
    <div className="pages-pdf" ref={conteneur}>
      {erreur && <p className="discret">{erreur}</p>}
    </div>
  );
}

function Apercu({ coeur, document: doc, fermer, ouvrir }: { coeur: Coeur; document: PieceJointe; fermer: () => void; ouvrir: () => void }) {
  const id = useId();
  const [octets, setOctets] = useState<ArrayBuffer | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const fermeture = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fermeture.current?.focus();
    let lien: string | null = null;
    coeur.contenuDocument(doc.id).then(
      (contenu) => {
        setOctets(contenu);
        if (estImage(doc)) {
          lien = URL.createObjectURL(new Blob([contenu], { type: doc.type_mime }));
          setUrl(lien);
        }
      },
      (e: Error) => setErreur(e.message),
    );
    return () => {
      if (lien) URL.revokeObjectURL(lien);
    };
  }, [coeur, doc]);

  return (
    <div className="voile" role="presentation" onClick={fermer} onKeyDown={(e) => e.key === "Escape" && fermer()}>
      <section
        className="carte apercu-document"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titre`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="entete-carte">
          <h2 id={`${id}-titre`}>{doc.nom}</h2>
          <span className="rangee">
            {isTauri() && (
              <button type="button" className="bouton bouton-petit" onClick={ouvrir}>
                Ouvrir dans une autre application
              </button>
            )}
            <button type="button" className="bouton bouton-petit" ref={fermeture} onClick={fermer}>
              Fermer
            </button>
          </span>
        </div>
        {erreur && (
          <p className="alerte" role="alert">
            {erreur}
          </p>
        )}
        {!octets && !erreur && <p className="discret">Ouverture…</p>}
        {url && <img className="image-document" src={url} alt={doc.nom} />}
        {octets && estPdf(doc) && <PagesPdf octets={octets} />}
        {octets && !estImage(doc) && !estPdf(doc) && (
          <p className="discret">Pas d’aperçu pour ce type de fichier : ouvrez-le dans l’application prévue pour lui.</p>
        )}
      </section>
    </div>
  );
}

function LigneDocument({
  coeur,
  document: doc,
  seances,
  avecSeance,
  changer,
  supprimer,
  apercu,
  ouvrir,
  copier,
}: {
  coeur: Coeur;
  document: PieceJointe;
  seances: ResumeSeance[];
  avecSeance: boolean;
  changer: (d: PieceJointe) => void;
  supprimer: () => void;
  apercu: () => void;
  ouvrir: () => void;
  copier: () => void;
}) {
  const id = useId();
  const [renommer, setRenommer] = useState(false);
  const [nom, setNom] = useState(doc.nom);
  const [miniature, setMiniature] = useState<string | null>(null);

  useEffect(() => {
    if (!estImage(doc)) return;
    let lien: string | null = null;
    coeur.contenuDocument(doc.id).then(
      (contenu) => {
        lien = URL.createObjectURL(new Blob([contenu], { type: doc.type_mime }));
        setMiniature(lien);
      },
      () => undefined,
    );
    return () => {
      if (lien) URL.revokeObjectURL(lien);
    };
  }, [coeur, doc.id, doc.type_mime]);

  const seance = seances.find((s) => s.id === doc.seance_id);
  return (
    <li className="ligne-document">
      <button type="button" className="vignette-document" onClick={apercu} aria-label={`Aperçu de ${doc.nom}`}>
        {miniature ? <img src={miniature} alt="" /> : <span aria-hidden="true">{signe(doc)}</span>}
      </button>
      <span className="pile-serree texte-document">
        {renommer ? (
          <form
            className="rangee"
            onSubmit={(e) => {
              e.preventDefault();
              coeur.modifierDocument(doc.id, nom, doc.seance_id).then(changer, () => undefined);
              setRenommer(false);
            }}
          >
            <label htmlFor={`${id}-nom`} className="visuellement-cache">
              Nouveau nom
            </label>
            <input id={`${id}-nom`} value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
            <button type="submit" className="bouton bouton-petit">
              Renommer
            </button>
          </form>
        ) : (
          <button type="button" className="lien-bouton nom-document" onClick={apercu}>
            {doc.nom}
          </button>
        )}
        <span className="discret">
          {tailleLisible(doc.taille)} · ajouté le {dateDe(doc.ajoute_le)}
          {!avecSeance && seance && ` · séance du ${dateCourte(seance.debut.slice(0, 10))}`}
        </span>
        {avecSeance && (
          <span className="rangee rattachement">
            <label htmlFor={`${id}-seance`} className="discret">
              Rattaché à
            </label>
            <select
              id={`${id}-seance`}
              value={doc.seance_id ?? ""}
              onChange={(e) => coeur.modifierDocument(doc.id, doc.nom, e.target.value || null).then(changer, () => undefined)}
            >
              <option value="">tout le dossier</option>
              {seances.map((s) => (
                <option key={s.id} value={s.id}>
                  la séance du {dateCourte(s.debut.slice(0, 10))}
                </option>
              ))}
            </select>
          </span>
        )}
      </span>
      <span className="rangee actions-document">
        {isTauri() && (
          <button type="button" className="bouton bouton-petit" onClick={ouvrir}>
            Ouvrir
          </button>
        )}
        <button type="button" className="bouton bouton-petit" onClick={copier} aria-label={`Enregistrer une copie de ${doc.nom}`}>
          Copie…
        </button>
        <button type="button" className="bouton bouton-petit" onClick={() => setRenommer((v) => !v)} aria-label={`Renommer ${doc.nom}`}>
          Renommer
        </button>
        <button type="button" className="bouton bouton-petit bouton-discret" onClick={supprimer} aria-label={`Mettre ${doc.nom} à la corbeille`}>
          Supprimer
        </button>
      </span>
    </li>
  );
}

/**
 * Pièces jointes d'un dossier, ou d'une seule séance (`seanceId`) : dépôt de fichiers, liste,
 * aperçu des images et des PDF, rattachement à une séance, corbeille de 30 jours.
 */
export function Documents({
  coeur,
  patientId,
  seanceId = null,
  seances = [],
  titre = "Documents",
}: {
  coeur: Coeur;
  patientId: string;
  seanceId?: string | null;
  seances?: ResumeSeance[];
  titre?: string;
}) {
  const id = useId();
  const [documents, setDocuments] = useState<PieceJointe[] | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [message, setMessage] = useState<{ texte: string; annuler?: () => void } | null>(null);
  const [apercu, setApercu] = useState<PieceJointe | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    coeur.listerDocuments(patientId).then(
      (tous) => setDocuments(seanceId ? tous.filter((d) => d.seance_id === seanceId) : tous),
      (e: Error) => setErreurs([e.message]),
    );
  }, [coeur, patientId, seanceId]);
  useEffect(charger, [charger]);

  const ajouter = useCallback(
    async (chemins: string[]) => {
      if (!chemins.length) return;
      setEnvoi(true);
      setErreurs([]);
      setMessage(null);
      try {
        const ajout = await coeur.ajouterDocuments(patientId, seanceId, chemins);
        setErreurs(ajout.erreurs);
        if (ajout.ajoutes.length) setMessage({ texte: `${ajout.ajoutes.length} document${ajout.ajoutes.length > 1 ? "s" : ""} ajouté${ajout.ajoutes.length > 1 ? "s" : ""}.` });
        charger();
      } catch (e) {
        setErreurs([(e as Error).message]);
      } finally {
        setEnvoi(false);
      }
    },
    [coeur, patientId, seanceId, charger],
  );
  const survol = useDepotFichiers((chemins) => void ajouter(chemins));

  const agir = (action: Promise<unknown>) => action.catch((e: Error) => setErreurs([e.message]));

  return (
    <section className="carte documents" aria-labelledby={`${id}-titre`} data-survol={survol || undefined}>
      <div className="entete-carte">
        <h2 id={`${id}-titre`}>
          {titre}
          {documents && documents.length > 0 && <span className="compte-onglet"> {documents.length}</span>}
        </h2>
        <button type="button" className="bouton bouton-petit" disabled={envoi} onClick={() => void coeur.choisirDocuments().then(ajouter, (e: Error) => setErreurs([e.message]))}>
          {envoi ? "Ajout…" : "Ajouter des documents…"}
        </button>
      </div>
      <p className="zone-depot" aria-hidden={!survol}>
        {survol
          ? "Déposez les fichiers pour les ajouter"
          : `Glissez ici des PDF, images ou documents${seanceId ? " pour cette séance" : ""} ; ils sont chiffrés avec le dossier.`}
      </p>
      {erreurs.map((e) => (
        <p key={e} className="alerte" role="alert">
          {e}
        </p>
      ))}
      {message && (
        <p className="succes" role="status">
          {message.texte}{" "}
          {message.annuler && (
            <button type="button" className="lien-bouton" onClick={message.annuler}>
              Annuler
            </button>
          )}
        </p>
      )}
      {documents === null ? (
        <p className="discret">Chargement…</p>
      ) : documents.length === 0 ? (
        <p className="discret">Aucun document pour l’instant.</p>
      ) : (
        <ul className="liste-documents">
          {documents.map((d) => (
            <LigneDocument
              key={d.id}
              coeur={coeur}
              document={d}
              seances={seances}
              avecSeance={!seanceId}
              changer={(nouveau) => setDocuments((liste) => liste?.map((x) => (x.id === nouveau.id ? nouveau : x)) ?? null)}
              apercu={() => setApercu(d)}
              ouvrir={() => void agir(coeur.ouvrirDocument(d.id))}
              copier={() =>
                void agir(
                  coeur.enregistrerCopieDocument(d.id).then((chemin) => chemin && setMessage({ texte: `Copie enregistrée : ${chemin}` })),
                )
              }
              supprimer={() =>
                void agir(
                  coeur.supprimerDocument(d.id).then(() => {
                    charger();
                    setMessage({
                      texte: `« ${d.nom} » est à la corbeille pour 30 jours.`,
                      annuler: () => void agir(coeur.restaurerDocument(d.id).then(() => (setMessage(null), charger()))),
                    });
                  }),
                )
              }
            />
          ))}
        </ul>
      )}
      {apercu && <Apercu coeur={coeur} document={apercu} fermer={() => setApercu(null)} ouvrir={() => void agir(coeur.ouvrirDocument(apercu.id))} />}
    </section>
  );
}
