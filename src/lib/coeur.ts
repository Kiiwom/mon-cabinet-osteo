import { invoke, isTauri } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";

import bibliothequeDeDepart from "../../crates/osteosphere-core/src/bibliotheque_depart.json";
import formulaireAntecedentsParDefaut from "../../crates/osteosphere-core/src/formulaire_antecedents.json";
import modelesFournis from "../../crates/osteosphere-core/src/modeles_fournis.json";
import { creerFacturationDeDemonstration } from "./demoFacturation";
import type {
  EvenementFacture,
  Facture,
  FactureDeSeance,
  LigneFacture,
  LigneRecette,
  Prestation,
  ReglagesNumerotation,
  ResumeFacture,
  SaisieFacture,
  SaisiePrestation,
  SaisieReglement,
} from "./facturation";
import { document, estVide, resumer } from "./seances";
import { calculerStatistiques, type BaseChiffre, type Statistiques } from "./statistiques";

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
  /** Vide : la mention légale des ostéopathes, {@link MENTION_TVA}. */
  mention_tva: string;
  /** Le nom n'est pas suivi de « EI » : exercice en société, par exemple. */
  sans_ei: boolean;
  /** Mentions libres en bas des factures. */
  mentions: string;
}

/** Les champs de l'identité saisis en texte. */
export type ChampTexteIdentite = Exclude<keyof IdentiteCabinet, "sans_ei">;

export const MENTION_TVA = "TVA non applicable, article 261-4-1° du CGI";

export type QuelleImage = "logo" | "signature";

/** Présentation des factures et des comptes rendus. */
export interface MiseEnPage {
  /** `#rrggbb`, l'une de {@link COULEURS_DOCUMENTS}. */
  couleur: string;
  position_logo: "gauche" | "droite";
  /** Imprimer le logo, s'il y en a un. */
  logo: boolean;
  /** Imprimer l'image de la signature, s'il y en a une ; sinon, le nom. */
  signature: boolean;
}

/** Couleurs sombres, lisibles sur papier blanc et à l'impression en noir et blanc. */
export const COULEURS_DOCUMENTS: { nom: string; valeur: string }[] = [
  { nom: "Bronze", valeur: "#6e5212" },
  { nom: "Bleu", valeur: "#1f4e79" },
  { nom: "Vert", valeur: "#2f5d3a" },
  { nom: "Sarcelle", valeur: "#16595a" },
  { nom: "Prune", valeur: "#5b2d5e" },
  { nom: "Bordeaux", valeur: "#7a2632" },
  { nom: "Ardoise", valeur: "#3c4654" },
  { nom: "Noir", valeur: "#222222" },
];

export const MISE_EN_PAGE_DEFAUT: MiseEnPage = { couleur: "#6e5212", position_logo: "gauche", logo: true, signature: true };

export type CaractereTrames = "@" | "/";
export type FrequenceSauvegarde = "fermeture" | "intervalle" | "jour" | "semaine" | "manuelle";

export interface PreferencesSauvegarde {
  frequence: FrequenceSauvegarde;
  /** Pour la fréquence « intervalle » : 10, 15, 30, 60, 120 ou 240. */
  intervalle_minutes: number;
  /** Vide : le dossier proposé par l'application. */
  dossier: string;
  /** Nombre de sauvegardes gardées, de 3 à 365. */
  conserver: number;
}

export interface ChoixPremierDemarrage {
  identite: IdentiteCabinet;
  mot_de_passe: string | null;
  cle_notee: boolean;
  caractere_trames: CaractereTrames;
  sauvegardes: PreferencesSauvegarde;
}

export interface DerniereSauvegarde {
  le: number;
  journal: number;
  fichier: string;
}

export interface EtatSauvegardes {
  preferences: PreferencesSauvegarde;
  /** Dossier réellement utilisé. */
  dossier: string;
  derniere: DerniereSauvegarde | null;
  /** Dernière erreur de la sauvegarde automatique depuis l'ouverture. */
  erreur: string | null;
}

export interface FichierSauvegarde {
  chemin: string;
  nom: string;
  cree_le: number;
  taille: number;
  logiciel: string;
}

/** Contenu d'une sauvegarde, lu après l'avoir déchiffrée avec la clé de secours. */
export interface ApercuSauvegarde {
  cree_le: number;
  logiciel: string;
  praticien: string;
  patients: number;
  seances: number;
  factures: number;
  derniere_seance: string | null;
}

export interface Securite {
  mot_de_passe_actif: boolean;
  session_protegee: boolean;
  systeme: string;
}

export interface LigneJournal {
  id: number;
  le: number;
  action: string;
  entite: string;
}

/** Un champ de la séance proposé à l'impression du compte rendu. */
export interface ChampImprimable {
  id: string;
  libelle: string;
  /** Le champ a quelque chose à imprimer dans cette séance. */
  rempli: boolean;
  /** Coché d'office : le modèle le marque « imprimé » et il est rempli. */
  par_defaut: boolean;
}

/** Une pièce jointe du dossier, sans son contenu. */
export interface PieceJointe {
  id: string;
  patient_id: string;
  seance_id: string | null;
  nom: string;
  type_mime: string;
  taille: number;
  ajoute_le: number;
  supprime_le: number | null;
}

export interface AjoutDocuments {
  ajoutes: PieceJointe[];
  /** Un message par fichier refusé (trop gros, illisible…) ; les autres sont ajoutés. */
  erreurs: string[];
}

export type BlocAccueil = "seances_du_jour" | "a_facturer" | "statistiques" | "pense_betes" | "en_attente" | "anniversaires" | "sauvegarde";

export interface PenseBete {
  /** Vide pour un nouveau pense-bête : le cœur lui en donne un. */
  id: string;
  texte: string;
  /** `AAAA-MM-JJ`. */
  le: string;
}

export interface PreferencesAccueil {
  masques: BlocAccueil[];
  /** Le plus récent en premier. */
  pense_betes: PenseBete[];
}

/** Un patient de l'aperçu d'import : les plus suivis d'abord. */
export interface ApercuPatientImport {
  nom: string;
  prenom: string;
  naissance: string | null;
  ville: string;
  seances: number;
}

/** Ce que contient l'export MonCabinetLibéral, lu sans rien écrire. */
export interface AnalyseImport {
  cabinet: string;
  patients: number;
  patients_actifs: number;
  patients_archives: number;
  seances: number;
  premiere_seance: string | null;
  derniere_seance: string | null;
  antecedents: number;
  factures: number;
  avoirs: number;
  reglements: number;
  /** Champs des séances, repris dans le modèle « Reprise MonCabinetLibéral ». */
  champs: string[];
  /** Éléments déjà importés : ils ne seront pas recopiés. */
  deja_importes: number;
  doublons: string[];
  points: string[];
  apercu: ApercuPatientImport[];
  numerotation: string | null;
}

export interface ChoixImport {
  patients: boolean;
  antecedents: boolean;
  seances: boolean;
  factures: boolean;
}

export interface CompteurImport {
  crees: number;
  deja: number;
  ignores: number;
}

export interface RapportImport {
  patients: CompteurImport;
  antecedents: CompteurImport;
  seances: CompteurImport;
  factures: CompteurImport;
  reglements: CompteurImport;
  modele: string | null;
  avertissements: string[];
}

export interface ResultatImport {
  rapport: RapportImport;
  /** Sauvegarde faite juste avant l'import. */
  sauvegarde: string;
  /** Rapport lisible dans Documents › Osteosphere › Imports, s'il a pu être écrit. */
  fichier_rapport: string | null;
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
  /** Le texte mis en forme ; absent (null) pour une trame en texte simple. */
  contenu: JSONContent | null;
  origine: "depart" | "praticien";
  utilisations: number;
}

export interface SaisieTrame {
  code: string;
  titre: string;
  categorie: string;
  /** Le texte brut, un paragraphe par ligne : la syntaxe des choix et des blancs y est vérifiée. */
  modele: string;
  contenu: JSONContent | null;
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
  /** Reprise d'un autre logiciel : jamais proposée à facturer. */
  importee?: boolean;
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
  /** Brouillon ou facture émise, ni annulée ni corrigée. */
  facture: FactureDeSeance | null;
  /** Reprise d'un autre logiciel : sa facture éventuelle a été reprise à part. */
  importee: boolean;
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
  definirCaractereTrames(caractere: CaractereTrames): Promise<CaractereTrames>;
  /** Pages SVG de la facture d'essai, à la date locale `AAAA-MM-JJ`. */
  apercuFactureEssai(date: string): Promise<string[]>;
  ouvrirFactureEssai(date: string): Promise<void>;
  identiteCabinet(): Promise<IdentiteCabinet>;
  enregistrerIdentiteCabinet(identite: IdentiteCabinet): Promise<IdentiteCabinet>;
  miseEnPage(): Promise<MiseEnPage>;
  enregistrerMiseEnPage(miseEnPage: MiseEnPage): Promise<MiseEnPage>;
  /** Le logo ou la signature, vide s'il n'y en a pas. */
  imageDocuments(quelle: QuelleImage): Promise<ArrayBuffer>;
  /** Fenêtre du système pour choisir l'image ; `false` si le praticien annule. */
  choisirImageDocuments(quelle: QuelleImage): Promise<boolean>;
  supprimerImageDocuments(quelle: QuelleImage): Promise<void>;
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
  listerPrestations(): Promise<Prestation[]>;
  enregistrerPrestation(id: string | null, saisie: SaisiePrestation): Promise<Prestation>;
  reglagesNumerotation(): Promise<ReglagesNumerotation>;
  enregistrerReglagesNumerotation(reglages: ReglagesNumerotation): Promise<ReglagesNumerotation>;
  /** Numéro qu'aurait la prochaine facture émise à cette date, sans le réserver. */
  numeroSuivant(date: string): Promise<string>;
  lireFacture(id: string): Promise<Facture>;
  creerFacture(saisie: SaisieFacture): Promise<Facture>;
  modifierFacture(id: string, saisie: SaisieFacture): Promise<Facture>;
  annoterFacture(id: string, commentaire: string): Promise<Facture>;
  supprimerBrouillon(id: string): Promise<void>;
  emettreFacture(id: string, date: string): Promise<Facture>;
  /** Fin de séance : facture émise en une fois, avec le règlement s'il est reçu. */
  facturerSeance(seanceId: string, lignes: LigneFacture[], reglement: SaisieReglement | null, date: string): Promise<Facture>;
  /** Plusieurs séances, avec la prestation par défaut ; le montant du règlement est celui de chaque facture. */
  facturerSeances(seances: string[], reglement: SaisieReglement | null, date: string): Promise<Facture[]>;
  /** Avoir et facture rectificative : rend la facture rectificative. */
  corrigerFacture(id: string, saisie: SaisieFacture, date: string): Promise<Facture>;
  /** Avoir total : rend l'avoir. */
  annulerFacture(id: string, date: string): Promise<Facture>;
  ajouterReglement(factureId: string, saisie: SaisieReglement): Promise<Facture>;
  modifierReglement(id: string, saisie: SaisieReglement): Promise<Facture>;
  supprimerReglement(id: string): Promise<Facture>;
  listerFactures(du: string, au: string): Promise<ResumeFacture[]>;
  facturesEnAttente(): Promise<ResumeFacture[]>;
  facturesPatient(patientId: string): Promise<ResumeFacture[]>;
  factureDeSeance(seanceId: string): Promise<Facture | null>;
  historiqueFacture(id: string): Promise<EvenementFacture[]>;
  recettes(du: string, au: string): Promise<LigneRecette[]>;
  seancesAFacturer(): Promise<ResumeSeance[]>;
  /** Pages SVG de la facture, pour l'aperçu. */
  apercuFacture(id: string): Promise<string[]>;
  /** Range le PDF dans Documents › Osteosphere › Factures ; rend son chemin. */
  enregistrerFacturePdf(id: string): Promise<string>;
  imprimerFacture(id: string): Promise<void>;
  preparerEmailFacture(id: string, email: string): Promise<string>;
  /** Écrit un fichier dans Documents › Osteosphere › Exports ; rend son chemin. */
  exporterFichier(nom: string, contenu: string): Promise<string>;
  etatDesSauvegardes(): Promise<EtatSauvegardes>;
  enregistrerPreferencesSauvegarde(preferences: PreferencesSauvegarde): Promise<EtatSauvegardes>;
  sauvegarderMaintenant(): Promise<FichierSauvegarde>;
  listerSauvegardes(): Promise<FichierSauvegarde[]>;
  /** Fenêtre de choix du système ; `null` si le praticien annule. */
  choisirFichier(sorte: "sauvegarde" | "import"): Promise<string | null>;
  choisirDossier(): Promise<string | null>;
  /** Déchiffre et vérifie une sauvegarde, sans rien remplacer. */
  apercuRestauration(chemin: string, cle: string): Promise<ApercuSauvegarde>;
  /** Remplace les données par la sauvegarde vérifiée ; l'ancienne base est mise de côté. */
  confirmerRestauration(): Promise<IdentiteCabinet>;
  annulerRestauration(): Promise<void>;
  securite(): Promise<Securite>;
  definirMotDePasse(motDePasse: string): Promise<void>;
  retirerMotDePasse(): Promise<void>;
  verrouiller(): Promise<void>;
  /** Export complet en clair (CSV et JSON) dans Documents › Osteosphere › Exports ; rend le dossier. */
  exporterTout(): Promise<string>;
  journal(limite: number, avant: number | null): Promise<LigneJournal[]>;
  /** Dates comprises, comparées à la même période un an plus tôt. */
  statistiques(du: string, au: string, base: BaseChiffre): Promise<Statistiques>;
  /** Lit et vérifie l'export MonCabinetLibéral, sans rien écrire. */
  analyserImport(chemin: string): Promise<AnalyseImport>;
  /** Sauvegarde le cabinet, puis importe ce qui est choisi ; tout ou rien. */
  importerMcl(chemin: string, choix: ChoixImport): Promise<ResultatImport>;
  ouvrirRapportImport(chemin: string): Promise<void>;
  champsCompteRendu(seanceId: string): Promise<ChampImprimable[]>;
  /** Pages SVG du compte rendu avec les champs choisis. */
  apercuCompteRendu(seanceId: string, champs: string[]): Promise<string[]>;
  /** Range le PDF dans Documents › Osteosphere › Comptes rendus ; `joindre` l'ajoute aux documents de la séance. */
  enregistrerCompteRendu(seanceId: string, champs: string[], joindre: boolean): Promise<string>;
  imprimerCompteRendu(seanceId: string, champs: string[]): Promise<void>;
  listerDocuments(patientId: string): Promise<PieceJointe[]>;
  /** Fichiers du disque (choisis ou déposés) ajoutés au dossier, et à la séance si elle est donnée. */
  ajouterDocuments(patientId: string, seanceId: string | null, chemins: string[]): Promise<AjoutDocuments>;
  /** Fenêtre du système ; vide si le praticien annule. */
  choisirDocuments(): Promise<string[]>;
  contenuDocument(id: string): Promise<ArrayBuffer>;
  modifierDocument(id: string, nom: string, seanceId: string | null): Promise<PieceJointe>;
  supprimerDocument(id: string): Promise<void>;
  restaurerDocument(id: string): Promise<PieceJointe>;
  corbeilleDocuments(): Promise<PieceJointe[]>;
  /** Ouvre le document dans l'application du système. */
  ouvrirDocument(id: string): Promise<void>;
  /** Copie enregistrée où le praticien le choisit ; `null` s'il annule. */
  enregistrerCopieDocument(id: string): Promise<string | null>;
  accueil(): Promise<PreferencesAccueil>;
  enregistrerAccueil(accueil: PreferencesAccueil): Promise<PreferencesAccueil>;
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
  mention_tva: "",
  sans_ei: false,
  mentions: "",
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
  definirCaractereTrames: (caractere) => appeler("definir_caractere_trames", { caractere }),
  apercuFactureEssai: (date) => appeler("apercu_facture_essai", { date }),
  ouvrirFactureEssai: (date) => appeler("ouvrir_facture_essai", { date }),
  identiteCabinet: () => appeler("identite_cabinet"),
  enregistrerIdentiteCabinet: (identite) => appeler("enregistrer_identite_cabinet", { identite }),
  miseEnPage: () => appeler("mise_en_page"),
  enregistrerMiseEnPage: (miseEnPage) => appeler("enregistrer_mise_en_page", { miseEnPage }),
  imageDocuments: (quelle) => appeler("image_documents", { quelle }),
  choisirImageDocuments: (quelle) => appeler("choisir_image_documents", { quelle }),
  supprimerImageDocuments: (quelle) => appeler("supprimer_image_documents", { quelle }),
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
  listerPrestations: () => appeler("lister_prestations"),
  enregistrerPrestation: (id, saisie) => appeler("enregistrer_prestation", { id, saisie }),
  reglagesNumerotation: () => appeler("reglages_numerotation"),
  enregistrerReglagesNumerotation: (reglages) => appeler("enregistrer_reglages_numerotation", { reglages }),
  numeroSuivant: (date) => appeler("numero_suivant", { date }),
  lireFacture: (id) => appeler("lire_facture", { id }),
  creerFacture: (saisie) => appeler("creer_facture", { saisie }),
  modifierFacture: (id, saisie) => appeler("modifier_facture", { id, saisie }),
  annoterFacture: (id, commentaire) => appeler("annoter_facture", { id, commentaire }),
  supprimerBrouillon: (id) => appeler("supprimer_brouillon", { id }),
  emettreFacture: (id, date) => appeler("emettre_facture", { id, date }),
  facturerSeance: (seanceId, lignes, reglement, date) => appeler("facturer_seance", { seanceId, lignes, reglement, date }),
  facturerSeances: (seances, reglement, date) => appeler("facturer_seances", { seances, reglement, date }),
  corrigerFacture: (id, saisie, date) => appeler("corriger_facture", { id, saisie, date }),
  annulerFacture: (id, date) => appeler("annuler_facture", { id, date }),
  ajouterReglement: (factureId, saisie) => appeler("ajouter_reglement", { factureId, saisie }),
  modifierReglement: (id, saisie) => appeler("modifier_reglement", { id, saisie }),
  supprimerReglement: (id) => appeler("supprimer_reglement", { id }),
  listerFactures: (du, au) => appeler("lister_factures", { du, au }),
  facturesEnAttente: () => appeler("factures_en_attente"),
  facturesPatient: (patientId) => appeler("factures_patient", { patientId }),
  factureDeSeance: (seanceId) => appeler("facture_de_seance", { seanceId }),
  historiqueFacture: (id) => appeler("historique_facture", { id }),
  recettes: (du, au) => appeler("recettes", { du, au }),
  seancesAFacturer: () => appeler("seances_a_facturer"),
  apercuFacture: (id) => appeler("apercu_facture", { id }),
  enregistrerFacturePdf: (id) => appeler("enregistrer_facture_pdf", { id }),
  imprimerFacture: (id) => appeler("imprimer_facture", { id }),
  preparerEmailFacture: (id, email) => appeler("preparer_email_facture", { id, email }),
  exporterFichier: (nom, contenu) => appeler("exporter_fichier", { nom, contenu }),
  etatDesSauvegardes: () => appeler("etat_des_sauvegardes"),
  enregistrerPreferencesSauvegarde: (preferences) => appeler("enregistrer_preferences_sauvegarde", { preferences }),
  sauvegarderMaintenant: () => appeler("sauvegarder_maintenant"),
  listerSauvegardes: () => appeler("lister_sauvegardes"),
  choisirFichier: (sorte) => appeler("choisir_fichier", { sorte }),
  choisirDossier: () => appeler("choisir_dossier"),
  apercuRestauration: (chemin, cle) => appeler("apercu_restauration", { chemin, cle }),
  confirmerRestauration: () => appeler("confirmer_restauration"),
  annulerRestauration: () => appeler("annuler_restauration"),
  securite: () => appeler("securite"),
  definirMotDePasse: (motDePasse) => appeler("definir_mot_de_passe", { motDePasse }),
  retirerMotDePasse: () => appeler("retirer_mot_de_passe"),
  verrouiller: () => appeler("verrouiller"),
  exporterTout: () => appeler("exporter_tout"),
  journal: (limite, avant) => appeler("journal", { limite, avant }),
  statistiques: (du, au, base) => appeler("statistiques", { du, au, base }),
  analyserImport: (chemin) => appeler("analyser_import", { chemin }),
  importerMcl: (chemin, choix) => appeler("importer_mcl", { chemin, choix }),
  ouvrirRapportImport: (chemin) => appeler("ouvrir_rapport_import", { chemin }),
  champsCompteRendu: (seanceId) => appeler("champs_compte_rendu", { seanceId }),
  apercuCompteRendu: (seanceId, champs) => appeler("apercu_compte_rendu", { seanceId, champs }),
  enregistrerCompteRendu: (seanceId, champs, joindre) => appeler("enregistrer_compte_rendu", { seanceId, champs, joindre }),
  imprimerCompteRendu: (seanceId, champs) => appeler("imprimer_compte_rendu", { seanceId, champs }),
  listerDocuments: (patientId) => appeler("lister_documents", { patientId }),
  ajouterDocuments: (patientId, seanceId, chemins) => appeler("ajouter_documents", { patientId, seanceId, chemins }),
  choisirDocuments: () => appeler("choisir_documents"),
  contenuDocument: (id) => appeler("contenu_document", { id }),
  modifierDocument: (id, nom, seanceId) => appeler("modifier_document", { id, nom, seanceId }),
  supprimerDocument: (id) => appeler("supprimer_document", { id }),
  restaurerDocument: (id) => appeler("restaurer_document", { id }),
  corbeilleDocuments: () => appeler("corbeille_documents"),
  ouvrirDocument: (id) => appeler("ouvrir_document", { id }),
  enregistrerCopieDocument: (id) => appeler("enregistrer_copie_document", { id }),
  accueil: () => appeler("accueil"),
  enregistrerAccueil: (accueil) => appeler("enregistrer_accueil", { accueil }),
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
  let identite: IdentiteCabinet = exemples
    ? {
        ...IDENTITE_VIDE,
        prenom: "Alexandre",
        nom: "Roux",
        adresse: "12 place de la Halle",
        code_postal: "47150",
        ville: "Lacapelle-Biron",
        telephone: "06 00 00 00 00",
        email: "cabinet@exemple.fr",
        siret: "12345678900012",
        rpps: "10000000000",
      }
    : { ...IDENTITE_VIDE, prenom: "Alexandre", nom: "Roux" };
  let caractere: CaractereTrames = "@";
  let miseEnPage: MiseEnPage = { ...MISE_EN_PAGE_DEFAUT };
  const images: Record<QuelleImage, boolean> = { logo: false, signature: false };
  let trames: Trame[] = bibliothequeDeDepart.map((t, rang) => ({ ...t, contenu: null, id: `depart-${rang}`, origine: "depart", utilisations: 0 }));
  let compteur = 0;
  let accueilDemo: PreferencesAccueil = {
    masques: [],
    pense_betes: exemples
      ? [
          { id: "pense-bete-a", texte: "Commander des draps d’examen", le: "2026-10-02" },
          { id: "pense-bete-b", texte: "Renouveler l’assurance RCP avant le 30 novembre", le: "2026-09-15" },
        ]
      : [],
  };
  const documentsDemo: PieceJointe[] = exemples
    ? [
        {
          id: "document-radio",
          patient_id: "patient-1",
          seance_id: null,
          nom: "Radiographie lombaire.png",
          type_mime: "image/png",
          taille: IMAGE_FICTIVE.length,
          ajoute_le: 1_790_000_000,
          supprime_le: null,
        },
      ]
    : [];
  /** Patients créés par l'import de démonstration : un second import ne les recopie pas. */
  const importDemo: string[] = [];
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
  const facturation = creerFacturationDeDemonstration(
    {
      patient: (id) => {
        const patient = patients.find((p) => p.id === id);
        if (!patient) throw new Error("Ce dossier n’existe plus");
        return patient;
      },
      seance: (id) => seances.find((s) => s.id === id),
      identite: () => identite,
    },
    exemples,
  );
  const resumerDemo = (s: Seance): ResumeSeance => {
    const patient = patients.find((p) => p.id === s.patient_id) ?? { nom: "", prenom: "" };
    const modele = modeles.find((m) => m.id === s.modele_id);
    return {
      ...resumer(s, patient, versions.get(`${s.modele_id}@${s.modele_version}`) ?? null, modele?.nom ?? ""),
      facture: facturation.factureDeSeanceResumee(s.id),
    };
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
  let preferencesSauvegarde: PreferencesSauvegarde = { frequence: "fermeture", intervalle_minutes: 60, dossier: "", conserver: 30 };
  const DOSSIER_DEMO = "C:\\Users\\Praticien\\Documents\\Osteosphere\\Sauvegardes";
  const nomSauvegarde = (le: number) => {
    const d = new Date(le * 1000);
    const deux = (n: number) => String(n).padStart(2, "0");
    return `Osteosphere ${dateDuJour(d)} ${deux(d.getHours())}h${deux(d.getMinutes())}.osteosauve`;
  };
  let sauvegardesDemo: FichierSauvegarde[] = exemples
    ? [3, 2, 1].map((jours) => {
        const le = Math.floor(Date.now() / 1000) - jours * 86_400;
        return { chemin: `${DOSSIER_DEMO}\\${nomSauvegarde(le)}`, nom: nomSauvegarde(le), cree_le: le, taille: 2_400_000, logiciel: "0.7.0" };
      })
    : [];
  let restaurationDemo: string | null = null;
  const etatSauvegardesDemo = (): EtatSauvegardes => ({
    preferences: { ...preferencesSauvegarde },
    dossier: preferencesSauvegarde.dossier || DOSSIER_DEMO,
    derniere: sauvegardesDemo[sauvegardesDemo.length - 1]
      ? { le: sauvegardesDemo[sauvegardesDemo.length - 1].cree_le, journal: 0, fichier: sauvegardesDemo[sauvegardesDemo.length - 1].chemin }
      : null,
    erreur: null,
  });
  const codePropre = (code: string) => code.trim().replace(/^[@/]/, "").toLowerCase();
  const normaliser = (cle: string) => cle.toUpperCase().replace(/[\s-]/g, "");

  const coeur: Coeur = {
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
        contenu: saisie.contenu ?? null,
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
    async definirCaractereTrames(nouveau) {
      caractere = nouveau;
      return caractere;
    },
    async apercuFactureEssai() {
      throw new Error(SANS_PDF);
    },
    async ouvrirFactureEssai() {
      throw new Error(SANS_PDF);
    },
    async identiteCabinet() {
      return { ...identite };
    },
    async enregistrerIdentiteCabinet(saisie) {
      if (!saisie.prenom.trim() || !saisie.nom.trim()) throw new Error("Indiquez votre prénom et votre nom");
      const chiffres = (t: string) => t.replace(/\s/g, "");
      const propre = { ...saisie, siret: chiffres(saisie.siret), rpps: chiffres(saisie.rpps), code_postal: chiffres(saisie.code_postal) };
      if (propre.siret && !/^\d{14}$/.test(propre.siret)) throw new Error("Le SIRET compte 14 chiffres");
      if (propre.rpps && !/^\d{11}$/.test(propre.rpps)) throw new Error("Le numéro RPPS compte 11 chiffres");
      if (propre.code_postal && !/^\d{5}$/.test(propre.code_postal)) throw new Error("Le code postal compte 5 chiffres");
      if (propre.mention_tva.length > 200 || propre.mentions.length > 600) throw new Error("Les mentions tiennent en 200 caractères pour la TVA, 600 pour les mentions libres");
      identite = { ...propre, mention_tva: propre.mention_tva.trim(), mentions: propre.mentions.trim() };
      return { ...identite };
    },
    async miseEnPage() {
      return { ...miseEnPage };
    },
    async enregistrerMiseEnPage(saisie) {
      if (!/^#[0-9a-f]{6}$/i.test(saisie.couleur.trim())) throw new Error("couleur inconnue : choisissez-en une dans la liste");
      miseEnPage = { ...saisie, couleur: saisie.couleur.trim().toLowerCase() };
      return { ...miseEnPage };
    },
    async imageDocuments(quelle) {
      return images[quelle] ? IMAGE_FICTIVE.slice().buffer : new ArrayBuffer(0);
    },
    async choisirImageDocuments(quelle) {
      images[quelle] = true;
      return true;
    },
    async supprimerImageDocuments(quelle) {
      images[quelle] = false;
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
      if (saisie.facturation === "gratuit" && avant.facturation !== "gratuit" && facturation.factureDeSeanceResumee(id))
        throw new Error("Cette séance a une facture : annulez-la par un avoir avant d’en faire un acte gratuit");
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
      if (facturation.seanceFacturee(id)) throw new Error("Cette séance a été facturée : elle reste dans le dossier, avec ses factures");
      facturation.supprimerBrouillonsDeSeance(id);
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
    listerPrestations: facturation.listerPrestations,
    enregistrerPrestation: facturation.enregistrerPrestation,
    reglagesNumerotation: facturation.reglagesNumerotation,
    enregistrerReglagesNumerotation: facturation.enregistrerReglagesNumerotation,
    numeroSuivant: facturation.numeroSuivant,
    lireFacture: facturation.lireFacture,
    creerFacture: facturation.creerFacture,
    modifierFacture: facturation.modifierFacture,
    annoterFacture: facturation.annoterFacture,
    supprimerBrouillon: facturation.supprimerBrouillon,
    emettreFacture: facturation.emettreFacture,
    facturerSeance: facturation.facturerSeance,
    facturerSeances: facturation.facturerSeances,
    corrigerFacture: facturation.corrigerFacture,
    annulerFacture: facturation.annulerFacture,
    ajouterReglement: facturation.ajouterReglement,
    modifierReglement: facturation.modifierReglement,
    supprimerReglement: facturation.supprimerReglement,
    listerFactures: facturation.listerFactures,
    facturesEnAttente: facturation.facturesEnAttente,
    facturesPatient: facturation.facturesPatient,
    factureDeSeance: facturation.factureDeSeance,
    historiqueFacture: facturation.historiqueFacture,
    recettes: facturation.recettes,
    async seancesAFacturer() {
      return listerDemo((s) => s.supprimee_le === null && s.facturation === "a_facturer").filter((s) => !s.facture || s.facture.numero === null);
    },
    async apercuFacture() {
      throw new Error(SANS_PDF);
    },
    async enregistrerFacturePdf() {
      throw new Error(SANS_PDF);
    },
    async imprimerFacture() {
      throw new Error(SANS_PDF);
    },
    async preparerEmailFacture() {
      throw new Error(SANS_PDF);
    },
    async exporterFichier(nom, contenu) {
      // Dans un navigateur, l'export devient un téléchargement.
      if (typeof URL.createObjectURL === "function") {
        const lien = window.document.createElement("a");
        lien.href = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8" }));
        lien.download = nom;
        lien.click();
        URL.revokeObjectURL(lien.href);
      }
      return `Téléchargements/${nom}`;
    },
    async etatDesSauvegardes() {
      return etatSauvegardesDemo();
    },
    async enregistrerPreferencesSauvegarde(preferences) {
      if (![10, 15, 30, 60, 120, 240].includes(preferences.intervalle_minutes)) throw new Error(`Intervalle de sauvegarde non proposé : ${preferences.intervalle_minutes} minutes`);
      if (preferences.conserver < 3 || preferences.conserver > 365) throw new Error("Gardez entre 3 et 365 sauvegardes");
      preferencesSauvegarde = { ...preferences, dossier: preferences.dossier.trim() };
      return etatSauvegardesDemo();
    },
    async sauvegarderMaintenant() {
      const le = Math.floor(Date.now() / 1000);
      const fichier = { chemin: `${etatSauvegardesDemo().dossier}\\${nomSauvegarde(le)}`, nom: nomSauvegarde(le), cree_le: le, taille: 2_400_000, logiciel: "0.7.0" };
      sauvegardesDemo = [...sauvegardesDemo, fichier].slice(-preferencesSauvegarde.conserver);
      return fichier;
    },
    async listerSauvegardes() {
      return [...sauvegardesDemo].reverse();
    },
    async choisirFichier(sorte) {
      return sorte === "sauvegarde" ? (sauvegardesDemo[0]?.chemin ?? null) : "C:\\Users\\Praticien\\Téléchargements\\export-mcl.zip";
    },
    async choisirDossier() {
      return "D:\\Sauvegardes Osteosphere";
    },
    async apercuRestauration(chemin, cle) {
      const fichier = sauvegardesDemo.find((f) => f.chemin === chemin);
      if (!fichier) throw new Error("Ce fichier n’est pas une sauvegarde Osteosphere");
      if (normaliser(cle) !== normaliser(CLE_DE_DEMONSTRATION)) throw new Error("Clé de secours incorrecte pour cette sauvegarde");
      restaurationDemo = chemin;
      const vivantes = seances.filter((s) => s.supprimee_le === null);
      return {
        cree_le: fichier.cree_le,
        logiciel: fichier.logiciel,
        praticien: `${identite.prenom} ${identite.nom}`,
        patients: patients.length,
        seances: vivantes.length,
        factures: (await facturation.listerFactures("1900-01-01", "2999-12-31")).filter((f) => f.numero).length,
        derniere_seance: vivantes.map((s) => s.debut.slice(0, 10)).sort().pop() ?? null,
      };
    },
    async confirmerRestauration() {
      if (!restaurationDemo) throw new Error("Choisissez d’abord la sauvegarde à restaurer.");
      restaurationDemo = null;
      etat = "ouvert";
      return identite;
    },
    async annulerRestauration() {
      restaurationDemo = null;
    },
    async securite() {
      return { mot_de_passe_actif: motDePasse !== null, session_protegee: true, systeme: "windows" };
    },
    async definirMotDePasse(nouveau) {
      if (nouveau.length < 8) throw new Error("Choisissez un mot de passe d’au moins 8 caractères.");
      motDePasse = nouveau;
    },
    async retirerMotDePasse() {
      motDePasse = null;
    },
    async verrouiller() {
      if (motDePasse === null) throw new Error("Sans mot de passe, utilisez le verrouillage de votre ordinateur.");
      etat = "mot_de_passe_requis";
    },
    async exporterTout() {
      return "C:\\Users\\Praticien\\Documents\\Osteosphere\\Exports\\Export Osteosphere (démonstration)";
    },
    async journal(limite, avant) {
      const lignes: LigneJournal[] = [
        ...patients.map((p, rang) => ({ id: rang + 1, le: 1_780_000_000 + rang * 3_600, action: "patient.cree", entite: p.id })),
        ...seances.map((s, rang) => ({ id: 100 + rang, le: 1_790_000_000 + rang * 3_600, action: "seance.creee", entite: s.id })),
      ].sort((a, b) => b.id - a.id);
      return lignes.filter((l) => avant === null || l.id < avant).slice(0, limite);
    },
    async statistiques(du, au, base) {
      const [recettes, factures] = await Promise.all([facturation.recettes("1900-01-01", "2999-12-31"), facturation.listerFactures("1900-01-01", "2999-12-31")]);
      return calculerStatistiques({ patients, seances: seances.map(resumerDemo), antecedents, recettes, factures }, du, au, base);
    },
    async analyserImport(chemin) {
      if (!chemin.toLowerCase().endsWith(".zip")) throw new Error("Ce fichier n’est pas une archive zip lisible.");
      const deja = importDemo.filter((id) => patients.some((p) => p.id === id)).length;
      return {
        ...ANALYSE_FICTIVE,
        deja_importes: deja,
        apercu: PATIENTS_IMPORT_FICTIFS.map((p) => ({ nom: p.nom!, prenom: p.prenom!, naissance: p.naissance ?? null, ville: p.ville ?? "", seances: 0 })),
      };
    },
    async importerMcl(chemin, choix) {
      await coeur.analyserImport(chemin);
      const vide = { crees: 0, deja: 0, ignores: 0 };
      const rapport: RapportImport = {
        patients: { ...vide },
        antecedents: { ...vide, ignores: ANALYSE_FICTIVE.antecedents },
        seances: { ...vide, ignores: ANALYSE_FICTIVE.seances },
        factures: { ...vide, ignores: ANALYSE_FICTIVE.factures + ANALYSE_FICTIVE.avoirs },
        reglements: { ...vide, ignores: ANALYSE_FICTIVE.reglements },
        modele: null,
        avertissements: ["Démonstration : seuls les patients sont repris. L’import complet se fait dans l’application installée."],
      };
      if (importDemo.length) rapport.patients.deja = importDemo.length;
      else if (choix.patients) {
        for (const fiche of PATIENTS_IMPORT_FICTIFS) importDemo.push((await coeur.creerPatient({ ...FICHE_VIDE, ...fiche })).id);
        rapport.patients.crees = importDemo.length;
      } else rapport.patients.ignores = PATIENTS_IMPORT_FICTIFS.length;
      return { rapport, sauvegarde: (await coeur.sauvegarderMaintenant()).chemin, fichier_rapport: null };
    },
    async ouvrirRapportImport() {
      throw new Error("Pas de rapport écrit dans la démonstration.");
    },
    async champsCompteRendu(seanceId) {
      const seance = seances.find((s) => s.id === seanceId);
      if (!seance) throw new Error("Cette séance n’existe plus");
      const definition = versions.get(`${seance.modele_id}@${seance.modele_version}`) ?? { champs: [] };
      return definition.champs
        .filter((c) => !["intertitre", "resume_precedent", "dessin"].includes(c.type))
        .map((c) => {
          const rempli = !estVide(seance.valeurs[c.id]);
          return { id: c.id, libelle: c.libelle, rempli, par_defaut: rempli && c.imprimer !== false };
        });
    },
    async apercuCompteRendu() {
      throw new Error(SANS_COMPTE_RENDU);
    },
    async enregistrerCompteRendu() {
      throw new Error(SANS_COMPTE_RENDU);
    },
    async imprimerCompteRendu() {
      throw new Error(SANS_COMPTE_RENDU);
    },
    async listerDocuments(patientId) {
      trouverPatient(patientId);
      return documentsDemo.filter((d) => d.patient_id === patientId && d.supprime_le === null).sort((a, b) => b.ajoute_le - a.ajoute_le);
    },
    async ajouterDocuments(patientId, seanceId, chemins) {
      trouverPatient(patientId);
      const ajoutes: PieceJointe[] = [];
      for (const chemin of chemins) {
        const nom = chemin.split(/[\\/]/).pop() || "Document";
        const document: PieceJointe = {
          id: `document-${(compteur += 1)}`,
          patient_id: patientId,
          seance_id: seanceId,
          nom,
          type_mime: typeDocument(nom),
          taille: IMAGE_FICTIVE.length,
          ajoute_le: Math.floor(Date.now() / 1000) + compteur,
          supprime_le: null,
        };
        documentsDemo.push(document);
        ajoutes.push(document);
      }
      return { ajoutes, erreurs: [] };
    },
    async choisirDocuments() {
      return ["C:\\Users\\Praticien\\Documents\\Radio du genou.png"];
    },
    async contenuDocument(id) {
      if (!documentsDemo.some((d) => d.id === id)) throw new Error("Ce document n’existe plus");
      return IMAGE_FICTIVE.slice().buffer;
    },
    async modifierDocument(id, nom, seanceId) {
      const document = documentsDemo.find((d) => d.id === id);
      if (!document) throw new Error("Ce document n’existe plus");
      Object.assign(document, { nom: nom.trim() || "Document", type_mime: typeDocument(nom), seance_id: seanceId });
      return { ...document };
    },
    async supprimerDocument(id) {
      const document = documentsDemo.find((d) => d.id === id);
      if (document) document.supprime_le = Math.floor(Date.now() / 1000);
    },
    async restaurerDocument(id) {
      const document = documentsDemo.find((d) => d.id === id);
      if (!document) throw new Error("Ce document n’existe plus");
      document.supprime_le = null;
      return { ...document };
    },
    async corbeilleDocuments() {
      return documentsDemo.filter((d) => d.supprime_le !== null);
    },
    async ouvrirDocument() {
      throw new Error("Dans la démonstration, les documents ne s’ouvrent pas dans une autre application.");
    },
    async enregistrerCopieDocument() {
      return null;
    },
    async accueil() {
      return structuredClone(accueilDemo);
    },
    async enregistrerAccueil(nouveau) {
      if (nouveau.pense_betes.some((p) => !p.texte.trim())) throw new Error("Un pense-bête vide ne sert à rien.");
      accueilDemo = {
        masques: [...new Set(nouveau.masques)],
        pense_betes: nouveau.pense_betes.map((p) => ({ ...p, texte: p.texte.trim().split(/\s+/).join(" "), id: p.id || `pense-bete-${(compteur += 1)}` })),
      };
      return structuredClone(accueilDemo);
    },
  };
  return coeur;
}

/** Image fictive des documents de démonstration : un carré de 1 pixel, en PNG. */
const IMAGE_FICTIVE = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

function typeDocument(nom: string): string {
  const extension = nom.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  return types[extension] ?? "application/octet-stream";
}

/** Patients fictifs de l'import de démonstration. */
const PATIENTS_IMPORT_FICTIFS: Partial<FichePatient>[] = [
  { nom: "Girard", prenom: "Thomas", naissance: "1979-11-02", sexe: "M", ville: "Villeneuve-sur-Lot", code_postal: "47300" },
  { nom: "Lemaire", prenom: "Hugo", naissance: "2015-06-21", sexe: "M", ville: "Monflanquin", code_postal: "47150" },
  { nom: "Haddad", prenom: "Nadia", naissance: "1968-08-30", sexe: "F", ville: "Lacapelle-Biron", code_postal: "47150" },
];

const ANALYSE_FICTIVE: AnalyseImport = {
  cabinet: "cabinet fictif",
  patients: 3,
  patients_actifs: 3,
  patients_archives: 0,
  seances: 28,
  premiere_seance: "2019-01-03",
  derniere_seance: "2026-10-01",
  antecedents: 9,
  factures: 27,
  avoirs: 1,
  reglements: 26,
  champs: ["Motif de consultation", "Anamnèse", "Tests", "Traitements", "Conseils"],
  deja_importes: 0,
  doublons: [],
  points: ["1 ligne(s) de paiement non reprise(s) : compensations par avoir, déjà comptées dans l’avoir, ou opérations sans facture."],
  apercu: [],
  numerotation: "La numérotation reprendra après la facture 2026-10-1771.",
};

const SANS_PDF = "Les factures PDF sont mises en page par le cœur : ouvrez Osteosphere dans sa fenêtre pour les voir.";
const SANS_COMPTE_RENDU = "Les comptes rendus PDF sont mis en page par le cœur : ouvrez Osteosphere dans sa fenêtre pour les voir.";

export function coeurParDefaut(): Coeur {
  return isTauri() ? coeurTauri : creerCoeurDeDemonstration();
}
