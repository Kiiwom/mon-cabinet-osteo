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
