import { describe, expect, it } from "vitest";

import modelesFournis from "../../crates/osteosphere-core/src/modeles_fournis.json";
import { completerChamp, type Champ, type Modele } from "./coeur";
import { descriptionChamp, identifiantDepuis, modelePropose, nouveauChamp, resumeProposition } from "./modeles";

const MODELES: Modele[] = modelesFournis.map((m, rang) => ({
  ...m,
  definition: { champs: m.definition.champs.map((c) => completerChamp(c as Champ)) },
  id: `m${rang}`,
  origine: "fourni",
  version: 1,
  version_le: 0,
}));
const AUJOURDHUI = new Date(2026, 9, 7);

describe("modèles de consultation", () => {
  it("propose le modèle selon l'âge du patient, sinon le modèle par défaut", () => {
    expect(modelePropose(MODELES, "2025-12-01", AUJOURDHUI)?.nom).toBe("Nourrisson");
    expect(modelePropose(MODELES, "1988-03-14", AUJOURDHUI)?.nom).toBe("Adulte");
    // 12 ans : aucune tranche, le modèle par défaut.
    expect(modelePropose(MODELES, "2014-09-20", AUJOURDHUI)?.nom).toBe("Adulte");
    expect(modelePropose(MODELES, null, AUJOURDHUI)?.nom).toBe("Adulte");
    const sansNourrisson = MODELES.map((m) => (m.nom === "Nourrisson" ? { ...m, actif: false } : m));
    expect(modelePropose(sansNourrisson, "2025-12-01", AUJOURDHUI)?.nom).toBe("Adulte");
  });

  it("décrit les tranches d'âge et les champs comme la maquette", () => {
    expect(MODELES.map(resumeProposition)).toEqual(["18 ans et plus", "Choisi à la main", "Moins de 2 ans", "Choisi à la main", "Choisi à la main"]);
    expect(resumeProposition({ age_min: 2, age_max: 18 })).toBe("De 2 à 17 ans");
    const [mesures, douleur, motif] = MODELES[0].definition.champs;
    expect([descriptionChamp(mesures), descriptionChamp(douleur), descriptionChamp(motif)]).toEqual(["Calculé", "Curseur de 0 à 10", "Texte enrichi · trames"]);
  });

  it("tire un identifiant unique du libellé", () => {
    const champs = MODELES[0].definition.champs;
    expect(identifiantDepuis("Qualité du sommeil", champs)).toBe("qualite_du_sommeil");
    expect(identifiantDepuis("Motif", champs)).toBe("motif_2");
    expect(nouveauChamp("liste", champs).options).toEqual(["Choix 1", "Choix 2"]);
    expect(nouveauChamp("curseur", champs)).toMatchObject({ min: 0, max: 10, pas: 1, visible: true });
  });
});
