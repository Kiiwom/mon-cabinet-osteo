import type { IdentiteCabinet } from "./coeur";

export type Nature = "facture" | "avoir";
export type EtatFacture = "brouillon" | "emise" | "annulee";
export type Moyen = "carte" | "cheque" | "especes" | "virement" | "autre";

export interface Destinataire {
  civilite: string;
  prenom: string;
  nom: string;
  /** Une ou deux lignes. */
  adresse: string;
  code_postal: string;
  ville: string;
}

export interface LigneFacture {
  prestation_id: string | null;
  designation: string;
  quantite: number;
  prix_unitaire_centimes: number;
  /** Remise accordée sur la ligne. */
  reduction_centimes: number;
}

export interface SaisieFacture {
  patient_id: string | null;
  seance_id: string | null;
  /** `AAAA-MM-JJ`, imprimée sous la date d'émission. */
  date_seance: string | null;
  destinataire: Destinataire;
  lignes: LigneFacture[];
  commentaire_imprime: string;
  /** Jamais imprimé. */
  commentaire_interne: string;
}

export interface SaisieReglement {
  moyen: Moyen;
  /** Négatif pour un remboursement. */
  montant_centimes: number;
  /** `AAAA-MM-JJ`. */
  encaisse_le: string;
  /** Numéro du chèque, référence du virement. */
  reference: string;
  /** Quand ce n'est pas le patient qui règle. */
  payeur: string;
  commentaire: string;
}

export interface Reglement extends SaisieReglement {
  id: string;
  facture_id: string;
  importe: boolean;
  cree_le: number;
  modifie_le: number;
}

export interface Renvoi {
  id: string;
  numero: string;
  date_emission: string;
}

export interface Facture extends SaisieFacture {
  id: string;
  nature: Nature;
  etat: EtatFacture;
  numero: string | null;
  date_emission: string | null;
  /** Négatif pour un avoir. */
  total_centimes: number;
  regle_centimes: number;
  /** Ce qui reste dû, pour une facture émise ; négatif s'il y a un trop-perçu. */
  reste_centimes: number;
  /** Avoir : ce qui peut encore être remboursé d'après les règlements de la facture annulée. */
  remboursable_centimes: number;
  praticien: IdentiteCabinet | null;
  /** Avoir : la facture annulée. Facture rectificative : celle qu'elle remplace. */
  origine: Renvoi | null;
  avoir: Renvoi | null;
  rectificative: Renvoi | null;
  reglements: Reglement[];
  importee: boolean;
  cree_le: number;
  modifie_le: number;
}

export interface ResumeFacture {
  id: string;
  nature: Nature;
  etat: EtatFacture;
  numero: string | null;
  date_emission: string | null;
  patient_id: string | null;
  patient_nom: string;
  patient_prenom: string;
  destinataire: string;
  seance_id: string | null;
  date_seance: string | null;
  designation: string;
  total_centimes: number;
  regle_centimes: number;
  reste_centimes: number;
  moyens: Moyen[];
  origine_numero: string | null;
  importee: boolean;
}

export interface LigneRecette extends SaisieReglement {
  id: string;
  facture_id: string;
  facture_numero: string | null;
  facture_date: string | null;
  nature: Nature;
  patient_id: string | null;
  /** Le patient, sinon le destinataire. */
  nom: string;
  importe: boolean;
}

export interface EvenementFacture {
  le: number;
  action: string;
  numero: string | null;
  montant_centimes: number | null;
  moyen: Moyen | null;
}

export type CouleurPrestation = "bleu" | "vert" | "ocre" | "violet" | "rose" | "gris";
export const COULEURS_PRESTATION: CouleurPrestation[] = ["bleu", "vert", "ocre", "violet", "rose", "gris"];

export interface SaisiePrestation {
  libelle: string;
  /** Désignation imprimée ; vide = le libellé. */
  libelle_imprime: string;
  tarif_centimes: number;
  couleur: CouleurPrestation;
  par_defaut: boolean;
  archivee: boolean;
}

export interface Prestation extends SaisiePrestation {
  id: string;
  rang: number;
  cree_le: number;
  modifie_le: number;
}

export interface ReglagesNumerotation {
  format: { modele: string; chiffres: number };
  /** Compteur de la première facture d'une année, pour qui change de logiciel sans importer. */
  depart: { annee: number; compteur: number } | null;
}

/** La facture en cours d'une séance, dans les listes. */
export interface FactureDeSeance {
  id: string;
  numero: string | null;
  reste_centimes: number;
}

export const MOYENS: { valeur: Moyen; libelle: string }[] = [
  { valeur: "carte", libelle: "Carte" },
  { valeur: "cheque", libelle: "Chèque" },
  { valeur: "especes", libelle: "Espèces" },
  { valeur: "virement", libelle: "Virement" },
  { valeur: "autre", libelle: "Autre" },
];

export function libelleMoyen(moyen: Moyen): string {
  return MOYENS.find((m) => m.valeur === moyen)?.libelle ?? moyen;
}

export const DESTINATAIRE_VIDE: Destinataire = { civilite: "", prenom: "", nom: "", adresse: "", code_postal: "", ville: "" };

export const SAISIE_FACTURE_VIDE: SaisieFacture = {
  patient_id: null,
  seance_id: null,
  date_seance: null,
  destinataire: DESTINATAIRE_VIDE,
  lignes: [],
  commentaire_imprime: "",
  commentaire_interne: "",
};

/** « 1 250,00 € » : espaces insécables, comme sur la facture imprimée. */
export function euros(centimes: number): string {
  const signe = centimes < 0 ? "-" : "";
  const absolu = Math.abs(Math.round(centimes));
  const entiers = String(Math.floor(absolu / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${signe}${entiers},${String(absolu % 100).padStart(2, "0")} €`;
}

/** « 55 », « 55,5 », « 55,50 € » ou « 55.50 » donnent 5550 centimes ; `null` si illisible. */
export function lireMontant(texte: string): number | null {
  const propre = texte.replace(/[\s €]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(propre)) return null;
  return Math.round(Number(propre) * 100);
}

/** « 55,00 » : la valeur d'un champ de montant. */
export function ecrireMontant(centimes: number): string {
  return euros(centimes).replace(/ €$/, "").replace(/ /g, " ");
}

export function montantLigne(l: LigneFacture): number {
  return l.prix_unitaire_centimes * l.quantite - l.reduction_centimes;
}

export function totalLignes(lignes: LigneFacture[]): number {
  return lignes.reduce((total, l) => total + montantLigne(l), 0);
}

export function designationPrestation(p: Pick<Prestation, "libelle" | "libelle_imprime">): string {
  return p.libelle_imprime || p.libelle;
}

export function ligneDePrestation(p: Prestation): LigneFacture {
  return { prestation_id: p.id, designation: designationPrestation(p), quantite: 1, prix_unitaire_centimes: p.tarif_centimes, reduction_centimes: 0 };
}

/** La prestation proposée en fin de séance : celle par défaut, sinon la première active. */
export function prestationParDefaut(prestations: Prestation[]): Prestation | null {
  const actives = prestations.filter((p) => !p.archivee);
  return actives.find((p) => p.par_defaut) ?? actives[0] ?? null;
}

export function nomComplet(d: Pick<Destinataire, "prenom" | "nom">): string {
  return [d.prenom.trim(), d.nom.trim()].filter(Boolean).join(" ");
}

/** Le patient lui-même, d'après sa fiche : le destinataire proposé. */
export function destinataireDuPatient(p: {
  sexe: string;
  prenom: string;
  nom: string;
  adresse: string;
  complement_adresse: string;
  code_postal: string;
  ville: string;
}): Destinataire {
  return {
    civilite: p.sexe === "F" ? "Mme" : p.sexe === "M" ? "M." : "",
    prenom: p.prenom,
    nom: p.nom,
    adresse: [p.adresse.trim(), p.complement_adresse.trim()].filter(Boolean).join("\n"),
    code_postal: p.code_postal,
    ville: p.ville,
  };
}

export type EtatPaiement = "brouillon" | "reglee" | "partielle" | "en_attente" | "trop_percu" | "annulee" | "avoir";

export function etatPaiement(f: Pick<ResumeFacture, "nature" | "etat" | "total_centimes" | "regle_centimes">): EtatPaiement {
  if (f.nature === "avoir") return "avoir";
  if (f.etat === "brouillon") return "brouillon";
  if (f.etat === "annulee") return "annulee";
  if (f.regle_centimes > f.total_centimes) return "trop_percu";
  if (f.regle_centimes === f.total_centimes) return "reglee";
  return f.regle_centimes === 0 ? "en_attente" : "partielle";
}

export const LIBELLES_ETAT: Record<EtatPaiement, string> = {
  brouillon: "Brouillon",
  reglee: "Réglée",
  partielle: "Réglée en partie",
  en_attente: "En attente de règlement",
  trop_percu: "Trop-perçu",
  annulee: "Annulée",
  avoir: "Avoir",
};

/** « Facture 2026-10-1772 », « Avoir 2026-10-1773 », « Brouillon ». */
export function intituleFacture(f: Pick<ResumeFacture, "nature" | "numero">): string {
  if (!f.numero) return "Brouillon de facture";
  return `${f.nature === "avoir" ? "Avoir" : "Facture"} ${f.numero}`;
}

/** Texte d'une ligne de l'historique d'une facture. */
export function texteEvenement(e: EvenementFacture): string {
  const montant = e.montant_centimes === null ? "" : euros(Math.abs(e.montant_centimes));
  const moyen = e.moyen ? libelleMoyen(e.moyen).toLowerCase() : "";
  switch (e.action) {
    case "facture.brouillon":
      return "Brouillon créé";
    case "facture.modifiee":
      return "Brouillon modifié";
    case "facture.emise":
      return `Émise sous le n° ${e.numero ?? ""}`;
    case "avoir.emis":
      return `Avoir émis sous le n° ${e.numero ?? ""}`;
    case "facture.annotee":
      return "Commentaire interne modifié";
    case "facture.annulee":
      return `Annulée par l’avoir n° ${e.numero ?? ""}`;
    case "facture.corrigee":
      return `Corrigée : remplacée par la facture n° ${e.numero ?? ""}`;
    case "reglement.ajoute":
      return (e.montant_centimes ?? 0) < 0 ? `Remboursement de ${montant} (${moyen})` : `Règlement de ${montant} (${moyen})`;
    case "reglement.modifie":
      return `Règlement modifié : ${montant} (${moyen})`;
    case "reglement.supprime":
      return `Règlement supprimé : ${montant} (${moyen})`;
    default:
      return e.action;
  }
}

/** CSV lisible par Excel et LibreOffice en français : point-virgule, BOM, montants à virgule. */
export function versCsv(entetes: string[], lignes: (string | number)[][]): string {
  const cellule = (v: string | number) => {
    const texte = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };
  return `﻿${[entetes, ...lignes].map((l) => l.map(cellule).join(";")).join("\r\n")}\r\n`;
}

const EVENEMENT_FACTURATION = "osteosphere:facturation";

/** Prévient l'interface qu'une facture a changé : le nombre de séances à facturer se met à jour. */
export function signalerFacturation() {
  window.dispatchEvent(new Event(EVENEMENT_FACTURATION));
}

export function surFacturation(action: () => void): () => void {
  window.addEventListener(EVENEMENT_FACTURATION, action);
  return () => window.removeEventListener(EVENEMENT_FACTURATION, action);
}
