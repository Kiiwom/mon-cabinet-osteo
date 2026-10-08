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
    saisir("Code", "@Coude");
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
    expect(await within(liste).findByText("@coude")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Modifier @coude" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer définitivement" }));
    await waitFor(() => expect(within(liste).queryByText("@coude")).not.toBeInTheDocument());
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

  it("range les trames par catégorie et insère les variables", async () => {
    render(<PageTrames coeur={creerCoeurDeDemonstration("ouvert")} />);
    const liste = await screen.findByRole("region", { name: "Mes trames" });
    await within(liste).findByText("Douleur lombaire");
    const categories = within(liste).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(categories).toEqual(["Anamnèse", "Examen", "Tests", "Traitement", "Conseils"]);
    expect(within(within(liste).getByRole("list", { name: "Conseils" })).getByText("Revoir")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Nouvelle trame" }));
    await texteTrame("<p>Bonjour </p>");
    fireEvent.click(within(screen.getByRole("group", { name: "Insérer une variable" })).getByRole("button", { name: "{{prénom}}" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Texte de la trame" })).toHaveTextContent("{{prénom}}"));
    const apercu = document.querySelector(".apercu-trame") as HTMLElement;
    // Hors séance, une variable s'affiche comme un blanc à compléter.
    expect(within(apercu).getByText("prénom")).toBeInTheDocument();
  });

  it("importe les trames d'un confrère en gérant les codes déjà pris, et exporte les siennes", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<PageTrames coeur={coeur} />);
    fireEvent.click(await screen.findByRole("button", { name: "Importer…" }));
    const panneau = await screen.findByRole("region", { name: /^Importer «.Trames d’un confrère\.json.»$/ });
    expect(panneau).toHaveTextContent("4 trames dans le fichier : 2 nouvelles, 1 déjà là, 1 dont le code est pris par une autre trame.");
    expect(within(panneau).getByRole("row", { name: /@lomb.*Code déjà pris/ })).toBeInTheDocument();
    expect(within(panneau).getByRole("button", { name: "Importer 2 trames" })).toBeInTheDocument();
    fireEvent.click(within(panneau).getByRole("radio", { name: /Ajouter celle du fichier sous un autre code/ }));
    fireEvent.click(within(panneau).getByRole("button", { name: "Importer 3 trames" }));
    expect(await screen.findByText(/^Import terminé/)).toHaveTextContent("Import terminé : 2 trames ajoutées, 1 ajoutée sous un autre code, 1 déjà là ou gardée.");
    const codes = (await coeur.listerTrames()).map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(["atm", "pied", "lomb-2"]));
    expect(await within(screen.getByRole("region", { name: "Mes trames" })).findByText("@lomb-2")).toBeInTheDocument();

    saisir("Rechercher une trame", "@cerv");
    fireEvent.click(screen.getByRole("button", { name: "Exporter les 1 affichées" }));
    expect(await screen.findByText(/^1 trame exportée : .*Trames Osteosphere/)).toBeInTheDocument();
  });
});
