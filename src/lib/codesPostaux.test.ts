import { chargerCommunes, chercherCommunes, communesDuCode, departementDe, indexerCommunes, plierCommune } from "./codesPostaux";

describe("codes postaux", () => {
  it("plie les noms : accents, tirets, apostrophes et « St »", () => {
    expect(plierCommune("Saint-Étienne-de-Villeréal")).toBe("saint etienne de villereal");
    expect(plierCommune("St Front sur Lémance")).toBe("saint front sur lemance");
    expect(plierCommune("L'Abergement")).toBe("l abergement");
  });

  it("lit une ligne par code, avec les communes déléguées", () => {
    const index = indexerCommunes("01300\tBelley\tSaint-Bois|Arboys en Bugey\n47150\tLacapelle-Biron\n");
    expect(communesDuCode(index, "01 300")).toEqual([
      { code_postal: "01300", nom: "Belley", rattachee: null },
      { code_postal: "01300", nom: "Saint-Bois", rattachee: "Arboys en Bugey" },
    ]);
    expect(communesDuCode(index, "99999")).toEqual([]);
  });

  it("trouve les communes de la base officielle, celles du département du cabinet d'abord", async () => {
    const index = await chargerCommunes();
    expect(communesDuCode(index, "47150").map((c) => c.nom)).toContain("Lacapelle-Biron");
    expect(communesDuCode(index, "75011").map((c) => c.nom)).toEqual(["Paris"]);
    expect(chercherCommunes(index, "lacapelle bi")[0]).toEqual({ code_postal: "47150", nom: "Lacapelle-Biron", rattachee: null });
    expect(chercherCommunes(index, "st front sur lem")[0]).toMatchObject({ code_postal: "47500", nom: "Saint-Front-sur-Lémance" });
    expect(chercherCommunes(index, "villeneuve sur", "47")[0]).toMatchObject({ code_postal: "47300", nom: "Villeneuve-sur-Lot" });
    expect(chercherCommunes(index, "f")).toEqual([]);
  });

  it("donne le département d'un code postal", () => {
    expect(departementDe("47150")).toBe("47");
    expect(departementDe("97 200")).toBe("972");
    expect(departementDe("4715")).toBe("");
  });
});
