import { dateCourte } from "./dates";

/** Périodes de la facturation et des statistiques : mois, trimestre, année ou dates choisies. */
export type TypePeriode = "mois" | "trimestre" | "annee" | "periode";

export interface Periode {
  type: TypePeriode;
  /** Un jour de la période affichée. */
  reference: Date;
  /** Pour une période choisie : dates comprises, `AAAA-MM-JJ`. */
  du?: string;
  au?: string;
}

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const MOIS_MINUSCULES = MOIS.map((m) => m.toLowerCase());

export function isoDe(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Premier et dernier jour compris, `AAAA-MM-JJ`. */
export function bornesPeriode(p: Periode): [string, string] {
  const r = p.reference;
  switch (p.type) {
    case "mois":
      return [isoDe(new Date(r.getFullYear(), r.getMonth(), 1)), isoDe(new Date(r.getFullYear(), r.getMonth() + 1, 0))];
    case "trimestre": {
      const debut = Math.floor(r.getMonth() / 3) * 3;
      return [isoDe(new Date(r.getFullYear(), debut, 1)), isoDe(new Date(r.getFullYear(), debut + 3, 0))];
    }
    case "annee":
      return [`${r.getFullYear()}-01-01`, `${r.getFullYear()}-12-31`];
    case "periode":
      return [p.du ?? isoDe(r), p.au ?? isoDe(r)];
  }
}

export function decalerPeriode(p: Periode, sens: 1 | -1): Periode {
  const r = new Date(p.reference.getFullYear(), p.reference.getMonth(), 1);
  if (p.type === "mois") r.setMonth(r.getMonth() + sens);
  else if (p.type === "trimestre") r.setMonth(r.getMonth() + 3 * sens);
  else if (p.type === "annee") r.setFullYear(r.getFullYear() + sens);
  return { ...p, reference: r };
}

/** « Octobre 2026 », « 4e trimestre 2026 », « 2026 », « du 1er oct. 2026 au 6 oct. 2026 ». */
export function libellePeriode(p: Periode): string {
  const r = p.reference;
  switch (p.type) {
    case "mois":
      return `${MOIS[r.getMonth()]} ${r.getFullYear()}`;
    case "trimestre": {
      const t = Math.floor(r.getMonth() / 3) + 1;
      return `${t === 1 ? "1er" : `${t}e`} trimestre ${r.getFullYear()}`;
    }
    case "annee":
      return String(r.getFullYear());
    case "periode": {
      const [du, au] = bornesPeriode(p);
      return `du ${dateCourte(du)} au ${dateCourte(au)}`;
    }
  }
}

/** « en octobre », « au 4e trimestre », « en 2026 », « sur la période ». */
export function surLaPeriode(p: Periode): string {
  switch (p.type) {
    case "mois":
      return `en ${MOIS_MINUSCULES[p.reference.getMonth()]}`;
    case "trimestre":
      return `au ${libellePeriode(p).replace(/ \d{4}$/, "")}`;
    case "annee":
      return `en ${p.reference.getFullYear()}`;
    case "periode":
      return "sur la période";
  }
}
