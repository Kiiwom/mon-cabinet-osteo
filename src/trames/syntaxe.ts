/**
 * Syntaxe d'une trame, la même que celle vérifiée par le cœur Rust :
 * - `{droite | gauche | bilatérale}` : choix unique, une pastille par option ;
 * - `{+ pauses | étirements | hydratation}` : choix multiple, écrit « pauses, étirements et hydratation » ;
 * - `[durée]` : blanc à compléter, l'indication s'affiche en grisé ;
 * - `\{`, `\}`, `\[`, `\]`, `\|` et `\\` écrivent ces caractères tels quels.
 */

export type Segment =
  | { type: "texte"; texte: string }
  | { type: "choix"; options: string[]; multiple: boolean }
  | { type: "blanc"; indication: string };

export type ResultatAnalyse = { ok: true; segments: Segment[] } | { ok: false; erreur: string; position: number };

const SPECIAUX = new Set(["{", "}", "[", "]", "|", "\\"]);

export function analyserModele(modele: string): ResultatAnalyse {
  const segments: Segment[] = [];
  let texte = "";
  let i = 0;
  const echec = (erreur: string, position: number): ResultatAnalyse => ({ ok: false, erreur, position });
  const pousserTexte = () => {
    if (texte) segments.push({ type: "texte", texte });
    texte = "";
  };

  while (i < modele.length) {
    const c = modele[i];
    if (c === "\\") {
      const suivant = modele[i + 1];
      if (suivant === undefined || !SPECIAUX.has(suivant)) return echec("Barre oblique inverse sans caractère à protéger.", i);
      texte += suivant;
      i += 2;
    } else if (c === "{") {
      pousserTexte();
      const debut = i;
      i += 1;
      let multiple = false;
      if (modele[i] === "+") {
        multiple = true;
        i += 1;
      }
      const options: string[] = [];
      let option = "";
      let ferme = false;
      while (i < modele.length) {
        const d = modele[i];
        if (d === "\\" && modele[i + 1] !== undefined && SPECIAUX.has(modele[i + 1])) {
          option += modele[i + 1];
          i += 2;
        } else if (d === "|" || d === "}") {
          if (!option.trim()) return echec("Option vide dans un groupe de choix.", i);
          options.push(option.trim());
          option = "";
          i += 1;
          if (d === "}") {
            ferme = true;
            break;
          }
        } else if (d === "{" || d === "[" || d === "]") {
          return echec("Un groupe de choix ne peut pas contenir d’autre groupe ni de blanc.", i);
        } else {
          option += d;
          i += 1;
        }
      }
      if (!ferme) return echec("Groupe de choix non refermé : il manque « } ».", debut);
      segments.push({ type: "choix", options, multiple });
    } else if (c === "[") {
      pousserTexte();
      const debut = i;
      const fin = modele.indexOf("]", i + 1);
      if (fin < 0) return echec("Blanc non refermé : il manque « ] ».", debut);
      const indication = modele.slice(i + 1, fin);
      if (/[{}[|]/.test(indication)) return echec("Un blanc ne contient que son indication.", debut);
      segments.push({ type: "blanc", indication: indication.trim() });
      i = fin + 1;
    } else if (c === "}" || c === "]" || c === "|") {
      return echec(`Caractère « ${c} » isolé : écrivez « \\${c} » pour l’afficher.`, i);
    } else {
      texte += c;
      i += 1;
    }
  }
  pousserTexte();
  return { ok: true, segments };
}

const proteger = (texte: string) => texte.replace(/[{}[\]|\\]/g, (c) => `\\${c}`);

export function ecrireModele(segments: Segment[]): string {
  return segments
    .map((s) => {
      if (s.type === "texte") return proteger(s.texte);
      if (s.type === "blanc") return `[${s.indication}]`;
      return `{${s.multiple ? "+ " : ""}${s.options.map(proteger).join(" | ")}}`;
    })
    .join("");
}

/** « a », « a et b », « a, b et c ». */
export function joindreChoix(retenus: string[]): string {
  if (retenus.length <= 1) return retenus[0] ?? "";
  return `${retenus.slice(0, -1).join(", ")} et ${retenus[retenus.length - 1]}`;
}
