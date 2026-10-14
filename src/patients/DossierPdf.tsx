import { useEffect, useId, useRef, useState } from "react";

import { PagesApercu } from "../facturation/composants";
import type { Coeur, Patient, ResumeSeance, RubriquesDossier } from "../lib/coeur";
import { dateCourte } from "../lib/dates";

const RUBRIQUES: { cle: Exclude<keyof RubriquesDossier, "seances">; libelle: string }[] = [
  { cle: "identite", libelle: "Identité et coordonnées" },
  { cle: "profil", libelle: "Profil et suivi" },
  { cle: "notes_importantes", libelle: "Notes importantes" },
  { cle: "antecedents", libelle: "Antécédents" },
  { cle: "remarques", libelle: "Remarques générales" },
  { cle: "proches", libelle: "Proches" },
  { cle: "documents", libelle: "Liste des documents" },
  { cle: "factures", libelle: "Liste des factures" },
];

/**
 * Le dossier en PDF, pour une demande d'accès du patient : rubriques et séances choisies, aperçu,
 * puis PDF rangé dans Documents › Osteosphere › Dossiers ou ouvert pour l'imprimer.
 */
export function FenetreDossierPdf({ coeur, patient, seances, fermer }: { coeur: Coeur; patient: Patient; seances: ResumeSeance[]; fermer: () => void }) {
  const id = useId();
  const visibles = seances.filter((s) => s.supprimee_le === null);
  const [rubriques, setRubriques] = useState<RubriquesDossier>(() => ({
    identite: true,
    profil: true,
    notes_importantes: true,
    antecedents: true,
    remarques: true,
    proches: true,
    documents: true,
    factures: true,
    seances: visibles.map((s) => s.id),
  }));
  const [pages, setPages] = useState<string[] | null>(null);
  const [erreurApercu, setErreurApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const fermeture = useRef<HTMLButtonElement>(null);

  useEffect(() => fermeture.current?.focus(), []);

  const rien = !RUBRIQUES.some((r) => rubriques[r.cle]) && rubriques.seances.length === 0;

  // L'aperçu suit le choix, après un court délai.
  useEffect(() => {
    if (rien) return;
    let actif = true;
    const minuterie = setTimeout(() => {
      coeur.apercuDossierPdf(patient.id, rubriques).then(
        (p) => actif && (setPages(p), setErreurApercu(null)),
        (e: Error) => actif && setErreurApercu(e.message),
      );
    }, 300);
    return () => {
      actif = false;
      clearTimeout(minuterie);
    };
  }, [coeur, patient.id, rubriques, rien]);

  async function enregistrer(ouvrir: boolean) {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      const chemin = await coeur.enregistrerDossierPdf(patient.id, rubriques, ouvrir);
      setMessage(`Dossier enregistré : ${chemin}`);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  const choisirSeance = (seanceId: string, choisie: boolean) =>
    setRubriques((r) => ({ ...r, seances: visibles.map((s) => s.id).filter((x) => (x === seanceId ? choisie : r.seances.includes(x))) }));

  return (
    <div className="voile" role="presentation" onClick={fermer} onKeyDown={(e) => e.key === "Escape" && fermer()}>
      <section className="carte compte-rendu" role="dialog" aria-modal="true" aria-labelledby={`${id}-titre`} onClick={(e) => e.stopPropagation()}>
        <div className="entete-carte">
          <h2 id={`${id}-titre`}>Dossier PDF de {patient.prenom} {patient.nom}</h2>
          <button type="button" className="bouton bouton-petit" ref={fermeture} onClick={fermer}>
            Fermer
          </button>
        </div>
        <div className="compte-rendu-colonnes">
          <div className="pile">
            <p className="discret">Pour répondre à une demande d’accès du patient à son dossier.</p>
            <fieldset className="groupe">
              <legend>Rubriques</legend>
              <div className="choix-liste">
                {RUBRIQUES.map((r) => (
                  <label key={r.cle} className="case-simple">
                    <input type="checkbox" checked={rubriques[r.cle]} onChange={(e) => setRubriques({ ...rubriques, [r.cle]: e.target.checked })} />
                    {r.libelle}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="groupe">
              <legend>Séances</legend>
              {visibles.length === 0 ? (
                <p className="discret">Aucune séance.</p>
              ) : (
                <>
                  <div className="rangee">
                    <button type="button" className="lien-bouton" onClick={() => setRubriques({ ...rubriques, seances: visibles.map((s) => s.id) })}>
                      Toutes
                    </button>
                    <button type="button" className="lien-bouton" onClick={() => setRubriques({ ...rubriques, seances: [] })}>
                      Aucune
                    </button>
                    <span className="discret">
                      {rubriques.seances.length} sur {visibles.length}
                    </span>
                  </div>
                  <div className="choix-liste choix-seances">
                    {visibles.map((s) => (
                      <label key={s.id} className="case-simple">
                        <input type="checkbox" checked={rubriques.seances.includes(s.id)} onChange={(e) => choisirSeance(s.id, e.target.checked)} />
                        {dateCourte(s.debut.slice(0, 10))}
                        {s.motif && <span className="discret"> · {s.motif}</span>}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </fieldset>
            {erreur && (
              <p className="alerte" role="alert">
                {erreur}
              </p>
            )}
            {message && (
              <p className="succes" role="status">
                {message}
              </p>
            )}
            <div className="rangee">
              <button type="button" className="bouton bouton-principal" disabled={envoi || rien} onClick={() => void enregistrer(false)}>
                Enregistrer le PDF
              </button>
              <button type="button" className="bouton" disabled={envoi || rien} onClick={() => void enregistrer(true)}>
                Ouvrir pour imprimer…
              </button>
            </div>
          </div>
          <PagesApercu pages={rien ? [] : pages} erreur={rien ? "Cochez au moins une rubrique ou une séance." : erreurApercu} titre="Aperçu du dossier" />
        </div>
      </section>
    </div>
  );
}
