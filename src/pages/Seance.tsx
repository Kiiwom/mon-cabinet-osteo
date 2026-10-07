import { useCallback, useEffect, useId, useRef, useState } from "react";

import { intitule, libelleCategorie, periode } from "../antecedents/apparence";
import type { Antecedent, CategorieAntecedents, CaractereTrames, Coeur, Definition, Modele, Patient, ResumeSeance, SaisieSeance, Seance } from "../lib/coeur";
import { dateCourte, ecrireDateFr, lireDateFr } from "../lib/dates";
import { adresse, aller } from "../lib/navigation";
import { estVide, evolutionDouleur, jourEnLettres, TYPES_SEANCE } from "../lib/seances";
import { FinDeSeance } from "../facturation/FinDeSeance";
import { Avatar } from "../patients/Avatar";
import { ChampSeance, type ContexteSaisie } from "../seances/ChampSeance";
import type { TrameResume } from "../trames/valider";
import { descriptionPatient, PucesPatient } from "./Dossier";

type EtatEnregistrement = { type: "enregistre"; a: Date } | { type: "en_cours" } | { type: "erreur"; message: string } | { type: "aucun" };

const DELAI_ENREGISTREMENT = 700;

function saisieDe(s: Seance): SaisieSeance {
  const { debut, modele_id, modele_version, type, titre, importante, valeurs, facturation, commentaire_gratuit } = s;
  return { debut, modele_id, modele_version, type, titre, importante, valeurs, facturation, commentaire_gratuit };
}

/**
 * Enregistrement au fil de la saisie : chaque changement relance un court délai, puis la séance part
 * au cœur. Rien n'est perdu en quittant l'écran : l'enregistrement en attente part tout de suite.
 */
function useEnregistrementAuto(coeur: Coeur, id: string) {
  const [etat, setEtat] = useState<EtatEnregistrement>({ type: "aucun" });
  const enAttente = useRef<SaisieSeance | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  const envoyer = useCallback(async () => {
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
    const saisie = enAttente.current;
    if (!saisie) return;
    enAttente.current = null;
    setEtat({ type: "en_cours" });
    try {
      await coeur.enregistrerSeance(id, saisie);
      if (!enAttente.current) setEtat({ type: "enregistre", a: new Date() });
    } catch (e) {
      enAttente.current ??= saisie;
      setEtat({ type: "erreur", message: (e as Error).message });
    }
  }, [coeur, id]);

  const planifier = useCallback(
    (saisie: SaisieSeance) => {
      enAttente.current = saisie;
      if (minuterie.current) clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => void envoyer(), DELAI_ENREGISTREMENT);
    },
    [envoyer],
  );

  useEffect(() => {
    const cacher = () => {
      if (document.visibilityState === "hidden") void envoyer();
    };
    document.addEventListener("visibilitychange", cacher);
    return () => {
      document.removeEventListener("visibilitychange", cacher);
      void envoyer();
    };
  }, [envoyer]);

  return { etat, planifier, envoyer };
}

function EtatSauvegarde({ etat, reessayer }: { etat: EtatEnregistrement; reessayer: () => void }) {
  if (etat.type === "erreur") {
    return (
      <p className="alerte rangee" role="alert">
        Séance non enregistrée : {etat.message}
        <button type="button" className="bouton bouton-petit" onClick={reessayer}>
          Réessayer
        </button>
      </p>
    );
  }
  const texte =
    etat.type === "en_cours"
      ? "Enregistrement…"
      : etat.type === "enregistre"
        ? `Enregistré à ${String(etat.a.getHours()).padStart(2, "0")}:${String(etat.a.getMinutes()).padStart(2, "0")}`
        : "Enregistrement automatique";
  return (
    <p className="etat-seance" role="status" data-etat={etat.type}>
      {etat.type === "enregistre" && <span aria-hidden="true">✓ </span>}
      {texte}
    </p>
  );
}

function Reperes({ patient, antecedents, formulaire }: { patient: Patient; antecedents: Antecedent[]; formulaire: CategorieAntecedents[] }) {
  const alertes = [patient.notes_importantes, ...antecedents.filter((a) => a.important).map(intitule)].filter(Boolean);
  const dates = antecedents.filter((a) => a.debut || a.en_cours).sort((a, b) => (b.debut ?? "9999").localeCompare(a.debut ?? "9999"));
  return (
    <section className="carte" aria-labelledby="titre-reperes">
      <h2 id="titre-reperes">Repères</h2>
      {alertes.length > 0 && (
        <p className="alerte-repere">
          {alertes.map((a, rang) => (
            <span key={rang}>
              {a}
              {rang < alertes.length - 1 ? ". " : "."}
            </span>
          ))}
        </p>
      )}
      {dates.length > 0 ? (
        <dl className="liste-reperes">
          {dates.slice(0, 6).map((a) => (
            <div key={a.id}>
              <dt>{a.en_cours ? "En cours" : a.debut!.slice(0, 4)}</dt>
              <dd>
                <span>{intitule(a)}</span>
                <span className="discret">
                  {libelleCategorie(formulaire, a.categorie)}
                  {a.en_cours && a.debut ? ` · ${periode(a)}` : ""}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        alertes.length === 0 && <p className="discret">Aucun antécédent daté.</p>
      )}
      <a href={adresse("patients", patient.id)}>Voir la frise de vie</a>
    </section>
  );
}

function SeancesPrecedentes({
  coeur,
  patient,
  precedentes,
  definition,
  reprendre,
}: {
  coeur: Coeur;
  patient: Patient;
  precedentes: ResumeSeance[];
  definition: Definition;
  reprendre: (valeurs: Record<string, unknown>) => void;
}) {
  const id = useId();
  const [choix, setChoix] = useState<{ seance: Seance; champs: string[] } | null>(null);
  const reprenables = (s: Seance) => definition.champs.filter((c) => !["intertitre", "dessin", "resume_precedent"].includes(c.type) && !estVide(s.valeurs[c.id]));

  async function ouvrir(resume: ResumeSeance) {
    const seance = await coeur.lireSeance(resume.id);
    const champs = reprenables(seance)
      .filter((c) => !["douleur_avant", "douleur_apres"].includes(c.role))
      .map((c) => c.id);
    setChoix({ seance, champs });
  }

  return (
    <section className="carte" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>Séances précédentes</h2>
      {precedentes.length === 0 && <p className="discret">Première séance de ce dossier.</p>}
      {precedentes.slice(0, 3).map((s) => (
        <article key={s.id} className="seance-precedente">
          <div className="rangee entre">
            <a href={adresse("seances", s.id)}>
              <strong>{dateCourte(s.debut.slice(0, 10))}</strong>
            </a>
            <span className="discret">{evolutionDouleur(s)}</span>
          </div>
          <p>{s.titre || s.motif || <span className="discret">Sans motif</span>}</p>
          {choix?.seance.id === s.id ? (
            <fieldset className="reprise">
              <legend>Champs à reprendre</legend>
              {reprenables(choix.seance).map((c) => (
                <label key={c.id} className="case-simple">
                  <input
                    type="checkbox"
                    checked={choix.champs.includes(c.id)}
                    onChange={(e) => setChoix({ ...choix, champs: e.target.checked ? [...choix.champs, c.id] : choix.champs.filter((x) => x !== c.id) })}
                  />
                  {c.libelle}
                </label>
              ))}
              <div className="rangee">
                <button
                  type="button"
                  className="bouton bouton-petit"
                  disabled={choix.champs.length === 0}
                  onClick={() => {
                    reprendre(Object.fromEntries(choix.champs.map((c) => [c, structuredClone(choix.seance.valeurs[c])])));
                    setChoix(null);
                  }}
                >
                  Reprendre ces champs
                </button>
                <button type="button" className="lien-bouton" onClick={() => setChoix(null)}>
                  Annuler
                </button>
              </div>
            </fieldset>
          ) : (
            <button type="button" className="bouton bouton-petit" onClick={() => void ouvrir(s)}>
              Reprendre dans cette séance
            </button>
          )}
        </article>
      ))}
      {precedentes.length > 3 && <a href={adresse("patients", patient.id, "seances")}>Voir les {precedentes.length} séances</a>}
    </section>
  );
}

export function PageSeance({ coeur, id }: { coeur: Coeur; id: string }) {
  const idTitre = useId();
  const [seance, setSeance] = useState<Seance | null>(null);
  const [saisie, setSaisie] = useState<SaisieSeance | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [antecedents, setAntecedents] = useState<Antecedent[]>([]);
  const [formulaire, setFormulaire] = useState<CategorieAntecedents[]>([]);
  const [modeles, setModeles] = useState<Modele[]>([]);
  const [definition, setDefinition] = useState<Definition | null>(null);
  const [precedentes, setPrecedentes] = useState<ResumeSeance[]>([]);
  const [toutes, setToutes] = useState<ResumeSeance[]>([]);
  const [trames, setTrames] = useState<TrameResume[]>([]);
  const [caractere, setCaractere] = useState<CaractereTrames>("@");
  const [erreur, setErreur] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [date, setDate] = useState("");
  const [heure, setHeure] = useState("");
  const [menu, setMenu] = useState(false);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const { etat, planifier, envoyer } = useEnregistrementAuto(coeur, id);

  useEffect(() => {
    let actif = true;
    (async () => {
      const s = await coeur.lireSeance(id);
      const [p, a, f, m, d, liste, t, c] = await Promise.all([
        coeur.lirePatient(s.patient_id),
        coeur.listerAntecedents(s.patient_id),
        coeur.formulaireAntecedents(),
        coeur.listerModeles(),
        coeur.lireVersionModele(s.modele_id, s.modele_version),
        coeur.listerSeancesPatient(s.patient_id),
        coeur.listerTrames(),
        coeur.caractereTrames(),
      ]);
      if (!actif) return;
      setSeance(s);
      setSaisie(saisieDe(s));
      setDate(ecrireDateFr(s.debut.slice(0, 10)));
      setHeure(s.debut.slice(11, 16));
      setPatient(p);
      setAntecedents(a);
      setFormulaire(f);
      setModeles(m);
      setDefinition(d);
      setToutes(liste);
      setPrecedentes(liste.filter((x) => x.id !== s.id && x.debut < s.debut));
      setTrames(t);
      setCaractere(c);
    })().catch((e: Error) => actif && setErreur(e.message));
    return () => {
      actif = false;
    };
  }, [coeur, id]);

  if (erreur) {
    return (
      <main className="page">
        <p className="alerte" role="alert">
          {erreur}
        </p>
        <a href={adresse("seances")}>Revenir aux séances</a>
      </main>
    );
  }
  if (!seance || !saisie || !patient || !definition) return <p className="page discret">Ouverture de la séance…</p>;

  const changer = (nouvelle: SaisieSeance) => {
    setSaisie(nouvelle);
    planifier(nouvelle);
  };
  const changerValeur = (champ: string) => (valeur: unknown) => changer({ ...saisie, valeurs: { ...saisie.valeurs, [champ]: valeur } });

  const contexte: ContexteSaisie = {
    trames,
    caractere,
    noterUtilisation: (t) => void coeur.noterUtilisationTrame(t.id).catch(() => undefined),
    precedente: precedentes[0] ?? null,
  };

  async function changerModele(modeleId: string) {
    const modele = modeles.find((m) => m.id === modeleId);
    if (!modele || !saisie) return;
    setDefinition(modele.definition);
    changer({ ...saisie, modele_id: modele.id, modele_version: modele.version });
  }

  const changerHoraire = (nouvelleDate: string, nouvelleHeure: string) => {
    setDate(nouvelleDate);
    setHeure(nouvelleHeure);
    const iso = lireDateFr(nouvelleDate);
    if (iso && /^([01]\d|2[0-3]):[0-5]\d$/.test(nouvelleHeure)) changer({ ...saisie, debut: `${iso}T${nouvelleHeure}` });
  };

  const reprendre = (valeurs: Record<string, unknown>) => {
    changer({ ...saisie, valeurs: { ...saisie.valeurs, ...valeurs } });
    // Les champs repris sont redessinés avec leur nouveau contenu.
    setVersions((v) => ({ ...v, ...Object.fromEntries(Object.keys(valeurs).map((c) => [c, (v[c] ?? 0) + 1])) }));
  };

  async function corbeille() {
    setMenu(false);
    setErreurAction(null);
    try {
      await envoyer();
      await coeur.supprimerSeance(id);
      aller("patients", patient!.id, "seances");
    } catch (e) {
      setErreurAction((e as Error).message);
    }
  }

  const dateSeance = saisie.debut.slice(0, 10);
  const premiereDeLAnnee = !toutes.some((s) => s.id !== seance.id && s.debut.slice(0, 4) === dateSeance.slice(0, 4) && s.debut < saisie.debut);
  const champsVisibles = definition.champs.filter((c) => c.visible && c.type !== "dessin");
  const manquants = champsVisibles.filter((c) => c.obligatoire && estVide(saisie.valeurs[c.id])).map((c) => c.libelle);
  const modelesProposes = modeles.filter((m) => m.actif || m.id === saisie.modele_id);
  const nombreSeances = toutes.length;
  const depuis = toutes.length ? toutes[toutes.length - 1].debut.slice(0, 4) : dateSeance.slice(0, 4);

  return (
    <main className="page page-large">
      <div className="entete-page">
        <nav className="fil" aria-label="Fil d’Ariane">
          <a href={adresse("patients")}>Patients</a> <span aria-hidden="true">›</span>{" "}
          <a href={adresse("patients", patient.id)}>
            {patient.prenom} {patient.nom}
          </a>{" "}
          <span aria-hidden="true">›</span> Séance du {dateCourte(dateSeance)}
        </nav>
        <EtatSauvegarde etat={etat} reessayer={() => void envoyer()} />
      </div>

      <section className="carte entete-seance" aria-label="Patient">
        <Avatar prenom={patient.prenom} nom={patient.nom} />
        <div className="pile-serree entete-dossier-nom">
          <strong className="nom-seance">
            {patient.prenom} {patient.nom}
          </strong>
          <span className="discret">
            {[descriptionPatient(patient), `${nombreSeances} séance${nombreSeances > 1 ? "s" : ""} depuis ${depuis}`].filter(Boolean).join(" · ")}
          </span>
          <PucesPatient patient={patient} antecedents={antecedents} />
        </div>
        <div className="rangee entete-dossier-actions">
          <a className="bouton" href={adresse("patients", patient.id)}>
            Ouvrir le dossier
          </a>
          <div className="menu-dossier">
            <button type="button" className="bouton bouton-icone" aria-label="Autres actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <span aria-hidden="true">⋯</span>
            </button>
            {menu && (
              <div className="menu-dossier-liste" role="menu">
                <button type="button" role="menuitem" onClick={() => void corbeille()}>
                  Mettre la séance à la corbeille
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {erreurAction && (
        <p className="alerte" role="alert">
          {erreurAction}
        </p>
      )}

      <div className="colonnes-seance">
        <section className="carte saisie-seance" aria-labelledby={idTitre}>
          <div className="entete-saisie">
            <div className="pile-serree">
              <h1 id={idTitre} className="titre-seance">
                Séance du {jourEnLettres(dateSeance)}
              </h1>
              <span className="discret">
                {saisie.debut.slice(11, 16)}
                {premiereDeLAnnee && " · première séance de l’année"}
              </span>
            </div>
            <div className="reglages-seance">
              <div className="champ">
                <label htmlFor={`${idTitre}-modele`}>Modèle</label>
                <select id={`${idTitre}-modele`} value={saisie.modele_id} onChange={(e) => void changerModele(e.target.value)}>
                  {modelesProposes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label htmlFor={`${idTitre}-type`}>Type</label>
                <select id={`${idTitre}-type`} value={saisie.type} onChange={(e) => changer({ ...saisie, type: e.target.value as SaisieSeance["type"] })}>
                  {TYPES_SEANCE.map((t) => (
                    <option key={t.valeur} value={t.valeur}>
                      {t.libelle}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rangee horaire-seance">
            <div className="champ">
              <label htmlFor={`${idTitre}-date`}>Date</label>
              <input
                id={`${idTitre}-date`}
                value={date}
                inputMode="numeric"
                aria-invalid={lireDateFr(date) ? undefined : true}
                onChange={(e) => changerHoraire(e.target.value, heure)}
              />
            </div>
            <div className="champ">
              <label htmlFor={`${idTitre}-heure`}>Heure</label>
              <input
                id={`${idTitre}-heure`}
                value={heure}
                inputMode="numeric"
                aria-invalid={/^([01]\d|2[0-3]):[0-5]\d$/.test(heure) ? undefined : true}
                onChange={(e) => changerHoraire(date, e.target.value)}
              />
            </div>
            <div className="champ titre-libre">
              <label htmlFor={`${idTitre}-titre`}>Titre (facultatif)</label>
              <input id={`${idTitre}-titre`} value={saisie.titre} onChange={(e) => changer({ ...saisie, titre: e.target.value })} />
            </div>
            <label className="case-simple">
              <input type="checkbox" checked={saisie.importante} onChange={(e) => changer({ ...saisie, importante: e.target.checked })} />
              Importante
            </label>
          </div>

          {champsVisibles.map((c) => (
            <ChampSeance key={`${c.id}-${versions[c.id] ?? 0}`} champ={c} valeur={saisie.valeurs[c.id]} changer={changerValeur(c.id)} contexte={contexte} />
          ))}
        </section>

        <div className="pile">
          {seance.importee ? (
            <section className="carte" aria-label="Séance importée">
              <span className="puce puce-discrete">Historique importé</span>
              <p className="discret">
                Séance reprise de MonCabinetLibéral. Sa facture, s’il y en avait une, a été reprise avec son numéro d’origine dans
                Facturation.
              </p>
            </section>
          ) : (
            <FinDeSeance
              coeur={coeur}
              seanceId={id}
              patient={patient}
              saisie={saisie}
              changer={changer}
              manquants={manquants}
              avantFacturer={envoyer}
            />
          )}
          <Reperes patient={patient} antecedents={antecedents} formulaire={formulaire} />
          <SeancesPrecedentes coeur={coeur} patient={patient} precedentes={precedentes} definition={definition} reprendre={reprendre} />
        </div>
      </div>
    </main>
  );
}
