import type { Editor, JSONContent, Range } from "@tiptap/core";
import type { Node as NoeudPM, Schema } from "@tiptap/pm/model";

import type { AttributsBlanc, AttributsChoix } from "./noeuds";
import { allerAuSuivant } from "./noeuds";
import { analyserDetaille, analyserModele, joindreChoix, nettoyer, type Segment } from "./syntaxe";

export { nettoyer };

export interface TrameResume {
  id: string;
  code: string;
  titre: string;
  categorie: string;
  modele: string;
  /** Le texte mis en forme ; absent pour une trame en texte simple. */
  contenu?: JSONContent | null;
}

type Marques = JSONContent["marks"];

const memesMarques = (a: Marques, b: Marques) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Un paragraphe ou un titre de la trame : sa syntaxe devient des pastilles et des blancs, sa mise en forme reste. */
function convertirLigne(noeud: JSONContent): JSONContent {
  let source = "";
  const marques: Marques[] = [];
  for (const enfant of noeud.content ?? []) {
    if (enfant.type === "text") {
      const texte = enfant.text ?? "";
      source += texte;
      for (let i = 0; i < texte.length; i += 1) marques.push(enfant.marks);
    } else if (enfant.type === "hardBreak") {
      source += "\n";
      marques.push(undefined);
    }
  }
  const analyse = analyserDetaille(source);
  if (!analyse.ok) throw new Error(`${analyse.erreur} « ${source.trim().slice(0, 60)} »`);
  const contenu: JSONContent[] = [];
  analyse.segments.forEach((segment, rang) => {
    const origine = analyse.origines[rang];
    if (segment.type === "texte") {
      const positions = origine as number[];
      let courant = "";
      let marquesCourantes: Marques = undefined;
      const vider = () => {
        if (courant) contenu.push({ type: "text", text: courant, ...(marquesCourantes?.length ? { marks: marquesCourantes } : {}) });
        courant = "";
      };
      for (let n = 0; n < segment.texte.length; n += 1) {
        const caractere = segment.texte[n];
        if (caractere === "\n") {
          vider();
          contenu.push({ type: "hardBreak" });
          continue;
        }
        const m = marques[positions[n]];
        if (!memesMarques(m, marquesCourantes)) {
          vider();
          marquesCourantes = m;
        }
        courant += caractere;
      }
      vider();
    } else {
      const m = marques[origine as number];
      const [noeudTrame] = segmentsVersContenu([segment]);
      contenu.push(m?.length ? { ...noeudTrame, marks: m } : noeudTrame);
    }
  });
  return { ...noeud, content: contenu };
}

function convertirBloc(noeud: JSONContent): JSONContent {
  if (noeud.type === "paragraph" || noeud.type === "heading") return convertirLigne(noeud);
  return { ...noeud, content: (noeud.content ?? []).map(convertirBloc) };
}

/**
 * Le texte mis en forme d'une trame, prêt à insérer : la syntaxe des choix et des blancs devient des
 * pastilles et des blancs, les titres, listes, gras et italiques restent. Lève une erreur si une ligne
 * a une syntaxe invalide (un groupe ne peut pas s'étendre sur deux lignes).
 */
export function contenuVersInsertion(contenu: JSONContent): JSONContent[] {
  return (contenu.content ?? []).map(convertirBloc);
}

/** Ce que l'éditeur ne connaît pas devient du texte simple : titres en paragraphes, listes à plat, marques retirées. */
export function adapterAuSchema(noeuds: JSONContent[], schema: Schema): JSONContent[] {
  const sortie: JSONContent[] = [];
  for (const noeud of noeuds) {
    const type = noeud.type ?? "";
    if (type === "text" || type === "choix" || type === "blanc" || type === "hardBreak") {
      const marques = (noeud.marks ?? []).filter((m) => m.type && schema.marks[m.type]);
      const { marks: _marques, ...reste } = noeud;
      sortie.push(marques.length ? { ...reste, marks: marques } : reste);
    } else if (!schema.nodes[type]) {
      if (type === "heading") sortie.push({ type: "paragraph", content: adapterAuSchema(noeud.content ?? [], schema) });
      else sortie.push(...adapterAuSchema(noeud.content ?? [], schema));
    } else {
      sortie.push({ ...noeud, content: noeud.content ? adapterAuSchema(noeud.content, schema) : undefined });
    }
  }
  return sortie;
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
  let contenu: JSONContent[];
  if (trame.contenu) {
    try {
      const blocs = adapterAuSchema(contenuVersInsertion(trame.contenu), editor.schema);
      // Une seule ligne : elle se glisse dans le paragraphe en cours au lieu de le couper.
      contenu = blocs.length === 1 && blocs[0].type === "paragraph" ? (blocs[0].content ?? []) : blocs;
    } catch {
      return false;
    }
  } else {
    const analyse = analyserModele(trame.modele);
    if (!analyse.ok) return false;
    contenu = segmentsVersContenu(analyse.segments);
  }
  editor.chain().focus().deleteRange(plage).insertContentAt(plage.from, contenu).run();
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
