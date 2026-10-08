import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { creerCoeurDeDemonstration } from "../lib/coeur";
import { remplirEditeur } from "../test/editeur";
import { PageTrames } from "./Trames";

const saisir = (libelle: string, valeur: string) =>
  fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });
const texteTrame = (html: string) => remplirEditeur(screen.getByRole("textbox", { name: "Texte de la trame" }), html);

describe("écran Trames", () => {
  it("liste la bibliothèque de départ et filtre par la recherche", async () => {
    render(<PageTrames coeur={creerCoeurDeDemonstration("ouvert")} />);
    const liste = await screen.findByRole("region", { name: "Mes trames" });
    expect(await within(liste).findByText("Douleur lombaire")).toBeInTheDocument();
    saisir("Rechercher une trame", "@cerv");
    expect(within(liste).queryByText("Douleur lombaire")).not.toBeInTheDocument();
    expect(within(liste).getByText("Cervicalgie")).toBeInTheDocument();
  });

  it("crée une trame avec aperçu, refuse une syntaxe fausse, puis la supprime", async () => {
    render(<PageTrames coeur={creerCoeurDeDemonstration("ouvert")} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Nouvelle trame" }));
    saisir("Titre", "Épaule");
    saisir("Code", "@Epaule");
    await texteTrame("<p>Épaule {droite | gauche</p>");
    expect(screen.getByText(/Groupe de choix non refermé/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Groupe de choix non refermé");

    await texteTrame("<p><strong>Épaule</strong> {droite | gauche}, mobilité [amplitude].</p><ul><li>Repos</li></ul>");
    // L'aperçu garde la mise en forme : gras, pastilles, liste.
    const apercu = document.querySelector(".apercu-trame") as HTMLElement;
    expect(within(apercu).getByText("Épaule").tagName).toBe("STRONG");
    expect(within(apercu).getByText("Repos").closest("li")).not.toBeNull();
    expect(within(apercu).getByText("droite")).toHaveClass("apercu-pastille");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const liste = screen.getByRole("region", { name: "Mes trames" });
    expect(await within(liste).findByText("@epaule")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Modifier @epaule" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer définitivement" }));
    await waitFor(() => expect(within(liste).queryByText("@epaule")).not.toBeInTheDocument());
  });

  it("refuse un code déjà pris", async () => {
    render(<PageTrames coeur={creerCoeurDeDemonstration("ouvert")} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Nouvelle trame" }));
    saisir("Titre", "Autre");
    saisir("Code", "lomb");
    await texteTrame("<p>Texte</p>");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("déjà pris");
  });

  it("change le caractère d'appel des trames", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<PageTrames coeur={coeur} />);
    fireEvent.click(await screen.findByRole("button", { name: "Appel par /" }));
    expect(await screen.findByText(/tapez \/ puis le code/)).toBeInTheDocument();
    expect(await coeur.caractereTrames()).toBe("/");
    expect(screen.getByRole("button", { name: "Appel par /" })).toHaveAttribute("aria-pressed", "true");
  });
});
