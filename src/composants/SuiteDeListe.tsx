import { useCallback, useEffect, useRef, useState } from "react";

/** Lignes ajoutées à chaque tranche : une page de 10 000 patients s'affiche sans attendre. */
export const TRANCHE = 100;

/**
 * Nombre de lignes affichées d'une longue liste, revenu à une tranche quand `cle` change (nouvelle
 * recherche, autre filtre).
 */
export function useTranches(cle: string): [number, () => void] {
  const [affichage, setAffichage] = useState({ cle, lignes: TRANCHE });
  const lignes = affichage.cle === cle ? affichage.lignes : TRANCHE;
  const plus = useCallback(() => setAffichage((a) => ({ cle, lignes: (a.cle === cle ? a.lignes : TRANCHE) + TRANCHE })), [cle]);
  return [lignes, plus];
}

/**
 * Bas d'une liste affichée par tranches : la suite vient d'elle-même quand on approche du bas, ou au
 * bouton, au clavier comme au doigt.
 */
export function SuiteDeListe({ affichees, total, afficherPlus, nature }: { affichees: number; total: number; afficherPlus: () => void; nature: string }) {
  const repere = useRef<HTMLDivElement>(null);
  const reste = total - affichees;

  useEffect(() => {
    const element = repere.current;
    if (!element || reste <= 0 || typeof IntersectionObserver === "undefined") return;
    const observateur = new IntersectionObserver((entrees) => entrees.some((e) => e.isIntersecting) && afficherPlus(), { rootMargin: "600px" });
    observateur.observe(element);
    return () => observateur.disconnect();
  }, [afficherPlus, affichees, reste]);

  if (reste <= 0) return null;
  return (
    <div className="suite-liste" ref={repere}>
      <button type="button" className="bouton" onClick={afficherPlus}>
        Afficher {Math.min(TRANCHE, reste)} {nature} de plus
      </button>
      <span className="discret">
        {affichees} affichés sur {total}
      </span>
    </div>
  );
}
