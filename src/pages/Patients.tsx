import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { Coeur, ResumePatient } from "../lib/coeur";
import { age, ageEnClair, dateCourte, neLe } from "../lib/dates";
import { adresse, aller } from "../lib/navigation";
import { doublonsProbables, rechercherPatients, type Surlignage } from "../lib/recherche";
import { Avatar } from "../patients/Avatar";

type FiltreAge = "tous" | "nourrisson" | "enfant" | "adulte" | "senior";

const AGES: { valeur: FiltreAge; libelle: string; garder: (ans: number) => boolean }[] = [
  { valeur: "tous", libelle: "Tous", garder: () => true },
  { valeur: "nourrisson", libelle: "Moins de 2 ans", garder: (ans) => ans < 2 },
  { valeur: "enfant", libelle: "2 à 17 ans", garder: (ans) => ans >= 2 && ans < 18 },
  { valeur: "adulte", libelle: "18 à 64 ans", garder: (ans) => ans >= 18 && ans < 65 },
  { valeur: "senior", libelle: "65 ans et plus", garder: (ans) => ans >= 65 },
];

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

export function PagePatients({ coeur }: { coeur: Coeur }) {
  const id = useId();
  const [liste, setListe] = useState<ResumePatient[] | null>(null);
  const [statuts, setStatuts] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [texte, setTexte] = useState("");
  const [statut, setStatut] = useState("");
  const [filtreAge, setFiltreAge] = useState<FiltreAge>("tous");
  const [archives, setArchives] = useState(false);
  const [actif, setActif] = useState(0);
  const [voirDoublons, setVoirDoublons] = useState(false);
  const recherche = useRef<HTMLInputElement>(null);

  useEffect(() => {
    coeur.listerPatients().then(setListe, (e: Error) => setErreur(e.message));
    coeur.statutsPatients().then(setStatuts, () => setStatuts([]));
  }, [coeur]);

  const resultats = useMemo(() => {
    if (!liste) return [];
    const gardeAge = AGES.find((a) => a.valeur === filtreAge)!.garder;
    const filtres = liste.filter(
      (p) =>
        (archives || !p.archive) &&
        (!statut || p.statut === statut) &&
        (filtreAge === "tous" || (p.naissance !== null && gardeAge(age(p.naissance).ans))),
    );
    return rechercherPatients(filtres, texte);
  }, [liste, texte, statut, filtreAge, archives]);

  const doublons = useMemo(() => (liste ? doublonsProbables(liste) : []), [liste]);

  useEffect(() => setActif(0), [texte, statut, filtreAge, archives]);

  if (erreur) return <main className="page"><p className="alerte" role="alert">{erreur}</p></main>;

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
          <p className="discret">Même nom et prénom, ou presque, avec la même date de naissance. La fusion guidée arrive avec la suite de la phase 3.</p>
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
            {statuts.map((s) => (
              <option key={s} value={s}>
                {s}
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
      </div>

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
                <th scope="col">Statut</th>
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
                    {p.statut && <span className="puce">{p.statut}</span>}
                    {p.archive && <span className="puce puce-discrete">Archivé</span>}
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
