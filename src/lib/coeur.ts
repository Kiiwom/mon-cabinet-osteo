import { invoke, isTauri } from "@tauri-apps/api/core";

import bibliothequeDeDepart from "../../crates/osteosphere-core/src/bibliotheque_depart.json";

export interface IdentiteCabinet {
  prenom: string;
  nom: string;
  profession: string;
  adresse: string;
  code_postal: string;
  ville: string;
  telephone: string;
  email: string;
  siret: string;
  rpps: string;
}

export type CaractereTrames = "@" | "/";
export type FrequenceSauvegarde = "fermeture" | "intervalle" | "jour" | "semaine" | "manuelle";

export interface ChoixPremierDemarrage {
  identite: IdentiteCabinet;
  mot_de_passe: string | null;
  cle_notee: boolean;
  caractere_trames: CaractereTrames;
  /** `intervalle_minutes` sert à la fréquence « intervalle » : 10, 15, 30, 60, 120 ou 240. */
  sauvegardes: { frequence: FrequenceSauvegarde; intervalle_minutes: number; dossier: string };
}

export interface PreparationPremierDemarrage {
  cle_de_secours: string;
  dossier_sauvegardes_propose: string;
  /** Faux si la session ne peut pas protéger la clé : trousseau absent sous Linux, macOS pas encore pris en charge. */
  session_protegee: boolean;
  /** « windows », « linux » ou « macos ». */
  systeme: string;
}

export type EtatDemarrage =
  | { etat: "premier_demarrage" }
  | { etat: "mot_de_passe_requis" }
  | { etat: "cle_de_secours_requise" }
  | { etat: "ouvert"; cabinet: IdentiteCabinet };

export interface Trame {
  id: string;
  code: string;
  titre: string;
  categorie: string;
  modele: string;
  origine: "depart" | "praticien";
  utilisations: number;
}

export interface SaisieTrame {
  code: string;
  titre: string;
  categorie: string;
  modele: string;
}

export type Sexe = "" | "F" | "M";
export type Lateralite = "" | "droitier" | "gaucher" | "ambidextre";

/** Fiche du patient telle que le praticien la saisit. Dates au format `AAAA-MM-JJ`. */
export interface FichePatient {
  sexe: Sexe;
  nom: string;
  nom_naissance: string;
  prenom: string;
  naissance: string | null;
  adresse: string;
  complement_adresse: string;
  code_postal: string;
  ville: string;
  pays: string;
  portable: string;
  fixe: string;
  email: string;
  profession: string;
  retraite: boolean;
  situation_familiale: string;
  enfants: number | null;
  lateralite: Lateralite;
  activites: string;
  medecin_traitant: string;
  autres_therapeutes: string;
  mobilite_reduite: boolean;
  decede: boolean;
  statut: string;
  /** Allergie, contre-indication, précaution : en tête du dossier et de chaque séance. */
  notes_importantes: string;
  remarques: string;
  consentement_le: string | null;
}

export interface Patient extends FichePatient {
  id: string;
  archive: boolean;
  cree_le: number;
  modifie_le: number;
}

/** Ligne de la liste des patients : de quoi chercher, filtrer et afficher. */
export interface ResumePatient {
  id: string;
  sexe: Sexe;
  nom: string;
  nom_naissance: string;
  prenom: string;
  naissance: string | null;
  portable: string;
  fixe: string;
  email: string;
  adresse: string;
  ville: string;
  statut: string;
  notes_importantes: string;
  decede: boolean;
  archive: boolean;
  seances: number;
  derniere_seance: string | null;
}

export const FICHE_VIDE: FichePatient = {
  sexe: "",
  nom: "",
  nom_naissance: "",
  prenom: "",
  naissance: null,
  adresse: "",
  complement_adresse: "",
  code_postal: "",
  ville: "",
  pays: "",
  portable: "",
  fixe: "",
  email: "",
  profession: "",
  retraite: false,
  situation_familiale: "",
  enfants: null,
  lateralite: "",
  activites: "",
  medecin_traitant: "",
  autres_therapeutes: "",
  mobilite_reduite: false,
  decede: false,
  statut: "",
  notes_importantes: "",
  remarques: "",
  consentement_le: null,
};

export function resumeDe(patient: Patient): ResumePatient {
  const { id, sexe, nom, nom_naissance, prenom, naissance, portable, fixe, email, adresse, ville, statut, notes_importantes, decede, archive } =
    patient;
  return { id, sexe, nom, nom_naissance, prenom, naissance, portable, fixe, email, adresse, ville, statut, notes_importantes, decede, archive, seances: 0, derniere_seance: null };
}

/** Ce que l'interface demande au cœur Rust. */
export interface Coeur {
  /** Vrai dans l'application ; faux dans le navigateur, où les données sont fictives. */
  readonly reel: boolean;
  etatDemarrage(): Promise<EtatDemarrage>;
  preparerPremierDemarrage(): Promise<PreparationPremierDemarrage>;
  terminerPremierDemarrage(choix: ChoixPremierDemarrage): Promise<IdentiteCabinet>;
  deverrouiller(motDePasse: string): Promise<IdentiteCabinet>;
  ouvrirAvecCleDeSecours(cle: string): Promise<IdentiteCabinet>;
  listerTrames(): Promise<Trame[]>;
  enregistrerTrame(id: string | null, saisie: SaisieTrame): Promise<Trame>;
  supprimerTrame(id: string): Promise<void>;
  noterUtilisationTrame(id: string): Promise<void>;
  caractereTrames(): Promise<CaractereTrames>;
  /** Facture d'essai en PDF, à la date locale `AAAA-MM-JJ`. */
  factureEssaiPdf(date: string): Promise<Uint8Array>;
  ouvrirFactureEssai(date: string): Promise<void>;
  listerPatients(): Promise<ResumePatient[]>;
  lirePatient(id: string): Promise<Patient>;
  creerPatient(fiche: FichePatient): Promise<Patient>;
  modifierPatient(id: string, fiche: FichePatient): Promise<Patient>;
  archiverPatient(id: string, archive: boolean): Promise<Patient>;
  statutsPatients(): Promise<string[]>;
}

/** Date du jour sur l'ordinateur du praticien, au format `AAAA-MM-JJ`. */
export function dateDuJour(maintenant = new Date()): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`;
}

export const IDENTITE_VIDE: IdentiteCabinet = {
  prenom: "",
  nom: "",
  profession: "Ostéopathe D.O.",
  adresse: "",
  code_postal: "",
  ville: "",
  telephone: "",
  email: "",
  siret: "",
  rpps: "",
};

/** Les erreurs du cœur arrivent en texte ; elles deviennent des Error à message affichable. */
async function appeler<T>(commande: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(commande, args);
  } catch (erreur) {
    throw new Error(typeof erreur === "string" ? erreur : String(erreur));
  }
}

export const coeurTauri: Coeur = {
  reel: true,
  etatDemarrage: () => appeler("etat_demarrage"),
  preparerPremierDemarrage: () => appeler("preparer_premier_demarrage"),
  terminerPremierDemarrage: (choix) => appeler("terminer_premier_demarrage", { choix }),
  deverrouiller: (motDePasse) => appeler("deverrouiller", { motDePasse }),
  ouvrirAvecCleDeSecours: (cle) => appeler("ouvrir_avec_cle_de_secours", { cle }),
  listerTrames: () => appeler("lister_trames"),
  enregistrerTrame: (id, saisie) => appeler("enregistrer_trame", { id, saisie }),
  supprimerTrame: (id) => appeler("supprimer_trame", { id }),
  noterUtilisationTrame: (id) => appeler("noter_utilisation_trame", { id }),
  caractereTrames: () => appeler("caractere_trames"),
  factureEssaiPdf: async (date) => new Uint8Array(await appeler<ArrayBuffer>("facture_essai_pdf", { date })),
  ouvrirFactureEssai: (date) => appeler("ouvrir_facture_essai", { date }),
  listerPatients: () => appeler("lister_patients"),
  lirePatient: (id) => appeler("lire_patient", { id }),
  creerPatient: (fiche) => appeler("creer_patient", { fiche }),
  modifierPatient: (id, fiche) => appeler("modifier_patient", { id, fiche }),
  archiverPatient: (id, archive) => appeler("archiver_patient", { id, archive }),
  statutsPatients: () => appeler("statuts_patients"),
};

const CLE_DE_DEMONSTRATION = "7KQM-R4TX-9WBE-H2NC-PX6V-3DFA";

/** Patients fictifs de la démonstration, ceux des maquettes. Numéros et adresses inventés. */
const PATIENTS_FICTIFS: Partial<FichePatient>[] = [
  {
    sexe: "F",
    nom: "Martin",
    prenom: "Camille",
    naissance: "1988-03-14",
    adresse: "12 rue des Tilleuls",
    code_postal: "47500",
    ville: "Fumel",
    portable: "06 00 00 00 01",
    email: "camille.martin@exemple.fr",
    profession: "Infirmière",
    lateralite: "droitier",
    activites: "Course à pied",
    statut: "Suivi",
    notes_importantes: "Allergie aux AINS",
    remarques: "Travaille de nuit un week-end sur deux. Course à pied trois fois par semaine. Préfère les créneaux de fin de journée.",
  },
  { sexe: "M", nom: "Martin", prenom: "Lucas", naissance: "2019-06-02", code_postal: "47500", ville: "Fumel", portable: "06 00 00 00 01", statut: "Suivi" },
  { sexe: "F", nom: "Martinez", prenom: "Julie", naissance: "1981-01-30", code_postal: "47150", ville: "Monflanquin", portable: "06 00 00 00 02", statut: "Suivi" },
  { sexe: "F", nom: "Aubert", prenom: "Martine", naissance: "1954-11-08", code_postal: "47210", ville: "Villeréal", fixe: "05 00 00 00 03", statut: "Ancien patient" },
  { sexe: "M", nom: "Morel", prenom: "Paul", naissance: "1974-08-19", adresse: "4 rue de la Martinie", code_postal: "47500", ville: "Fumel", portable: "06 00 00 00 04", statut: "Suivi" },
  { sexe: "F", nom: "Marthe", prenom: "Élodie", naissance: "1997-05-03", code_postal: "47150", ville: "Lacapelle-Biron", portable: "07 00 00 00 05", statut: "Nouveau" },
  { sexe: "M", nom: "Girard", prenom: "Thomas", naissance: "1990-04-12", code_postal: "47300", ville: "Villeneuve-sur-Lot", portable: "06 00 00 00 06", statut: "Suivi" },
  { sexe: "M", nom: "Petit", prenom: "Louis", naissance: "2014-09-20", code_postal: "47500", ville: "Fumel", portable: "06 00 00 00 07", statut: "Suivi" },
];

/**
 * Cœur simulé, en mémoire : l'interface fonctionne dans un navigateur et dans les tests,
 * sans base ni chiffrement. Rien n'y est enregistré.
 */
export function creerCoeurDeDemonstration(
  depart: EtatDemarrage["etat"] = "premier_demarrage",
  { exemples = true }: { exemples?: boolean } = {},
): Coeur {
  let etat = depart;
  let motDePasse: string | null = depart === "mot_de_passe_requis" ? "motdepasse" : null;
  let identite: IdentiteCabinet = { ...IDENTITE_VIDE, prenom: "Alexandre", nom: "Roux" };
  let caractere: CaractereTrames = "@";
  let trames: Trame[] = bibliothequeDeDepart.map((t, rang) => ({ ...t, id: `depart-${rang}`, origine: "depart", utilisations: 0 }));
  let compteur = 0;
  let patients: Patient[] = exemples
    ? PATIENTS_FICTIFS.map((fiche, rang) => ({ ...FICHE_VIDE, ...fiche, id: `patient-${rang + 1}`, archive: false, cree_le: 0, modifie_le: 0 }))
    : [];
  const trouverPatient = (id: string) => {
    const patient = patients.find((p) => p.id === id);
    if (!patient) throw new Error("Ce dossier n’existe plus");
    return patient;
  };
  const verifierFiche = (fiche: FichePatient): FichePatient => {
    const propre = (t: string) => t.trim().replace(/\s+/g, " ");
    const verifiee = { ...fiche, nom: propre(fiche.nom), prenom: propre(fiche.prenom), naissance: fiche.naissance || null };
    if (!verifiee.nom || !verifiee.prenom) throw new Error("Indiquez le nom et le prénom du patient");
    return verifiee;
  };
  const remplacer = (patient: Patient) => {
    patients = [...patients.filter((p) => p.id !== patient.id), patient];
    return patient;
  };
  const codePropre = (code: string) => code.trim().replace(/^[@/]/, "").toLowerCase();
  const normaliser = (cle: string) => cle.toUpperCase().replace(/[\s-]/g, "");

  return {
    reel: false,
    async etatDemarrage() {
      return etat === "ouvert" ? { etat, cabinet: identite } : { etat };
    },
    async preparerPremierDemarrage() {
      return {
        cle_de_secours: CLE_DE_DEMONSTRATION,
        dossier_sauvegardes_propose: "C:\\Users\\Praticien\\Documents\\Osteosphere\\Sauvegardes",
        session_protegee: true,
        systeme: "windows",
      };
    },
    async terminerPremierDemarrage(choix) {
      if (!choix.cle_notee) throw new Error("Cochez la case qui confirme que la clé de secours est notée ou imprimée.");
      identite = choix.identite;
      motDePasse = choix.mot_de_passe;
      caractere = choix.caractere_trames;
      etat = "ouvert";
      return identite;
    },
    async deverrouiller(saisie) {
      if (saisie !== motDePasse) throw new Error("Mot de passe incorrect");
      etat = "ouvert";
      return identite;
    },
    async ouvrirAvecCleDeSecours(cle) {
      if (normaliser(cle) !== normaliser(CLE_DE_DEMONSTRATION)) throw new Error("Clé de secours incorrecte");
      etat = "ouvert";
      return identite;
    },
    async listerTrames() {
      return [...trames].sort((a, b) => a.code.localeCompare(b.code));
    },
    async enregistrerTrame(id, saisie) {
      const code = codePropre(saisie.code);
      if (!/^[a-z0-9-]{1,20}$/.test(code)) throw new Error("Le code ne contient que des lettres sans accent, des chiffres ou des tirets, 20 au plus");
      if (trames.some((t) => t.code === code && t.id !== id)) throw new Error(`Le code « ${code} » est déjà pris par une autre trame`);
      const existante = trames.find((t) => t.id === id);
      const trame: Trame = {
        id: id ?? `essai-${(compteur += 1)}`,
        code,
        titre: saisie.titre.trim(),
        categorie: saisie.categorie.trim(),
        modele: saisie.modele.trim(),
        origine: existante?.origine ?? "praticien",
        utilisations: existante?.utilisations ?? 0,
      };
      trames = [...trames.filter((t) => t.id !== trame.id), trame];
      return trame;
    },
    async supprimerTrame(id) {
      trames = trames.filter((t) => t.id !== id);
    },
    async noterUtilisationTrame(id) {
      trames = trames.map((t) => (t.id === id ? { ...t, utilisations: t.utilisations + 1 } : t));
    },
    async caractereTrames() {
      return caractere;
    },
    async factureEssaiPdf() {
      throw new Error("La facture PDF est mise en page par le cœur : ouvrez Osteosphere dans sa fenêtre pour l’essayer.");
    },
    async ouvrirFactureEssai() {
      throw new Error("La facture PDF est mise en page par le cœur : ouvrez Osteosphere dans sa fenêtre pour l’essayer.");
    },
    async listerPatients() {
      return patients.map(resumeDe).sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"));
    },
    async lirePatient(id) {
      return trouverPatient(id);
    },
    async creerPatient(fiche) {
      return remplacer({ ...verifierFiche(fiche), id: `patient-${(compteur += 1)}-${Date.now()}`, archive: false, cree_le: 0, modifie_le: 0 });
    },
    async modifierPatient(id, fiche) {
      return remplacer({ ...trouverPatient(id), ...verifierFiche(fiche) });
    },
    async archiverPatient(id, archive) {
      return remplacer({ ...trouverPatient(id), archive });
    },
    async statutsPatients() {
      return ["Nouveau", "Suivi", "Ancien patient"];
    },
  };
}

export function coeurParDefaut(): Coeur {
  return isTauri() ? coeurTauri : creerCoeurDeDemonstration();
}
