import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** La fin de mot proposée, à la position du curseur. */
type Proposition = { position: number; suffixe: string } | null;

export const cleMotsFrequents = new PluginKey<Proposition>("motsFrequents");

/**
 * La fin du mot à proposer pour `debut` (trois lettres au moins) : le mot le plus fréquent qui le
 * prolonge d'au moins deux lettres. Un début en capitales se complète en capitales.
 */
export function completion(mots: string[], debut: string): string | null {
  if ([...debut].length < 3) return null;
  const bas = debut.toLocaleLowerCase("fr");
  const mot = mots.find((m) => m.length >= bas.length + 2 && m.startsWith(bas));
  if (!mot) return null;
  const suffixe = mot.slice(bas.length);
  const capitales = debut.length > 1 && debut === debut.toLocaleUpperCase("fr") && debut !== bas;
  return capitales ? suffixe.toLocaleUpperCase("fr") : suffixe;
}

function proposer(state: EditorState, mots: string[]): Proposition {
  const { selection } = state;
  if (!selection.empty || mots.length === 0) return null;
  const $position = selection.$from;
  if (!$position.parent.isTextblock) return null;
  const avant = $position.parent.textBetween(0, $position.parentOffset, undefined, "￼");
  const apres = $position.parent.textBetween($position.parentOffset, $position.parent.content.size, undefined, "￼");
  // Au milieu d'un mot, rien à proposer.
  if (/^[\p{L}-]/u.test(apres)) return null;
  const trouve = /[\p{L}][\p{L}-]*$/u.exec(avant);
  if (!trouve) return null;
  // « @lomb » appelle une trame : c'est le menu des trames qui répond.
  if (["@", "/"].includes(avant[trouve.index - 1])) return null;
  const suffixe = completion(mots, trouve[0]);
  return suffixe ? { position: selection.from, suffixe } : null;
}

/** Une ou deux lettres tapées au curseur, et rien d'autre : une frappe, pas un collage ni une trame. */
function estUneFrappe(steps: readonly unknown[]): boolean {
  if (steps.length !== 1 || !(steps[0] instanceof ReplaceStep)) return false;
  const taille = steps[0].slice.content.size;
  return taille >= 1 && taille <= 2;
}

export interface OptionsMotsFrequents {
  /** Le vocabulaire du praticien, du plus fréquent au moins fréquent, en minuscules. */
  mots: () => string[];
}

/**
 * Mots fréquents : pendant la frappe, la fin d'un mot déjà écrit dans les séances ou les trames
 * s'affiche en grisé après le curseur ; Tab l'accepte, Échap ou la suite de la frappe l'ignore.
 */
export const MotsFrequents = Extension.create<OptionsMotsFrequents>({
  name: "motsFrequents",
  // Avant la navigation des trames : Tab accepte d'abord le mot proposé.
  priority: 1000,
  addOptions() {
    return { mots: () => [] };
  },
  addProseMirrorPlugins() {
    const { mots } = this.options;
    return [
      new Plugin<Proposition>({
        key: cleMotsFrequents,
        state: {
          init: () => null,
          apply(tr, ancienne, _avant, apres) {
            if (tr.getMeta(cleMotsFrequents) === "effacer") return null;
            if (tr.docChanged) return estUneFrappe(tr.steps) ? proposer(apres, mots()) : null;
            return tr.selectionSet ? null : ancienne;
          },
        },
        props: {
          decorations(state) {
            const proposition = cleMotsFrequents.getState(state);
            if (!proposition) return null;
            const fantome = () => {
              const span = document.createElement("span");
              span.className = "mot-propose";
              span.setAttribute("aria-hidden", "true");
              span.textContent = proposition.suffixe;
              return span;
            };
            return DecorationSet.create(state.doc, [Decoration.widget(proposition.position, fantome, { side: 1, key: `mot-${proposition.suffixe}` })]);
          },
          handleKeyDown(view, evenement) {
            const proposition = cleMotsFrequents.getState(view.state);
            if (!proposition) return false;
            if (evenement.key === "Tab" && !evenement.shiftKey && !evenement.ctrlKey && !evenement.altKey && !evenement.metaKey) {
              view.dispatch(view.state.tr.insertText(proposition.suffixe, proposition.position).setMeta(cleMotsFrequents, "effacer"));
              return true;
            }
            if (evenement.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(cleMotsFrequents, "effacer"));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
