import type { ReactNode } from "react";

import type { Ecran } from "../lib/navigation";
import { Marque } from "./Marque";

const TRAIT = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Icone({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...TRAIT}>
      {children}
    </svg>
  );
}

interface Entree {
  ecran: Ecran;
  libelle: string;
  icone: ReactNode;
}

const PRINCIPAL: Entree[] = [
  { ecran: "accueil", libelle: "Accueil", icone: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></> },
  {
    ecran: "patients",
    libelle: "Patients",
    icone: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
        <path d="M18 14.8c2 .6 3.2 2.4 3.5 5.2" />
      </>
    ),
  },
  {
    ecran: "seances",
    libelle: "Séances",
    icone: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M9 15l2 2 4-4" />
      </>
    ),
  },
  {
    ecran: "facturation",
    libelle: "Facturation",
    icone: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /></>,
  },
  {
    ecran: "statistiques",
    libelle: "Statistiques",
    icone: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  },
];

const OUTILS: Entree[] = [
  {
    ecran: "trames",
    libelle: "Trames",
    icone: <><path d="M5 4h14v16H5z" /><path d="M9 9l-2 2 2 2" /><path d="M13 9h4" /><path d="M13 13h4" /></>,
  },
  {
    ecran: "parametres",
    libelle: "Paramètres",
    icone: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3" />
        <path d="M12 19v3" />
        <path d="M2 12h3" />
        <path d="M19 12h3" />
        <path d="M4.9 4.9l2.1 2.1" />
        <path d="M17 17l2.1 2.1" />
        <path d="M4.9 19.1L7 17" />
        <path d="M17 7l2.1-2.1" />
      </>
    ),
  },
];

interface Props {
  courant: Ecran;
  seancesAFacturer: number;
  /** Faux dans le navigateur : les données sont fictives et rien n'est enregistré. */
  donneesReelles: boolean;
}

export function BarreLaterale({ courant, seancesAFacturer, donneesReelles }: Props) {
  const lien = ({ ecran, libelle, icone }: Entree) => (
    <a
      key={ecran}
      href={`#/${ecran}`}
      className="menu-lien"
      aria-current={courant === ecran ? "page" : undefined}
    >
      <Icone>{icone}</Icone>
      {libelle}
      {ecran === "seances" && seancesAFacturer > 0 && (
        <span className="pastille-alerte">{seancesAFacturer} à facturer</span>
      )}
    </a>
  );

  return (
    <nav className="barre" aria-label="Navigation principale">
      <Marque />
      <div className="menu">{PRINCIPAL.map(lien)}</div>
      <div className="separateur" />
      <div className="menu">{OUTILS.map(lien)}</div>
      <div className="etat-sauvegarde">
        <span className="point" data-etat={donneesReelles ? "ok" : "demo"} />
        <span>{donneesReelles ? "Cabinet chiffré sur cet ordinateur" : "Démonstration\u00a0: rien n’est enregistré"}</span>
      </div>
    </nav>
  );
}
