import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { insererTrame, type TrameResume } from "./valider";

const sansAccents = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Trames proposées pour « @requete » : code qui commence par la requête d'abord, puis code ou titre qui la contient. */
export function filtrerTrames(trames: TrameResume[], requete: string): TrameResume[] {
  const q = sansAccents(requete.trim());
  const rang = (t: TrameResume) => {
    const code = sansAccents(t.code);
    if (code.startsWith(q)) return 0;
    if (code.includes(q)) return 1;
    if (sansAccents(t.titre).includes(q)) return 2;
    return 3;
  };
  return trames
    .map((t) => ({ t, r: rang(t) }))
    .filter(({ r }) => r < 3)
    .sort((a, b) => a.r - b.r || a.t.code.localeCompare(b.t.code))
    .slice(0, 8)
    .map(({ t }) => t);
}

interface PropsListe {
  items: TrameResume[];
  command: (trame: TrameResume) => void;
  caractere: string;
}

export interface CommandeListe {
  gererTouche: (evenement: KeyboardEvent) => boolean;
}

const ListeTrames = forwardRef<CommandeListe, PropsListe>(function ListeTrames({ items, command, caractere }, ref) {
  const [choisie, setChoisie] = useState(0);
  useEffect(() => setChoisie(0), [items]);

  useImperativeHandle(ref, () => ({
    gererTouche(evenement) {
      if (items.length === 0) return false;
      if (evenement.key === "ArrowDown") {
        setChoisie((c) => (c + 1) % items.length);
        return true;
      }
      if (evenement.key === "ArrowUp") {
        setChoisie((c) => (c + items.length - 1) % items.length);
        return true;
      }
      if (evenement.key === "Enter" || evenement.key === "Tab") {
        command(items[choisie]);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="menu-trames" role="listbox" aria-label="Trames">
      {items.length === 0 ? (
        <p className="menu-trames-vide">Aucune trame pour ce code</p>
      ) : (
        items.map((trame, rang) => (
          <div
            key={trame.id}
            role="option"
            aria-selected={rang === choisie}
            className="menu-trames-option"
            onMouseDown={(e) => {
              e.preventDefault();
              command(trame);
            }}
            onMouseEnter={() => setChoisie(rang)}
          >
            <span className="menu-trames-code">
              {caractere}
              {trame.code}
            </span>
            <span className="menu-trames-titre">{trame.titre}</span>
          </div>
        ))
      )}
      <p className="menu-trames-aide">↑ ↓ pour choisir · Entrée pour insérer · Échap pour fermer</p>
    </div>
  );
});

export interface OptionsMenuTrames {
  caractere: string;
  trames: () => TrameResume[];
  surInsertion: (trame: TrameResume) => void;
}

/** Menu ouvert par le caractère choisi (@ par défaut), en début de mot. */
export const MenuTrames = Extension.create<OptionsMenuTrames>({
  name: "menuTrames",
  addOptions() {
    return { caractere: "@", trames: () => [], surInsertion: () => undefined };
  },
  addProseMirrorPlugins() {
    const { caractere, trames, surInsertion } = this.options;
    return [
      Suggestion<TrameResume, TrameResume>({
        editor: this.editor,
        pluginKey: new PluginKey("menuTrames"),
        char: caractere,
        allowSpaces: false,
        items: ({ query }) => filtrerTrames(trames(), query),
        command: ({ editor, range, props }) => {
          if (insererTrame(editor, range, props)) surInsertion(props);
        },
        render: () => {
          let rendu: ReactRenderer<CommandeListe, PropsListe> | null = null;
          let demonter: (() => void) | null = null;
          const proprietes = (p: SuggestionProps<TrameResume, TrameResume>): PropsListe => ({
            items: p.items,
            command: p.command,
            caractere,
          });
          return {
            onStart: (p) => {
              rendu = new ReactRenderer(ListeTrames, { props: proprietes(p), editor: p.editor });
              demonter = p.mount(rendu.element);
            },
            onUpdate: (p) => rendu?.updateProps(proprietes(p)),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => rendu?.ref?.gererTouche(event) ?? false,
            onExit: () => {
              demonter?.();
              rendu?.destroy();
              rendu = null;
            },
          };
        },
      }),
    ];
  },
});
