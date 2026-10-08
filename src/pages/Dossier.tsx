import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import { intitule } from "../antecedents/apparence";
import { FriseDeVie } from "../antecedents/FriseDeVie";
import { CarteAntecedents, OngletAntecedents } from "../antecedents/OngletAntecedents";
import type { Antecedent, CategorieAntecedents, Coeur, Groupe, Patient, ResumeSeance } from "../lib/coeur";
import { accorder, ageEnClair, neLe } from "../lib/dates";
import { adresse, aller } from "../lib/navigation";
import { Avatar } from "../patients/Avatar";
import { depuisBrouillon, FormulaireFiche, versBrouillon, type BrouillonFiche, type ErreursFiche } from "../patients/FormulaireFiche";
import { PucesGroupes, useReglagesFiche } from "../patients/Groupes";
import { ListeSeancesPatient } from "../seances/ListeSeances";
import { creerSeanceMaintenant } from "../seances/nouvelleSeance";
import { Documents } from "../documents/Documents";
import { FenetreDossierPdf } from "../patients/DossierPdf";
import { OngletHistorique } from "../patients/Historique";
import { CarteProches } from "../patients/Proches";
import { TexteRiche } from "../trames/TexteRiche";

export type Onglet = "synthese" | "seances" | "antecedents" | "documents" | "identite" | "historique";

const ONGLETS: { onglet: Onglet; libelle: string }[] = [
  { onglet: "synthese", libelle: "Synthèse" },
  { onglet: "seances", libelle: "Séances" },
  { onglet: "antecedents", libelle: "Antécédents" },
  { onglet: "documents", libelle: "Documents" },
  { onglet: "identite", libelle: "Identité et contact" },
  { onglet: "historique", libelle: "Historique" },
];

export function ongletDepuis(segment: string | undefined): Onglet {
  return ONGLETS.some((o) => o.onglet === segment) ? (segment as Onglet) : "synthese";
}

function minusculeInitiale(texte: string): string {
  return texte.charAt(0).toLocaleLowerCase("fr") + texte.slice(1);
}

const LATERALITES = { droitier: ["droitier", "droitière"], gaucher: ["gaucher", "gauchère"], ambidextre: ["ambidextre", "ambidextre"] } as const;

/** « 38 ans · née le 14 mars 1988 · infirmière · droitière · Fumel » */
export function descriptionPatient(p: Patient): string {
  const parties: string[] = [];
  if (p.naissance) parties.push(ageEnClair(p.naissance), neLe(p.sexe, p.naissance));
  if (p.profession) parties.push(minusculeInitiale(p.profession));
  if (p.retraite) parties.push(accorder(p.sexe, "retraité", "retraitée"));
  if (p.lateralite) {
    const [masculin, feminin] = LATERALITES[p.lateralite];
    parties.push(accorder(p.sexe, masculin, feminin));
  }
  if (p.ville) parties.push(p.ville);
  return parties.join(" · ");
}

/** Puces sous le nom : notes importantes d'abord, puis statut et situations particulières. */
export function PucesPatient({ patient, antecedents = [], groupes = [] }: { patient: Patient; antecedents?: Antecedent[]; groupes?: Groupe[] }) {
  const premiereLigne = patient.notes_importantes.split("\n")[0];
  return (
    <div className="rangee">
      {premiereLigne && (
        <span className="puce puce-alerte" title={patient.notes_importantes}>
          <span aria-hidden="true">⚠</span> {premiereLigne}
        </span>
      )}
      {antecedents
        .filter((a) => a.important)
        .map((a) => (
          <span key={a.id} className="puce puce-alerte">
            <span aria-hidden="true">⚠</span> {intitule(a)}
          </span>
        ))}
      {patient.statut && <span className="puce">{patient.statut}</span>}
      <PucesGroupes ids={patient.groupes} groupes={groupes} />
      {patient.archive && <span className="puce puce-discrete">Archivé</span>}
      {patient.decede && <span className="puce puce-discrete">{accorder(patient.sexe, "Décédé", "Décédée")}</span>}
      {patient.mobilite_reduite && <span className="puce">Mobilité réduite</span>}
    </div>
  );
}

function MenuDossier({ patient, archiver, dossierPdf }: { patient: Patient; archiver: (archive: boolean) => void; dossierPdf: () => void }) {
  const id = useId();
  const [ouvert, setOuvert] = useState(false);
  const choisir = (action: () => void) => () => {
    setOuvert(false);
    action();
  };
  return (
    <div className="menu-dossier">
      <button
        type="button"
        className="bouton bouton-icone"
        aria-label="Autres actions"
        aria-expanded={ouvert}
        aria-controls={id}
        onClick={() => setOuvert((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {ouvert && (
        <div className="menu-dossier-liste" id={id} role="menu">
          <button type="button" role="menuitem" onClick={choisir(dossierPdf)}>
            Dossier PDF…
          </button>
          <button type="button" role="menuitem" onClick={choisir(() => aller("patients", patient.id, "fusion"))}>
            Fusionner avec un autre dossier…
          </button>
          <button type="button" role="menuitem" onClick={choisir(() => archiver(!patient.archive))}>
            {patient.archive ? "Sortir des archives" : "Archiver le dossier"}
          </button>
          <button type="button" role="menuitem" className="menu-danger" onClick={choisir(() => aller("patients", patient.id, "effacement"))}>
            Effacer le dossier…
          </button>
        </div>
      )}
    </div>
  );
}

function Ligne({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="ligne-info">
      <dt>{libelle}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const CLE_FRISE = "osteosphere.dossier.frise-repliee";

/** La frise de vie, en tête de chaque onglet du dossier ; repliée, elle tient sur une ligne. */
function BandeauFrise({
  patient,
  antecedents,
  formulaire,
  seances,
}: {
  patient: Patient;
  antecedents: Antecedent[];
  formulaire: CategorieAntecedents[];
  seances: ResumeSeance[];
}) {
  const [repliee, setRepliee] = useState(() => {
    try {
      return localStorage.getItem(CLE_FRISE) === "oui";
    } catch {
      return false;
    }
  });
  const basculer = () => {
    setRepliee(!repliee);
    try {
      localStorage.setItem(CLE_FRISE, repliee ? "non" : "oui");
    } catch {
      // Préférence non retenue : sans conséquence.
    }
  };
  const bouton = (
    <button type="button" className="bouton bouton-petit" aria-expanded={!repliee} onClick={basculer}>
      {repliee ? "Déplier" : "Replier"}
    </button>
  );
  return (
    <section className="carte bandeau-frise">
      {repliee ? (
        <div className="entete-carte">
          <h2>Frise de vie</h2>
          <span className="discret frise-resume">
            {antecedents.length} antécédent{antecedents.length > 1 ? "s" : ""} · {seances.length} séance{seances.length > 1 ? "s" : ""}
          </span>
          {bouton}
        </div>
      ) : (
        <FriseDeVie naissance={patient.naissance} antecedents={antecedents} formulaire={formulaire} seances={seances.map((s) => s.debut.slice(0, 10))} actions={bouton} />
      )}
    </section>
  );
}

function Synthese({
  coeur,
  patient,
  antecedents,
  formulaire,
  seances,
  misAJour,
}: {
  coeur: Coeur;
  patient: Patient;
  antecedents: Antecedent[];
  formulaire: CategorieAntecedents[];
  seances: ResumeSeance[];
  misAJour: (p: Patient) => void;
}) {
  const adressePostale = [patient.adresse, patient.complement_adresse, [patient.code_postal, patient.ville].filter(Boolean).join(" "), patient.pays]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="pile">
      <div className="colonnes-synthese">
        <div className="pile">
          <section className="carte" aria-labelledby="titre-dernieres">
            <div className="entete-carte">
              <h2 id="titre-dernieres">Dernières séances</h2>
              {seances.length > 4 && <a href={adresse("patients", patient.id, "seances")}>Toutes les séances</a>}
            </div>
            <ListeSeancesPatient seances={seances} limite={4} />
          </section>
          <section className="carte" aria-labelledby="titre-remarques">
            <div className="entete-carte">
              <h2 id="titre-remarques">Remarques générales</h2>
              <a className="bouton bouton-petit" href={adresse("patients", patient.id, "identite")}>
                Modifier
              </a>
            </div>
            {patient.remarques ? <TexteRiche valeur={patient.remarques} /> : <p className="discret">Aucune remarque.</p>}
          </section>
        </div>
        <div className="pile">
          <CarteAntecedents patient={patient} antecedents={antecedents} formulaire={formulaire} />
          <section className="carte" aria-labelledby="titre-coordonnees">
            <h2 id="titre-coordonnees">Coordonnées</h2>
            <dl className="liste-infos">
              {patient.portable && <Ligne libelle="Portable">{patient.portable}</Ligne>}
              {patient.fixe && <Ligne libelle="Fixe">{patient.fixe}</Ligne>}
              {patient.email && <Ligne libelle="Email">{patient.email}</Ligne>}
              {adressePostale && (
                <Ligne libelle="Adresse">
                  <span className="texte-multiligne">{adressePostale}</span>
                </Ligne>
              )}
              {patient.medecin_traitant && <Ligne libelle="Médecin traitant">{patient.medecin_traitant}</Ligne>}
              {patient.autres_therapeutes && <Ligne libelle="Autres thérapeutes">{patient.autres_therapeutes}</Ligne>}
              {patient.activites && <Ligne libelle="Activités">{patient.activites}</Ligne>}
            </dl>
            {!patient.portable && !patient.fixe && !patient.email && !adressePostale && <p className="discret">Aucune coordonnée.</p>}
          </section>
          <CarteProches coeur={coeur} patient={patient} misAJour={misAJour} />
        </div>
      </div>
    </div>
  );
}

function OngletIdentite({
  patient,
  coeur,
  misAJour,
  reglages,
}: {
  patient: Patient;
  coeur: Coeur;
  misAJour: (p: Patient) => void;
  reglages: ReturnType<typeof useReglagesFiche>;
}) {
  const [brouillon, setBrouillon] = useState<BrouillonFiche>(() => versBrouillon(patient));
  const [erreurs, setErreurs] = useState<ErreursFiche>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<"modifie" | "envoi" | "enregistre" | null>(null);

  const changer = (b: BrouillonFiche) => {
    setBrouillon(b);
    setEtat("modifie");
  };

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    const { fiche, erreurs } = depuisBrouillon(brouillon);
    setErreurs(erreurs);
    if (!fiche) {
      setErreur("Corrigez les champs signalés pour enregistrer.");
      return;
    }
    setEtat("envoi");
    try {
      const enregistre = await coeur.modifierPatient(patient.id, fiche);
      misAJour(enregistre);
      setBrouillon(versBrouillon(enregistre));
      setEtat("enregistre");
    } catch (raison) {
      setErreur((raison as Error).message);
      setEtat("modifie");
    }
  }

  return (
    <form className="pile" onSubmit={enregistrer} noValidate>
      <div className="carte">
        <FormulaireFiche
          brouillon={brouillon}
          changer={changer}
          erreurs={erreurs}
          statuts={reglages.statuts}
          groupes={reglages.groupes}
          departement={reglages.departement}
        />
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="rangee barre-actions">
        <span className="discret" role="status">
          {etat === "modifie" ? "Modifications non enregistrées" : etat === "enregistre" ? "Fiche enregistrée" : ""}
        </span>
        <button type="submit" className="bouton bouton-principal" disabled={etat !== "modifie"}>
          Enregistrer les modifications
        </button>
      </div>
    </form>
  );
}

export function DossierPatient({ coeur, id, onglet }: { coeur: Coeur; id: string; onglet: Onglet }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [antecedents, setAntecedents] = useState<Antecedent[]>([]);
  const [formulaire, setFormulaire] = useState<CategorieAntecedents[]>([]);
  const [seances, setSeances] = useState<ResumeSeance[]>([]);
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pdf, setPdf] = useState(false);
  const reglages = useReglagesFiche(coeur);

  useEffect(() => {
    setPatient(null);
    setErreur(null);
    Promise.all([coeur.lirePatient(id), coeur.listerAntecedents(id), coeur.formulaireAntecedents(), coeur.listerSeancesPatient(id)]).then(
      ([p, a, f, s]) => {
        setAntecedents(a);
        setFormulaire(f);
        setSeances(s);
        setPatient(p);
      },
      (e: Error) => setErreur(e.message),
    );
  }, [coeur, id]);

  const rafraichirAntecedents = async () => setAntecedents(await coeur.listerAntecedents(id));

  if (erreur) {
    return (
      <main className="page">
        <p className="alerte" role="alert">
          {erreur}
        </p>
        <a href={adresse("patients")}>Revenir à la liste des patients</a>
      </main>
    );
  }
  if (!patient) return <p className="page discret">Ouverture du dossier…</p>;

  /** Nouvelle séance, maintenant, avec le modèle proposé pour l'âge du patient. */
  async function nouvelleSeance() {
    if (!patient) return;
    setCreation(true);
    try {
      const seance = await creerSeanceMaintenant(coeur, patient);
      aller("seances", seance.id);
    } catch (e) {
      setErreur((e as Error).message);
      setCreation(false);
    }
  }

  const archiver = (archive: boolean) => {
    coeur.archiverPatient(patient.id, archive).then(setPatient, (e: Error) => setErreur(e.message));
  };

  return (
    <main className="page page-large">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("patients")}>Patients</a> <span aria-hidden="true">›</span> {patient.prenom} {patient.nom}
      </nav>
      <section className="carte entete-dossier" aria-labelledby="nom-patient">
        <div className="entete-dossier-haut">
          <Avatar prenom={patient.prenom} nom={patient.nom} grand />
          <div className="pile-serree entete-dossier-nom">
            <h1 id="nom-patient">
              {patient.prenom} {patient.nom}
            </h1>
            <span className="discret">{descriptionPatient(patient)}</span>
            <PucesPatient patient={patient} antecedents={antecedents} groupes={reglages.groupes} />
          </div>
          <div className="rangee entete-dossier-actions">
            <button type="button" className="bouton bouton-principal" disabled={creation || patient.decede} onClick={() => void nouvelleSeance()}>
              <span aria-hidden="true">+</span> Nouvelle séance
            </button>
            <MenuDossier patient={patient} archiver={archiver} dossierPdf={() => setPdf(true)} />
          </div>
        </div>
        <nav className="onglets" aria-label="Rubriques du dossier">
          {ONGLETS.map((o) => (
            <a
              key={o.onglet}
              href={adresse("patients", patient.id, ...(o.onglet === "synthese" ? [] : [o.onglet]))}
              aria-current={onglet === o.onglet ? "page" : undefined}
            >
              {o.libelle}
              {o.onglet === "seances" && seances.length > 0 && <span className="compte-onglet"> {seances.length}</span>}
              {o.onglet === "antecedents" && antecedents.length > 0 && <span className="compte-onglet"> {antecedents.length}</span>}
            </a>
          ))}
        </nav>
      </section>

      <BandeauFrise patient={patient} antecedents={antecedents} formulaire={formulaire} seances={seances.filter((s) => s.supprimee_le === null)} />

      {onglet === "identite" ? (
        <OngletIdentite key={patient.id} patient={patient} coeur={coeur} misAJour={setPatient} reglages={reglages} />
      ) : onglet === "synthese" ? (
        <Synthese coeur={coeur} patient={patient} antecedents={antecedents} formulaire={formulaire} seances={seances} misAJour={setPatient} />
      ) : onglet === "historique" ? (
        <OngletHistorique coeur={coeur} patient={patient} />
      ) : onglet === "documents" ? (
        <Documents coeur={coeur} patientId={patient.id} seances={seances.filter((s) => s.supprimee_le === null)} titre="Documents du dossier" />
      ) : onglet === "antecedents" ? (
        <OngletAntecedents
          patient={patient}
          antecedents={antecedents}
          formulaire={formulaire}
          coeur={coeur}
          rafraichir={rafraichirAntecedents}
          misAJour={setPatient}
        />
      ) : (
        <section className="carte" aria-label="Séances du dossier">
          <ListeSeancesPatient seances={seances} />
        </section>
      )}
      {pdf && <FenetreDossierPdf coeur={coeur} patient={patient} seances={seances} fermer={() => setPdf(false)} />}
    </main>
  );
}
