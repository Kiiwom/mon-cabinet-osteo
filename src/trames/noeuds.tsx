import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { KeyboardEvent } from "react";

/**
 * Nœuds d'une trame insérée dans un champ :
 * - « choix » : un groupe de pastilles, une par option ;
 * - « blanc » : un petit champ à compléter, avec son indication en grisé.
 * Les pastilles et les blancs sont de vrais boutons et de vrais champs : Tab passe de l'un à
 * l'autre, Espace retient un choix, Échap revient au texte.
 */

export interface AttributsChoix {
  options: string[];
  multiple: boolean;
  retenus: number[];
}

export interface AttributsBlanc {
  indication: string;
  valeur: string;
}

const ARRET = "[data-arret-trame]";

function positionDuNoeud(editor: Editor, element: Element): number | null {
  const enveloppe = element.closest("[data-type-trame]");
  if (!enveloppe) return null;
  try {
    return editor.view.posAtDOM(enveloppe, 0);
  } catch {
    return null;
  }
}

/** Remet le curseur dans le texte, juste avant ou juste après le nœud qui contient l'élément. */
function revenirAuTexte(editor: Editor, element: Element, apres: boolean) {
  const position = positionDuNoeud(editor, element);
  if (position === null) return;
  editor
    .chain()
    .focus()
    .setTextSelection(apres ? position + 1 : position)
    .run();
}

/**
 * Passe au prochain arrêt (pastille ou blanc) dans le sens donné.
 * `depuis` : l'élément qui a le focus ; à défaut, la position du curseur ou `apresPosition`.
 * Renvoie faux quand il n'y a plus d'arrêt : le focus suit alors son cours normal.
 */
export function allerAuSuivant(editor: Editor, depuis: Element | null, sens: 1 | -1, apresPosition?: number): boolean {
  const arrets = Array.from(editor.view.dom.querySelectorAll<HTMLElement>(ARRET));
  let rang: number;
  if (depuis && arrets.includes(depuis as HTMLElement)) {
    rang = arrets.indexOf(depuis as HTMLElement) + sens;
  } else {
    const curseur = apresPosition ?? editor.state.selection.head;
    const positions = arrets.map((arret) => positionDuNoeud(editor, arret) ?? -1);
    if (sens > 0) rang = positions.findIndex((p) => p >= curseur);
    else rang = positions.reduce((dernier, p, i) => (p >= 0 && p < curseur ? i : dernier), -1);
  }
  if (rang < 0 || rang >= arrets.length) {
    if (depuis && arrets.includes(depuis as HTMLElement)) {
      revenirAuTexte(editor, depuis, sens > 0);
      return true;
    }
    return false;
  }
  arrets[rang].focus();
  return true;
}

function gererToucheArret(editor: Editor, evenement: KeyboardEvent<HTMLElement>, entreeAvance: boolean) {
  if (evenement.key === "Enter" && (evenement.ctrlKey || evenement.metaKey)) {
    evenement.preventDefault();
    editor.storage.navigationTrames.valider();
  } else if (evenement.key === "Tab" || (entreeAvance && evenement.key === "Enter")) {
    evenement.preventDefault();
    allerAuSuivant(editor, evenement.currentTarget, evenement.shiftKey ? -1 : 1);
  } else if (evenement.key === "Escape") {
    evenement.preventDefault();
    revenirAuTexte(editor, evenement.currentTarget, true);
  }
}

function VueChoix({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const { options, multiple, retenus } = node.attrs as AttributsChoix;

  const basculer = (rang: number) => {
    // Lu dans le document, pas dans les propriétés : deux clics rapprochés ne s'écrasent pas.
    const position = getPos();
    const actuel = typeof position === "number" ? editor.state.doc.nodeAt(position) : null;
    const retenus = actuel ? (actuel.attrs as AttributsChoix).retenus : (node.attrs as AttributsChoix).retenus;
    const deja = retenus.includes(rang);
    const nouveaux = multiple
      ? deja
        ? retenus.filter((r) => r !== rang)
        : [...retenus, rang].sort((a, b) => a - b)
      : deja
        ? []
        : [rang];
    updateAttributes({ retenus: nouveaux });
  };

  return (
    <NodeViewWrapper
      as="span"
      className="trame-choix"
      data-type-trame="choix"
      data-multiple={multiple}
      data-complet={retenus.length > 0}
      role="group"
      aria-label={multiple ? "Choix multiple" : "Choix unique"}
    >
      {multiple && (
        <span className="trame-choix-plusieurs" aria-hidden="true">
          +
        </span>
      )}
      {options.map((option, rang) => (
        <button
          key={rang}
          type="button"
          className="trame-pastille"
          aria-pressed={retenus.includes(rang)}
          data-arret-trame=""
          tabIndex={-1}
          onClick={() => basculer(rang)}
          onKeyDown={(e) => gererToucheArret(editor, e, false)}
        >
          {option}
        </button>
      ))}
    </NodeViewWrapper>
  );
}

function VueBlanc({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const { indication, valeur } = node.attrs as AttributsBlanc;
  return (
    <NodeViewWrapper as="span" className="trame-blanc" data-type-trame="blanc" data-complet={valeur.trim() !== ""}>
      <input
        data-arret-trame=""
        tabIndex={-1}
        value={valeur}
        placeholder={indication || "…"}
        aria-label={indication ? `À compléter : ${indication}` : "À compléter"}
        size={Math.max(4, Math.max(valeur.length, indication.length) + 1)}
        onChange={(e) => updateAttributes({ valeur: e.target.value })}
        onKeyDown={(e) => gererToucheArret(editor, e, true)}
      />
    </NodeViewWrapper>
  );
}

const enJson = (nom: string, defaut: unknown) => ({
  default: defaut,
  parseHTML: (element: HTMLElement) => JSON.parse(element.getAttribute(`data-${nom}`) ?? JSON.stringify(defaut)),
  renderHTML: (attributs: Record<string, unknown>) => ({ [`data-${nom}`]: JSON.stringify(attributs[nom]) }),
});

export const Choix = Node.create({
  name: "choix",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { options: enJson("options", []), multiple: enJson("multiple", false), retenus: enJson("retenus", []) };
  },
  parseHTML() {
    return [{ tag: "span[data-choix]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-choix": "" }, HTMLAttributes)];
  },
  renderText({ node }) {
    return `{${(node.attrs as AttributsChoix).options.join(" | ")}}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(VueChoix, { as: "span" });
  },
});

export const Blanc = Node.create({
  name: "blanc",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { indication: enJson("indication", ""), valeur: enJson("valeur", "") };
  },
  parseHTML() {
    return [{ tag: "span[data-blanc]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-blanc": "" }, HTMLAttributes)];
  },
  renderText({ node }) {
    const { indication, valeur } = node.attrs as AttributsBlanc;
    return valeur || `[${indication}]`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(VueBlanc, { as: "span" });
  },
});

declare module "@tiptap/core" {
  interface Storage {
    navigationTrames: { valider: () => void };
  }
}

/**
 * Tab et Maj+Tab dans le texte rejoignent la pastille ou le blanc le plus proche.
 * Ctrl+Entrée valide, depuis le texte comme depuis une pastille ou un blanc :
 * le champ range sa fonction de validation dans `editor.storage.navigationTrames`.
 */
export const NavigationTrames = Extension.create({
  name: "navigationTrames",
  addStorage() {
    return { valider: () => undefined };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => allerAuSuivant(this.editor, null, 1),
      "Shift-Tab": () => allerAuSuivant(this.editor, null, -1),
      "Mod-Enter": () => {
        this.storage.valider();
        return true;
      },
    };
  },
});
