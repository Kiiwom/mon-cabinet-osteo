import { describe, expect, it } from "vitest";

import { ageEnClair, dateCourte, dateEnLettres, datePartielleEnLettres, ecrireDateFr, ecrireDatePartielle, enAnnees, lireDateFr, lireDatePartielle, neLe } from "./dates";

const AUJOURDHUI = new Date(2026, 9, 7);

describe("dates à la française", () => {
  it("lit les façons courantes de taper une date", () => {
    expect(lireDateFr("14/03/1988", AUJOURDHUI)).toBe("1988-03-14");
    expect(lireDateFr("14-3-1988", AUJOURDHUI)).toBe("1988-03-14");
    expect(lireDateFr("14031988", AUJOURDHUI)).toBe("1988-03-14");
    expect(lireDateFr("1988-03-14", AUJOURDHUI)).toBe("1988-03-14");
    expect(lireDateFr("14/03/88", AUJOURDHUI)).toBe("1988-03-14");
    expect(lireDateFr("02/06/19", AUJOURDHUI)).toBe("2019-06-02");
    expect(lireDateFr("", AUJOURDHUI)).toBeNull();
    expect(lireDateFr("30/02/1988", AUJOURDHUI)).toBeUndefined();
    expect(lireDateFr("14 mars", AUJOURDHUI)).toBeUndefined();
  });

  it("écrit les dates comme on les lit", () => {
    expect(ecrireDateFr("1988-03-14")).toBe("14/03/1988");
    expect(dateEnLettres("2026-03-01")).toBe("1er mars 2026");
    expect(dateCourte("2026-04-11")).toBe("11 avr. 2026");
    expect(neLe("F", "1988-03-14")).toBe("née le 14 mars 1988");
    expect(neLe("", "1988-03-14")).toBe("né(e) le 14 mars 1988");
  });

  it("dit l'âge comme on le dit d'un patient", () => {
    expect(ageEnClair("1988-03-14", AUJOURDHUI)).toBe("38 ans");
    expect(ageEnClair("1988-10-08", AUJOURDHUI)).toBe("37 ans");
    expect(ageEnClair("2025-04-07", AUJOURDHUI)).toBe("18 mois");
    expect(ageEnClair("2026-09-16", AUJOURDHUI)).toBe("3 semaines");
    expect(ageEnClair("2026-10-05", AUJOURDHUI)).toBe("2 jours");
  });
});

describe("dates partielles des antécédents", () => {
  it("lit l'année seule, le mois ou la date complète", () => {
    expect(lireDatePartielle("2009", AUJOURDHUI)).toBe("2009");
    expect(lireDatePartielle("3/2009", AUJOURDHUI)).toBe("2009-03");
    expect(lireDatePartielle("2009-03", AUJOURDHUI)).toBe("2009-03");
    expect(lireDatePartielle("14/03/2009", AUJOURDHUI)).toBe("2009-03-14");
    expect(lireDatePartielle("", AUJOURDHUI)).toBeNull();
    expect(lireDatePartielle("13/2009", AUJOURDHUI)).toBeUndefined();
    expect(lireDatePartielle("1850", AUJOURDHUI)).toBeUndefined();
    expect(lireDatePartielle("hier", AUJOURDHUI)).toBeUndefined();
  });

  it("l'écrit et la place sur la frise", () => {
    expect(ecrireDatePartielle("2009-03")).toBe("03/2009");
    expect(ecrireDatePartielle("2009-03-14")).toBe("14/03/2009");
    expect(datePartielleEnLettres("2009-03")).toBe("mars 2009");
    expect(enAnnees("2009")).toBe(2009.5);
    expect(enAnnees("2009-01")).toBeCloseTo(2009 + 0.5 / 12);
    expect(enAnnees("2009-01-01")).toBe(2009);
  });
});
