import type { Antecedent, CategorieAntecedents, CouleurAntecedent } from "../lib/coeur";
import { datePartielleEnLettres } from "../lib/dates";

export type Forme = "losange" | "rond" | "carre" | "triangle" | "anneau";

interface Apparence {
  fond: string;
  encre: string;
  trait: string;
  forme: Forme;
}

/** Une couleur et une forme par catégorie : la forme seule suffit à les distinguer. */
const PAR_CATEGORIE: Record<string, Apparence> = {
  medicaux: { fond: "#e3f0e8", encre: "#1f4a33", trait: "#3e7a57", forme: "carre" },
  traumatiques: { fond: "#fce8d2", encre: "#8a4710", trait: "#b0621c", forme: "losange" },
  chirurgicaux: { fond: "#e3ecf6", encre: "#2f4f74", trait: "#3d6a99", forme: "rond" },
  familiaux: { fond: "#efe6f5", encre: "#5b3a72", trait: "#7a52a0", forme: "triangle" },
  psychologiques: { fond: "#f8e3ea", encre: "#7a2d48", trait: "#a3456b", forme: "anneau" },
};

const NEUTRE: Apparence = { fond: "#ebe3d6", encre: "#4a3d30", trait: "#6b5b4b", forme: "rond" };

/** Couleurs choisies à la main pour un antécédent : elles priment sur celle de la catégorie. */
const COULEURS: Record<Exclude<CouleurAntecedent, "">, { fond: string; encre: string; libelle: string }> = {
  gris: { fond: "#ebe3d6", encre: "#4a3d30", libelle: "Gris" },
  blanc: { fond: "#ffffff", encre: "#4a3d30", libelle: "Blanc" },
  jaune: { fond: "#f6eacb", encre: "#6e5212", libelle: "Jaune" },
  rouge: { fond: "#fbe3df", encre: "#8c2f25", libelle: "Rouge" },
  bleu: { fond: "#e3ecf6", encre: "#2f4f74", libelle: "Bleu" },
  vert: { fond: "#e3f0e8", encre: "#1f4a33", libelle: "Vert" },
};

export const CHOIX_COULEURS: { valeur: CouleurAntecedent; libelle: string; fond: string }[] = [
  { valeur: "", libelle: "Couleur de la catégorie", fond: "transparent" },
  ...(Object.entries(COULEURS) as [Exclude<CouleurAntecedent, "">, (typeof COULEURS)["gris"]][]).map(([valeur, c]) => ({
    valeur,
    libelle: c.libelle,
    fond: c.fond,
  })),
];

export function apparenceCategorie(categorie: string): Apparence {
  return PAR_CATEGORIE[categorie] ?? NEUTRE;
}

export function apparence(antecedent: Pick<Antecedent, "categorie" | "couleur">): Apparence {
  const base = apparenceCategorie(antecedent.categorie);
  return antecedent.couleur ? { ...base, ...COULEURS[antecedent.couleur] } : base;
}

export function libelleCategorie(formulaire: CategorieAntecedents[], cle: string): string {
  return formulaire.find((c) => c.cle === cle)?.libelle ?? cle;
}

/** « Fracture · poignet G » */
export function intitule(a: Pick<Antecedent, "rubrique" | "precision">): string {
  return a.precision ? `${a.rubrique} · ${a.precision}` : a.rubrique;
}

/** « 2009 », « depuis 2015 », « 2010 – 2014 », ou rien sans date. */
export function periode(a: Pick<Antecedent, "debut" | "fin" | "en_cours">): string {
  if (!a.debut) return a.en_cours ? "en cours" : "";
  const debut = datePartielleEnLettres(a.debut);
  if (a.en_cours) return `depuis ${debut}`;
  if (a.fin) return `${debut} – ${datePartielleEnLettres(a.fin)}`;
  return debut;
}
