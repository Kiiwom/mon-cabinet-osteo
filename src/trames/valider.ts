import type { Editor, JSONContent, Range } from "@tiptap/core";
import type { Node as NoeudPM } from "@tiptap/pm/model";

import type { AttributsBlanc, AttributsChoix } from "./noeuds";
import { allerAuSuivant } from "./noeuds";
import { analyserModele, joindreChoix, type Segment } from "./syntaxe";

export interface TrameResume {
  id: string;
  code: string;
  titre: string;
  categorie: string;
  modele: string;
}

export function segmentsVersContenu(segments: Segment[]): JSONContent[] {
  return segments.map((segment) => {
    if (segment.type === "texte") return { type: "text", text: segment.texte };
    if (segment.type === "blanc") return { type: "blanc", attrs: { indication: segment.indication, valeur: "" } };
    return { type: "choix", attrs: { options: segment.options, multiple: segment.multiple, retenus: [] } };
  });
}

/** Remplace « @code » par la trame, puis place le focus sur sa première pastille ou son premier blanc. */
export function insererTrame(editor: Editor, plage: Range, trame: TrameResume): boolean {
  const analyse = analyserModele(trame.modele);
  if (!analyse.ok) return false;
  editor.chain().focus().deleteRange(plage).insertContentAt(plage.from, segmentsVersContenu(analyse.segments)).run();
  focaliserQuandPret(editor, plage.from);
  return true;
}

/** Les pastilles sont dessinées par React peu après la transaction : on réessaie quelques fois. */
function focaliserQuandPret(editor: Editor, position: number, essais = 20) {
  setTimeout(() => {
    if (editor.isDestroyed) return;
    if (!allerAuSuivant(editor, null, 1, position) && essais > 1) focaliserQuandPret(editor, position, essais - 1);
  }, 16);
}

/** Pastilles sans choix et blancs vides restant dans le champ. */
export function compterACompleter(doc: NoeudPM): { restants: number; total: number } {
  let restants = 0;
  let total = 0;
  doc.descendants((noeud) => {
    if (noeud.type.name === "choix") {
      total += 1;
      if ((noeud.attrs as AttributsChoix).retenus.length === 0) restants += 1;
    } else if (noeud.type.name === "blanc") {
      total += 1;
      if (!(noeud.attrs as AttributsBlanc).valeur.trim()) restants += 1;
    }
  });
  return { restants, total };
}

/** Espaces doublés et ponctuation orpheline laissés par un choix ou un blanc retirés. */
export function nettoyer(texte: string): string {
  return texte
    .replace(/ {2,}/g, " ")
    .replace(/ +([,.])/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/,\s*\./g, ".");
}

/**
 * « Valider » : chaque groupe devient le texte des choix retenus, chaque blanc sa valeur.
 * Un groupe sans choix ou un blanc vide disparaît. Le texte qui reste est propre.
 */
export function validerTrames(editor: Editor): boolean {
  const { state } = editor;
  const cibles: { position: number; noeud: NoeudPM }[] = [];
  state.doc.descendants((noeud, position) => {
    if (noeud.type.name === "choix" || noeud.type.name === "blanc") cibles.push({ position, noeud });
  });
  if (cibles.length === 0) return false;

  // Seuls les paragraphes qui contenaient une trame sont nettoyés : le texte libre reste tel quel.
  const paragraphes = new Map<number, number>();
  for (const { position } of cibles) {
    const $position = state.doc.resolve(position);
    paragraphes.set($position.start(), $position.end());
  }

  const tr = state.tr;
  for (const { position, noeud } of [...cibles].reverse()) {
    let texte: string;
    if (noeud.type.name === "choix") {
      const { options, retenus } = noeud.attrs as AttributsChoix;
      texte = joindreChoix(retenus.map((r) => options[r]));
    } else {
      texte = (noeud.attrs as AttributsBlanc).valeur.trim();
    }
    const fin = position + noeud.nodeSize;
    if (texte) tr.replaceWith(position, fin, state.schema.text(texte, noeud.marks));
    else tr.delete(position, fin);
  }

  const corrections: { de: number; a: number; noeud: NoeudPM; texte: string }[] = [];
  for (const [debut, fin] of paragraphes) {
    tr.doc.nodesBetween(tr.mapping.map(debut, -1), tr.mapping.map(fin, 1), (noeud, position) => {
      if (noeud.isText && noeud.text) {
        const texte = nettoyer(noeud.text);
        if (texte !== noeud.text) corrections.push({ de: position, a: position + noeud.nodeSize, noeud, texte });
      }
    });
  }
  corrections.sort((x, y) => x.de - y.de);
  for (const { de, a, noeud, texte } of corrections.reverse()) {
    if (texte) tr.replaceWith(de, a, state.schema.text(texte, noeud.marks));
    else tr.delete(de, a);
  }
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}
