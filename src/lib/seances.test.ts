import { describe, expect, it } from "vitest";

import { bornes, libellePeriode } from "../pages/Seances";
import { debutMaintenant, document, estVide, evolutionDouleur, imc, jourEnLettres, texteDe } from "./seances";

describe("séances", () => {
  it("lit le texte d'un document avec trames, comme le cœur", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Douleur lombaire " },
            { type: "choix", attrs: { options: ["droite", "gauche"], multiple: false, retenus: ["droite"] } },
            { type: "text", text: ", depuis " },
            { type: "blanc", attrs: { indication: "durée", valeur: "3 jours" } },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "EVA 6/10" }] }] }] },
      ],
    };
    expect(texteDe(doc)).toBe("Douleur lombaire droite, depuis 3 jours\nEVA 6/10");
    expect(texteDe(document("Deux\nlignes"))).toBe("Deux\nlignes");
    expect(estVide(document(""))).toBe(true);
    expect(estVide({ taille: null, poids: null })).toBe(true);
    expect(estVide({ coche: false, precision: "" })).toBe(true);
    expect(estVide(0)).toBe(false);
  });

  it("calcule l'IMC et décrit l'évolution de la douleur", () => {
    expect(imc({ taille: 168, poids: 61 })).toBe(21.6);
    expect(imc({ taille: null, poids: 61 })).toBeNull();
    expect(evolutionDouleur({ douleur_avant: 6, douleur_apres: 2 })).toBe("Douleur 6 → 2");
    expect(evolutionDouleur({ douleur_avant: 6, douleur_apres: null })).toBe("Douleur 6 → ?");
    expect(evolutionDouleur({ douleur_avant: null, douleur_apres: null })).toBe("");
  });

  it("date les séances à la française", () => {
    expect(jourEnLettres("2026-10-06")).toBe("mardi 6 octobre 2026");
    expect(debutMaintenant(new Date(2026, 9, 6, 14, 28, 40))).toBe("2026-10-06T14:30");
  });

  it("borne les périodes de la liste des séances", () => {
    const mardi = new Date(2026, 9, 6);
    const jours = (vue: "jour" | "semaine" | "mois") => bornes(vue, mardi).map((d) => d.getDate());
    expect(jours("jour")).toEqual([6, 6]);
    expect(jours("semaine")).toEqual([5, 11]);
    expect(jours("mois")).toEqual([1, 31]);
    expect(libellePeriode("mois", mardi)).toBe("Octobre 2026");
    expect(libellePeriode("semaine", mardi)).toBe("Semaine du 5 au 11 octobre 2026");
    expect(libellePeriode("semaine", new Date(2026, 9, 1))).toBe("Semaine du 28 septembre au 4 octobre 2026");
  });
});
