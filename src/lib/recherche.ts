import type { ResumePatient } from "./coeur";

/**
 * Recherche instantanée des patients, sur la liste complète gardée par l'interface :
 * sans accents ni majuscules, tolérante à une faute de frappe, sur le nom, le nom de naissance,
 * le prénom, les téléphones, l'email, l'adresse et la ville.
 *
 * Avec 10 000 dossiers, chaque lettre tapée doit répondre en moins de 0,2 s : le texte plié de chaque
 * dossier est préparé une seule fois, puis gardé tant que le dossier reste dans la liste.
 */

const PLIES = new Map<string, string>();

function plierCaractere(caractere: string): string {
  const code = caractere.charCodeAt(0);
  if (caractere.length === 1 && code < 128) {
    const minuscule = code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : caractere;
    return /[a-z0-9@.]/.test(minuscule) ? minuscule : " ";
  }
  let plie = PLIES.get(caractere);
  if (plie === undefined) {
    const simple = caractere.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const premier = simple[0] ?? " ";
    // Un caractère hors de la table de base (ligature…) garde une seule place.
    plie = /[a-z0-9@.]/.test(premier) ? premier : caractere.length === 1 ? " " : " ".repeat(caractere.length);
    PLIES.set(caractere, plie);
  }
  return plie;
}

/** Plie chaque caractère sans changer la longueur : les positions restent celles du texte d'origine. */
export function plier(texte: string): string {
  let plie = "";
  for (const caractere of texte) plie += plierCaractere(caractere);
  return plie;
}

export function normaliser(texte: string): string {
  return plier(texte).trim().split(/\s+/).filter(Boolean).join(" ");
}

/** Distance d'édition avec inversion de deux lettres voisines (« Mrathe » pour « Marthe »). */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const lignes = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) lignes[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      lignes[i][j] = Math.min(lignes[i - 1][j] + 1, lignes[i][j - 1] + 1, lignes[i - 1][j - 1] + cout);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        lignes[i][j] = Math.min(lignes[i][j], lignes[i - 2][j - 2] + 1);
      }
    }
  }
  return lignes[a.length][b.length];
}

/** Vrai quand `distance(a, b) <= 1`, sans construire la table : appelé des milliers de fois par lettre tapée. */
export function auPlusUneFaute(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  // Même longueur : une lettre remplacée, ou deux lettres voisines inversées.
  return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

type Champ = "nom" | "prenom" | "nom_naissance" | "ville" | "adresse" | "email" | "telephone";

/** Ordre de préférence des champs, à score égal : le nom d'abord. */
const POIDS: Record<Champ, number> = { nom: 0.5, prenom: 0.4, nom_naissance: 0.3, telephone: 0.2, ville: 0.1, email: 0.1, adresse: 0 };

export interface Surlignage {
  debut: number;
  fin: number;
}

export interface Resultat {
  patient: ResumePatient;
  score: number;
  /** Pourquoi ce dossier sort, quand ce n'est pas visible : adresse, nom de naissance, orthographe proche… */
  raison: string | null;
  surlignage: { nom: Surlignage[]; prenom: Surlignage[] };
}

interface Correspondance {
  score: number;
  champ: Champ;
  approchee: boolean;
  surlignage?: Surlignage;
}

interface Mot {
  mot: string;
  debut: number;
}

function mots(texte: string): Mot[] {
  const plie = plier(texte);
  const trouves: Mot[] = [];
  let debut = -1;
  for (let i = 0; i <= plie.length; i++) {
    const espace = i === plie.length || plie[i] === " ";
    if (!espace && debut < 0) debut = i;
    else if (espace && debut >= 0) {
      trouves.push({ mot: plie.slice(debut, i), debut });
      debut = -1;
    }
  }
  return trouves;
}

/** Ce que la recherche lit d'un dossier, préparé une fois : les mots pliés de chaque champ et les chiffres des téléphones. */
interface Index {
  champs: [Champ, Mot[]][];
  telephones: string[];
  noms: string[];
  prenom: string;
  /** Nom puis prénom pliés : l'ordre alphabétique sans comparer selon la langue à chaque tri. */
  ordre: string;
}

const INDEX = new WeakMap<ResumePatient, Index>();

function indexer(patient: ResumePatient): Index {
  let index = INDEX.get(patient);
  if (!index) {
    index = {
      champs: [
        ["nom", mots(patient.nom)],
        ["prenom", mots(patient.prenom)],
        ["nom_naissance", mots(patient.nom_naissance)],
        ["ville", mots(patient.ville)],
        ["email", mots(patient.email)],
        ["adresse", mots(patient.adresse)],
      ],
      telephones: [chiffres(patient.portable), chiffres(patient.fixe)].filter(Boolean),
      noms: [normaliser(patient.nom), normaliser(patient.nom_naissance)].filter(Boolean),
      prenom: normaliser(patient.prenom),
      ordre: `${normaliser(patient.nom)}\u0000${normaliser(patient.prenom)}`,
    };
    INDEX.set(patient, index);
  }
  return index;
}

/** Prépare la recherche dans toute la liste, dès son chargement : la première lettre tapée n'attend pas. */
export function preparerRecherche(liste: ResumePatient[]): void {
  for (const patient of liste) indexer(patient);
}

function correspondre(terme: string, mots: Mot[], champ: Champ): Correspondance | null {
  let meilleure: Correspondance | null = null;
  const garder = (c: Correspondance) => {
    if (!meilleure || c.score + POIDS[c.champ] > meilleure.score + POIDS[meilleure.champ]) meilleure = c;
  };
  for (const { mot, debut } of mots) {
    if (mot.startsWith(terme)) {
      garder({ score: 3, champ, approchee: false, surlignage: { debut, fin: debut + terme.length } });
    } else if (terme.length >= 3 && mot.includes(terme)) {
      const position = debut + mot.indexOf(terme);
      garder({ score: 2, champ, approchee: false, surlignage: { debut: position, fin: position + terme.length } });
    } else if (terme.length >= 4 && (auPlusUneFaute(terme, mot.slice(0, terme.length)) || auPlusUneFaute(terme, mot))) {
      garder({ score: 1, champ, approchee: true });
    }
  }
  return meilleure;
}

function chiffres(texte: string): string {
  return texte.replace(/\D/g, "");
}

export function rechercherPatients(liste: ResumePatient[], texte: string): Resultat[] {
  const termes = normaliser(texte).split(" ").filter(Boolean);
  if (termes.length === 0) return liste.map((patient) => ({ patient, score: 0, raison: null, surlignage: { nom: [], prenom: [] } }));

  const resultats: Resultat[] = [];
  for (const patient of liste) {
    const index = indexer(patient);
    let score = 0;
    let raison: string | null = null;
    const surlignage: Resultat["surlignage"] = { nom: [], prenom: [] };
    let trouve = true;
    for (const terme of termes) {
      let meilleure: Correspondance | null = null;
      const garder = (c: Correspondance | null) => {
        if (c && (!meilleure || c.score + POIDS[c.champ] > meilleure.score + POIDS[meilleure.champ])) meilleure = c;
      };
      for (const [champ, mots] of index.champs) garder(correspondre(terme, mots, champ));
      if (/^\d{2,}$/.test(terme) && index.telephones.some((t) => t.includes(terme))) {
        garder({ score: 3, champ: "telephone", approchee: false });
      }
      if (!meilleure) {
        trouve = false;
        break;
      }
      const retenue: Correspondance = meilleure;
      score += retenue.score + POIDS[retenue.champ];
      if (retenue.surlignage && (retenue.champ === "nom" || retenue.champ === "prenom")) {
        surlignage[retenue.champ].push(retenue.surlignage);
      }
      raison ??= raisonDe(retenue, patient);
    }
    if (trouve) resultats.push({ patient, score, raison, surlignage });
  }
  const ordre = (r: Resultat) => indexer(r.patient).ordre;
  return resultats.sort((a, b) => b.score - a.score || (ordre(a) < ordre(b) ? -1 : ordre(a) > ordre(b) ? 1 : 0));
}

function raisonDe(correspondance: Correspondance, patient: ResumePatient): string | null {
  if (correspondance.approchee && (correspondance.champ === "nom" || correspondance.champ === "prenom")) return "orthographe proche";
  if (correspondance.champ === "adresse") return patient.adresse;
  if (correspondance.champ === "nom_naissance") return `nom de naissance ${patient.nom_naissance}`;
  if (correspondance.champ === "email") return patient.email;
  return null;
}

/** Dossiers qui ressemblent à la fiche en cours de création : même nom et prénom, ou presque, et même naissance. */
export function ressemblants(
  liste: ResumePatient[],
  fiche: { nom: string; prenom: string; naissance: string | null },
  exclure?: string,
): ResumePatient[] {
  const nom = normaliser(fiche.nom);
  const prenom = normaliser(fiche.prenom);
  if (!nom || !prenom) return [];
  return liste.filter((p) => p.id !== exclure && semblables(p, { nom, prenom, naissance: fiche.naissance }));
}

function semblables(p: ResumePatient, autre: { nom: string; prenom: string; naissance: string | null }): boolean {
  const { noms, prenom } = indexer(p);
  if (noms.includes(autre.nom) && prenom === autre.prenom) return true;
  const proches = noms.some((n) => auPlusUneFaute(n, autre.nom)) && auPlusUneFaute(prenom, autre.prenom);
  return proches && !!p.naissance && p.naissance === autre.naissance;
}

/** Paires de dossiers probablement en double, pour les fusionner ou les corriger. */
export function doublonsProbables(liste: ResumePatient[]): [ResumePatient, ResumePatient][] {
  const paires: [ResumePatient, ResumePatient][] = [];
  const groupes = new Map<string, ResumePatient[]>();
  for (const p of liste) {
    // Regroupés par naissance ou, sans naissance, par nom : on ne compare que des dossiers voisins.
    const cle = p.naissance ?? `nom:${indexer(p).noms[0] ?? ""}`;
    const groupe = groupes.get(cle);
    if (groupe) groupe.push(p);
    else groupes.set(cle, [p]);
  }
  for (const groupe of groupes.values()) {
    for (let i = 0; i < groupe.length; i++) {
      for (let j = i + 1; j < groupe.length; j++) {
        const [a, b] = [groupe[i], groupe[j]];
        const autre = indexer(b);
        if (semblables(a, { nom: autre.noms[0] ?? "", prenom: autre.prenom, naissance: b.naissance })) paires.push([a, b]);
      }
    }
  }
  return paires;
}
