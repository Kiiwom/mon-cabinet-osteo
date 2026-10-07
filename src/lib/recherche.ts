import type { ResumePatient } from "./coeur";

/**
 * Recherche instantanée des patients, sur la liste complète gardée par l'interface :
 * sans accents ni majuscules, tolérante à une faute de frappe, sur le nom, le nom de naissance,
 * le prénom, les téléphones, l'email, l'adresse et la ville.
 */

/** Plie chaque caractère sans changer la longueur : les positions restent celles du texte d'origine. */
export function plier(texte: string): string {
  let plie = "";
  for (const caractere of texte) {
    const simple = caractere.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const premier = simple[0] ?? " ";
    // Un caractère hors de la table de base (ligature…) garde une seule place.
    plie += /[a-z0-9@.]/.test(premier) ? premier : caractere.length === 1 ? " " : " ".repeat(caractere.length);
  }
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

function mots(texte: string): { mot: string; debut: number }[] {
  const plie = plier(texte);
  return [...plie.matchAll(/[a-z0-9@.]+/g)].map((m) => ({ mot: m[0], debut: m.index ?? 0 }));
}

function correspondre(terme: string, texte: string, champ: Champ): Correspondance | null {
  let meilleure: Correspondance | null = null;
  const garder = (c: Correspondance) => {
    if (!meilleure || c.score + POIDS[c.champ] > meilleure.score + POIDS[meilleure.champ]) meilleure = c;
  };
  for (const { mot, debut } of mots(texte)) {
    if (mot.startsWith(terme)) {
      garder({ score: 3, champ, approchee: false, surlignage: { debut, fin: debut + terme.length } });
    } else if (terme.length >= 3 && mot.includes(terme)) {
      const position = debut + mot.indexOf(terme);
      garder({ score: 2, champ, approchee: false, surlignage: { debut: position, fin: position + terme.length } });
    } else if (terme.length >= 4 && (distance(terme, mot.slice(0, terme.length)) <= 1 || distance(terme, mot) <= 1)) {
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
    let score = 0;
    let raison: string | null = null;
    const surlignage: Resultat["surlignage"] = { nom: [], prenom: [] };
    let trouve = true;
    for (const terme of termes) {
      const candidats: (Correspondance | null)[] = [
        correspondre(terme, patient.nom, "nom"),
        correspondre(terme, patient.prenom, "prenom"),
        correspondre(terme, patient.nom_naissance, "nom_naissance"),
        correspondre(terme, patient.ville, "ville"),
        correspondre(terme, patient.email, "email"),
        correspondre(terme, patient.adresse, "adresse"),
      ];
      if (/^\d{2,}$/.test(terme) && [patient.portable, patient.fixe].some((t) => chiffres(t).includes(terme))) {
        candidats.push({ score: 3, champ: "telephone", approchee: false });
      }
      const meilleure = candidats
        .filter((c): c is Correspondance => c !== null)
        .sort((a, b) => b.score + POIDS[b.champ] - (a.score + POIDS[a.champ]))[0];
      if (!meilleure) {
        trouve = false;
        break;
      }
      score += meilleure.score + POIDS[meilleure.champ];
      if (meilleure.surlignage && (meilleure.champ === "nom" || meilleure.champ === "prenom")) {
        surlignage[meilleure.champ].push(meilleure.surlignage);
      }
      raison ??= raisonDe(meilleure, patient);
    }
    if (trouve) resultats.push({ patient, score, raison, surlignage });
  }
  return resultats.sort(
    (a, b) => b.score - a.score || a.patient.nom.localeCompare(b.patient.nom, "fr") || a.patient.prenom.localeCompare(b.patient.prenom, "fr"),
  );
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
  const noms = [normaliser(p.nom), normaliser(p.nom_naissance)].filter(Boolean);
  const prenom = normaliser(p.prenom);
  if (noms.includes(autre.nom) && prenom === autre.prenom) return true;
  const proches = noms.some((n) => distance(n, autre.nom) <= 1) && distance(prenom, autre.prenom) <= 1;
  return proches && !!p.naissance && p.naissance === autre.naissance;
}

/** Paires de dossiers probablement en double, pour les fusionner ou les corriger. */
export function doublonsProbables(liste: ResumePatient[]): [ResumePatient, ResumePatient][] {
  const paires: [ResumePatient, ResumePatient][] = [];
  const groupes = new Map<string, ResumePatient[]>();
  for (const p of liste) {
    // Regroupés par naissance ou, sans naissance, par nom : on ne compare que des dossiers voisins.
    const cle = p.naissance ?? `nom:${normaliser(p.nom)}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), p]);
  }
  for (const groupe of groupes.values()) {
    for (let i = 0; i < groupe.length; i++) {
      for (let j = i + 1; j < groupe.length; j++) {
        const [a, b] = [groupe[i], groupe[j]];
        if (semblables(a, { nom: normaliser(b.nom), prenom: normaliser(b.prenom), naissance: b.naissance })) paires.push([a, b]);
      }
    }
  }
  return paires;
}
