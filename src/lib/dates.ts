import type { Sexe } from "./coeur";

/** Dates à la française : saisie JJ/MM/AAAA, affichage en lettres, âge en clair. Stockage `AAAA-MM-JJ`. */

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function valide(annee: number, mois: number, jour: number): boolean {
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour;
}

function iso(annee: number, mois: number, jour: number): string {
  return `${String(annee).padStart(4, "0")}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

/**
 * Lit une date tapée par le praticien : « 14/03/1988 », « 14-3-88 », « 14031988 » ou « 1988-03-14 ».
 * Rend `null` pour un champ vide, `undefined` pour une date impossible.
 * Une année sur deux chiffres est du siècle passé si elle dépasse l'année en cours.
 */
export function lireDateFr(texte: string, aujourdhui = new Date()): string | null | undefined {
  const t = texte.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valide(a, mo, j) ? iso(a, mo, j) : undefined;
  }
  m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
  if (!m) return undefined;
  let annee = Number(m[3]);
  if (m[3].length === 2) {
    const siecle = Math.floor(aujourdhui.getFullYear() / 100) * 100;
    annee = siecle + annee > aujourdhui.getFullYear() ? siecle - 100 + annee : siecle + annee;
  }
  const [mois, jour] = [Number(m[2]), Number(m[1])];
  return valide(annee, mois, jour) ? iso(annee, mois, jour) : undefined;
}

function parties(dateIso: string): [number, number, number] {
  const [a, m, j] = dateIso.slice(0, 10).split("-").map(Number);
  return [a, m, j];
}

/** « 14/03/1988 » */
export function ecrireDateFr(dateIso: string | null): string {
  if (!dateIso) return "";
  const [a, m, j] = parties(dateIso);
  return `${String(j).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}`;
}

/** « 14 mars 1988 », « 1er mars 2026 » */
export function dateEnLettres(dateIso: string): string {
  const [a, m, j] = parties(dateIso);
  return `${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${a}`;
}

/** « 11 avr. 2026 » */
export function dateCourte(dateIso: string): string {
  const [a, m, j] = parties(dateIso);
  return `${j === 1 ? "1er" : j} ${MOIS_COURTS[m - 1]} ${a}`;
}

/** Âge en années, mois et jours révolus. */
export function age(naissance: string, aujourdhui = new Date()): { ans: number; mois: number; jours: number } {
  const [a, m, j] = parties(naissance);
  let ans = aujourdhui.getFullYear() - a;
  let mois = aujourdhui.getMonth() + 1 - m;
  let jours = aujourdhui.getDate() - j;
  if (jours < 0) {
    mois -= 1;
    jours += new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 0).getDate();
  }
  if (mois < 0) {
    ans -= 1;
    mois += 12;
  }
  return { ans, mois, jours };
}

/** « 38 ans », « 18 mois », « 3 semaines », « 5 jours » : comme on le dit d'un patient. */
export function ageEnClair(naissance: string, aujourdhui = new Date()): string {
  const { ans, mois, jours } = age(naissance, aujourdhui);
  if (ans < 0) return "";
  if (ans >= 2) return `${ans} ans`;
  const totalMois = ans * 12 + mois;
  if (totalMois >= 1) return `${totalMois} mois`;
  if (jours >= 7) return `${Math.floor(jours / 7)} semaine${jours >= 14 ? "s" : ""}`;
  return `${jours} jour${jours > 1 ? "s" : ""}`;
}

/** « née le 14 mars 1988 », « né le », « né(e) le » selon le sexe renseigné. */
export function neLe(sexe: Sexe, naissance: string): string {
  const accord = sexe === "F" ? "née" : sexe === "M" ? "né" : "né(e)";
  return `${accord} le ${dateEnLettres(naissance)}`;
}

/** Accord au féminin quand la fiche le dit : « droitière », « décédée », « retraitée ». */
export function accorder(sexe: Sexe, masculin: string, feminin: string): string {
  return sexe === "F" ? feminin : masculin;
}

/**
 * Date partielle d'un antécédent, telle qu'on la tape : « 2009 », « 03/2009 », « 14/03/2009 ».
 * Rend « 2009 », « 2009-03 » ou « 2009-03-14 » ; `null` si vide ; `undefined` si impossible.
 */
export function lireDatePartielle(texte: string, aujourdhui = new Date()): string | null | undefined {
  const t = texte.trim();
  if (!t) return null;
  if (/^\d{4}$/.test(t)) return Number(t) >= 1900 ? t : undefined;
  const moisAnnee = /^(\d{1,2})[/.\- ](\d{4})$/.exec(t);
  const anneeMois = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (moisAnnee || anneeMois) {
    const [mois, annee] = moisAnnee ? [Number(moisAnnee[1]), Number(moisAnnee[2])] : [Number(anneeMois![2]), Number(anneeMois![1])];
    return mois >= 1 && mois <= 12 && annee >= 1900 ? `${annee}-${String(mois).padStart(2, "0")}` : undefined;
  }
  const complete = lireDateFr(t, aujourdhui);
  if (complete === null) return null;
  return complete && complete >= "1900" ? complete : undefined;
}

/** « 2009 », « 03/2009 » ou « 14/03/2009 » */
export function ecrireDatePartielle(partielle: string | null): string {
  if (!partielle) return "";
  if (partielle.length === 4) return partielle;
  if (partielle.length === 7) return `${partielle.slice(5, 7)}/${partielle.slice(0, 4)}`;
  return ecrireDateFr(partielle);
}

/** « 2009 », « mars 2009 », « 14 mars 2009 » */
export function datePartielleEnLettres(partielle: string): string {
  if (partielle.length === 4) return partielle;
  if (partielle.length === 7) return `${MOIS[Number(partielle.slice(5, 7)) - 1]} ${partielle.slice(0, 4)}`;
  return dateEnLettres(partielle);
}

/** Position sur une frise, en années décimales ; une année seule est placée en son milieu. */
export function enAnnees(partielle: string): number {
  const annee = Number(partielle.slice(0, 4));
  if (partielle.length === 4) return annee + 0.5;
  const mois = Number(partielle.slice(5, 7));
  if (partielle.length === 7) return annee + (mois - 0.5) / 12;
  const jour = Number(partielle.slice(8, 10));
  const debut = Date.UTC(annee, 0, 1);
  const date = Date.UTC(annee, mois - 1, jour);
  return annee + (date - debut) / (Date.UTC(annee + 1, 0, 1) - debut);
}

export function anneesDepuisDate(date: Date): number {
  const annee = date.getFullYear();
  const debut = new Date(annee, 0, 1).getTime();
  return annee + (date.getTime() - debut) / (new Date(annee + 1, 0, 1).getTime() - debut);
}

export { MOIS_COURTS };
