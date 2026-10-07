import { fireEvent, render, screen, within } from "@testing-library/react";

import { creerCoeurDeDemonstration } from "../lib/coeur";
import { PageModeles } from "./Modeles";

const saisir = (element: HTMLElement, valeur: string) => fireEvent.change(element, { target: { value: valeur } });

describe("constructeur de modèles", () => {
  it("liste les modèles fournis et règle un champ, avec une nouvelle version à l'enregistrement", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<PageModeles coeur={coeur} />);
    const liste = await screen.findByRole("navigation", { name: "Modèles" });
    expect(within(liste).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Adultepar défaut18 ans et plus · 9 champs",
      "Femme enceinteChoisi à la main · 11 champs",
      "NourrissonMoins de 2 ans · 9 champs",
      "Note libreChoisi à la main · 1 champ",
      "Examen par sphèresdésactivéChoisi à la main · 9 champs",
    ]);

    // Le dessin attend son module : il est signalé dans la liste.
    expect(screen.getByText(/module Schéma corporel, à venir/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Douleur avant la séance" }));
    const reglages = screen.getByRole("region", { name: "Champ sélectionné" });
    expect(within(reglages).getByLabelText("Max.")).toHaveValue("10");
    saisir(within(reglages).getByLabelText("Libellé"), "Douleur à l’arrivée");
    expect(screen.getByRole("button", { name: "Douleur à l’arrivée" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Descendre « Taille, poids et IMC »" }));
    const noms = within(screen.getByRole("list", { name: /Champs du modèle/ }))
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".ligne-champ-nom")?.textContent);
    expect(noms.slice(0, 2)).toEqual(["Douleur à l’arrivée", "Taille, poids et IMC"]);

    fireEvent.click(screen.getByRole("button", { name: "Nombre" }));
    expect(within(screen.getByRole("region", { name: "Champ sélectionné" })).getByLabelText("Libellé")).toHaveValue("Nouveau nombre");
    // Taille, poids et IMC ne figure qu'une fois.
    expect(screen.getByRole("button", { name: "Taille, poids, IMC" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le modèle" }));
    expect(await screen.findByText("Modèle enregistré, version 2")).toBeInTheDocument();
    const adulte = (await coeur.listerModeles())[0];
    expect(adulte.version).toBe(2);
    expect(await coeur.lireVersionModele(adulte.id, 1)).toMatchObject({ champs: expect.arrayContaining([expect.objectContaining({ libelle: "Douleur avant la séance" })]) });
  });

  it("demande avant d'abandonner des modifications, puis crée un nouveau modèle", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<PageModeles coeur={coeur} />);
    await screen.findByRole("navigation", { name: "Modèles" });
    saisir(screen.getByLabelText("Nom du modèle"), "Adulte sportif");
    fireEvent.click(screen.getByRole("button", { name: /^Nourrisson/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Les modifications de « Adulte sportif » ne sont pas enregistrées.");
    fireEvent.click(screen.getByRole("button", { name: "Abandonner les modifications" }));
    expect(screen.getByLabelText("Nom du modèle")).toHaveValue("Nourrisson");

    fireEvent.click(screen.getByRole("button", { name: "Nouveau modèle" }));
    saisir(screen.getByLabelText("Nom du modèle"), "Sportif");
    saisir(screen.getByLabelText("Proposé automatiquement pour"), "autre");
    saisir(screen.getByLabelText("Âge minimum, en années"), "12");
    saisir(screen.getByLabelText("Âge maximum exclu, en années"), "18");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le modèle" }));
    expect(await screen.findByRole("button", { name: /^SportifDe 12 à 17 ans/ })).toBeInTheDocument();
  });
});
