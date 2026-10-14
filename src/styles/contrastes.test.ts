import css from "./theme.css?raw";

/**
 * Contrastes WCAG 2.2 niveau AA des couleurs du thème, en clair et en sombre, avec chaque couleur
 * d'accent : 4,5:1 pour le texte, 3:1 pour les bordures de champs, le contour de focus et les traits
 * qui portent une information. Une couleur retouchée qui casse un contraste fait échouer ce test.
 */

type Jetons = Record<string, string>;

/** Les variables `--nom: #rrggbb;` du bloc dont le sélecteur est donné exactement. */
function bloc(selecteur: string): Jetons {
  const debut = css.indexOf(`${selecteur} {`);
  if (debut < 0) throw new Error(`bloc introuvable : ${selecteur}`);
  const corps = css.slice(debut, css.indexOf("}", debut));
  return Object.fromEntries([...corps.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

function luminance(hexa: string): number {
  const canaux = [1, 3, 5].map((i) => parseInt(hexa.slice(i, i + 2), 16) / 255);
  const [r, v, b] = canaux.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * v + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [clair, fonce] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (fonce + 0.05);
}

const CLAIR = bloc(':root,\n:root[data-sombre="true"] :is(.pense-bete, .cadre-image)');
const SOMBRE = { ...CLAIR, ...bloc(':root[data-sombre="true"]') };
const ACCENTS = ["sauge", "bleu", "terracotta", "lavande"];

const THEMES: [string, Jetons][] = [
  ["clair, ocre", CLAIR],
  ["sombre, ocre", SOMBRE],
  ...ACCENTS.flatMap((a): [string, Jetons][] => [
    [`clair, ${a}`, { ...CLAIR, ...bloc(`:root[data-accent="${a}"]`) }],
    [`sombre, ${a}`, { ...SOMBRE, ...bloc(`:root[data-sombre="true"][data-accent="${a}"]`) }],
  ]),
];

const FONDS = ["fond", "fond-barre", "fond-carte", "fond-actif"];

/** [texte ou trait, fond, minimum] */
const PAIRES: [string, string, number][] = [
  ...["encre", "encre-2", "encre-discrete"].flatMap((t) => [...FONDS, "fond-discret"].map((f): [string, string, number] => [t, f, 4.5])),
  ["lien", "fond", 4.5],
  ["lien", "fond-carte", 4.5],
  ["lien", "accent-doux", 4.5],
  ["sur-accent", "accent", 4.5],
  ["encre", "accent-doux", 4.5],
  ["encre-discrete", "accent-doux", 4.5],
  ["succes-texte", "succes-fond", 4.5],
  ["alerte-texte", "alerte-fond", 4.5],
  ["avertissement-texte", "alerte-fond", 4.5],
  ["avertissement-texte", "fond-carte", 4.5],
  ["danger-texte", "danger-fond", 4.5],
  ["danger-encre", "fond-carte", 4.5],
  ["danger-encre", "fond", 4.5],
  ["violet-texte", "violet-fond", 4.5],
  ["hausse", "fond-carte", 4.5],
  ["baisse", "fond-carte", 4.5],
  // Éléments d'interface : 3:1.
  ...FONDS.map((f): [string, string, number] => ["bordure-saisie", f, 3]),
  ...["fond", "fond-carte", "fond-barre"].map((f): [string, string, number] => ["accent-fonce", f, 3]),
  ["danger", "fond-carte", 3],
  ["succes", "fond-carte", 3],
];

describe("contrastes WCAG 2.2 AA du thème", () => {
  it.each(THEMES)("%s", (_, jetons) => {
    const echecs = PAIRES.flatMap(([texte, fond, minimum]) => {
      const [a, b] = [jetons[texte], jetons[fond]];
      if (!a || !b) return [`${texte} sur ${fond} : couleur absente`];
      const valeur = contraste(a, b);
      return valeur < minimum ? [`${texte} ${a} sur ${fond} ${b} : ${valeur.toFixed(2)} < ${minimum}`] : [];
    });
    expect(echecs).toEqual([]);
  });

  it("calcule le contraste comme la norme", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contraste("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});
