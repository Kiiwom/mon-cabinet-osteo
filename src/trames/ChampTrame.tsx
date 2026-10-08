import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useRef, useState } from "react";

import type { CaractereTrames } from "../lib/coeur";
import { useVariablesTrames } from "./contexte";
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
  /** Titres, listes, gras, italique et souligné, avec leur barre d'outils. */
  miseEnForme?: boolean;
  /** Pour les tests : donne accès à l'éditeur une fois créé. */
  surEditeur?: (editor: Editor) => void;
}

/** Extensions de l'éditeur : texte simple, ou mis en forme (titres, listes, gras, italique, souligné). */
export function extensionsTexte(miseEnForme: boolean) {
  return StarterKit.configure({
    heading: miseEnForme ? { levels: [2, 3] } : false,
    bulletList: miseEnForme ? {} : false,
    orderedList: miseEnForme ? {} : false,
    listItem: miseEnForme ? {} : false,
    listKeymap: miseEnForme ? {} : false,
    underline: miseEnForme ? {} : false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    link: false,
    strike: false,
  });
}

/** Barre de mise en forme : gras, italique, souligné, titre, listes, effacement de la mise en forme. */
export function BarreOutils({ editor }: { editor: Editor }) {
  const etat = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      gras: e.isActive("bold"),
      italique: e.isActive("italic"),
      souligne: e.isActive("underline"),
      titre: e.isActive("heading"),
      puces: e.isActive("bulletList"),
      numeros: e.isActive("orderedList"),
    }),
  });
  const boutons = [
    { nom: "Gras", signe: "G", actif: etat.gras, agir: () => editor.chain().focus().toggleBold().run(), style: { fontWeight: 700 } },
    { nom: "Italique", signe: "I", actif: etat.italique, agir: () => editor.chain().focus().toggleItalic().run(), style: { fontStyle: "italic" } },
    { nom: "Souligné", signe: "S", actif: etat.souligne, agir: () => editor.chain().focus().toggleUnderline().run(), style: { textDecoration: "underline" } },
    { nom: "Intertitre", signe: "T", actif: etat.titre, agir: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), style: { fontWeight: 700 } },
    { nom: "Liste à puces", signe: "•", actif: etat.puces, agir: () => editor.chain().focus().toggleBulletList().run(), style: {} },
    { nom: "Liste numérotée", signe: "1.", actif: etat.numeros, agir: () => editor.chain().focus().toggleOrderedList().run(), style: {} },
  ];
  return (
    <span className="barre-outils" role="toolbar" aria-label="Mise en forme">
      {boutons.map((b) => (
        <button key={b.nom} type="button" aria-label={b.nom} title={b.nom} aria-pressed={b.actif} onClick={b.agir} style={b.style}>
          {b.signe}
        </button>
      ))}
      <button type="button" aria-label="Effacer la mise en forme" title="Effacer la mise en forme" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <span aria-hidden="true">⌫</span>
      </button>
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
  // Sans contexte (fiche d'un nouveau patient…), les variables restent des blancs à compléter.
  const valeursVariables = useVariablesTrames();
  const variables = useRef(valeursVariables);
  variables.current = valeursVariables;
  const [etat, setEtat] = useState({ restants: 0, total: 0 });

  const editor = useEditor(
    {
      extensions: [
        extensionsTexte(miseEnForme),
        Choix,
        Blanc,
        NavigationTrames,
        MenuTrames.configure({
          caractere,
          trames: () => tramesActuelles.current,
          surInsertion: (trame) => rappel.current?.(trame),
          variables: () => variables.current,
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
