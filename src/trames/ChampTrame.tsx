import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
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
  /** Contenu de départ ; les changements suivants passent par `surChangement`. */
  valeur?: JSONContent;
  /** À chaque modification : le document complet, trames non validées comprises. */
  surChangement?: (document: JSONContent) => void;
  /** Gras, italique et liste à puces, avec leur barre d'outils. */
  miseEnForme?: boolean;
  /** Pour les tests : donne accès à l'éditeur une fois créé. */
  surEditeur?: (editor: Editor) => void;
}

function BarreOutils({ editor }: { editor: Editor }) {
  const etat = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ gras: e.isActive("bold"), italique: e.isActive("italic"), liste: e.isActive("bulletList") }),
  });
  const boutons = [
    { nom: "Gras", signe: "G", actif: etat.gras, agir: () => editor.chain().focus().toggleBold().run(), style: { fontWeight: 700 } },
    { nom: "Italique", signe: "I", actif: etat.italique, agir: () => editor.chain().focus().toggleItalic().run(), style: { fontStyle: "italic" } },
    { nom: "Liste à puces", signe: "≡", actif: etat.liste, agir: () => editor.chain().focus().toggleBulletList().run(), style: {} },
  ];
  return (
    <span className="barre-outils" role="toolbar" aria-label="Mise en forme">
      {boutons.map((b) => (
        <button key={b.nom} type="button" aria-label={b.nom} aria-pressed={b.actif} onClick={b.agir} style={b.style}>
          {b.signe}
        </button>
      ))}
    </span>
  );
}

/** Champ de séance qui accepte les trames : menu au caractère choisi, pastilles, blancs, Valider. */
export function ChampTrame({ libelle, trames, caractere, surUtilisation, surValidation, valeur, surChangement, miseEnForme = false, surEditeur }: Props) {
  const id = useId();
  const tramesActuelles = useRef(trames);
  tramesActuelles.current = trames;
  const rappel = useRef(surUtilisation);
  rappel.current = surUtilisation;
  const changement = useRef(surChangement);
  changement.current = surChangement;
  const [etat, setEtat] = useState({ restants: 0, total: 0 });

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          bulletList: miseEnForme ? {} : false,
          orderedList: false,
          listItem: miseEnForme ? {} : false,
          listKeymap: miseEnForme ? {} : false,
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
      content: valeur ?? "",
      editorProps: {
        attributes: { class: "champ-trame-saisie", "aria-labelledby": `${id}-libelle`, "aria-describedby": `${id}-aide` },
      },
      onCreate: ({ editor: e }) => setEtat(compterACompleter(e.state.doc)),
      onUpdate: ({ editor: e }) => {
        setEtat(compterACompleter(e.state.doc));
        changement.current?.(e.getJSON());
      },
    },
    [caractere, miseEnForme],
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
      <span className="champ-trame-entete">
        <span id={`${id}-libelle`} className="champ-trame-libelle">
          {libelle}
        </span>
        {miseEnForme && editor && <BarreOutils editor={editor} />}
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
