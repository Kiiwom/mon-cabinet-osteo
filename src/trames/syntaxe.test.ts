import depart from "../../crates/osteosphere-core/src/bibliotheque_depart.json";
import { analyserModele, ecrireModele, joindreChoix } from "./syntaxe";

describe("syntaxe des trames", () => {
  it("lit choix uniques, choix multiples et blancs", () => {
    const resultat = analyserModele("Douleur {droite | gauche}, conseils {+ pauses | étirements}, depuis [durée].");
    expect(resultat).toEqual({
      ok: true,
      segments: [
        { type: "texte", texte: "Douleur " },
        { type: "choix", options: ["droite", "gauche"], multiple: false },
        { type: "texte", texte: ", conseils " },
        { type: "choix", options: ["pauses", "étirements"], multiple: true },
        { type: "texte", texte: ", depuis " },
        { type: "blanc", indication: "durée" },
        { type: "texte", texte: "." },
      ],
    });
  });

  it("protège les caractères spéciaux et se réécrit à l'identique", () => {
    const modele = "Accolade \\{ et option {a \\| b | c}";
    const resultat = analyserModele(modele);
    expect(resultat.ok && resultat.segments[1]).toEqual({ type: "choix", options: ["a | b", "c"], multiple: false });
    expect(resultat.ok && ecrireModele(resultat.segments)).toBe(modele);
  });

  it("signale les erreurs avec leur position", () => {
    expect(analyserModele("Douleur {droite | gauche")).toMatchObject({ ok: false, position: 8 });
    expect(analyserModele("Douleur {droite || gauche}")).toMatchObject({ ok: false, erreur: "Option vide dans un groupe de choix." });
    expect(analyserModele("depuis [durée")).toMatchObject({ ok: false });
    expect(analyserModele("a } b")).toMatchObject({ ok: false, position: 2 });
    expect(analyserModele("{a | [b]}")).toMatchObject({ ok: false });
  });

  it("joint les choix multiples à la française", () => {
    expect(joindreChoix([])).toBe("");
    expect(joindreChoix(["pauses"])).toBe("pauses");
    expect(joindreChoix(["pauses", "étirements"])).toBe("pauses et étirements");
    expect(joindreChoix(["pauses", "étirements", "hydratation"])).toBe("pauses, étirements et hydratation");
  });

  it("lit les variables, avec ou sans accent, et refuse les inconnues", () => {
    expect(analyserModele("{{Prénom}}, {{age}}, le {{date}}")).toEqual({
      ok: true,
      segments: [
        { type: "variable", nom: "prenom" },
        { type: "texte", texte: ", " },
        { type: "variable", nom: "age" },
        { type: "texte", texte: ", le " },
        { type: "variable", nom: "date" },
      ],
    });
    const lu = analyserModele("{{prenom}} {{âge}}");
    expect(lu.ok && ecrireModele(lu.segments)).toBe("{{prénom}} {{âge}}");
    expect(analyserModele("Bonjour {{surnom}}")).toMatchObject({ ok: false, position: 8 });
    expect(analyserModele("Bonjour {{prénom}")).toMatchObject({ ok: false, erreur: "Variable non refermée : il manque « }} »." });
  });

  it("accepte toute la bibliothèque de départ", () => {
    for (const trame of depart) expect(analyserModele(trame.modele)).toMatchObject({ ok: true });
  });
});
