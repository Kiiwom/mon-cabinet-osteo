import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { creerCoeurDeDemonstration } from "../lib/coeur";
import { PageTrames } from "./Trames";

const saisir = (libelle: string, valeur: string) =>
  fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });

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
    saisir("Texte de la trame", "Épaule {droite | gauche");
    expect(screen.getByText(/Groupe de choix non refermé/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Groupe de choix non refermé");

    saisir("Texte de la trame", "Épaule {droite | gauche}, mobilité [amplitude].");
    expect(screen.getByText("amplitude")).toBeInTheDocument();
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
    saisir("Texte de la trame", "Texte");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("déjà pris");
  });
});

describe("facture d'essai dans le navigateur", () => {
  it("explique qu'il faut la fenêtre de l'application", async () => {
    const { PageFacturation } = await import("./Facturation");
    render(<PageFacturation coeur={creerCoeurDeDemonstration("ouvert")} />);
    fireEvent.click(screen.getByRole("button", { name: "Créer la facture d’essai" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ouvrez Osteosphere dans sa fenêtre");
  });
});
