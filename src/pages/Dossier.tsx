import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import type { Coeur, Patient } from "../lib/coeur";
import { accorder, ageEnClair, neLe } from "../lib/dates";
import { adresse } from "../lib/navigation";
import { Avatar } from "../patients/Avatar";
import { depuisBrouillon, FormulaireFiche, versBrouillon, type BrouillonFiche, type ErreursFiche } from "../patients/FormulaireFiche";

export type Onglet = "synthese" | "seances" | "antecedents" | "identite";

const ONGLETS: { onglet: Onglet; libelle: string }[] = [
  { onglet: "synthese", libelle: "Synthèse" },
  { onglet: "seances", libelle: "Séances" },
  { onglet: "antecedents", libelle: "Antécédents" },
  { onglet: "identite", libelle: "Identité et contact" },
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
export function PucesPatient({ patient }: { patient: Patient }) {
  const premiereLigne = patient.notes_importantes.split("\n")[0];
  return (
    <div className="rangee">
      {premiereLigne && (
        <span className="puce puce-alerte" title={patient.notes_importantes}>
          <span aria-hidden="true">⚠</span> {premiereLigne}
        </span>
      )}
      {patient.statut && <span className="puce">{patient.statut}</span>}
      {patient.archive && <span className="puce puce-discrete">Archivé</span>}
      {patient.decede && <span className="puce puce-discrete">{accorder(patient.sexe, "Décédé", "Décédée")}</span>}
      {patient.mobilite_reduite && <span className="puce">Mobilité réduite</span>}
    </div>
  );
}

function MenuDossier({ patient, archiver }: { patient: Patient; archiver: (archive: boolean) => void }) {
  const id = useId();
  const [ouvert, setOuvert] = useState(false);
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
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOuvert(false);
              archiver(!patient.archive);
            }}
          >
            {patient.archive ? "Sortir des archives" : "Archiver le dossier"}
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

function Synthese({ patient }: { patient: Patient }) {
  const adressePostale = [patient.adresse, patient.complement_adresse, [patient.code_postal, patient.ville].filter(Boolean).join(" "), patient.pays]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="colonnes-dossier">
      <section className="carte" aria-labelledby="titre-remarques">
        <div className="entete-carte">
          <h2 id="titre-remarques">Remarques générales</h2>
          <a className="bouton bouton-petit" href={adresse("patients", patient.id, "identite")}>
            Modifier
          </a>
        </div>
        {patient.remarques ? <p className="texte-multiligne">{patient.remarques}</p> : <p className="discret">Aucune remarque.</p>}
      </section>
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
    </div>
  );
}

function OngletIdentite({ patient, coeur, misAJour }: { patient: Patient; coeur: Coeur; misAJour: (p: Patient) => void }) {
  const [brouillon, setBrouillon] = useState<BrouillonFiche>(() => versBrouillon(patient));
  const [erreurs, setErreurs] = useState<ErreursFiche>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<"modifie" | "envoi" | "enregistre" | null>(null);
  const [statuts, setStatuts] = useState<string[]>([]);

  useEffect(() => {
    coeur.statutsPatients().then(setStatuts, () => setStatuts([]));
  }, [coeur]);

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
        <FormulaireFiche brouillon={brouillon} changer={changer} erreurs={erreurs} statuts={statuts} />
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
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setPatient(null);
    setErreur(null);
    coeur.lirePatient(id).then(setPatient, (e: Error) => setErreur(e.message));
  }, [coeur, id]);

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
            <PucesPatient patient={patient} />
          </div>
          <div className="rangee entete-dossier-actions">
            <button type="button" className="bouton bouton-principal" disabled title="Les séances arrivent à l’étape 3.4 de la phase 3">
              <span aria-hidden="true">+</span> Nouvelle séance
            </button>
            <MenuDossier patient={patient} archiver={archiver} />
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
            </a>
          ))}
        </nav>
      </section>

      {onglet === "identite" ? (
        <OngletIdentite key={patient.id} patient={patient} coeur={coeur} misAJour={setPatient} />
      ) : onglet === "synthese" ? (
        <Synthese patient={patient} />
      ) : (
        <section className="carte">
          <p className="discret">
            {onglet === "seances" ? "Les séances arrivent à l’étape 3.4 de la phase 3." : "Les antécédents arrivent à l’étape 3.2 de la phase 3."}
          </p>
        </section>
      )}
    </main>
  );
}
