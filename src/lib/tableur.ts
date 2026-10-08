import { versCsv } from "./facturation";

/** Les colonnes d'un export Excel : un montant est en euros (`55.5`), une date `AAAA-MM-JJ`. */
export type GenreColonne = "texte" | "nombre" | "montant" | "date";

export interface Colonne {
  titre: string;
  genre: GenreColonne;
}

export type Case = string | number | null;

/** Une feuille du classeur Excel. */
export interface Feuille {
  nom: string;
  colonnes: Colonne[];
  lignes: Case[][];
}

export const colonne = (titre: string, genre: GenreColonne = "texte"): Colonne => ({ titre, genre });

/** La même feuille en CSV, pour les logiciels qui n'ouvrent pas les classeurs Excel. */
export function feuilleVersCsv(feuille: Feuille): string {
  const titre = (c: Colonne) => (c.genre === "montant" ? `${c.titre} (€)` : c.titre);
  const cellule = (v: Case, c: Colonne): string | number => {
    if (v === null) return "";
    if (c.genre === "date" && typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}${v.slice(10).replace("T", " ")}` : v;
    return v;
  };
  return versCsv(
    feuille.colonnes.map(titre),
    feuille.lignes.map((l) => l.map((v, i) => cellule(v, feuille.colonnes[i]))),
  );
}
