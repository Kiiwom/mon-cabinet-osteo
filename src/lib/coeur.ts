import { invoke, isTauri } from "@tauri-apps/api/core";

import bibliothequeDeDepart from "../../crates/osteosphere-core/src/bibliotheque_depart.json";
import formulaireAntecedentsParDefaut from "../../crates/osteosphere-core/src/formulaire_antecedents.json";
import modelesFournis from "../../crates/osteosphere-core/src/modeles_fournis.json";
import { document, resumer } from "./seances";

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
  /** Remarques sur les antécédents, saisies dans l'onglet Antécédents. */
  remarques_antecedents: string;
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
  remarques_antecedents: "",
  consentement_le: null,
};

/** Couleurs d'antécédent proposées ; vide = couleur de la catégorie. */
export type CouleurAntecedent = "" | "gris" | "blanc" | "jaune" | "rouge" | "bleu" | "vert";

export interface CategorieAntecedents {
  cle: string;
  libelle: string;
  rubriques: string[];
}

/** Dates partielles : « 2009 », « 2009-03 » ou « 2009-03-14 ». */
export interface SaisieAntecedent {
  categorie: string;
  rubrique: string;
  precision: string;
  debut: string | null;
  fin: string | null;
  en_cours: boolean;
  couleur: CouleurAntecedent;
  important: boolean;
}

export interface Antecedent extends SaisieAntecedent {
  id: string;
  patient_id: string;
}

export type TypeChamp =
  | "texte_court"
  | "texte_enrichi"
  | "liste"
  | "cases"
  | "case_precision"
  | "curseur"
  | "date"
  | "nombre"
  | "intertitre"
  | "mesures"
  | "resume_precedent"
  | "dessin";

/** Rôle d'un champ, repris dans les listes de séances et les statistiques. */
export type RoleChamp = "" | "motif" | "douleur_avant" | "douleur_apres";

export interface Champ {
  /** Clé de la valeur dans la séance : ne change plus une fois le champ créé. */
  id: string;
  type: TypeChamp;
  libelle: string;
  visible: boolean;
  obligatoire: boolean;
  imprimer: boolean;
  role: RoleChamp;
  options?: string[];
  min?: number;
  max?: number;
  pas?: number;
  unite?: string;
}

export interface Definition {
  champs: Champ[];
}

export interface SaisieModele {
  nom: string;
  /** Proposé automatiquement à partir de cet âge, en années révolues. */
  age_min: number | null;
  /** Proposé automatiquement avant cet âge. */
  age_max: number | null;
  actif: boolean;
  definition: Definition;
}

export interface Modele extends SaisieModele {
  id: string;
  par_defaut: boolean;
  origine: "fourni" | "praticien";
  version: number;
  /** Date de la version en cours, en secondes depuis 1970. */
  version_le: number;
}

export type TypeSeance = "premiere" | "suivi" | "urgence";
export type Facturation = "a_facturer" | "gratuit";

export interface SaisieSeance {
  /** `AAAA-MM-JJTHH:MM`, heure du cabinet. */
  debut: string;
  modele_id: string;
  modele_version: number;
  type: TypeSeance;
  titre: string;
  importante: boolean;
  /** Clé du champ → valeur : texte, nombre, document de l'éditeur, cases, mesures… */
  valeurs: Record<string, unknown>;
  facturation: Facturation;
  commentaire_gratuit: string;
}

export interface Seance extends SaisieSeance {
  id: string;
  patient_id: string;
  supprimee_le: number | null;
  cree_le: number;
  modifie_le: number;
}

/** Une ligne des listes de séances : motif et douleurs tirés du rôle des champs. */
export interface ResumeSeance {
  id: string;
  patient_id: string;
  patient_nom: string;
  patient_prenom: string;
  debut: string;
  modele_nom: string;
  type: TypeSeance;
  titre: string;
  importante: boolean;
  motif: string;
  douleur_avant: number | null;
  douleur_apres: number | null;
  facturation: Facturation;
  commentaire_gratuit: string;
  supprimee_le: number | null;
}

/** Les champs tels qu'écrits dans un fichier : les réglages absents prennent leur valeur habituelle. */
export function completerChamp(champ: Partial<Champ> & Pick<Champ, "id" | "type" | "libelle">): Champ {
  const complet: Champ = { visible: true, obligatoire: false, imprimer: true, role: "", ...champ };
  if (complet.type === "curseur") return { min: 0, max: 10, pas: 1, ...complet };
  return complet;
}

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
  formulaireAntecedents(): Promise<CategorieAntecedents[]>;
  listerAntecedents(patientId: string): Promise<Antecedent[]>;
  enregistrerAntecedent(patientId: string, id: string | null, saisie: SaisieAntecedent): Promise<Antecedent>;
  supprimerAntecedent(id: string): Promise<void>;
  listerModeles(): Promise<Modele[]>;
  lireVersionModele(id: string, version: number): Promise<Definition>;
  enregistrerModele(id: string | null, saisie: SaisieModele): Promise<Modele>;
  definirModeleParDefaut(id: string): Promise<Modele>;
  creerSeance(patientId: string, saisie: SaisieSeance): Promise<Seance>;
  lireSeance(id: string): Promise<Seance>;
  /** Appelé au fil de la saisie : enregistre la séance telle qu'elle est à l'écran. */
  enregistrerSeance(id: string, saisie: SaisieSeance): Promise<Seance>;
  listerSeancesPatient(patientId: string): Promise<ResumeSeance[]>;
  /** Dates comprises, `AAAA-MM-JJ`. */
  listerSeancesPeriode(du: string, au: string): Promise<ResumeSeance[]>;
  supprimerSeance(id: string): Promise<void>;
  restaurerSeance(id: string): Promise<Seance>;
  corbeilleSeances(): Promise<ResumeSeance[]>;
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
  formulaireAntecedents: () => appeler("formulaire_antecedents"),
  listerAntecedents: (patientId) => appeler("lister_antecedents", { patientId }),
  enregistrerAntecedent: (patientId, id, saisie) => appeler("enregistrer_antecedent", { patientId, id, saisie }),
  supprimerAntecedent: (id) => appeler("supprimer_antecedent", { id }),
  listerModeles: () => appeler("lister_modeles"),
  lireVersionModele: (id, version) => appeler("lire_version_modele", { id, version }),
  enregistrerModele: (id, saisie) => appeler("enregistrer_modele", { id, saisie }),
  definirModeleParDefaut: (id) => appeler("definir_modele_par_defaut", { id }),
  creerSeance: (patientId, saisie) => appeler("creer_seance", { patientId, saisie }),
  lireSeance: (id) => appeler("lire_seance", { id }),
  enregistrerSeance: (id, saisie) => appeler("enregistrer_seance", { id, saisie }),
  listerSeancesPatient: (patientId) => appeler("lister_seances_patient", { patientId }),
  listerSeancesPeriode: (du, au) => appeler("lister_seances_periode", { du, au }),
  supprimerSeance: (id) => appeler("supprimer_seance", { id }),
  restaurerSeance: (id) => appeler("restaurer_seance", { id }),
  corbeilleSeances: () => appeler("corbeille_seances"),
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

/** Antécédents fictifs de Camille Martin, ceux de la maquette du dossier. */
const ANTECEDENTS_FICTIFS: Partial<SaisieAntecedent>[] = [
  { categorie: "medicaux", rubrique: "Traitement longue durée", precision: "lévothyroxine", debut: "2015", en_cours: true },
  { categorie: "medicaux", rubrique: "Allergies", precision: "AINS", couleur: "rouge", important: true },
  { categorie: "chirurgicaux", rubrique: "Orthopédique", precision: "prothèse hanche D", debut: "2024", important: true },
  { categorie: "chirurgicaux", rubrique: "Gynéco / Uro", precision: "césarienne", debut: "2017" },
  { categorie: "traumatiques", rubrique: "Fracture", precision: "poignet G", debut: "2009" },
];

/** Séances fictives : celles des maquettes du dossier et de la liste des séances. */
const SEANCES_FICTIVES: { patient: string; debut: string; motif: string; avant: number; apres: number; traitements?: string; gratuit?: string; type?: TypeSeance }[] = [
  { patient: "patient-1", debut: "2026-02-18T17:15", motif: "Bilan de prévention annuel", avant: 2, apres: 1, gratuit: "Bilan offert" },
  { patient: "patient-1", debut: "2026-07-03T18:00", motif: "Cervicalgie, céphalées de tension", avant: 5, apres: 2, traitements: "Techniques fonctionnelles cervicales." },
  {
    patient: "patient-1",
    debut: "2026-09-12T16:30",
    motif: "Lombalgie aiguë après port de charge",
    avant: 7,
    apres: 3,
    traitements: "Techniques fonctionnelles sacro-iliaques, travail tissulaire du carré des lombes.",
    type: "premiere",
  },
  { patient: "patient-7", debut: "2026-10-06T16:00", motif: "Entorse de cheville, reprise du sport", avant: 4, apres: 2 },
  { patient: "patient-8", debut: "2026-10-03T11:40", motif: "Bilan postural, scoliose à surveiller", avant: 1, apres: 1 },
  { patient: "patient-4", debut: "2025-03-05T10:30", motif: "Gonalgie droite", avant: 5, apres: 3 },
];

const SAISIE_ANTECEDENT_VIDE: SaisieAntecedent = {
  categorie: "",
  rubrique: "",
  precision: "",
  debut: null,
  fin: null,
  en_cours: false,
  couleur: "",
  important: false,
};

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
  let antecedents: Antecedent[] = exemples
    ? ANTECEDENTS_FICTIFS.map((a, rang) => ({ ...SAISIE_ANTECEDENT_VIDE, ...a, id: `antecedent-${rang + 1}`, patient_id: "patient-1" }))
    : [];
  let modeles: Modele[] = modelesFournis.map((m, rang) => ({
    ...m,
    definition: { champs: m.definition.champs.map((c) => completerChamp(c as Champ)) },
    id: `modele-${rang + 1}`,
    origine: "fourni",
    version: 1,
    version_le: 0,
  }));
  const versions = new Map<string, Definition>(modeles.map((m) => [`${m.id}@1`, m.definition]));
  const trouverModele = (id: string) => {
    const modele = modeles.find((m) => m.id === id);
    if (!modele) throw new Error("Ce modèle n’existe plus");
    return modele;
  };
  let seances: Seance[] = exemples
    ? SEANCES_FICTIVES.map((s, rang) => ({
        id: `seance-${rang + 1}`,
        patient_id: s.patient,
        debut: s.debut,
        modele_id: "modele-1",
        modele_version: 1,
        type: s.type ?? "suivi",
        titre: "",
        importante: false,
        valeurs: {
          motif: document(s.motif),
          douleur_avant: s.avant,
          douleur_apres: s.apres,
          ...(s.traitements ? { traitements: document(s.traitements) } : {}),
        },
        facturation: s.gratuit ? "gratuit" : "a_facturer",
        commentaire_gratuit: s.gratuit ?? "",
        supprimee_le: null,
        cree_le: 0,
        modifie_le: 0,
      }))
    : [];
  const trouverSeance = (id: string) => {
    const seance = seances.find((s) => s.id === id);
    if (!seance) throw new Error("Cette séance n’existe plus");
    return seance;
  };
  const resumerDemo = (s: Seance) => {
    const patient = patients.find((p) => p.id === s.patient_id) ?? { nom: "", prenom: "" };
    const modele = modeles.find((m) => m.id === s.modele_id);
    return resumer(s, patient, versions.get(`${s.modele_id}@${s.modele_version}`) ?? null, modele?.nom ?? "");
  };
  const listerDemo = (garder: (s: Seance) => boolean) =>
    seances
      .filter(garder)
      .sort((a, b) => b.debut.localeCompare(a.debut))
      .map(resumerDemo);
  const verifierSeance = (saisie: SaisieSeance) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(saisie.debut)) throw new Error("Date ou heure de séance invalide");
    if (!versions.has(`${saisie.modele_id}@${saisie.modele_version}`)) throw new Error("Ce modèle n’existe plus");
    return { ...saisie, titre: saisie.titre.trim().replace(/\s+/g, " ") };
  };
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
      return patients
        .map((p) => {
          const siennes = seances.filter((s) => s.patient_id === p.id && s.supprimee_le === null).map((s) => s.debut).sort();
          return { ...resumeDe(p), seances: siennes.length, derniere_seance: siennes.length ? siennes[siennes.length - 1].slice(0, 10) : null };
        })
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"));
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
    async formulaireAntecedents() {
      return formulaireAntecedentsParDefaut;
    },
    async listerAntecedents(patientId) {
      const cle = (a: Antecedent) => `${a.debut === null ? 0 : 1}${a.debut ?? ""}`;
      return antecedents.filter((a) => a.patient_id === patientId).sort((a, b) => cle(a).localeCompare(cle(b)));
    },
    async enregistrerAntecedent(patientId, id, saisie) {
      trouverPatient(patientId);
      if (!saisie.categorie || !saisie.rubrique.trim()) throw new Error("Choisissez la catégorie et la rubrique de l’antécédent");
      if (saisie.fin && !saisie.debut) throw new Error("Indiquez le début avant la fin");
      if (saisie.debut && saisie.fin && !saisie.en_cours && saisie.fin < saisie.debut) throw new Error("La fin précède le début");
      const antecedent: Antecedent = {
        ...saisie,
        precision: saisie.precision.trim(),
        fin: saisie.en_cours ? null : saisie.fin,
        id: id ?? `antecedent-${(compteur += 1)}-${Date.now()}`,
        patient_id: patientId,
      };
      antecedents = [...antecedents.filter((a) => a.id !== antecedent.id), antecedent];
      return antecedent;
    },
    async supprimerAntecedent(id) {
      antecedents = antecedents.filter((a) => a.id !== id);
    },
    async listerModeles() {
      return [...modeles].sort((a, b) => Number(b.par_defaut) - Number(a.par_defaut));
    },
    async lireVersionModele(id, version) {
      const definition = versions.get(`${id}@${version}`);
      if (!definition) throw new Error("Ce modèle n’existe plus");
      return definition;
    },
    async enregistrerModele(id, saisie) {
      if (!saisie.nom.trim()) throw new Error("Donnez un nom au modèle");
      if (saisie.definition.champs.length === 0) throw new Error("Le modèle a besoin d’au moins un champ");
      const avant = id ? trouverModele(id) : null;
      if (avant?.par_defaut && !saisie.actif) throw new Error("Un modèle désactivé ne peut pas être le modèle par défaut");
      const nouvelleVersion = !avant || JSON.stringify(avant.definition) !== JSON.stringify(saisie.definition);
      const modele: Modele = {
        ...saisie,
        nom: saisie.nom.trim(),
        id: avant?.id ?? `modele-${(compteur += 1)}-${Date.now()}`,
        par_defaut: avant?.par_defaut ?? false,
        origine: avant?.origine ?? "praticien",
        version: avant ? avant.version + (nouvelleVersion ? 1 : 0) : 1,
        version_le: nouvelleVersion ? Math.floor(Date.now() / 1000) : (avant?.version_le ?? 0),
      };
      versions.set(`${modele.id}@${modele.version}`, modele.definition);
      modeles = avant ? modeles.map((m) => (m.id === modele.id ? modele : m)) : [...modeles, modele];
      return modele;
    },
    async creerSeance(patientId, saisie) {
      trouverPatient(patientId);
      const seance: Seance = {
        ...verifierSeance(saisie),
        id: `seance-${(compteur += 1)}-${Date.now()}`,
        patient_id: patientId,
        supprimee_le: null,
        cree_le: 0,
        modifie_le: 0,
      };
      seances = [...seances, seance];
      return seance;
    },
    async lireSeance(id) {
      return structuredClone(trouverSeance(id));
    },
    async enregistrerSeance(id, saisie) {
      const avant = trouverSeance(id);
      if (avant.supprimee_le !== null) throw new Error("Cette séance est à la corbeille : restaurez-la pour la modifier");
      const apres: Seance = { ...avant, ...verifierSeance(saisie) };
      seances = seances.map((s) => (s.id === id ? apres : s));
      return structuredClone(apres);
    },
    async listerSeancesPatient(patientId) {
      return listerDemo((s) => s.patient_id === patientId && s.supprimee_le === null);
    },
    async listerSeancesPeriode(du, au) {
      return listerDemo((s) => s.supprimee_le === null && s.debut.slice(0, 10) >= du && s.debut.slice(0, 10) <= au);
    },
    async supprimerSeance(id) {
      trouverSeance(id);
      seances = seances.map((s) => (s.id === id ? { ...s, supprimee_le: Math.floor(Date.now() / 1000) } : s));
    },
    async restaurerSeance(id) {
      trouverSeance(id);
      seances = seances.map((s) => (s.id === id ? { ...s, supprimee_le: null } : s));
      return trouverSeance(id);
    },
    async corbeilleSeances() {
      return listerDemo((s) => s.supprimee_le !== null);
    },
    async definirModeleParDefaut(id) {
      if (!trouverModele(id).actif) throw new Error("Un modèle désactivé ne peut pas être le modèle par défaut");
      modeles = modeles.map((m) => ({ ...m, par_defaut: m.id === id }));
      return trouverModele(id);
    },
  };
}

export function coeurParDefaut(): Coeur {
  return isTauri() ? coeurTauri : creerCoeurDeDemonstration();
}
