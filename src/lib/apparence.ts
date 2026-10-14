import { isTauri } from "@tauri-apps/api/core";

export type Theme = "systeme" | "clair" | "sombre";
export type Tactile = "auto" | "toujours" | "jamais";
export type Accent = "ocre" | "sauge" | "bleu" | "terracotta" | "lavande";

/** Apparence du logiciel, gardée dans la base chiffrée comme le reste des réglages. */
export interface Apparence {
  theme: Theme;
  accent: Accent;
  /** En pourcentage : de 100 à 150, par pas de 10. */
  taille_texte: number;
  tactile: Tactile;
}

export const APPARENCE_PAR_DEFAUT: Apparence = { theme: "systeme", accent: "ocre", taille_texte: 100, tactile: "auto" };

/** Les mêmes que le cœur ; `couleur` sert à l'échantillon du choix. */
export const ACCENTS: { valeur: Accent; nom: string; couleur: string }[] = [
  { valeur: "ocre", nom: "Ocre", couleur: "#e2b84a" },
  { valeur: "sauge", nom: "Sauge", couleur: "#94c7a5" },
  { valeur: "bleu", nom: "Bleu", couleur: "#93bdea" },
  { valeur: "terracotta", nom: "Terre cuite", couleur: "#eba584" },
  { valeur: "lavande", nom: "Lavande", couleur: "#c7abe3" },
];

export const TAILLES_TEXTE = [100, 110, 120, 130, 140, 150];

/**
 * Copie locale de l'apparence, pour les écrans d'avant l'ouverture du cabinet (verrouillage, clé de
 * secours) : elle ne contient aucune donnée de santé.
 */
const CLE_LOCALE = "osteosphere.apparence";

function valide(a: Partial<Apparence> | null | undefined): Apparence {
  const choix = { ...APPARENCE_PAR_DEFAUT, ...(a ?? {}) };
  return {
    theme: ["systeme", "clair", "sombre"].includes(choix.theme) ? choix.theme : APPARENCE_PAR_DEFAUT.theme,
    accent: ACCENTS.some((x) => x.valeur === choix.accent) ? choix.accent : APPARENCE_PAR_DEFAUT.accent,
    taille_texte: TAILLES_TEXTE.includes(choix.taille_texte) ? choix.taille_texte : APPARENCE_PAR_DEFAUT.taille_texte,
    tactile: ["auto", "toujours", "jamais"].includes(choix.tactile) ? choix.tactile : APPARENCE_PAR_DEFAUT.tactile,
  };
}

export function apparenceMemorisee(): Apparence {
  try {
    const texte = window.localStorage.getItem(CLE_LOCALE);
    return valide(texte ? (JSON.parse(texte) as Partial<Apparence>) : null);
  } catch {
    return APPARENCE_PAR_DEFAUT;
  }
}

function memoriser(a: Apparence) {
  try {
    window.localStorage.setItem(CLE_LOCALE, JSON.stringify(a));
  } catch {
    // Stockage local indisponible : l'apparence sera relue dans la base à l'ouverture.
  }
}

const requete = (media: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(media) : null);

/** Thème sombre en vigueur : choisi, ou celui de l'ordinateur. */
export function themeSombre(a: Apparence, systemeSombre = requete("(prefers-color-scheme: dark)")?.matches ?? false): boolean {
  return a.theme === "sombre" || (a.theme === "systeme" && systemeSombre);
}

/** Vrai si l'ordinateur a un écran tactile, même avec une souris branchée. */
export function ecranTactileDetecte(): boolean {
  return requete("(any-pointer: coarse)")?.matches ?? false;
}

/** Cibles agrandies : choisies, ou parce que l'ordinateur a un écran tactile. */
export function modeTactile(a: Pick<Apparence, "tactile">, ecranTactile = ecranTactileDetecte()): boolean {
  return a.tactile === "toujours" || (a.tactile === "auto" && ecranTactile);
}

let enVigueur: Apparence = APPARENCE_PAR_DEFAUT;
let zoomApplique = 1;
let ecoute = false;

function peindre() {
  const racine = document.documentElement;
  racine.dataset.sombre = String(themeSombre(enVigueur));
  racine.dataset.accent = enVigueur.accent;
  racine.dataset.tactile = String(modeTactile(enVigueur));
  const zoom = enVigueur.taille_texte / 100;
  if (zoom === zoomApplique) return;
  zoomApplique = zoom;
  if (isTauri()) {
    // Comme Ctrl + molette : tout grandit, et la mise en page s'adapte à la place restante.
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setZoom(zoom)).catch(() => undefined);
  } else {
    racine.style.setProperty("zoom", zoom === 1 ? "" : String(zoom));
  }
}

/** Applique l'apparence à tout le logiciel et la garde pour le prochain démarrage. */
export function appliquerApparence(a: Apparence) {
  enVigueur = valide(a);
  memoriser(enVigueur);
  if (!ecoute) {
    ecoute = true;
    // Le thème de l'ordinateur ou l'écran branché peuvent changer pendant l'utilisation.
    requete("(prefers-color-scheme: dark)")?.addEventListener?.("change", peindre);
    requete("(any-pointer: coarse)")?.addEventListener?.("change", peindre);
  }
  peindre();
}

/** Au lancement, avant toute lecture de la base. */
export function appliquerApparenceMemorisee() {
  appliquerApparence(apparenceMemorisee());
}
