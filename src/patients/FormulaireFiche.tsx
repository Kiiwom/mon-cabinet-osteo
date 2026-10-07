import { useId, type ReactNode } from "react";

import type { FichePatient, Lateralite, Sexe } from "../lib/coeur";
import { dateDuJour } from "../lib/coeur";
import { ecrireDateFr, lireDateFr } from "../lib/dates";

/** La fiche telle qu'on la tape : dates et nombre d'enfants en texte, convertis à l'enregistrement. */
export type BrouillonFiche = Omit<FichePatient, "naissance" | "consentement_le" | "enfants"> & {
  naissance: string;
  consentement_le: string;
  enfants: string;
};

export type ErreursFiche = Partial<Record<keyof BrouillonFiche, string>>;

export function versBrouillon(fiche: FichePatient): BrouillonFiche {
  return {
    ...fiche,
    naissance: ecrireDateFr(fiche.naissance),
    consentement_le: ecrireDateFr(fiche.consentement_le),
    enfants: fiche.enfants === null ? "" : String(fiche.enfants),
  };
}

/** Convertit et vérifie ce qui peut l'être avant d'envoyer au cœur, qui vérifie à son tour. */
export function depuisBrouillon(brouillon: BrouillonFiche, aujourdhui = new Date()): { fiche: FichePatient | null; erreurs: ErreursFiche } {
  const erreurs: ErreursFiche = {};
  if (!brouillon.nom.trim()) erreurs.nom = "Indiquez le nom.";
  if (!brouillon.prenom.trim()) erreurs.prenom = "Indiquez le prénom.";
  const naissance = lireDateFr(brouillon.naissance, aujourdhui);
  if (naissance === undefined) erreurs.naissance = "Date incomplète ou impossible : JJ/MM/AAAA.";
  else if (naissance && naissance > dateDuJour(aujourdhui)) erreurs.naissance = "Cette date est dans le futur.";
  const consentement = lireDateFr(brouillon.consentement_le, aujourdhui);
  if (consentement === undefined) erreurs.consentement_le = "Date incomplète ou impossible : JJ/MM/AAAA.";
  const enfants = brouillon.enfants.trim();
  if (enfants && !/^\d{1,2}$/.test(enfants)) erreurs.enfants = "Un nombre, 0 compris.";
  const pays = brouillon.pays.trim().toLowerCase();
  const cp = brouillon.code_postal.replace(/\s/g, "");
  if ((pays === "" || pays === "france") && cp && !/^\d{5}$/.test(cp)) erreurs.code_postal = "Le code postal compte 5 chiffres.";
  const email = brouillon.email.trim();
  if (email && !/^[^@\s]+@[^@\s.][^@\s]*\.[^@\s.]+$/.test(email)) erreurs.email = "L’adresse email semble incomplète.";
  if (Object.keys(erreurs).length > 0) return { fiche: null, erreurs };
  return {
    fiche: {
      ...brouillon,
      naissance: naissance ?? null,
      consentement_le: consentement ?? null,
      enfants: enfants ? Number(enfants) : null,
    },
    erreurs,
  };
}

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <fieldset className="groupe fiche-section">
      <legend>{titre}</legend>
      <div className="champs">{children}</div>
    </fieldset>
  );
}

function Texte({
  libelle,
  valeur,
  changer,
  erreur,
  large = false,
  ...autres
}: {
  libelle: string;
  valeur: string;
  changer: (v: string) => void;
  erreur?: string;
  large?: boolean;
  type?: string;
  inputMode?: "numeric" | "tel" | "email" | "text";
  autoComplete?: string;
  placeholder?: string;
  autoFocus?: boolean;
  list?: string;
}) {
  const id = useId();
  return (
    <div className={large ? "champ champ-large" : "champ"}>
      <label htmlFor={id}>{libelle}</label>
      <input
        id={id}
        value={valeur}
        onChange={(e) => changer(e.target.value)}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
        {...autres}
      />
      {erreur && (
        <span id={`${id}-erreur`} className="champ-erreur">
          {erreur}
        </span>
      )}
    </div>
  );
}

function TexteLong({ libelle, valeur, changer, aide }: { libelle: string; valeur: string; changer: (v: string) => void; aide?: string }) {
  const id = useId();
  return (
    <div className="champ champ-large">
      <label htmlFor={id}>{libelle}</label>
      <textarea id={id} rows={3} value={valeur} onChange={(e) => changer(e.target.value)} aria-describedby={aide ? `${id}-aide` : undefined} />
      {aide && (
        <span id={`${id}-aide`} className="discret">
          {aide}
        </span>
      )}
    </div>
  );
}

function Case({ libelle, coche, changer }: { libelle: string; coche: boolean; changer: (v: boolean) => void }) {
  return (
    <label className="case-simple">
      <input type="checkbox" checked={coche} onChange={(e) => changer(e.target.checked)} />
      {libelle}
    </label>
  );
}

function Liste<T extends string>({
  libelle,
  valeur,
  changer,
  options,
}: {
  libelle: string;
  valeur: T;
  changer: (v: T) => void;
  options: { valeur: T; libelle: string }[];
}) {
  const id = useId();
  return (
    <div className="champ">
      <label htmlFor={id}>{libelle}</label>
      <select id={id} value={valeur} onChange={(e) => changer(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.libelle}
          </option>
        ))}
      </select>
    </div>
  );
}

const SITUATIONS = ["Célibataire", "En couple", "Marié(e)", "Pacsé(e)", "Séparé(e)", "Divorcé(e)", "Veuf, veuve"];

export function FormulaireFiche({
  brouillon,
  changer,
  erreurs,
  statuts,
  premierChampAutoFocus = false,
}: {
  brouillon: BrouillonFiche;
  changer: (b: BrouillonFiche) => void;
  erreurs: ErreursFiche;
  statuts: string[];
  premierChampAutoFocus?: boolean;
}) {
  const idListe = useId();
  const champ =
    <K extends keyof BrouillonFiche>(nom: K) =>
    (valeur: BrouillonFiche[K]) =>
      changer({ ...brouillon, [nom]: valeur });
  const statutsProposes = brouillon.statut && !statuts.includes(brouillon.statut) ? [...statuts, brouillon.statut] : statuts;

  return (
    <div className="pile">
      <Section titre="Identité">
        <Liste<Sexe>
          libelle="Sexe"
          valeur={brouillon.sexe}
          changer={champ("sexe")}
          options={[
            { valeur: "", libelle: "Non renseigné" },
            { valeur: "F", libelle: "Femme" },
            { valeur: "M", libelle: "Homme" },
          ]}
        />
        <Texte libelle="Nom" valeur={brouillon.nom} changer={champ("nom")} erreur={erreurs.nom} autoComplete="off" autoFocus={premierChampAutoFocus} />
        <Texte libelle="Prénom" valeur={brouillon.prenom} changer={champ("prenom")} erreur={erreurs.prenom} autoComplete="off" />
        <Texte libelle="Nom de naissance" valeur={brouillon.nom_naissance} changer={champ("nom_naissance")} autoComplete="off" />
        <Texte
          libelle="Date de naissance"
          valeur={brouillon.naissance}
          changer={champ("naissance")}
          erreur={erreurs.naissance}
          placeholder="JJ/MM/AAAA"
          inputMode="numeric"
          autoComplete="off"
        />
      </Section>

      <Section titre="Coordonnées">
        <Texte libelle="Portable" valeur={brouillon.portable} changer={champ("portable")} type="tel" inputMode="tel" autoComplete="off" />
        <Texte libelle="Téléphone fixe" valeur={brouillon.fixe} changer={champ("fixe")} type="tel" inputMode="tel" autoComplete="off" />
        <Texte libelle="Email" valeur={brouillon.email} changer={champ("email")} erreur={erreurs.email} type="email" inputMode="email" autoComplete="off" />
        <Texte libelle="Adresse" valeur={brouillon.adresse} changer={champ("adresse")} large autoComplete="off" />
        <Texte libelle="Complément d’adresse" valeur={brouillon.complement_adresse} changer={champ("complement_adresse")} large autoComplete="off" />
        <Texte libelle="Code postal" valeur={brouillon.code_postal} changer={champ("code_postal")} erreur={erreurs.code_postal} inputMode="numeric" autoComplete="off" />
        <Texte libelle="Ville" valeur={brouillon.ville} changer={champ("ville")} autoComplete="off" />
        <Texte libelle="Pays" valeur={brouillon.pays} changer={champ("pays")} placeholder="France" autoComplete="off" />
      </Section>

      <Section titre="Profil">
        <Texte libelle="Profession ou scolarité" valeur={brouillon.profession} changer={champ("profession")} autoComplete="off" />
        <Texte libelle="Situation familiale" valeur={brouillon.situation_familiale} changer={champ("situation_familiale")} list={idListe} autoComplete="off" />
        <datalist id={idListe}>
          {SITUATIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Texte libelle="Enfants" valeur={brouillon.enfants} changer={champ("enfants")} erreur={erreurs.enfants} inputMode="numeric" autoComplete="off" />
        <Liste<Lateralite>
          libelle="Latéralité"
          valeur={brouillon.lateralite}
          changer={champ("lateralite")}
          options={[
            { valeur: "", libelle: "Non renseignée" },
            { valeur: "droitier", libelle: "Droitier, droitière" },
            { valeur: "gaucher", libelle: "Gaucher, gauchère" },
            { valeur: "ambidextre", libelle: "Ambidextre" },
          ]}
        />
        <Texte libelle="Activités, sports" valeur={brouillon.activites} changer={champ("activites")} large autoComplete="off" />
        <Texte libelle="Médecin traitant" valeur={brouillon.medecin_traitant} changer={champ("medecin_traitant")} autoComplete="off" />
        <Texte libelle="Autres thérapeutes" valeur={brouillon.autres_therapeutes} changer={champ("autres_therapeutes")} autoComplete="off" />
        <div className="champ-large cases">
          <Case libelle="Retraité, retraitée" coche={brouillon.retraite} changer={champ("retraite")} />
        </div>
      </Section>

      <Section titre="Suivi">
        <Liste
          libelle="Statut"
          valeur={brouillon.statut}
          changer={champ("statut")}
          options={[{ valeur: "", libelle: "Aucun" }, ...statutsProposes.map((s) => ({ valeur: s, libelle: s }))]}
        />
        <div className="champ">
          <Texte
            libelle="Consentement recueilli le"
            valeur={brouillon.consentement_le}
            changer={champ("consentement_le")}
            erreur={erreurs.consentement_le}
            placeholder="JJ/MM/AAAA"
            inputMode="numeric"
            autoComplete="off"
          />
          {!brouillon.consentement_le && (
            <button type="button" className="lien-bouton" onClick={() => champ("consentement_le")(ecrireDateFr(dateDuJour()))}>
              Aujourd’hui
            </button>
          )}
        </div>
        <div className="champ-large cases">
          <Case libelle="Personne à mobilité réduite" coche={brouillon.mobilite_reduite} changer={champ("mobilite_reduite")} />
          <Case libelle="Patient décédé" coche={brouillon.decede} changer={champ("decede")} />
        </div>
        <TexteLong
          libelle="Notes importantes"
          valeur={brouillon.notes_importantes}
          changer={champ("notes_importantes")}
          aide="Allergie, contre-indication, précaution : affichées en tête du dossier et de chaque séance."
        />
        <TexteLong libelle="Remarques générales" valeur={brouillon.remarques} changer={champ("remarques")} />
      </Section>
    </div>
  );
}
