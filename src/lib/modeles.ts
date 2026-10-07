import { completerChamp, type Champ, type Modele, type TypeChamp } from "./coeur";
import { age } from "./dates";
import { normaliser } from "./recherche";

export const TYPES_CHAMPS: { type: TypeChamp; libelle: string; module?: string }[] = [
  { type: "texte_court", libelle: "Texte court" },
  { type: "texte_enrichi", libelle: "Texte enrichi" },
  { type: "liste", libelle: "Liste" },
  { type: "cases", libelle: "Cases à cocher" },
  { type: "case_precision", libelle: "Case avec précision" },
  { type: "curseur", libelle: "Curseur" },
  { type: "date", libelle: "Date" },
  { type: "nombre", libelle: "Nombre" },
  { type: "intertitre", libelle: "Intertitre" },
  { type: "mesures", libelle: "Taille, poids, IMC" },
  { type: "resume_precedent", libelle: "Résumé séance précédente" },
  { type: "dessin", libelle: "Dessin", module: "Schéma corporel" },
];

const LIBELLES_PAR_DEFAUT: Record<TypeChamp, string> = {
  texte_court: "Nouveau texte court",
  texte_enrichi: "Nouveau texte",
  liste: "Nouvelle liste",
  cases: "Nouvelles cases",
  case_precision: "Nouvelle case",
  curseur: "Nouveau curseur",
  date: "Nouvelle date",
  nombre: "Nouveau nombre",
  intertitre: "Intertitre",
  mesures: "Taille, poids et IMC",
  resume_precedent: "Résumé de la séance précédente",
  dessin: "Schéma sur planches",
};

/** Types de champ qui ne figurent qu'une fois par modèle. */
export const TYPES_UNIQUES: TypeChamp[] = ["mesures", "resume_precedent"];

/** Le dessin attend le module Schéma corporel : affiché grisé, sans saisie. */
export function champDisponible(champ: Pick<Champ, "type">): boolean {
  return champ.type !== "dessin";
}

/** « Curseur de 0 à 10 », « Texte enrichi · trames », « Calculé »… */
export function descriptionChamp(champ: Champ): string {
  switch (champ.type) {
    case "curseur":
      return `Curseur de ${champ.min ?? 0} à ${champ.max ?? 10}`;
    case "texte_enrichi":
      return "Texte enrichi · trames";
    case "texte_court":
      return "Texte court";
    case "liste":
      return `Liste · ${champ.options?.length ?? 0} choix`;
    case "cases":
      return `Cases · ${champ.options?.length ?? 0} choix`;
    case "case_precision":
      return "Case avec précision";
    case "date":
      return "Date";
    case "nombre":
      return champ.unite ? `Nombre en ${champ.unite}` : "Nombre";
    case "intertitre":
      return "Intertitre";
    case "mesures":
      return "Calculé";
    case "resume_precedent":
      return "Séance précédente";
    case "dessin":
      return "Dessin";
  }
}

/** Identifiant tiré du libellé, sans accents, unique dans le modèle : « Qualité du sommeil » → « qualite_du_sommeil ». */
export function identifiantDepuis(libelle: string, existants: Pick<Champ, "id">[]): string {
  const base = normaliser(libelle).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "champ";
  const pris = new Set(existants.map((c) => c.id));
  if (!pris.has(base)) return base;
  let n = 2;
  while (pris.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function nouveauChamp(type: TypeChamp, existants: Champ[]): Champ {
  const libelle = LIBELLES_PAR_DEFAUT[type];
  const champ = completerChamp({ id: identifiantDepuis(libelle, existants), type, libelle });
  if (type === "liste" || type === "cases") return { ...champ, options: ["Choix 1", "Choix 2"] };
  return champ;
}

/** « 18 ans et plus », « Moins de 2 ans », « De 2 à 17 ans », « Choisi à la main ». */
export function resumeProposition(m: Pick<Modele, "age_min" | "age_max">): string {
  if (m.age_min !== null && m.age_max !== null) return `De ${m.age_min} à ${m.age_max - 1} ans`;
  if (m.age_min !== null) return `${m.age_min} ans et plus`;
  if (m.age_max !== null) return `Moins de ${m.age_max} an${m.age_max > 1 ? "s" : ""}`;
  return "Choisi à la main";
}

/**
 * Modèle proposé pour une nouvelle séance : le modèle actif dont la tranche d'âge contient celui du
 * patient (la plus étroite d'abord), sinon le modèle par défaut.
 */
export function modelePropose(modeles: Modele[], naissance: string | null, aujourdhui = new Date()): Modele | null {
  const actifs = modeles.filter((m) => m.actif);
  if (naissance) {
    const ans = age(naissance, aujourdhui).ans;
    const largeur = (m: Modele) => (m.age_max ?? 200) - (m.age_min ?? 0);
    const candidats = actifs
      .filter((m) => (m.age_min !== null || m.age_max !== null) && ans >= (m.age_min ?? 0) && ans < (m.age_max ?? Infinity))
      .sort((a, b) => largeur(a) - largeur(b));
    if (candidats[0]) return candidats[0];
  }
  return actifs.find((m) => m.par_defaut) ?? actifs[0] ?? null;
}
