import { useEffect, useMemo, useState } from "react";

import type { Coeur, ResumeSeance } from "../lib/coeur";
import { dateCourte, dateEnLettres } from "../lib/dates";
import { adresse, aller } from "../lib/navigation";
import { rechercherPatients } from "../lib/recherche";
import { jourEnLettres, libelleType } from "../lib/seances";
import { DUREE_CORBEILLE_JOURS } from "../seances/corbeille";
import { EtatFacturation } from "../seances/ListeSeances";

type Vue = "jour" | "semaine" | "mois";
type Filtre = "toutes" | "a_facturer" | "gratuit";

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

function iso(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Premier et dernier jour de la période qui contient `reference`. */
export function bornes(vue: Vue, reference: Date): [Date, Date] {
  const r = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  if (vue === "jour") return [r, r];
  if (vue === "mois") return [new Date(r.getFullYear(), r.getMonth(), 1), new Date(r.getFullYear(), r.getMonth() + 1, 0)];
  const lundi = new Date(r);
  lundi.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);
  return [lundi, dimanche];
}

function decaler(vue: Vue, reference: Date, sens: 1 | -1): Date {
  const d = new Date(reference);
  if (vue === "jour") d.setDate(d.getDate() + sens);
  else if (vue === "semaine") d.setDate(d.getDate() + 7 * sens);
  else d.setMonth(d.getMonth() + sens, 1);
  return d;
}

export function libellePeriode(vue: Vue, reference: Date): string {
  const [du, au] = bornes(vue, reference);
  if (vue === "jour") return jourEnLettres(iso(du));
  if (vue === "mois") return `${MOIS[du.getMonth()]} ${du.getFullYear()}`;
  const memeMois = du.getMonth() === au.getMonth();
  return `Semaine du ${memeMois ? du.getDate() : dateEnLettres(iso(du)).replace(/ \d{4}$/, "")} au ${dateEnLettres(iso(au))}`;
}

export function PageSeances({ coeur, aujourdhui }: { coeur: Coeur; aujourdhui?: Date }) {
  const [vue, setVue] = useState<Vue>("mois");
  const [reference, setReference] = useState(() => aujourdhui ?? new Date());
  const [seances, setSeances] = useState<ResumeSeance[] | null>(null);
  const [filtre, setFiltre] = useState<Filtre>("toutes");
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [aLaCorbeille, setALaCorbeille] = useState(0);

  useEffect(() => {
    const [du, au] = bornes(vue, reference);
    setSeances(null);
    coeur.listerSeancesPeriode(iso(du), iso(au)).then(setSeances, (e: Error) => setErreur(e.message));
  }, [coeur, vue, reference]);

  useEffect(() => {
    coeur.corbeilleSeances().then((c) => setALaCorbeille(c.length), () => setALaCorbeille(0));
  }, [coeur]);

  const comptes = useMemo(
    () => ({
      toutes: seances?.length ?? 0,
      a_facturer: seances?.filter((s) => s.facturation === "a_facturer").length ?? 0,
      gratuit: seances?.filter((s) => s.facturation === "gratuit").length ?? 0,
    }),
    [seances],
  );

  const visibles = useMemo(() => {
    const liste = (seances ?? []).filter((s) => filtre === "toutes" || s.facturation === filtre);
    const t = texte.trim();
    if (!t) return liste;
    // Même recherche que pour les patients, étendue au motif et au titre.
    const parPatient = new Set(
      rechercherPatients(
        liste.map((s) => ({
          id: s.id,
          sexe: "",
          nom: s.patient_nom,
          nom_naissance: "",
          prenom: s.patient_prenom,
          naissance: null,
          portable: "",
          fixe: "",
          email: "",
          adresse: `${s.titre} ${s.motif}`,
          ville: "",
          statut: "",
          notes_importantes: "",
          decede: false,
          archive: false,
          seances: 0,
          derniere_seance: null,
        })),
        t,
      ).map((r) => r.patient.id),
    );
    return liste.filter((s) => parPatient.has(s.id));
  }, [seances, filtre, texte]);

  const parJour = useMemo(() => {
    const groupes = new Map<string, ResumeSeance[]>();
    for (const s of visibles) groupes.set(s.debut.slice(0, 10), [...(groupes.get(s.debut.slice(0, 10)) ?? []), s]);
    return [...groupes.entries()].map(([jour, liste]) => [jour, [...liste].sort((a, b) => a.debut.localeCompare(b.debut))] as const);
  }, [visibles]);

  const FILTRES: { valeur: Filtre; libelle: string }[] = [
    { valeur: "toutes", libelle: `Toutes · ${comptes.toutes}` },
    { valeur: "a_facturer", libelle: `À facturer · ${comptes.a_facturer}` },
    { valeur: "gratuit", libelle: `Actes gratuits · ${comptes.gratuit}` },
  ];

  return (
    <main className="page page-large">
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Séances</h1>
          <p className="page-sous-titre">Toutes les séances saisies et leur facturation</p>
        </div>
        <div className="rangee navigation-periode">
          <button type="button" className="bouton" aria-label="Période précédente" onClick={() => setReference((r) => decaler(vue, r, -1))}>
            ‹
          </button>
          <strong className="libelle-periode" aria-live="polite">
            {libellePeriode(vue, reference)}
          </strong>
          <button type="button" className="bouton" aria-label="Période suivante" onClick={() => setReference((r) => decaler(vue, r, 1))}>
            ›
          </button>
          <div className="segments" role="group" aria-label="Durée affichée">
            {(["jour", "semaine", "mois"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={vue === v} onClick={() => setVue(v)}>
                {v === "jour" ? "Jour" : v === "semaine" ? "Semaine" : "Mois"}
              </button>
            ))}
          </div>
          <button type="button" className="lien-bouton" onClick={() => setReference(aujourdhui ?? new Date())}>
            Aujourd’hui
          </button>
        </div>
      </div>

      <div className="tuiles">
        <div className="tuile">
          <span>Séances</span>
          <strong>{comptes.toutes}</strong>
        </div>
        <div className="tuile" data-accent="true">
          <span>À facturer</span>
          <strong>{comptes.a_facturer}</strong>
        </div>
        <div className="tuile">
          <span>Actes gratuits</span>
          <strong>{comptes.gratuit}</strong>
        </div>
      </div>

      <div className="filtres">
        <div className="rangee" role="group" aria-label="État de facturation">
          {FILTRES.map((f) => (
            <button key={f.valeur} type="button" className="filtre-puce" aria-pressed={filtre === f.valeur} onClick={() => setFiltre(f.valeur)}>
              {f.libelle}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="recherche recherche-seances"
          aria-label="Rechercher une séance"
          placeholder="Patient, motif…"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
        {aLaCorbeille > 0 && <a href={adresse("seances", "corbeille")}>Corbeille · {aLaCorbeille}</a>}
      </div>

      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}

      <section className="carte carte-tableau" aria-label="Séances de la période">
        {seances === null ? (
          <p className="vide discret">Chargement…</p>
        ) : parJour.length === 0 ? (
          <p className="vide discret">Aucune séance sur cette période.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Patient</th>
                <th scope="col">Modèle</th>
                <th scope="col">Motif</th>
                <th scope="col">Facturation</th>
              </tr>
            </thead>
            {parJour.map(([jour, liste]) => (
              <tbody key={jour}>
                <tr className="ligne-jour">
                  <th scope="rowgroup" colSpan={5}>
                    {jourEnLettres(jour).replace(/ \d{4}$/, "").replace(/^./, (c) => c.toUpperCase())} · {liste.length} séance{liste.length > 1 ? "s" : ""}
                  </th>
                </tr>
                {liste.map((s) => (
                  <tr key={s.id} onClick={() => aller("seances", s.id)}>
                    <td className="sans-retour">
                      <a href={adresse("seances", s.id)} onClick={(e) => e.stopPropagation()}>
                        {s.debut.slice(11, 16)}
                      </a>
                    </td>
                    <td>
                      <a href={adresse("patients", s.patient_id)} onClick={(e) => e.stopPropagation()}>
                        {s.patient_prenom} {s.patient_nom}
                      </a>
                    </td>
                    <td className="discret">
                      {s.modele_nom} · {libelleType(s.type)}
                    </td>
                    <td>
                      {s.importante && <span aria-label="Importante">★ </span>}
                      {s.titre || s.motif || <span className="discret">Sans motif</span>}
                    </td>
                    <td>
                      <EtatFacturation seance={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </section>
    </main>
  );
}

export function PageCorbeille({ coeur }: { coeur: Coeur }) {
  const [seances, setSeances] = useState<ResumeSeance[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = () => coeur.corbeilleSeances().then(setSeances, (e: Error) => setErreur(e.message));
  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  async function restaurer(id: string) {
    try {
      await coeur.restaurerSeance(id);
      await charger();
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <main className="page">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("seances")}>Séances</a> <span aria-hidden="true">›</span> Corbeille
      </nav>
      <div>
        <h1 className="page-titre">Corbeille</h1>
        <p className="page-sous-titre">Les séances supprimées restent ici {DUREE_CORBEILLE_JOURS} jours, puis sont effacées.</p>
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <section className="carte" aria-label="Séances à la corbeille">
        {seances === null ? (
          <p className="discret">Chargement…</p>
        ) : seances.length === 0 ? (
          <p className="discret">La corbeille est vide.</p>
        ) : (
          <ul className="liste-seances">
            {seances.map((s) => {
              const effacement = new Date(((s.supprimee_le ?? 0) + DUREE_CORBEILLE_JOURS * 86_400) * 1000);
              return (
                <li key={s.id} className="ligne-corbeille">
                  <span className="ligne-seance-texte">
                    <strong>
                      {dateCourte(s.debut.slice(0, 10))} · {s.patient_prenom} {s.patient_nom}
                    </strong>
                    <span className="discret">
                      {s.titre || s.motif || "Sans motif"} · effacée le {dateEnLettres(iso(effacement))}
                    </span>
                  </span>
                  <button type="button" className="bouton bouton-petit" onClick={() => void restaurer(s.id)}>
                    Restaurer
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
