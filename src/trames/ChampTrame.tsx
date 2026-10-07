import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useRef, useState } from "react";

import type { CaractereTrames } from "../lib/coeur";
import { MenuTrames } from "./menu";
import { Blanc, Choix, NavigationTrames } from "./noeuds";
import { compterACompleter, validerTrames, type TrameResume } from "./valider";

interface Props {
  libelle: string;
  trames: TrameResume[];
  caractere: CaractereTrames;
  surUtilisation?: (trame: TrameResume) => void;
  surValidation?: (texte: string) => void;
  /** Pour les tests : donne accès à l'éditeur une fois créé. */
  surEditeur?: (editor: Editor) => void;
}

/** Champ de séance qui accepte les trames : menu au caractère choisi, pastilles, blancs, Valider. */
export function ChampTrame({ libelle, trames, caractere, surUtilisation, surValidation, surEditeur }: Props) {
  const id = useId();
  const tramesActuelles = useRef(trames);
  tramesActuelles.current = trames;
  const rappel = useRef(surUtilisation);
  rappel.current = surUtilisation;
  const [etat, setEtat] = useState({ restants: 0, total: 0 });

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          blockquote: false,
          codeBlock: false,
          code: false,
          horizontalRule: false,
          link: false,
          strike: false,
          underline: false,
        }),
        Choix,
        Blanc,
        NavigationTrames,
        MenuTrames.configure({
          caractere,
          trames: () => tramesActuelles.current,
          surInsertion: (trame) => rappel.current?.(trame),
        }),
      ],
      editorProps: {
        attributes: { class: "champ-trame-saisie", "aria-labelledby": `${id}-libelle`, "aria-describedby": `${id}-aide` },
      },
      onUpdate: ({ editor: e }) => setEtat(compterACompleter(e.state.doc)),
    },
    [caractere],
  );

  useEffect(() => {
    if (editor) surEditeur?.(editor);
  }, [editor, surEditeur]);

  /** Bouton « Valider » et Ctrl+Entrée passent par le même chemin. */
  const valider = () => {
    if (!editor || !validerTrames(editor)) return;
    surValidation?.(editor.getText());
  };
  if (editor) editor.storage.navigationTrames.valider = valider;

  return (
    <div className="champ-trame">
      <span id={`${id}-libelle`} className="champ-trame-libelle">
        {libelle}
      </span>
      <EditorContent editor={editor} />
      <div className="champ-trame-pied">
        <span id={`${id}-aide`} className="discret">
          {etat.total === 0
            ? `Tapez ${caractere} suivi du code d’une trame, par exemple ${caractere}lomb.`
            : "Tab passe d’une pastille à l’autre, Espace retient un choix, Ctrl+Entrée valide."}
        </span>
        <span className="champ-trame-etat" role="status">
          {etat.total > 0 && (etat.restants > 0 ? `${etat.restants} à compléter` : "Tout est complété")}
        </span>
        <button type="button" className="bouton" onClick={valider} disabled={etat.total === 0}>
          Valider
        </button>
      </div>
    </div>
  );
}
