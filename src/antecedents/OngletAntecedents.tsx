import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { Antecedent, CategorieAntecedents, Coeur, CouleurAntecedent, FichePatient, Patient, SaisieAntecedent } from "../lib/coeur";
import { ecrireDatePartielle, lireDatePartielle } from "../lib/dates";
import { adresse } from "../lib/navigation";
import { apparence, CHOIX_COULEURS, intitule, periode } from "./apparence";

export function ficheDe(patient: Patient): FichePatient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, archive, cree_le, modifie_le, ...fiche } = patient;
  return fiche;
}

interface Brouillon {
  categorie: string;
  rubrique: string;
  precision: string;
  debut: string;
  fin: string;
  en_cours: boolean;
  couleur: CouleurAntecedent;
  important: boolean;
}

function versBrouillon(a: SaisieAntecedent): Brouillon {
  return { ...a, debut: ecrireDatePartielle(a.debut), fin: ecrireDatePartielle(a.fin) };
}

function EditeurAntecedent({
  formulaire,
  depart,
  existant,
  enregistrer,
  supprimer,
  annuler,
}: {
  formulaire: CategorieAntecedents[];
  depart: SaisieAntecedent;
  existant: boolean;
  enregistrer: (saisie: SaisieAntecedent) => Promise<void>;
  supprimer: (() => Promise<void>) | null;
  annuler: () => void;
}) {
  const id = useId();
  const [b, setB] = useState<Brouillon>(() => versBrouillon(depart));
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const precision = useRef<HTMLInputElement>(null);
  const categorie = formulaire.find((c) => c.cle === b.categorie);
  const rubriques = categorie ? [...categorie.rubriques, ...(categorie.rubriques.includes(b.rubrique) || !b.rubrique ? [] : [b.rubrique])] : [];
  const changer = <K extends keyof Brouillon>(nom: K, valeur: Brouillon[K]) => setB((x) => ({ ...x, [nom]: valeur }));

  useEffect(() => {
    precision.current?.focus();
  }, []);

  async function valider(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    const debut = lireDatePartielle(b.debut);
    const fin = b.en_cours ? null : lireDatePartielle(b.fin);
    if (debut === undefined || fin === undefined) return setErreur("Date à écrire 2009, 03/2009 ou 14/03/2009.");
    if (!b.categorie || !b.rubrique) return setErreur("Choisissez la catégorie et la rubrique.");
    try {
      await enregistrer({ ...b, debut, fin });
    } catch (raison) {
      setErreur((raison as Error).message);
    }
  }

  return (
    <form className="carte editeur-antecedent" onSubmit={valider} aria-labelledby={`${id}-titre`} noValidate>
      <h2 id={`${id}-titre`}>{existant ? "Modifier l’antécédent" : "Nouvel antécédent"}</h2>
      <div className="champs">
        <div className="champ">
          <label htmlFor={`${id}-categorie`}>Catégorie</label>
          <select
            id={`${id}-categorie`}
            value={b.categorie}
            onChange={(e) => setB((x) => ({ ...x, categorie: e.target.value, rubrique: formulaire.find((c) => c.cle === e.target.value)?.rubriques[0] ?? "" }))}
          >
            {formulaire.map((c) => (
              <option key={c.cle} value={c.cle}>
                {c.libelle}
              </option>
            ))}
          </select>
        </div>
        <div className="champ">
          <label htmlFor={`${id}-rubrique`}>Rubrique</label>
          <select id={`${id}-rubrique`} value={b.rubrique} onChange={(e) => changer("rubrique", e.target.value)}>
            {rubriques.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="champ champ-large">
          <label htmlFor={`${id}-precision`}>Précision</label>
          <input ref={precision} id={`${id}-precision`} value={b.precision} onChange={(e) => changer("precision", e.target.value)} autoComplete="off" />
        </div>
        <div className="champ">
          <label htmlFor={`${id}-debut`}>Début</label>
          <input id={`${id}-debut`} value={b.debut} onChange={(e) => changer("debut", e.target.value)} placeholder="2009, 03/2009…" inputMode="numeric" autoComplete="off" />
        </div>
        {!b.en_cours && (
          <div className="champ">
            <label htmlFor={`${id}-fin`}>Fin</label>
            <input id={`${id}-fin`} value={b.fin} onChange={(e) => changer("fin", e.target.value)} placeholder="facultative" inputMode="numeric" autoComplete="off" />
          </div>
        )}
        <div className="champ-large cases">
          <label className="case-simple">
            <input type="checkbox" checked={b.en_cours} onChange={(e) => changer("en_cours", e.target.checked)} />
            En cours (traitement, suivi…)
          </label>
          <label className="case-simple">
            <input type="checkbox" checked={b.important} onChange={(e) => changer("important", e.target.checked)} />
            Important : rappelé en tête du dossier et de chaque séance
          </label>
        </div>
        <fieldset className="champ-large nuancier">
          <legend>Couleur</legend>
          {CHOIX_COULEURS.map((c) => (
            <label key={c.valeur || "categorie"} className="pastille-couleur" title={c.libelle}>
              <input type="radio" name={`${id}-couleur`} checked={b.couleur === c.valeur} onChange={() => changer("couleur", c.valeur)} />
              <span style={{ background: c.fond }} data-auto={c.valeur === ""} aria-hidden="true" />
              <span className="lecteur-seulement">{c.libelle}</span>
            </label>
          ))}
        </fieldset>
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="rangee">
        <button type="submit" className="bouton bouton-principal">
          Enregistrer
        </button>
        <button type="button" className="bouton" onClick={annuler}>
          Annuler
        </button>
        {supprimer &&
          (confirmer ? (
            <button type="button" className="bouton bouton-danger" onClick={() => void supprimer()}>
              Supprimer définitivement
            </button>
          ) : (
            <button type="button" className="lien-bouton" onClick={() => setConfirmer(true)}>
              Supprimer
            </button>
          ))}
      </div>
    </form>
  );
}

function RemarquesAntecedents({ patient, coeur, misAJour }: { patient: Patient; coeur: Coeur; misAJour: (p: Patient) => void }) {
  const id = useId();
  const [texte, setTexte] = useState(patient.remarques_antecedents);
  const [etat, setEtat] = useState<"modifie" | "enregistre" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer() {
    setErreur(null);
    try {
      const p = await coeur.modifierPatient(patient.id, { ...ficheDe(patient), remarques_antecedents: texte });
      misAJour(p);
      setEtat("enregistre");
    } catch (raison) {
      setErreur((raison as Error).message);
    }
  }

  return (
    <section className="carte" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>Remarques sur les antécédents</h2>
      <textarea
        aria-labelledby={`${id}-titre`}
        className="zone-texte"
        rows={3}
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          setEtat("modifie");
        }}
      />
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="rangee barre-actions">
        <span className="discret" role="status">
          {etat === "enregistre" ? "Remarques enregistrées" : ""}
        </span>
        <button type="button" className="bouton" disabled={etat !== "modifie"} onClick={() => void enregistrer()}>
          Enregistrer les remarques
        </button>
      </div>
    </section>
  );
}

export function OngletAntecedents({
  patient,
  antecedents,
  formulaire,
  coeur,
  rafraichir,
  misAJour,
}: {
  patient: Patient;
  antecedents: Antecedent[];
  formulaire: CategorieAntecedents[];
  coeur: Coeur;
  rafraichir: () => Promise<void>;
  misAJour: (p: Patient) => void;
}) {
  const [edition, setEdition] = useState<{ antecedent: Antecedent | null; depart: SaisieAntecedent } | null>(null);

  const ouvrir = (categorie: string, rubrique: string) =>
    setEdition({
      antecedent: null,
      depart: { categorie, rubrique, precision: "", debut: null, fin: null, en_cours: false, couleur: "", important: false },
    });

  async function enregistrer(saisie: SaisieAntecedent) {
    await coeur.enregistrerAntecedent(patient.id, edition?.antecedent?.id ?? null, saisie);
    setEdition(null);
    await rafraichir();
  }

  async function supprimer() {
    if (!edition?.antecedent) return;
    await coeur.supprimerAntecedent(edition.antecedent.id);
    setEdition(null);
    await rafraichir();
  }

  return (
    <div className="pile">
      {edition && (
        <EditeurAntecedent
          key={edition.antecedent?.id ?? `${edition.depart.categorie}-${edition.depart.rubrique}`}
          formulaire={formulaire}
          depart={edition.depart}
          existant={edition.antecedent !== null}
          enregistrer={enregistrer}
          supprimer={edition.antecedent ? supprimer : null}
          annuler={() => setEdition(null)}
        />
      )}
      <div className="colonnes-dossier">
        {formulaire.map((categorie) => {
          const liste = antecedents.filter((a) => a.categorie === categorie.cle);
          return (
            <section key={categorie.cle} className="carte" aria-labelledby={`categorie-${categorie.cle}`}>
              <h2 id={`categorie-${categorie.cle}`}>
                {categorie.libelle} {liste.length > 0 && <span className="discret">· {liste.length}</span>}
              </h2>
              {liste.length > 0 && (
                <ul className="liste-antecedents">
                  {liste.map((a) => {
                    const style = apparence(a);
                    return (
                      <li key={a.id}>
                        <span className="point-couleur" style={{ background: style.trait }} aria-hidden="true" />
                        <span className="liste-antecedents-texte">
                          <strong>{intitule(a)}</strong>
                          {a.important && <span className="puce puce-alerte">Important</span>}
                          {periode(a) && <span className="discret">{periode(a)}</span>}
                        </span>
                        <button type="button" className="lien-bouton" onClick={() => setEdition({ antecedent: a, depart: a })} aria-label={`Modifier ${intitule(a)}`}>
                          Modifier
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="rubriques" role="group" aria-label={`Ajouter un antécédent ${categorie.libelle.toLowerCase()}`}>
                {categorie.rubriques.map((r) => (
                  <button key={r} type="button" className="bouton bouton-petit" onClick={() => ouvrir(categorie.cle, r)} aria-label={`Ajouter : ${r}`}>
                    <span aria-hidden="true">+</span> {r}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <RemarquesAntecedents key={patient.id} patient={patient} coeur={coeur} misAJour={misAJour} />
    </div>
  );
}

/** Carte de la synthèse : antécédents en puces, par catégorie. */
export function CarteAntecedents({ patient, antecedents, formulaire }: { patient: Patient; antecedents: Antecedent[]; formulaire: CategorieAntecedents[] }) {
  const vides = formulaire.filter((c) => !antecedents.some((a) => a.categorie === c.cle));
  return (
    <section className="carte" aria-labelledby="titre-antecedents">
      <div className="entete-carte">
        <h2 id="titre-antecedents">Antécédents</h2>
        <a className="bouton bouton-petit" href={adresse("patients", patient.id, "antecedents")}>
          Ajouter
        </a>
      </div>
      {formulaire
        .filter((c) => antecedents.some((a) => a.categorie === c.cle))
        .map((c) => (
          <div key={c.cle} className="pile-serree">
            <h3 className="sur-titre">{c.libelle}</h3>
            <div className="rangee">
              {antecedents
                .filter((a) => a.categorie === c.cle)
                .map((a) => {
                  const style = apparence(a);
                  const quand = a.debut ? (a.en_cours ? periode(a) : a.debut.slice(0, 4)) : "";
                  return (
                    <span key={a.id} className="puce" style={{ background: style.fond, color: style.encre }}>
                      {a.important && <span aria-hidden="true">⚠</span>}
                      {intitule(a)}
                      {quand && `, ${quand}`}
                    </span>
                  );
                })}
            </div>
          </div>
        ))}
      {vides.length > 0 && (
        <p className="discret">
          {vides
            .map((c, rang) => (rang === 0 ? c.libelle : c.libelle.toLocaleLowerCase("fr")))
            .join(", ")
            .replace(/, ([^,]*)$/, " et $1")}{" "}
          : rien de renseigné
        </p>
      )}
    </section>
  );
}
