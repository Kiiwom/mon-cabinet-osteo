import type { JSONContent } from "@tiptap/core";

import type { Champ, Definition, Facturation, ResumeSeance, Seance, TypeSeance } from "./coeur";
import { nettoyer } from "../trames/syntaxe";
import { dateEnLettres } from "./dates";

/** Les deux mesures du champ « Taille, poids et IMC ». */
export interface Mesures {
  taille: number | null;
  poids: number | null;
}

export interface CasePrecision {
  coche: boolean;
  precision: string;
}

export const TYPES_SEANCE: { valeur: TypeSeance; libelle: string }[] = [
  { valeur: "premiere", libelle: "Première séance" },
  { valeur: "suivi", libelle: "Suivi" },
  { valeur: "urgence", libelle: "Urgence" },
];

export function libelleType(type: TypeSeance): string {
  return TYPES_SEANCE.find((t) => t.valeur === type)?.libelle ?? type;
}

export function libelleFacturation(f: Facturation): string {
  return f === "gratuit" ? "Acte gratuit" : "À facturer";
}

function joindre(retenus: string[]): string {
  if (retenus.length <= 1) return retenus.join("");
  return `${retenus.slice(0, -1).join(", ")} et ${retenus[retenus.length - 1]}`;
}

function texteEnLigne(noeud: JSONContent): string {
  switch (noeud.type) {
    case "text":
      return noeud.text ?? "";
    case "hardBreak":
      return "\n";
    case "blanc":
      return String(noeud.attrs?.valeur ?? "");
    case "choix":
      return joindre((noeud.attrs?.retenus as string[] | undefined) ?? []);
    default:
      return "";
  }
}

function blocs(noeud: JSONContent, sortie: string[]) {
  if (noeud.type === "paragraph") {
    sortie.push(nettoyer((noeud.content ?? []).map(texteEnLigne).join("")));
    return;
  }
  for (const enfant of noeud.content ?? []) blocs(enfant, sortie);
}

/** Texte lisible d'une valeur de champ : le même calcul que le cœur, pour la démonstration et l'affichage. */
export function texteDe(valeur: unknown): string {
  if (typeof valeur === "string") return valeur;
  if (valeur && typeof valeur === "object" && "type" in valeur) {
    const sortie: string[] = [];
    blocs(valeur as JSONContent, sortie);
    return sortie.join("\n").trim();
  }
  return "";
}

/** Le champ n'a rien de saisi : texte vide, aucune case, aucune mesure. */
export function estVide(valeur: unknown): boolean {
  if (valeur === null || valeur === undefined || valeur === "") return true;
  if (Array.isArray(valeur)) return valeur.length === 0;
  if (typeof valeur === "object") {
    if ("type" in (valeur as object)) return texteDe(valeur) === "";
    if ("coche" in (valeur as object)) return !(valeur as CasePrecision).coche;
    if ("taille" in (valeur as object)) return (valeur as Mesures).taille === null && (valeur as Mesures).poids === null;
  }
  return false;
}

/** IMC au dixième, ou `null` sans taille et poids plausibles. */
export function imc({ taille, poids }: Mesures): number | null {
  if (!taille || !poids || taille < 30 || poids <= 0) return null;
  return Math.round((poids / (taille / 100) ** 2) * 10) / 10;
}

export function nombreFr(n: number): string {
  return String(n).replace(".", ",");
}

/** Date `AAAA-MM-JJ` et heure `HH:MM` d'un début de séance. */
export function dateDe(debut: string): string {
  return debut.slice(0, 10);
}

export function heureDe(debut: string): string {
  return debut.slice(11, 16);
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** « mardi 6 octobre 2026 » */
export function jourEnLettres(dateIso: string): string {
  const [a, m, j] = dateIso.split("-").map(Number);
  return `${JOURS[new Date(a, m - 1, j).getDay()]} ${dateEnLettres(dateIso)}`;
}

/** Maintenant, arrondi aux 5 minutes : `AAAA-MM-JJTHH:MM`. */
export function debutMaintenant(maintenant = new Date()): string {
  const arrondi = new Date(Math.round(maintenant.getTime() / 300_000) * 300_000);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${arrondi.getFullYear()}-${deux(arrondi.getMonth() + 1)}-${deux(arrondi.getDate())}T${deux(arrondi.getHours())}:${deux(arrondi.getMinutes())}`;
}

/** « Douleur 6 → 2 », « Douleur 6 → ? », ou rien. */
export function evolutionDouleur(s: Pick<ResumeSeance, "douleur_avant" | "douleur_apres">): string {
  if (s.douleur_avant === null && s.douleur_apres === null) return "";
  const n = (v: number | null) => (v === null ? "?" : nombreFr(v));
  return `Douleur ${n(s.douleur_avant)} → ${n(s.douleur_apres)}`;
}

/** Résumé d'une séance d'après le rôle des champs : le même que celui du cœur. */
export function resumer(
  seance: Seance,
  patient: { nom: string; prenom: string },
  definition: Definition | null,
  modeleNom: string,
): ResumeSeance {
  const champ = (role: string): Champ | undefined => definition?.champs.find((c) => c.role === role);
  const douleur = (role: string) => {
    const c = champ(role);
    const v = c ? seance.valeurs[c.id] : undefined;
    return typeof v === "number" ? v : null;
  };
  const motif = champ("motif");
  const texte = motif ? texteDe(seance.valeurs[motif.id]).split(/\s+/).join(" ") : "";
  return {
    id: seance.id,
    patient_id: seance.patient_id,
    patient_nom: patient.nom,
    patient_prenom: patient.prenom,
    debut: seance.debut,
    modele_nom: modeleNom,
    type: seance.type,
    titre: seance.titre,
    importante: seance.importante,
    motif: texte.length > 160 ? `${texte.slice(0, 159)}…` : texte,
    douleur_avant: douleur("douleur_avant"),
    douleur_apres: douleur("douleur_apres"),
    facturation: seance.facturation,
    commentaire_gratuit: seance.commentaire_gratuit,
    supprimee_le: seance.supprimee_le,
    facture: null,
  };
}

/** Document d'éditeur d'un seul paragraphe, pour les séances fictives et la reprise de texte. */
export function document(texte: string): JSONContent {
  return {
    type: "doc",
    content: texte.split("\n").map((ligne) => (ligne ? { type: "paragraph", content: [{ type: "text", text: ligne }] } : { type: "paragraph" })),
  };
}
