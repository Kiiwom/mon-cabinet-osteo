import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { Antecedent, CategorieAntecedents } from "../lib/coeur";
import { anneesDepuisDate, dateCourte, enAnnees, MOIS_COURTS } from "../lib/dates";
import { apparence, apparenceCategorie, intitule, libelleCategorie, periode, type Forme } from "./apparence";

type Periode = "vie" | "5ans" | "12mois";

const PERIODES: { valeur: Periode; libelle: string }[] = [
  { valeur: "vie", libelle: "Vie entière" },
  { valeur: "5ans", libelle: "5 ans" },
  { valeur: "12mois", libelle: "12 mois" },
];

const MARGE = 16;
const HAUTEUR_PASTILLE = 22;
const ECART_RANGEES = 30;
const RANGEES_MAX = 4;

let contexteMesure: CanvasRenderingContext2D | null | undefined;

/** Largeur du texte à 12 px : mesurée quand le navigateur le permet, estimée sinon. */
function largeurTexte(texte: string): number {
  if (contexteMesure === undefined) {
    try {
      contexteMesure = document.createElement("canvas").getContext("2d");
      if (contexteMesure) contexteMesure.font = '500 12px "Figtree Variable", system-ui, sans-serif';
    } catch {
      contexteMesure = null;
    }
  }
  return contexteMesure ? contexteMesure.measureText(texte).width : texte.length * 6.6;
}

function Marque({ forme, x, y, couleur }: { forme: Forme; x: number; y: number; couleur: string }) {
  const r = 6;
  switch (forme) {
    case "losange":
      return <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z`} fill={couleur} stroke="#ffffff" strokeWidth={2} />;
    case "carre":
      return <rect x={x - r + 0.5} y={y - r + 0.5} width={2 * r - 1} height={2 * r - 1} rx={2} fill={couleur} stroke="#ffffff" strokeWidth={2} />;
    case "triangle":
      return <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y + r}L${x - r - 1} ${y + r}Z`} fill={couleur} stroke="#ffffff" strokeWidth={2} />;
    case "anneau":
      return <circle cx={x} cy={y} r={r - 1} fill="#ffffff" stroke={couleur} strokeWidth={3} />;
    default:
      return <circle cx={x} cy={y} r={r} fill={couleur} stroke="#ffffff" strokeWidth={2} />;
  }
}

function MarqueLegende({ forme, couleur }: { forme: Forme; couleur: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <Marque forme={forme} x={8} y={8} couleur={couleur} />
    </svg>
  );
}

interface Graduation {
  x: number;
  libelle: string;
}

function graduations(debut: number, fin: number, echelle: (a: number) => number, mode: Periode): Graduation[] {
  if (mode === "12mois") {
    const liste: Graduation[] = [];
    const premier = Math.ceil(debut * 12);
    for (let m = premier; m <= fin * 12; m += 2) {
      const annee = Math.floor(m / 12);
      const mois = m - annee * 12;
      liste.push({ x: echelle(m / 12), libelle: mois === 0 || liste.length === 0 ? `${MOIS_COURTS[mois]} ${annee}` : MOIS_COURTS[mois] });
    }
    return liste;
  }
  const pas = [1, 2, 5, 10, 20, 25, 50].find((p) => (fin - debut) / p <= 6) ?? 50;
  const liste: Graduation[] = mode === "vie" ? [{ x: echelle(debut), libelle: String(Math.floor(debut)) }] : [];
  for (let a = Math.ceil(debut / pas) * pas; a <= fin; a += pas) {
    const x = echelle(a);
    // L'année de naissance reste à gauche ; une graduation trop proche d'elle s'efface.
    if (liste.every((g) => Math.abs(g.x - x) > 72)) liste.push({ x, libelle: String(a) });
  }
  return liste;
}

/** « 9 séances de 2023 à 2026 », « 2 séances en 2026 », « 1 séance en 2026 » */
export function resumeSeances(seances: string[]): string {
  const annees = seances.map((s) => s.slice(0, 4)).sort();
  const [premiere, derniere] = [annees[0], annees[annees.length - 1]];
  const nombre = `${seances.length} séance${seances.length > 1 ? "s" : ""}`;
  return premiere === derniere ? `${nombre} en ${premiere}` : `${nombre} de ${premiere} à ${derniere}`;
}

/**
 * Frise de vie : antécédents datés au-dessus de l'axe, traitements en cours et périodes en bandes,
 * séances en traits sous l'axe, antécédents non datés en tête.
 */
export function FriseDeVie({
  naissance,
  antecedents,
  formulaire,
  seances = [],
  aujourdhui = new Date(),
  actions,
}: {
  naissance: string | null;
  antecedents: Antecedent[];
  formulaire: CategorieAntecedents[];
  seances?: string[];
  aujourdhui?: Date;
  /** Boutons ajoutés à l'en-tête : replier la frise… */
  actions?: ReactNode;
}) {
  const id = useId();
  const conteneur = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(900);
  const [mode, setMode] = useState<Periode>("vie");

  useEffect(() => {
    const element = conteneur.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observateur = new ResizeObserver(([entree]) => setLargeur(Math.max(320, Math.floor(entree.contentRect.width))));
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);

  const maintenant = anneesDepuisDate(aujourdhui);
  const dates = antecedents.filter((a) => a.debut);
  const nonDates = antecedents.filter((a) => !a.debut);
  const plusAncien = Math.min(...dates.map((a) => Math.floor(enAnnees(a.debut!))), ...seances.map((s) => enAnnees(s)), maintenant - 10);
  const debut = mode === "vie" ? (naissance ? enAnnees(naissance) : Math.floor(plusAncien)) : mode === "5ans" ? maintenant - 5 : maintenant - 1;
  const fin = maintenant;
  const utile = largeur - 2 * MARGE;
  const echelle = (a: number) => MARGE + ((a - debut) / Math.max(fin - debut, 0.01)) * utile;
  const visible = (a: number) => a >= debut - 0.001 && a <= fin + 0.001;

  const { pastilles, rangees } = (() => {
    const ponctuels = dates
      .filter((a) => !a.en_cours && !a.fin && visible(enAnnees(a.debut!)))
      .map((a) => {
        const x = echelle(enAnnees(a.debut!));
        const texte = `${a.debut!.slice(0, 4)} · ${intitule(a)}`;
        const l = Math.min(largeurTexte(texte) + 16, utile);
        return { a, x, texte, l, gauche: Math.min(Math.max(x - l / 2, MARGE), MARGE + utile - l), rangee: 0 };
      })
      .sort((p, q) => p.x - q.x);
    const finDeRangee: number[] = [];
    for (const p of ponctuels) {
      let rangee = finDeRangee.findIndex((finR) => finR + 8 <= p.gauche);
      if (rangee === -1) rangee = finDeRangee.length < RANGEES_MAX ? finDeRangee.length : finDeRangee.indexOf(Math.min(...finDeRangee));
      finDeRangee[rangee] = p.gauche + p.l;
      p.rangee = rangee;
    }
    return { pastilles: ponctuels, rangees: Math.max(finDeRangee.length, 1) };
  })();

  const durables = dates.filter((a) => a.en_cours || a.fin);
  const seancesVisibles = seances.filter((s) => visible(enAnnees(s)));
  const axe = 16 + rangees * ECART_RANGEES + 20;
  const hauteur = axe + 34 + durables.length * 20 + (seancesVisibles.length ? 22 : 0);
  const reperes = graduations(debut, fin, echelle, mode);
  const categoriesPresentes = formulaire.filter((c) => antecedents.some((a) => a.categorie === c.cle));
  const resume = [
    `${dates.length} antécédent${dates.length > 1 ? "s" : ""} daté${dates.length > 1 ? "s" : ""}`,
    `${seances.length} séance${seances.length > 1 ? "s" : ""}`,
  ].join(", ");

  return (
    <figure className="frise" aria-labelledby={`${id}-titre`}>
      <div className="entete-carte">
        <h2 id={`${id}-titre`}>Frise de vie</h2>
        <div className="rangee rangee-centree">
          <div className="segments" role="group" aria-label="Période affichée">
            {PERIODES.map((p) => (
              <button key={p.valeur} type="button" aria-pressed={mode === p.valeur} onClick={() => setMode(p.valeur)}>
                {p.libelle}
              </button>
            ))}
          </div>
          {actions}
        </div>
      </div>

      {nonDates.length > 0 && (
        <div className="frise-non-dates">
          <span className="discret">Sans date</span>
          {nonDates.map((a) => {
            const style = apparence(a);
            return (
              <span key={a.id} className="puce" style={{ background: style.fond, color: style.encre }}>
                {a.important && <span aria-hidden="true">⚠</span>} {intitule(a)}
              </span>
            );
          })}
        </div>
      )}

      <div ref={conteneur} className="frise-dessin">
        <svg width={largeur} height={hauteur} role="img" aria-label={`Frise de vie : ${resume}`}>
          <line x1={MARGE} x2={MARGE + utile} y1={axe} y2={axe} stroke="#d9cfc0" strokeWidth={2} strokeLinecap="round" />

          {durables.map((a, rang) => {
            const style = apparence(a);
            const de = Math.max(enAnnees(a.debut!), debut);
            const a_ = a.en_cours ? fin : Math.min(enAnnees(a.fin!), fin);
            if (a_ < debut || de > fin) return null;
            const ligne = axe + 44 + rang * 20;
            return (
              <g key={a.id}>
                <title>{`${intitule(a)} · ${periode(a)}`}</title>
                <rect x={echelle(de)} y={axe - 4} width={Math.max(echelle(a_) - echelle(de), 4)} height={8} rx={4} fill={style.fond} stroke={style.trait} strokeWidth={1} />
                <text x={Math.min(Math.max(echelle(de), MARGE), MARGE + utile - largeurTexte(`${periode(a)} · ${intitule(a)}`) - 14)} y={ligne} className="frise-texte">
                  <tspan fill={style.trait}>■ </tspan>
                  {periode(a)} · {intitule(a)}
                </text>
              </g>
            );
          })}

          {pastilles.map(({ a, x, texte, l, gauche, rangee }) => {
            const style = apparence(a);
            const haut = axe - 30 - rangee * ECART_RANGEES - HAUTEUR_PASTILLE / 2;
            return (
              <g key={a.id}>
                <title>{`${intitule(a)} · ${periode(a)}`}</title>
                <line x1={x} x2={x} y1={haut + HAUTEUR_PASTILLE} y2={axe} stroke={style.trait} strokeWidth={1.5} />
                <rect x={gauche} y={haut} width={l} height={HAUTEUR_PASTILLE} rx={6} fill={style.fond} />
                <text x={gauche + 8} y={haut + 15} className="frise-texte" fill={style.encre}>
                  {texte}
                </text>
                <Marque forme={apparenceCategorie(a.categorie).forme} x={x} y={axe} couleur={style.trait} />
              </g>
            );
          })}

          {seancesVisibles.map((s, rang) => (
            <line key={`${s}-${rang}`} x1={echelle(enAnnees(s))} x2={echelle(enAnnees(s))} y1={axe + 6} y2={axe + 13} stroke="#8f6c1e" strokeWidth={1.5}>
              <title>{`Séance du ${dateCourte(s)}`}</title>
            </line>
          ))}

          {reperes.map((g) => (
            <text key={`${g.x}-${g.libelle}`} x={g.x} y={axe + 28} textAnchor={g.x <= MARGE + 1 ? "start" : "middle"} className="frise-graduation">
              {g.libelle}
            </text>
          ))}

          {seancesVisibles.length > 0 && (
            <text x={MARGE + utile} y={hauteur - 6} textAnchor="end" className="frise-graduation">
              {resumeSeances(seancesVisibles)}
            </text>
          )}
        </svg>
      </div>

      <figcaption className="frise-legende">
        {categoriesPresentes.map((c) => {
          const style = apparenceCategorie(c.cle);
          return (
            <span key={c.cle}>
              <MarqueLegende forme={style.forme} couleur={style.trait} /> {c.libelle}
            </span>
          );
        })}
        {seances.length > 0 && (
          <span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <line x1={8} x2={8} y1={3} y2={13} stroke="#8f6c1e" strokeWidth={2} />
            </svg>{" "}
            Séance
          </span>
        )}
      </figcaption>

      <ul className="lecteur-seulement">
        {antecedents.map((a) => (
          <li key={a.id}>
            {libelleCategorie(formulaire, a.categorie)} : {intitule(a)}
            {periode(a) ? `, ${periode(a)}` : ", sans date"}
            {a.important ? ", important" : ""}
          </li>
        ))}
      </ul>
    </figure>
  );
}
