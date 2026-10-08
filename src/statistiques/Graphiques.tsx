import { useEffect, useRef, useState, type ReactNode } from "react";

/** Mois en abrégé, pour les axes. */
export const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Graduations rondes : 0, 1 000, 2 000… ; `pasMinimum` à 1 pour compter des séances ou des patients. */
export function graduations(maximum: number, nombre = 4, pasMinimum = 0): number[] {
  if (maximum <= 0) return [0, 1];
  const brut = maximum / (nombre + 1);
  const puissance = 10 ** Math.floor(Math.log10(brut));
  // Le plus petit pas rond qui tient en `nombre + 1` intervalles au plus.
  const pas = Math.max(pasMinimum, [1, 2, 2.5, 5, 10, 20].map((f) => f * puissance).find((p) => Math.ceil(maximum / p) <= nombre + 1) ?? brut);
  const fin = Math.ceil(maximum / pas) * pas;
  const valeurs: number[] = [];
  for (let v = 0; v <= fin + pas / 2; v += pas) valeurs.push(Math.round(v * 100) / 100);
  return valeurs;
}

/** Largeur du conteneur, suivie au redimensionnement de la fenêtre. */
function useLargeur(defaut: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(defaut);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observateur = new ResizeObserver(([entree]) => setLargeur(Math.max(320, Math.floor(entree.contentRect.width))));
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);
  return { ref, largeur };
}

/** Colonne à l'extrémité arrondie (4 px), carrée sur la ligne de base. */
function colonne(x: number, y: number, largeur: number, hauteur: number): string {
  if (hauteur <= 0) return "";
  const r = Math.min(4, largeur / 2, hauteur);
  return `M${x},${y + hauteur}V${y + r}Q${x},${y} ${x + r},${y}H${x + largeur - r}Q${x + largeur},${y} ${x + largeur},${y + r}V${y + hauteur}Z`;
}

export interface Serie {
  cle: string;
  libelle: string;
  valeurs: number[];
}

/**
 * Colonnes groupées : une catégorie par groupe (un mois), une colonne par série. Chaque groupe est
 * une cible de survol et de focus clavier qui montre toutes les séries.
 */
export function ColonnesGroupees({
  categories,
  series,
  format,
  formatAxe,
  description,
  entiers = false,
}: {
  categories: { cle: string; libelle: string; detail: string }[];
  series: Serie[];
  format: (v: number) => string;
  formatAxe: (v: number) => string;
  description: string;
  /** Des nombres entiers (séances, patients) : pas de graduation à 0,5. */
  entiers?: boolean;
}) {
  const { ref, largeur } = useLargeur(720);
  const [survol, setSurvol] = useState<number | null>(null);
  const hauteur = 240;
  const marge = { haut: 12, droite: 8, bas: 28, gauche: 64 };
  const graduation = graduations(Math.max(0, ...series.flatMap((s) => s.valeurs)), 4, entiers ? 1 : 0);
  const maximum = graduation[graduation.length - 1] || 1;
  const largeurUtile = largeur - marge.gauche - marge.droite;
  const hauteurUtile = hauteur - marge.haut - marge.bas;
  const bande = largeurUtile / Math.max(1, categories.length);
  const epaisseur = Math.max(4, Math.min(24, (bande - 12) / series.length - 2));
  const groupe = epaisseur * series.length + 2 * (series.length - 1);
  const y = (v: number) => marge.haut + hauteurUtile - (Math.max(0, v) / maximum) * hauteurUtile;
  const pasEtiquettes = Math.ceil(categories.length / Math.max(1, Math.floor(largeurUtile / 56)));

  return (
    <div className="graphique" ref={ref}>
      <svg width={largeur} height={hauteur} role="img" aria-label={description}>
        {graduation.map((g) => (
          <g key={g}>
            <line x1={marge.gauche} x2={largeur - marge.droite} y1={y(g)} y2={y(g)} className={g === 0 ? "axe-base" : "grille"} />
            <text x={marge.gauche - 8} y={y(g)} className="graduation" textAnchor="end" dominantBaseline="middle">
              {formatAxe(g)}
            </text>
          </g>
        ))}
        {categories.map((c, i) => {
          const x0 = marge.gauche + i * bande + (bande - groupe) / 2;
          return (
            <g key={c.cle} data-survol={survol === i || undefined}>
              {series.map((s, rang) => {
                const v = s.valeurs[i] ?? 0;
                return <path key={s.cle} className="colonne" data-serie={s.cle} d={colonne(x0 + rang * (epaisseur + 2), y(v), epaisseur, y(0) - y(v))} />;
              })}
              {i % pasEtiquettes === 0 && (
                <text x={marge.gauche + i * bande + bande / 2} y={hauteur - 8} className="graduation" textAnchor="middle">
                  {c.libelle}
                </text>
              )}
              <rect
                className="cible"
                x={marge.gauche + i * bande}
                y={marge.haut}
                width={bande}
                height={hauteurUtile}
                tabIndex={0}
                aria-label={`${c.detail} : ${series.map((s) => `${s.libelle} ${format(s.valeurs[i] ?? 0)}`).join(", ")}`}
                onPointerEnter={() => setSurvol(i)}
                onPointerLeave={() => setSurvol(null)}
                onFocus={() => setSurvol(i)}
                onBlur={() => setSurvol(null)}
              />
            </g>
          );
        })}
      </svg>
      {survol !== null && (
        <div
          className="infobulle"
          role="status"
          style={{ left: Math.min(largeur - 180, Math.max(0, marge.gauche + survol * bande + bande / 2 - 90)), top: 4 }}
        >
          <span className="infobulle-titre">{categories[survol].detail}</span>
          {series.map((s) => (
            <span key={s.cle} className="infobulle-ligne">
              <span className="cle-ligne" data-serie={s.cle} aria-hidden="true" />
              <strong>{format(s.valeurs[survol] ?? 0)}</strong>
              <span className="discret">{s.libelle}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Barres horizontales d'une seule série, valeur au bout de chaque barre. */
export function BarresHorizontales({ lignes, format = String }: { lignes: { libelle: string; valeur: number }[]; format?: (v: number) => string }) {
  const maximum = Math.max(1, ...lignes.map((l) => l.valeur));
  return (
    <ul className="barres-horizontales">
      {lignes.map((l) => (
        <li key={l.libelle} title={`${l.libelle} : ${format(l.valeur)}`}>
          <span className="barre-libelle">{l.libelle}</span>
          <span className="barre-piste">
            <span className="barre-valeur" style={{ width: `${(l.valeur / maximum) * 100}%` }} />
          </span>
          <strong className="barre-nombre">{format(l.valeur)}</strong>
        </li>
      ))}
    </ul>
  );
}

export interface Part {
  cle: string;
  libelle: string;
  valeur: number;
  detail?: string;
}

/** Une barre empilée à 100 % et sa légende chiffrée : chaque part a sa couleur et son libellé. */
export function Repartition({ parts, famille, description, legende }: { parts: Part[]; famille: string; description: string; legende?: (p: Part, pourcent: number) => ReactNode }) {
  const total = parts.reduce((t, p) => t + p.valeur, 0);
  const pourcent = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return (
    <div className="repartition">
      <div className="barre-repartition" role="img" aria-label={`${description} : ${parts.map((p) => `${p.libelle} ${pourcent(p.valeur)} %`).join(", ")}`}>
        {parts
          .filter((p) => p.valeur > 0)
          .map((p) => (
            <span
              key={p.cle}
              className="segment-repartition"
              data-famille={famille}
              data-part={p.cle}
              style={{ flexGrow: p.valeur }}
              title={`${p.libelle} : ${p.detail ?? p.valeur} · ${pourcent(p.valeur)} %`}
            >
              {pourcent(p.valeur) >= 12 && <span className="segment-texte">{pourcent(p.valeur)} %</span>}
            </span>
          ))}
      </div>
      <ul className="legende-repartition">
        {parts.map((p) => (
          <li key={p.cle}>
            <span className="pastille-part" data-famille={famille} data-part={p.cle} aria-hidden="true" />
            {legende ? legende(p, pourcent(p.valeur)) : `${p.libelle} · ${pourcent(p.valeur)} %`}
          </li>
        ))}
      </ul>
    </div>
  );
}

const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Le créneau nettement le plus chargé : « le mardi à 10 h » ; `null` sans séance ou à égalité. */
export function creneauLePlusCharge(creneaux: number[][]): { jour: string; heure: number; nombre: number } | null {
  const cases = creneaux.flatMap((heures, j) => heures.map((nombre, heure) => ({ jour: JOURS_SEMAINE[j].toLocaleLowerCase("fr"), heure, nombre })));
  const maximum = Math.max(0, ...cases.map((c) => c.nombre));
  const premiers = cases.filter((c) => c.nombre === maximum);
  return maximum > 0 && premiers.length === 1 ? premiers[0] : null;
}

/**
 * Les séances par jour et par heure de début, en tableau : chaque case est teintée selon son nombre
 * (le nombre reste écrit), avec les totaux par jour et par heure. Le dimanche n'apparaît que s'il
 * est travaillé ; les heures vont de la première à la dernière occupée.
 */
export function GrilleCreneaux({ creneaux, description }: { creneaux: number[][]; description: string }) {
  const occupees = creneaux.flatMap((heures) => heures.flatMap((n, h) => (n > 0 ? [h] : [])));
  if (occupees.length === 0) return <p className="discret">Aucune séance sur cette période.</p>;
  const premiere = Math.min(...occupees);
  const derniere = Math.max(...occupees);
  const heures = Array.from({ length: derniere - premiere + 1 }, (_, i) => premiere + i);
  const jours = JOURS_SEMAINE.map((libelle, j) => ({ libelle, valeurs: creneaux[j] ?? [] })).filter((j, rang) => rang < 6 || j.valeurs.some((n) => n > 0));
  const maximum = Math.max(1, ...creneaux.flat());
  const teinte = (n: number) => {
    if (n === 0) return undefined;
    const part = n / maximum;
    return { background: `rgba(42, 120, 214, ${(0.12 + 0.88 * part).toFixed(3)})`, color: part > 0.5 ? "#ffffff" : undefined };
  };
  return (
    <div className="defilement-horizontal">
      <table className="grille-creneaux">
        <caption className="visuellement-cache">{description}</caption>
        <thead>
          <tr>
            <td />
            {heures.map((h) => (
              <th key={h} scope="col">
                {h} h
              </th>
            ))}
            <th scope="col" className="total-creneaux">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {jours.map((j) => (
            <tr key={j.libelle}>
              <th scope="row">{j.libelle}</th>
              {heures.map((h) => {
                const n = j.valeurs[h] ?? 0;
                return (
                  <td key={h} style={teinte(n)} title={`${j.libelle} à ${h} h : ${n} séance${n > 1 ? "s" : ""}`}>
                    {n > 0 ? n : <span className="visuellement-cache">0</span>}
                  </td>
                );
              })}
              <td className="total-creneaux">{j.valeurs.reduce((t, n) => t + n, 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {heures.map((h) => (
              <td key={h}>{creneaux.reduce((t, jour) => t + (jour[h] ?? 0), 0)}</td>
            ))}
            <td className="total-creneaux">{occupees.length ? creneaux.flat().reduce((t, n) => t + n, 0) : 0}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
