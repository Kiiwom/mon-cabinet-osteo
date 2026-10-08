import type { JSONContent } from "@tiptap/core";
import { useRef } from "react";

import { documentDepuis, valeurDepuis } from "../lib/texteRiche";
import { ChampTrame } from "./ChampTrame";
import { useTrames } from "./contexte";

/**
 * Champ texte mis en forme, avec les trames : pour les remarques et tout texte long hors séance.
 * La valeur rangée est le document en JSON (vide quand rien n'est écrit).
 */
export function ChampTexteRiche({ libelle, valeur, changer }: { libelle: string; valeur: string; changer: (valeur: string) => void }) {
  const { trames, caractere, noter } = useTrames();
  // L'éditeur n'est recréé que si le caractère d'appel change : il repart alors du dernier état.
  const dernier = useRef<JSONContent | null>(null);
  dernier.current ??= documentDepuis(valeur);
  return (
    <ChampTrame
      libelle={libelle}
      trames={trames}
      caractere={caractere}
      surUtilisation={noter}
      valeur={dernier.current}
      surChangement={(document) => {
        dernier.current = document;
        changer(valeurDepuis(document));
      }}
      miseEnForme
    />
  );
}
