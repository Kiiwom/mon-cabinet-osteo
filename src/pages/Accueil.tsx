import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import { lireInfosApplication, type InfosApplication } from "../lib/application";
import {
  dateDuJour,
  type BlocAccueil,
  type Coeur,
  type EtatSauvegardes,
  type IdentiteCabinet,
  type PreferencesAccueil,
  type ResumePatient,
  type ResumeSeance,
} from "../lib/coeur";
import { dateCourte, ecrireDateFr } from "../lib/dates";
import { euros, type ResumeFacture } from "../lib/facturation";
import { adresse, aller } from "../lib/navigation";
import { rechercherPatients } from "../lib/recherche";
import { jourEnLettres } from "../lib/seances";
import type { Statistiques } from "../lib/statistiques";
import { momentEnLettres } from "../sauvegardes/Restauration";
import { EtatFacturation } from "../seances/ListeSeances";
import { creerSeanceMaintenant } from "../seances/nouvelleSeance";
import { MOIS_LONGS } from "../statistiques/Graphiques";
import { ALERTE_SAUVEGARDE_JOURS, joursDepuis } from "./ParametresSauvegardes";

/** « de » devient « d’ » devant une voyelle ou un h muet : Cabinet d’Alexandre Roux. */
export function deOuD(mot: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(mot) ? "d’" : "de ";
}

export const BLOCS: { cle: BlocAccueil; titre: string }[] = [
  { cle: "seances_du_jour", titre: "Séances du jour" },
  { cle: "a_facturer", titre: "À facturer" },
  { cle: "statistiques", titre: "Chiffres du mois" },
  { cle: "pense_betes", titre: "Pense-bêtes" },
  { cle: "en_attente", titre: "Paiements en attente" },
  { cle: "anniversaires", titre: "Anniversaires de la semaine" },
  { cle: "sauvegarde", titre: "Sauvegarde" },
];

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function iso(d: Date): string {
  return dateDuJour(d);
}

function eurosRonds(centimes: number): string {
  return `${Math.round(centimes / 100).toLocaleString("fr-FR")} €`;
}

/** Anniversaires des sept prochains jours, aujourd'hui compris ; le 29 février fêté le 28 les autres années. */
export function anniversaires(patients: ResumePatient[], aujourdhui: Date): { patient: ResumePatient; age: number; jour: string }[] {
  const resultat: { patient: ResumePatient; age: number; jour: string; ecart: number }[] = [];
  for (const p of patients) {
    if (!p.naissance || p.archive || p.decede) continue;
    const [a, m, j] = p.naissance.split("-").map(Number);
    for (let ecart = 0; ecart < 7; ecart += 1) {
      const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() + ecart);
      const bissextile = new Date(d.getFullYear(), 1, 29).getMonth() === 1;
      const jourFete = m === 2 && j === 29 && !bissextile ? 28 : j;
      if (d.getMonth() + 1 === m && d.getDate() === jourFete && d.getFullYear() > a) {
        resultat.push({ patient: p, age: d.getFullYear() - a, jour: ecart === 0 ? "aujourd’hui" : ecart === 1 ? "demain" : JOURS[d.getDay()], ecart });
        break;
      }
    }
  }
  return resultat.sort((x, y) => x.ecart - y.ecart || x.patient.nom.localeCompare(y.patient.nom, "fr"));
}

function Bloc({ titre, lien, children, id }: { titre: string; lien?: { href: string; texte: string }; children: ReactNode; id: string }) {
  return (
    <section className="carte bloc-accueil" aria-labelledby={id}>
      <div className="entete-carte">
        <h2 id={id}>{titre}</h2>
        {lien && (
          <a href={lien.href} className="lien-discret">
            {lien.texte}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function variation(valeur: number, precedent: number, format: (v: number) => string, annee: string): string {
  if (valeur === precedent) return `autant qu’en ${annee}`;
  const ecart = valeur - precedent;
  if (precedent === 0) return `+${format(ecart)} sur ${annee} à date`;
  const pourcent = Math.round((ecart / Math.abs(precedent)) * 100);
  return `${ecart > 0 ? "+" : "−"}${format(Math.abs(ecart))} (${ecart > 0 ? "+" : "−"}${Math.abs(pourcent)} %) sur ${annee} à date`;
}

function PenseBetes({ preferences, enregistrer, aujourdhui }: { preferences: PreferencesAccueil; enregistrer: (p: PreferencesAccueil) => Promise<boolean>; aujourdhui: Date }) {
  const id = useId();
  const [texte, setTexte] = useState("");
  const ajouter = (e: FormEvent) => {
    e.preventDefault();
    if (!texte.trim()) return;
    void enregistrer({ ...preferences, pense_betes: [{ id: "", texte, le: iso(aujourdhui) }, ...preferences.pense_betes] }).then((ok) => ok && setTexte(""));
  };
  return (
    <>
      <form className="ajout-pense-bete" onSubmit={ajouter}>
        <label htmlFor={`${id}-texte`} className="visuellement-cache">
          Nouveau pense-bête
        </label>
        <input id={`${id}-texte`} value={texte} maxLength={300} placeholder="Nouveau pense-bête" onChange={(e) => setTexte(e.target.value)} />
        <button type="submit" className="bouton bouton-petit" disabled={!texte.trim()}>
          Ajouter
        </button>
      </form>
      {preferences.pense_betes.length === 0 ? (
        <p className="discret">Rien à se rappeler pour l’instant.</p>
      ) : (
        <ul className="liste-accueil">
          {preferences.pense_betes.map((p) => (
            <li key={p.id}>
              <span className="pile-serree">
                <span>{p.texte}</span>
                <span className="discret">{dateCourte(p.le)}</span>
              </span>
              <button
                type="button"
                className="bouton bouton-petit"
                aria-label={`Fait : ${p.texte}`}
                onClick={() => void enregistrer({ ...preferences, pense_betes: preferences.pense_betes.filter((x) => x.id !== p.id) })}
              >
                Fait
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Nouvelle séance depuis l'accueil : le patient se choisit au clavier, la séance s'ouvre aussitôt. */
function NouvelleSeance({ coeur, fermer }: { coeur: Coeur; fermer: () => void }) {
  const id = useId();
  const [patients, setPatients] = useState<ResumePatient[]>([]);
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    coeur.listerPatients().then(setPatients, (e: Error) => setErreur(e.message));
  }, [coeur]);

  const suivis = patients.filter((p) => !p.archive && !p.decede);
  const proposes = texte.trim()
    ? rechercherPatients(suivis, texte)
        .slice(0, 6)
        .map((r) => r.patient)
    : [...suivis].sort((a, b) => (b.derniere_seance ?? "").localeCompare(a.derniere_seance ?? "")).slice(0, 6);

  const choisir = async (patient: ResumePatient | undefined) => {
    if (!patient || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const seance = await creerSeanceMaintenant(coeur, patient);
      aller("seances", seance.id);
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  };

  return (
    <section className="carte nouvelle-seance" aria-labelledby={`${id}-titre`}>
      <div className="entete-carte">
        <h2 id={`${id}-titre`}>Nouvelle séance</h2>
        <button type="button" className="lien-bouton" onClick={fermer}>
          Annuler
        </button>
      </div>
      <div className="champ">
        <label htmlFor={`${id}-patient`}>Pour quel patient&nbsp;?</label>
        <input
          id={`${id}-patient`}
          type="search"
          autoFocus
          placeholder="Nom, prénom, téléphone, ville…"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void choisir(proposes[0]);
            } else if (e.key === "Escape") fermer();
          }}
        />
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <ul className="liste-accueil" aria-label={texte.trim() ? "Patients trouvés" : "Patients vus récemment"}>
        {proposes.map((p) => (
          <li key={p.id}>
            <button type="button" className="ligne-choix-patient" disabled={envoi} onClick={() => void choisir(p)}>
              <strong>
                {p.prenom} {p.nom}
              </strong>
              <span className="discret">
                {[p.naissance ? ecrireDateFr(p.naissance) : "", p.ville, p.derniere_seance ? `vu le ${dateCourte(p.derniere_seance)}` : "jamais vu"].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}
        {proposes.length === 0 && <li className="discret">Aucun patient ne correspond.</li>}
      </ul>
      <p className="discret">
        Nouveau patient&nbsp;? <a href={adresse("patients", "nouveau")}>Créer son dossier</a>, puis «&nbsp;Nouvelle séance&nbsp;».
      </p>
    </section>
  );
}

/** Accueil du cabinet : la journée, ce qui attend, les chiffres du mois ; chaque bloc peut être masqué. */
export function Accueil({ coeur, cabinet, aujourdhui = new Date() }: { coeur: Coeur; cabinet: IdentiteCabinet; aujourdhui?: Date }) {
  const id = useId();
  const jour = iso(aujourdhui);
  const debutDuMois = `${jour.slice(0, 8)}01`;
  const [infos, setInfos] = useState<InfosApplication | null>(null);
  const [preferences, setPreferences] = useState<PreferencesAccueil | null>(null);
  const [duJour, setDuJour] = useState<ResumeSeance[]>([]);
  const [aFacturer, setAFacturer] = useState<ResumeSeance[]>([]);
  const [stats, setStats] = useState<Statistiques | null>(null);
  const [attente, setAttente] = useState<ResumeFacture[]>([]);
  const [patients, setPatients] = useState<ResumePatient[]>([]);
  const [sauvegardes, setSauvegardes] = useState<EtatSauvegardes | null>(null);
  const [personnaliser, setPersonnaliser] = useState(false);
  const [choixSeance, setChoixSeance] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    lireInfosApplication().then(setInfos, () => setInfos(null));
  }, []);

  useEffect(() => {
    let actif = true;
    const garder =
      <T,>(f: (v: T) => void) =>
      (v: T) => {
        if (actif) f(v);
      };
    const signaler = (e: Error) => actif && setErreur(e.message);
    coeur.accueil().then(garder(setPreferences), signaler);
    coeur.listerSeancesPeriode(jour, jour).then(garder((s: ResumeSeance[]) => setDuJour([...s].sort((a, b) => a.debut.localeCompare(b.debut)))), signaler);
    coeur.seancesAFacturer().then(garder((s: ResumeSeance[]) => setAFacturer(s.filter((x) => !x.facture))), signaler);
    coeur.statistiques(debutDuMois, jour, "encaissement").then(garder(setStats), signaler);
    coeur.facturesEnAttente().then(garder(setAttente), signaler);
    coeur.listerPatients().then(garder(setPatients), signaler);
    coeur.etatDesSauvegardes().then(garder(setSauvegardes), signaler);
    return () => {
      actif = false;
    };
  }, [coeur, jour, debutDuMois]);

  const enregistrer = async (nouvelles: PreferencesAccueil) => {
    setErreur(null);
    try {
      setPreferences(await coeur.enregistrerAccueil(nouvelles));
      return true;
    } catch (e) {
      setErreur((e as Error).message);
      return false;
    }
  };
  const visible = (bloc: BlocAccueil) => preferences !== null && !preferences.masques.includes(bloc);
  const sauvegarder = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await coeur.sauvegarderMaintenant();
      setSauvegardes(await coeur.etatDesSauvegardes());
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  };

  const [annee, mois, quantieme] = jour.split("-").map(Number);
  const anneePrecedente = `${MOIS_LONGS[mois - 1]} ${annee - 1}`;
  const fetes = anniversaires(patients, aujourdhui);
  const enRetard = sauvegardes?.derniere ? joursDepuis(sauvegardes.derniere.le, aujourdhui.getTime()) > ALERTE_SAUVEGARDE_JOURS : true;
  const titreJour = jourEnLettres(jour);

  const gauche: ReactNode[] = [];
  const droite: ReactNode[] = [];
  if (visible("seances_du_jour"))
    gauche.push(
      <Bloc key="seances_du_jour" id={`${id}-jour`} titre="Séances du jour" lien={{ href: adresse("seances"), texte: "Toutes les séances" }}>
        {duJour.length === 0 ? (
          <p className="discret">Aucune séance aujourd’hui pour l’instant.</p>
        ) : (
          <ul className="liste-accueil">
            {duJour.map((s) => (
              <li key={s.id}>
                <a href={adresse("seances", s.id)} className="ligne-accueil">
                  <strong className="heure-accueil">{s.debut.slice(11, 16)}</strong>
                  <span className="pile-serree">
                    <span>
                      {s.patient_prenom} {s.patient_nom}
                    </span>
                    {s.motif && <span className="discret">{s.motif}</span>}
                  </span>
                </a>
                <EtatFacturation seance={s} />
              </li>
            ))}
          </ul>
        )}
      </Bloc>,
    );
  if (visible("a_facturer"))
    gauche.push(
      <Bloc key="a_facturer" id={`${id}-facturer`} titre="À facturer" lien={aFacturer.length ? { href: adresse("facturation", "a-facturer"), texte: `Facturer les ${aFacturer.length}` } : undefined}>
        {aFacturer.length === 0 ? (
          <p className="discret">Toutes les séances sont facturées.</p>
        ) : (
          <ul className="liste-accueil">
            {aFacturer.slice(0, 5).map((s) => (
              <li key={s.id}>
                <a href={adresse("seances", s.id)} className="ligne-accueil">
                  <strong className="heure-accueil">{dateCourte(s.debut.slice(0, 10)).replace(/ \d{4}$/, "")}</strong>
                  <span>
                    {s.patient_prenom} {s.patient_nom}
                  </span>
                </a>
              </li>
            ))}
            {aFacturer.length > 5 && <li className="discret">et {aFacturer.length - 5} autre(s)</li>}
          </ul>
        )}
      </Bloc>,
    );
  if (visible("statistiques") && stats)
    droite.push(
      <Bloc key="statistiques" id={`${id}-stats`} titre={`${MOIS_LONGS[mois - 1].replace(/^./, (c) => c.toUpperCase())}, au ${quantieme === 1 ? "1er" : quantieme} du mois`} lien={{ href: adresse("statistiques"), texte: "Statistiques" }}>
        <dl className="chiffres-accueil">
          <div>
            <dt>Séances</dt>
            <dd>
              <strong>{stats.seances.valeur}</strong>
              <span className="discret">{variation(stats.seances.valeur, stats.seances.precedent, String, anneePrecedente)}</span>
            </dd>
          </div>
          <div>
            <dt>Encaissé</dt>
            <dd>
              <strong>{eurosRonds(stats.chiffre.valeur)}</strong>
              <span className="discret">{variation(stats.chiffre.valeur, stats.chiffre.precedent, eurosRonds, anneePrecedente)}</span>
            </dd>
          </div>
          <div>
            <dt>Nouveaux patients</dt>
            <dd>
              <strong>{stats.nouveaux_patients.valeur}</strong>
              <span className="discret">{variation(stats.nouveaux_patients.valeur, stats.nouveaux_patients.precedent, String, anneePrecedente)}</span>
            </dd>
          </div>
        </dl>
      </Bloc>,
    );
  if (visible("pense_betes") && preferences)
    droite.push(
      <Bloc key="pense_betes" id={`${id}-notes`} titre="Pense-bêtes">
        <PenseBetes preferences={preferences} enregistrer={enregistrer} aujourdhui={aujourdhui} />
      </Bloc>,
    );
  if (visible("en_attente"))
    droite.push(
      <Bloc key="en_attente" id={`${id}-attente`} titre="Paiements en attente" lien={attente.length ? { href: adresse("facturation", "en-attente"), texte: "Voir les factures" } : undefined}>
        {attente.length === 0 ? (
          <p className="discret">Toutes les factures émises sont réglées.</p>
        ) : (
          <p className="ligne-info">
            <span>
              {attente.length} facture{attente.length > 1 ? "s" : ""} émise{attente.length > 1 ? "s" : ""} non réglée{attente.length > 1 ? "s" : ""}
            </span>
            <strong>{euros(attente.reduce((t, f) => t + f.reste_centimes, 0))}</strong>
          </p>
        )}
      </Bloc>,
    );
  if (visible("anniversaires"))
    droite.push(
      <Bloc key="anniversaires" id={`${id}-anniversaires`} titre="Anniversaires de la semaine">
        {fetes.length === 0 ? (
          <p className="discret">Aucun anniversaire cette semaine.</p>
        ) : (
          <ul className="liste-accueil">
            {fetes.map(({ patient, age, jour: quand }) => (
              <li key={patient.id}>
                <a href={adresse("patients", patient.id)}>
                  {patient.prenom} {patient.nom}
                </a>
                <span className="discret">
                  {age} an{age > 1 ? "s" : ""} {quand}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Bloc>,
    );
  if (visible("sauvegarde") && sauvegardes)
    droite.push(
      <Bloc key="sauvegarde" id={`${id}-sauvegarde`} titre={sauvegardes.erreur ? "Sauvegarde en échec" : enRetard ? "Sauvegarde à faire" : "Sauvegarde à jour"} lien={{ href: adresse("parametres", "sauvegardes"), texte: "Réglages" }}>
        {sauvegardes.erreur && (
          <p className="alerte" role="alert">
            {sauvegardes.erreur}
          </p>
        )}
        <p className="discret">
          {sauvegardes.derniere ? `Dernière sauvegarde le ${momentEnLettres(sauvegardes.derniere.le)}, dans ${sauvegardes.dossier}.` : "Aucune sauvegarde pour l’instant."}
        </p>
        <div className="rangee">
          <button type="button" className="bouton bouton-petit" onClick={() => void sauvegarder()} disabled={envoi}>
            {envoi ? "Sauvegarde…" : "Sauvegarder maintenant"}
          </button>
        </div>
      </Bloc>,
    );

  return (
    <main className="page page-accueil">
      <div className="entete-page">
        <div>
          <p className="discret">{titreJour.replace(/^./, (c) => c.toUpperCase())}</p>
          <h1 className="page-titre">
            Bonjour {cabinet.prenom}
            {duJour.length > 0 && `, ${duJour.length} séance${duJour.length > 1 ? "s" : ""} aujourd’hui`}
          </h1>
          <p className="page-sous-titre">
            Cabinet {deOuD(cabinet.prenom)}
            {cabinet.prenom} {cabinet.nom}
            {coeur.reel ? "" : " · démonstration avec des données fictives : rien n’est enregistré"}
          </p>
        </div>
        <div className="rangee">
          <a className="bouton" href={adresse("patients", "nouveau")}>
            Nouveau patient
          </a>
          <button type="button" className="bouton bouton-principal" aria-expanded={choixSeance} onClick={() => setChoixSeance((v) => !v)}>
            Nouvelle séance
          </button>
          <button type="button" className="bouton" aria-expanded={personnaliser} onClick={() => setPersonnaliser((v) => !v)}>
            Personnaliser l’accueil
          </button>
        </div>
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {choixSeance && <NouvelleSeance coeur={coeur} fermer={() => setChoixSeance(false)} />}
      {personnaliser && preferences && (
        <fieldset className="carte groupe">
          <legend>Blocs affichés</legend>
          <div className="choix-blocs">
            {BLOCS.map((b) => (
              <label key={b.cle} className="case-simple">
                <input
                  type="checkbox"
                  checked={!preferences.masques.includes(b.cle)}
                  onChange={(e) =>
                    void enregistrer({
                      ...preferences,
                      masques: e.target.checked ? preferences.masques.filter((m) => m !== b.cle) : [...preferences.masques, b.cle],
                    })
                  }
                />
                {b.titre}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grille-accueil">
        <div className="pile">{gauche}</div>
        <div className="pile">{droite}</div>
      </div>
      {infos && (
        <p className="discret">
          Osteosphere {infos.version} · cœur {infos.version_coeur}
        </p>
      )}
    </main>
  );
}
