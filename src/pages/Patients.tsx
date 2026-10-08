import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Exports } from "../composants/Exports";
import { dateDuJour, type Coeur, type Groupe, type ResumePatient } from "../lib/coeur";
import { age, ageEnClair, dateCourte, neLe } from "../lib/dates";
import { adresse, aller } from "../lib/navigation";
import { doublonsProbables, rechercherPatients, type Surlignage } from "../lib/recherche";
import { colonne, feuilleVersCsv, type Feuille } from "../lib/tableur";
import { Avatar } from "../patients/Avatar";
import { groupesDe, PucesGroupes } from "../patients/Groupes";

type FiltreAge = "tous" | "nourrisson" | "enfant" | "adulte" | "senior";

/** Valeur des filtres « Sans statut » et « Sans groupe » : aucun identifiant ne la porte. */
const SANS = "\u0000sans";

const AGES: { valeur: FiltreAge; libelle: string; garder: (ans: number) => boolean }[] = [
  { valeur: "tous", libelle: "Tous", garder: () => true },
  { valeur: "nourrisson", libelle: "Moins de 2 ans", garder: (ans) => ans < 2 },
  { valeur: "enfant", libelle: "2 à 17 ans", garder: (ans) => ans >= 2 && ans < 18 },
  { valeur: "adulte", libelle: "18 à 64 ans", garder: (ans) => ans >= 18 && ans < 65 },
  { valeur: "senior", libelle: "65 ans et plus", garder: (ans) => ans >= 65 },
];

export type FiltreVenue = "toutes" | "mois" | "trimestre" | "annee" | "plus_annee" | "dormants" | "inactifs" | "jamais";

/** La date d'il y a `mois` mois, `AAAA-MM-JJ`. */
function ilYa(mois: number, aujourdhui: Date): string {
  const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - mois, aujourdhui.getDate());
  return dateDuJour(d);
}

export const VENUES: { valeur: FiltreVenue; libelle: string; garder: (derniere: string | null, aujourdhui: Date) => boolean }[] = [
  { valeur: "toutes", libelle: "Peu importe", garder: () => true },
  { valeur: "mois", libelle: "Dans le mois", garder: (d, a) => d !== null && d >= ilYa(1, a) },
  { valeur: "trimestre", libelle: "Dans les 3 mois", garder: (d, a) => d !== null && d >= ilYa(3, a) },
  { valeur: "annee", libelle: "Dans l’année (actifs)", garder: (d, a) => d !== null && d >= ilYa(12, a) },
  { valeur: "plus_annee", libelle: "Il y a plus d’un an", garder: (d, a) => d !== null && d < ilYa(12, a) },
  { valeur: "dormants", libelle: "Il y a un à deux ans (dormants)", garder: (d, a) => d !== null && d < ilYa(12, a) && d >= ilYa(24, a) },
  { valeur: "inactifs", libelle: "Il y a plus de deux ans (inactifs)", garder: (d, a) => d !== null && d < ilYa(24, a) },
  { valeur: "jamais", libelle: "Jamais venus", garder: (d) => d === null },
];

/** La liste telle qu'affichée, pour un tableur. */
export function feuillePatients(patients: ResumePatient[], groupes: Groupe[], aujourdhui = new Date()): Feuille {
  return {
    nom: "Patients",
    colonnes: [
      colonne("Nom"),
      colonne("Prénom"),
      colonne("Nom de naissance"),
      colonne("Sexe"),
      colonne("Naissance", "date"),
      colonne("Âge", "nombre"),
      colonne("Portable"),
      colonne("Fixe"),
      colonne("Email"),
      colonne("Adresse"),
      colonne("Complément"),
      colonne("Code postal"),
      colonne("Ville"),
      colonne("Statut"),
      colonne("Groupes"),
      colonne("Séances", "nombre"),
      colonne("Dernière séance", "date"),
      colonne("Archivé"),
      colonne("Décédé"),
    ],
    lignes: patients.map((p) => [
      p.nom,
      p.prenom,
      p.nom_naissance,
      p.sexe,
      p.naissance,
      p.naissance ? age(p.naissance, aujourdhui).ans : null,
      p.portable,
      p.fixe,
      p.email,
      p.adresse,
      p.complement_adresse,
      p.code_postal,
      p.ville,
      p.statut,
      groupesDe(p.groupes, groupes)
        .map((g) => g.nom)
        .join(", "),
      p.seances,
      p.derniere_seance,
      p.archive ? "oui" : "",
      p.decede ? "oui" : "",
    ]),
  };
}

/** Le texte avec ses passages trouvés en surbrillance. */
function Surligne({ texte, passages }: { texte: string; passages: Surlignage[] }) {
  if (passages.length === 0) return <>{texte}</>;
  const tries = [...passages].sort((a, b) => a.debut - b.debut);
  const morceaux = [];
  let position = 0;
  for (const { debut, fin } of tries) {
    if (debut < position) continue;
    morceaux.push(texte.slice(position, debut));
    morceaux.push(
      <mark key={debut} className="surligne">
        {texte.slice(debut, fin)}
      </mark>,
    );
    position = fin;
  }
  morceaux.push(texte.slice(position));
  return <>{morceaux.map((m, i) => (typeof m === "string" ? <Fragment key={`t${i}`}>{m}</Fragment> : m))}</>;
}

export function lignePatient(p: ResumePatient): string {
  const parties = [];
  if (p.naissance) parties.push(ageEnClair(p.naissance), neLe(p.sexe, p.naissance));
  return parties.join(" · ");
}

function telephone(p: ResumePatient): string {
  return p.portable || p.fixe;
}

/** Les patients actifs, dormants ou inactifs des statistiques : `#/patients/recence/dormants`. */
export const RECENCE_VERS_FILTRE: Record<string, FiltreVenue> = { actifs: "annee", dormants: "dormants", inactifs: "inactifs" };

export function PagePatients({ coeur, venueInitiale = "toutes" }: { coeur: Coeur; venueInitiale?: FiltreVenue }) {
  const id = useId();
  const [liste, setListe] = useState<ResumePatient[] | null>(null);
  const [statuts, setStatuts] = useState<string[]>([]);
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [texte, setTexte] = useState("");
  const [statut, setStatut] = useState("");
  const [groupe, setGroupe] = useState("");
  const [venue, setVenue] = useState<FiltreVenue>(venueInitiale);
  const [filtreAge, setFiltreAge] = useState<FiltreAge>("tous");
  const [archives, setArchives] = useState(false);
  const [actif, setActif] = useState(0);
  const [voirDoublons, setVoirDoublons] = useState(false);
  const recherche = useRef<HTMLInputElement>(null);

  useEffect(() => {
    coeur.listerPatients().then(setListe, (e: Error) => setErreur(e.message));
    coeur.statutsPatients().then(setStatuts, () => setStatuts([]));
    coeur.listerGroupes().then(setGroupes, () => setGroupes([]));
  }, [coeur]);

  const resultats = useMemo(() => {
    if (!liste) return [];
    const aujourdhui = new Date();
    const gardeAge = AGES.find((a) => a.valeur === filtreAge)!.garder;
    const gardeVenue = VENUES.find((v) => v.valeur === venue)!.garder;
    const filtres = liste.filter(
      (p) =>
        (archives || !p.archive) &&
        (!statut || (statut === SANS ? !p.statut : p.statut === statut)) &&
        (!groupe || (groupe === SANS ? p.groupes.length === 0 : p.groupes.includes(groupe))) &&
        gardeVenue(p.derniere_seance, aujourdhui) &&
        (filtreAge === "tous" || (p.naissance !== null && gardeAge(age(p.naissance).ans))),
    );
    return rechercherPatients(filtres, texte);
  }, [liste, texte, statut, groupe, venue, filtreAge, archives]);

  const doublons = useMemo(() => (liste ? doublonsProbables(liste) : []), [liste]);

  useEffect(() => setActif(0), [texte, statut, groupe, venue, filtreAge, archives]);

  if (erreur && liste === null) return <main className="page"><p className="alerte" role="alert">{erreur}</p></main>;

  const actifs = liste?.filter((p) => !p.archive).length ?? 0;
  const archives_ = (liste?.length ?? 0) - actifs;
  const ouvrir = (patient: ResumePatient) => aller("patients", patient.id);

  function clavier(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActif((a) => Math.min(a + 1, resultats.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActif((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && resultats[actif]) {
      e.preventDefault();
      ouvrir(resultats[actif].patient);
    }
  }

  // Le texte cherché devient le nom (premier mot) et le prénom (la suite) du nouveau dossier.
  const nouveauDepuisRecherche = () => aller("patients", "nouveau", texte.trim());

  // Les statuts portés par des dossiers sans être dans la liste du praticien (repris d'un import) se filtrent aussi.
  const statutsFiltres = [...statuts, ...[...new Set((liste ?? []).map((p) => p.statut))].filter((s) => s && !statuts.includes(s)).sort()];
  const filtresActifs = Boolean(statut || groupe || venue !== "toutes" || filtreAge !== "tous");

  async function exporter(format: "xlsx" | "csv") {
    setErreur(null);
    setMessage(null);
    try {
      const feuille = feuillePatients(resultats.map((r) => r.patient), groupes);
      const nom = `Patients du ${dateDuJour()}`;
      const chemin = format === "xlsx" ? await coeur.exporterClasseur(`${nom}.xlsx`, [feuille]) : await coeur.exporterFichier(`${nom}.csv`, feuilleVersCsv(feuille));
      setMessage(`Export enregistré : ${chemin}`);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <main className="page page-large">
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Patients</h1>
          <p className="page-sous-titre">
            {liste === null
              ? "Chargement…"
              : `${actifs} dossier${actifs > 1 ? "s" : ""} actif${actifs > 1 ? "s" : ""}${archives_ ? ` · ${archives_} archivé${archives_ > 1 ? "s" : ""}` : ""}`}
          </p>
        </div>
        <div className="rangee">
          {doublons.length > 0 && (
            <button type="button" className="bouton" onClick={() => setVoirDoublons((v) => !v)} aria-expanded={voirDoublons}>
              Doublons probables <span className="compteur">{doublons.length}</span>
            </button>
          )}
          <a className="bouton bouton-principal" href={adresse("patients", "nouveau")}>
            <span aria-hidden="true">+</span> Nouveau patient
          </a>
        </div>
      </div>

      {voirDoublons && doublons.length > 0 && (
        <section className="carte" aria-labelledby={`${id}-doublons`}>
          <h2 id={`${id}-doublons`}>Doublons probables</h2>
          <p className="discret">Même nom et prénom, ou presque, avec la même date de naissance. La fusion réunit les deux dossiers, après un aperçu.</p>
          <ul className="liste-doublons">
            {doublons.map(([a, b]) => (
              <li key={`${a.id}-${b.id}`}>
                <a href={adresse("patients", a.id)}>
                  {a.nom} {a.prenom}
                </a>
                <span aria-hidden="true">≈</span>
                <a href={adresse("patients", b.id)}>
                  {b.nom} {b.prenom}
                </a>
                {a.naissance && <span className="discret">{neLe(a.sexe, a.naissance)}</span>}
                <a className="bouton bouton-petit" href={adresse("patients", a.id, "fusion", b.id)}>
                  Fusionner…
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="recherche-patients">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={recherche}
          type="search"
          aria-label="Rechercher un patient"
          placeholder="Nom, prénom, téléphone, ville, email…"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={clavier}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-controls={`${id}-liste`}
        />
        {texte.trim() && (
          <span className="discret" aria-live="polite">
            {resultats.length} résultat{resultats.length > 1 ? "s" : ""} · accents et fautes ignorés
          </span>
        )}
      </div>

      <div className="filtres">
        <label className="filtre">
          <span>Statut</span>
          <select value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="">Tous</option>
            {statutsFiltres.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={SANS}>Sans statut</option>
          </select>
        </label>
        {groupes.length > 0 && (
          <label className="filtre">
            <span>Groupe</span>
            <select value={groupe} onChange={(e) => setGroupe(e.target.value)}>
              <option value="">Tous</option>
              {groupes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nom}
                </option>
              ))}
              <option value={SANS}>Sans groupe</option>
            </select>
          </label>
        )}
        <label className="filtre">
          <span>Dernière séance</span>
          <select value={venue} onChange={(e) => setVenue(e.target.value as FiltreVenue)}>
            {VENUES.map((v) => (
              <option key={v.valeur} value={v.valeur}>
                {v.libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="filtre">
          <span>Âge</span>
          <select value={filtreAge} onChange={(e) => setFiltreAge(e.target.value as FiltreAge)}>
            {AGES.map((a) => (
              <option key={a.valeur} value={a.valeur}>
                {a.libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="case-simple">
          <input type="checkbox" checked={archives} onChange={(e) => setArchives(e.target.checked)} />
          Inclure les archives
        </label>
        {filtresActifs && (
          <button
            type="button"
            className="lien-bouton"
            onClick={() => {
              setStatut("");
              setGroupe("");
              setVenue("toutes");
              setFiltreAge("tous");
            }}
          >
            Retirer les filtres
          </button>
        )}
        <span className="filtres-fin">
          <Exports desactive={resultats.length === 0} excel={() => void exporter("xlsx")} csv={() => void exporter("csv")} />
        </span>
      </div>
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}

      <section className="carte carte-tableau" aria-label="Liste des patients">
        {liste !== null && liste.length === 0 ? (
          <div className="vide">
            <p>Aucun dossier pour l’instant.</p>
            <a className="bouton bouton-principal" href={adresse("patients", "nouveau")}>
              Créer le premier dossier
            </a>
          </div>
        ) : resultats.length === 0 && liste !== null ? (
          <div className="vide">
            <p>
              Aucun patient ne correspond{texte.trim() ? ` à « ${texte.trim()} »` : " à ces filtres"}.
            </p>
            {texte.trim() && (
              <button type="button" className="bouton" onClick={nouveauDepuisRecherche}>
                Créer le dossier « {texte.trim()} »
              </button>
            )}
          </div>
        ) : (
          <table className="tableau" id={`${id}-liste`}>
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Téléphone</th>
                <th scope="col">Ville</th>
                <th scope="col">Dernière séance</th>
                <th scope="col" className="nombre">
                  Séances
                </th>
                <th scope="col">Statut et groupes</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map(({ patient: p, raison, surlignage }, rang) => (
                <tr key={p.id} data-actif={texte.trim() !== "" && rang === actif} onClick={() => ouvrir(p)}>
                  <td>
                    <div className="cellule-patient">
                      <Avatar prenom={p.prenom} nom={p.nom} />
                      <div>
                        <a href={adresse("patients", p.id)} className="nom-patient" onClick={(e) => e.stopPropagation()}>
                          <Surligne texte={p.nom} passages={surlignage.nom} /> <Surligne texte={p.prenom} passages={surlignage.prenom} />
                        </a>
                        {p.notes_importantes && (
                          <span className="icone-alerte" title={p.notes_importantes}>
                            <span aria-hidden="true">⚠</span>
                            <span className="lecteur-seulement">Note importante : {p.notes_importantes}</span>
                          </span>
                        )}
                        {raison && <span className="discret"> · {raison}</span>}
                        <div className="discret">
                          {lignePatient(p)}
                          {p.decede && ` · ${p.sexe === "F" ? "décédée" : "décédé"}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="sans-retour">{telephone(p)}</td>
                  <td>{p.ville}</td>
                  <td>{p.derniere_seance ? dateCourte(p.derniere_seance) : <span className="discret">jamais venu{p.sexe === "F" ? "e" : ""}</span>}</td>
                  <td className="nombre">{p.seances}</td>
                  <td>
                    <div className="puces-cellule">
                      {p.statut && <span className="puce">{p.statut}</span>}
                      <PucesGroupes ids={p.groupes} groupes={groupes} />
                      {p.archive && <span className="puce puce-discrete">Archivé</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {liste !== null && liste.length > 0 && resultats.length > 0 && (
          <div className="pied-tableau">
            <span>
              {resultats.length} patient{resultats.length > 1 ? "s" : ""} sur {liste.length}
            </span>
            <span className="discret">Entrée ouvre le dossier · ↑ ↓ pour parcourir</span>
          </div>
        )}
      </section>
    </main>
  );
}
