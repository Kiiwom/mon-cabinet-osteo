import type { JSONContent } from "@tiptap/core";

import { texteDe } from "./seances";

/**
 * Textes mis en forme rangés dans un champ texte du cœur (remarques du dossier…) : le document de
 * l'éditeur en JSON. Un texte simple d'avant (saisi à la main ou importé) reste lisible : un
 * paragraphe par ligne.
 */
export function documentDepuis(valeur: string): JSONContent {
  const texte = valeur.trim();
  if (texte.startsWith("{")) {
    try {
      const document = JSON.parse(texte) as JSONContent;
      if (document && document.type === "doc") return document;
    } catch {
      // Un texte simple qui commence par une accolade : gardé tel quel.
    }
  }
  if (!texte) return { type: "doc", content: [{ type: "paragraph" }] };
  return {
    type: "doc",
    content: valeur.split("\n").map((ligne) => (ligne ? { type: "paragraph", content: [{ type: "text", text: ligne }] } : { type: "paragraph" })),
  };
}

function contientTrame(noeud: JSONContent): boolean {
  return noeud.type === "choix" || noeud.type === "blanc" || (noeud.content ?? []).some(contientTrame);
}

/** Valeur à ranger : vide quand il n'y a rien d'écrit, sinon le document en JSON. */
export function valeurDepuis(document: JSONContent): string {
  return texteDe(document) === "" && !contientTrame(document) ? "" : JSON.stringify(document);
}

/** Le texte brut d'une valeur rangée, mise en forme retirée. */
export function texteRiche(valeur: string): string {
  return texteDe(documentDepuis(valeur));
}
