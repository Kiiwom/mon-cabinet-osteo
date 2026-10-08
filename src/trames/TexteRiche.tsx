import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";

import { documentDepuis } from "../lib/texteRiche";

function marques(noeud: JSONContent, contenu: ReactNode): ReactNode {
  return (noeud.marks ?? []).reduce<ReactNode>((rendu, marque) => {
    if (marque.type === "bold") return <strong>{rendu}</strong>;
    if (marque.type === "italic") return <em>{rendu}</em>;
    if (marque.type === "underline") return <u>{rendu}</u>;
    return rendu;
  }, contenu);
}

function enLigne(noeud: JSONContent, cle: number): ReactNode {
  switch (noeud.type) {
    case "text":
      return <span key={cle}>{marques(noeud, noeud.text)}</span>;
    case "hardBreak":
      return <br key={cle} />;
    case "blanc": {
      const valeur = String(noeud.attrs?.valeur ?? "").trim();
      return valeur ? (
        <span key={cle}>{marques(noeud, valeur)}</span>
      ) : (
        <span key={cle} className="apercu-blanc">
          {String(noeud.attrs?.indication ?? "") || "…"}
        </span>
      );
    }
    case "choix": {
      const options = (noeud.attrs?.options as string[] | undefined) ?? [];
      const retenus = ((noeud.attrs?.retenus as number[] | undefined) ?? []).map((r) => options[r]).filter(Boolean);
      if (retenus.length) return <span key={cle}>{marques(noeud, retenus.join(", "))}</span>;
      return (
        <span key={cle} className="apercu-choix" data-multiple={Boolean(noeud.attrs?.multiple)}>
          {options.map((option, i) => (
            <span key={i} className="apercu-pastille">
              {option}
            </span>
          ))}
        </span>
      );
    }
    default:
      return null;
  }
}

function bloc(noeud: JSONContent, cle: number): ReactNode {
  const enfants = (noeud.content ?? []).map((enfant, i) =>
    enfant.type === "text" || enfant.type === "hardBreak" || enfant.type === "blanc" || enfant.type === "choix" ? enLigne(enfant, i) : bloc(enfant, i),
  );
  switch (noeud.type) {
    case "paragraph":
      return <p key={cle}>{enfants.length ? enfants : <br />}</p>;
    case "heading":
      return (
        <p key={cle} className="texte-riche-titre" data-niveau={noeud.attrs?.level ?? 2}>
          {enfants}
        </p>
      );
    case "bulletList":
      return <ul key={cle}>{enfants}</ul>;
    case "orderedList":
      return <ol key={cle}>{enfants}</ol>;
    case "listItem":
      return <li key={cle}>{enfants}</li>;
    default:
      return <div key={cle}>{enfants}</div>;
  }
}

/** Affichage d'un texte mis en forme (remarques, compte rendu) : titres, listes, gras, italique, souligné. */
export function TexteRiche({ valeur, document }: { valeur?: string; document?: JSONContent }) {
  const doc = document ?? documentDepuis(valeur ?? "");
  return <div className="texte-riche">{(doc.content ?? []).map((noeud, i) => bloc(noeud, i))}</div>;
}
