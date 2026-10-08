import type { Editor } from "@tiptap/core";
import { act } from "@testing-library/react";

/** L'éditeur Tiptap derrière un champ texte mis en forme (Tiptap le range sur son élément). */
export function editeurDe(champ: HTMLElement): Editor {
  const editeur = (champ as HTMLElement & { editor?: Editor }).editor;
  if (!editeur) throw new Error("Ce champ n'est pas un éditeur Tiptap");
  return editeur;
}

/** Remplace le contenu du champ, comme une saisie (HTML de l'éditeur : <p>, <strong>, <ul>…). */
export async function remplirEditeur(champ: HTMLElement, html: string) {
  await act(async () => {
    editeurDe(champ).commands.setContent(html, { emitUpdate: true });
  });
}
