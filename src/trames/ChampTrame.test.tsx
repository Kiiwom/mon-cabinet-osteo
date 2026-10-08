import type { Editor } from "@tiptap/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import depart from "../../crates/osteosphere-core/src/bibliotheque_depart.json";
import { texteDe } from "../lib/seances";
import { ChampTrame } from "./ChampTrame";
import { filtrerTrames } from "./menu";
import { insererTrame, nettoyer, type TrameResume } from "./valider";

const TRAMES: TrameResume[] = depart.map((t, i) => ({ ...t, id: `t${i}` }));
const trame = (code: string) => TRAMES.find((t) => t.code === code)!;

async function champAvec(code: string) {
  let editeur: Editor | null = null;
  const valide = vi.fn();
  render(
    <ChampTrame libelle="Motif de consultation" trames={TRAMES} caractere="@" surEditeur={(e) => (editeur = e)} surValidation={valide} />,
  );
  await waitFor(() => expect(editeur).not.toBeNull());
  const e = editeur as unknown as Editor;
  await act(async () => {
    e.commands.setContent(`<p>@${code}</p>`);
    insererTrame(e, { from: 1, to: 2 + code.length }, trame(code));
  });
  return { editeur: e, valide };
}

describe("trame interactive", () => {
  it("donne le texte du cahier des charges : deux clics, deux saisies, Valider", async () => {
    const { editeur, valide } = await champAvec("lomb");
    expect(screen.getByRole("status")).toHaveTextContent("4 à compléter");

    fireEvent.click(screen.getByRole("button", { name: "droite" }));
    fireEvent.click(screen.getByRole("button", { name: "aiguë" }));
    fireEvent.change(screen.getByLabelText("À compléter : durée"), { target: { value: "3 jours" } });
    fireEvent.change(screen.getByLabelText("À compléter : 0 à 10"), { target: { value: "6" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "droite" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("status")).toHaveTextContent("Tout est complété");

    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(editeur.getText()).toBe("Douleur lombaire droite, aiguë, depuis 3 jours, EVA 6/10.");
    expect(valide).toHaveBeenCalledWith("Douleur lombaire droite, aiguë, depuis 3 jours, EVA 6/10.");
    expect(screen.queryByRole("button", { name: "droite" })).not.toBeInTheDocument();
  });

  it("un choix unique se change, un second clic le retire", async () => {
    await champAvec("lomb");
    fireEvent.click(screen.getByRole("button", { name: "droite" }));
    fireEvent.click(screen.getByRole("button", { name: "gauche" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "gauche" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "droite" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "gauche" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "gauche" })).toHaveAttribute("aria-pressed", "false"));
  });

  it("joint les choix multiples et retire ce qui n'est pas choisi", async () => {
    const { editeur } = await champAvec("post");
    fireEvent.click(screen.getByRole("button", { name: "hydratation" }));
    fireEvent.click(screen.getByRole("button", { name: "pauses régulières" }));
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(editeur.getText()).toBe("Conseils donnés : pauses régulières et hydratation.");
  });

  it("un groupe sans choix disparaît sans laisser d'espace en trop", async () => {
    const { editeur } = await champAvec("revoir");
    fireEvent.change(screen.getByLabelText("À compléter : délai"), { target: { value: "3 semaines" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(editeur.getText()).toBe("À revoir dans 3 semaines.");
  });

  it("Tab passe de pastille en pastille, puis au blanc", async () => {
    await champAvec("lomb");
    await waitFor(() => expect(document.activeElement?.tagName).toBe("BUTTON"));
    expect(document.activeElement).toHaveTextContent("droite");
    const parcours: string[] = [];
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(document.activeElement!, { key: "Tab" });
      const actif = document.activeElement as HTMLElement;
      parcours.push(actif.getAttribute("aria-label") ?? actif.textContent ?? actif.tagName);
    }
    expect(parcours).toEqual(["gauche", "bilatérale", "aiguë", "subaiguë", "chronique", "À compléter : durée"]);
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toHaveTextContent("chronique");
  });
});

describe("menu des trames", () => {
  it("propose d'abord les codes qui commencent par la saisie, sans tenir compte des accents", () => {
    expect(filtrerTrames(TRAMES, "lo").map((t) => t.code)).toEqual(["lomb"]);
    expect(filtrerTrames(TRAMES, "etat").map((t) => t.code)).toEqual(["eg"]);
    expect(filtrerTrames(TRAMES, "").length).toBe(TRAMES.length);
    expect(filtrerTrames(TRAMES, "zzz")).toEqual([]);
  });

  it("nettoie la ponctuation laissée par un choix retiré", () => {
    expect(nettoyer("depuis  3 jours , EVA .")).toBe("depuis 3 jours, EVA.");
    expect(nettoyer("a, , b")).toBe("a, b");
  });
});

describe("raccourci", () => {
  it("Ctrl+Entrée valide comme le bouton", async () => {
    const { editeur, valide } = await champAvec("revoir");
    fireEvent.change(screen.getByLabelText("À compléter : délai"), { target: { value: "2 semaines" } });
    fireEvent.keyDown(editeur.view.dom, { key: "Enter", ctrlKey: true });
    expect(editeur.getText()).toBe("À revoir dans 2 semaines.");
    expect(valide).toHaveBeenCalledWith("À revoir dans 2 semaines.");
  });

  it("Ctrl+Entrée valide aussi depuis un blanc", async () => {
    const { editeur, valide } = await champAvec("revoir");
    const blanc = screen.getByLabelText("À compléter : délai");
    fireEvent.change(blanc, { target: { value: "1 mois" } });
    fireEvent.keyDown(blanc, { key: "Enter", ctrlKey: true });
    expect(editeur.getText()).toBe("À revoir dans 1 mois.");
    expect(valide).toHaveBeenCalledWith("À revoir dans 1 mois.");
  });
});

describe("trame mise en forme", () => {
  const MISE_EN_FORME: TrameResume = {
    id: "mef",
    code: "bilan",
    titre: "Bilan",
    categorie: "Examen",
    modele: "Bilan\nDouleur {droite | gauche}\nRepos [durée]",
    contenu: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Bilan" }] },
        { type: "paragraph", content: [{ type: "text", text: "Douleur ", marks: [{ type: "bold" }] }, { type: "text", text: "{droite | gauche}" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Repos [durée]" }] }] }] },
      ],
    },
  };

  async function inserer(miseEnForme: boolean) {
    let editeur: Editor | null = null;
    render(<ChampTrame libelle="Examen" trames={[MISE_EN_FORME]} caractere="@" miseEnForme={miseEnForme} surEditeur={(e) => (editeur = e)} />);
    await waitFor(() => expect(editeur).not.toBeNull());
    const e = editeur as unknown as Editor;
    await act(async () => {
      e.commands.setContent("<p>@bilan</p>");
      insererTrame(e, { from: 1, to: 7 }, MISE_EN_FORME);
    });
    return e;
  }

  it("garde titres, gras et listes, et la syntaxe devient pastilles et blancs", async () => {
    const editeur = await inserer(true);
    expect(screen.getByRole("button", { name: "droite" })).toBeInTheDocument();
    expect(screen.getByLabelText("À compléter : durée")).toBeInTheDocument();
    const html = editeur.getHTML();
    expect(html).toContain("<h2>Bilan</h2>");
    expect(html).toContain("<strong>Douleur </strong>");
    expect(html).toContain("<ul>");
    fireEvent.click(screen.getByRole("button", { name: "gauche" }));
    fireEvent.change(screen.getByLabelText("À compléter : durée"), { target: { value: "2 jours" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(texteDe(editeur.getJSON())).toBe("Bilan\nDouleur gauche\nRepos 2 jours");
  });

  it("devient du texte simple dans un champ sans mise en forme", async () => {
    const editeur = await inserer(false);
    const html = editeur.getHTML();
    // Titres et listes deviennent des paragraphes ; le gras reste (Ctrl+G y est permis).
    expect(html).not.toContain("<h2>");
    expect(html).not.toContain("<ul>");
    expect(html).toContain("<p>Bilan</p>");
    expect(screen.getByRole("button", { name: "droite" })).toBeInTheDocument();
  });
});
