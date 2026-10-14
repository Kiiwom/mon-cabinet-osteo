/**
 * Complétion du code postal et de la ville, d'après la base officielle des codes postaux de
 * La Poste et les noms officiels des communes (Licence Ouverte, voir `outils/codes_postaux.py`).
 * Le fichier n'est chargé qu'à la première saisie d'une adresse.
 */

export interface Commune {
  code_postal: string;
  nom: string;
  /** Commune nouvelle dont celle-ci est une commune déléguée. */
  rattachee: string | null;
}

export interface IndexCommunes {
  parCode: Map<string, Commune[]>;
  toutes: { commune: Commune; plie: string }[];
}

/** Sans accents, tirets ni apostrophes ; « St » et « Ste » valent « Saint » et « Sainte ». */
export function plierCommune(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[-'’]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((mot) => (mot === "st" ? "saint" : mot === "ste" ? "sainte" : mot))
    .join(" ");
}

/** Une ligne par code postal : le code puis ses communes, les déléguées sous la forme « Ancienne|Nouvelle ». */
export function indexerCommunes(texte: string): IndexCommunes {
  const parCode = new Map<string, Commune[]>();
  const toutes: IndexCommunes["toutes"] = [];
  for (const ligne of texte.split("\n")) {
    const [code_postal, ...noms] = ligne.split("\t");
    if (!code_postal || noms.length === 0) continue;
    const communes = noms.map((n): Commune => {
      const [nom, rattachee = null] = n.split("|");
      return { code_postal, nom, rattachee };
    });
    parCode.set(code_postal, communes);
    for (const commune of communes) toutes.push({ commune, plie: plierCommune(commune.nom) });
  }
  return { parCode, toutes };
}

let chargement: Promise<IndexCommunes> | null = null;

export function chargerCommunes(): Promise<IndexCommunes> {
  chargement ??= import("../donnees/codes-postaux.tsv?raw").then((m) => indexerCommunes(m.default));
  return chargement;
}

export function communesDuCode(index: IndexCommunes, codePostal: string): Commune[] {
  return index.parCode.get(codePostal.replace(/\s/g, "")) ?? [];
}

/**
 * Communes dont le nom commence par le texte tapé, ou dont un mot commence par lui : le nom exact
 * d'abord, puis celles du département préféré (celui du cabinet), puis les noms les plus courts.
 */
export function chercherCommunes(index: IndexCommunes, texte: string, departement = "", limite = 8): Commune[] {
  const cherche = plierCommune(texte);
  if (cherche.length < 2) return [];
  const trouvees: { commune: Commune; rang: number }[] = [];
  for (const { commune, plie } of index.toutes) {
    const rang = plie === cherche ? 0 : plie.startsWith(cherche) ? 1 : plie.includes(` ${cherche}`) ? 2 : -1;
    if (rang >= 0) trouvees.push({ commune, rang });
  }
  const dep = (c: Commune) => (departement && c.code_postal.startsWith(departement) ? 0 : 1);
  trouvees.sort(
    (a, b) =>
      a.rang - b.rang ||
      dep(a.commune) - dep(b.commune) ||
      Number(a.commune.rattachee !== null) - Number(b.commune.rattachee !== null) ||
      a.commune.nom.length - b.commune.nom.length ||
      a.commune.nom.localeCompare(b.commune.nom, "fr") ||
      a.commune.code_postal.localeCompare(b.commune.code_postal),
  );
  return trouvees.slice(0, limite).map((t) => t.commune);
}

/** Le début du code postal qui désigne le département, pour classer les communes : « 47 », « 971 » outre-mer. */
export function departementDe(codePostal: string): string {
  const cp = codePostal.replace(/\s/g, "");
  if (!/^\d{5}$/.test(cp)) return "";
  return cp.startsWith("97") || cp.startsWith("98") ? cp.slice(0, 3) : cp.slice(0, 2);
}
