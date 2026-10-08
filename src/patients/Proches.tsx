import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import type { Coeur, LienFamilial, Patient, Proche, ResumePatient, Sexe } from "../lib/coeur";
import { ageEnClair } from "../lib/dates";
import { adresse } from "../lib/navigation";
import { rechercherPatients } from "../lib/recherche";

/** « mère », « fils », « conjointe », « frère »… ; le neutre faute de sexe renseigné. */
export function lienEnClair(lien: LienFamilial, sexe: Sexe): string {
  const formes: Record<LienFamilial, [string, string, string]> = {
    parent: ["père", "mère", "parent"],
    enfant: ["fils", "fille", "enfant"],
    conjoint: ["conjoint", "conjointe", "conjoint ou conjointe"],
    fratrie: ["frère", "sœur", "frère ou sœur"],
  };
  const [masculin, feminin, neutre] = formes[lien];
  return sexe === "M" ? masculin : sexe === "F" ? feminin : neutre;
}

const LIENS: { lien: LienFamilial; libelle: string }[] = [
  { lien: "parent", libelle: "le parent" },
  { lien: "enfant", libelle: "l’enfant" },
  { lien: "conjoint", libelle: "le conjoint ou la conjointe" },
  { lien: "fratrie", libelle: "le frère ou la sœur" },
];

function AjoutProche({
  coeur,
  patient,
  exclus,
  ajouter,
  annuler,
}: {
  coeur: Coeur;
  patient: Patient;
  exclus: string[];
  ajouter: (procheId: string, lien: LienFamilial) => Promise<void>;
  annuler: () => void;
}) {
  const id = useId();
  const [liste, setListe] = useState<ResumePatient[]>([]);
  const [texte, setTexte] = useState("");
  const [choisi, setChoisi] = useState<ResumePatient | null>(null);
  const [lien, setLien] = useState<LienFamilial>("enfant");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    coeur.listerPatients().then(setListe, () => setListe([]));
  }, [coeur]);

  const candidats = useMemo(() => {
    const autres = liste.filter((p) => p.id !== patient.id && !exclus.includes(p.id));
    // Sans recherche, les dossiers du même nom d'abord : souvent la famille.
    if (!texte.trim()) return autres.filter((p) => p.nom.toLocaleLowerCase("fr") === patient.nom.toLocaleLowerCase("fr")).slice(0, 6);
    return rechercherPatients(autres, texte)
      .slice(0, 6)
      .map((r) => r.patient);
  }, [liste, texte, patient, exclus]);

  async function valider(e: FormEvent) {
    e.preventDefault();
    if (!choisi) return;
    setEnvoi(true);
    try {
      await ajouter(choisi.id, lien);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="ajout-proche pile-serree" onSubmit={valider}>
      {choisi ? (
        <div className="rangee rangee-centree">
          <strong>
            {choisi.prenom} {choisi.nom}
          </strong>
          <label htmlFor={`${id}-lien`}>est</label>
          <select id={`${id}-lien`} className="saisie-courte" value={lien} onChange={(e) => setLien(e.target.value as LienFamilial)}>
            {LIENS.map((l) => (
              <option key={l.lien} value={l.lien}>
                {l.libelle}
              </option>
            ))}
          </select>
          <span>de {patient.prenom}</span>
          <button type="submit" className="bouton bouton-petit bouton-principal" disabled={envoi}>
            Lier les dossiers
          </button>
          <button type="button" className="lien-bouton" onClick={() => setChoisi(null)}>
            Changer
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            className="saisie-courte"
            aria-label="Chercher le dossier du proche"
            placeholder="Nom ou prénom du proche"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            autoFocus
            autoComplete="off"
          />
          {candidats.length > 0 ? (
            <div className="rangee" role="group" aria-label="Dossiers proposés">
              {candidats.map((p) => (
                <button key={p.id} type="button" className="bouton bouton-petit" onClick={() => setChoisi(p)}>
                  {p.prenom} {p.nom}
                  {p.naissance && <span className="discret"> · {ageEnClair(p.naissance)}</span>}
                </button>
              ))}
            </div>
          ) : (
            texte.trim() && <p className="discret">Aucun dossier ne correspond. Créez d’abord le dossier du proche.</p>
          )}
        </>
      )}
      <div>
        <button type="button" className="lien-bouton" onClick={annuler}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Les proches du patient : liens dans les deux sens, et le parent ou le conjoint qui reçoit les factures. */
export function CarteProches({ coeur, patient, misAJour }: { coeur: Coeur; patient: Patient; misAJour: (p: Patient) => void }) {
  const id = useId();
  const [proches, setProches] = useState<Proche[] | null>(null);
  const [ajout, setAjout] = useState(false);
  const [aRetirer, setARetirer] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    coeur.prochesPatient(patient.id).then(setProches, (e: Error) => setErreur(e.message));
  }, [coeur, patient.id]);

  async function agir(action: () => Promise<void>) {
    setErreur(null);
    try {
      await action();
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  const ajouter = (procheId: string, lien: LienFamilial) =>
    agir(async () => {
      setProches(await coeur.lierProche(patient.id, procheId, lien));
      setAjout(false);
    });
  const retirer = (procheId: string) =>
    agir(async () => {
      setProches(await coeur.delierProche(patient.id, procheId));
      setARetirer(null);
      misAJour(await coeur.lirePatient(patient.id));
    });
  const payeur = (procheId: string | null) =>
    agir(async () => {
      misAJour(await coeur.definirPayeur(patient.id, procheId));
      setProches(await coeur.prochesPatient(patient.id));
    });

  return (
    <section className="carte" aria-labelledby={`${id}-titre`}>
      <div className="entete-carte">
        <h2 id={`${id}-titre`}>Proches</h2>
        {!ajout && (
          <button type="button" className="bouton bouton-petit" onClick={() => setAjout(true)}>
            Ajouter un proche
          </button>
        )}
      </div>
      {proches === null ? (
        <p className="discret">{erreur ?? "Chargement…"}</p>
      ) : proches.length === 0 && !ajout ? (
        <p className="discret">Aucun proche lié. Un parent peut recevoir les factures de son enfant.</p>
      ) : (
        <ul className="liste-proches">
          {proches.map((p) => (
            <li key={p.id}>
              <div>
                <a href={adresse("patients", p.id)}>
                  {p.prenom} {p.nom}
                </a>
                <span className="discret">
                  {" "}
                  · {lienEnClair(p.lien, p.sexe)}
                  {p.naissance && ` · ${ageEnClair(p.naissance)}`}
                  {p.decede && " · décédé(e)"}
                </span>
              </div>
              <div className="rangee rangee-centree">
                {(p.lien === "parent" || p.lien === "conjoint") && (
                  <label className="case-simple">
                    <input type="checkbox" checked={p.recoit_les_factures} onChange={(e) => void payeur(e.target.checked ? p.id : null)} />
                    Reçoit les factures
                  </label>
                )}
                {aRetirer === p.id ? (
                  <>
                    <button type="button" className="bouton bouton-petit bouton-danger" onClick={() => void retirer(p.id)}>
                      Retirer le lien
                    </button>
                    <button type="button" className="lien-bouton" onClick={() => setARetirer(null)}>
                      Garder
                    </button>
                  </>
                ) : (
                  <button type="button" className="lien-bouton" aria-label={`Retirer le lien avec ${p.prenom} ${p.nom}`} onClick={() => setARetirer(p.id)}>
                    Retirer
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {ajout && <AjoutProche coeur={coeur} patient={patient} exclus={(proches ?? []).map((p) => p.id)} ajouter={ajouter} annuler={() => setAjout(false)} />}
      {erreur && proches !== null && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
    </section>
  );
}
