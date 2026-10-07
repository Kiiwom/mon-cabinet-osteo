import type { Editor } from "@tiptap/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import depart from "../../crates/osteosphere-core/src/bibliotheque_depart.json";
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
