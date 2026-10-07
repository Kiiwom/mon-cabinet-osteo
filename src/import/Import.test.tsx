import { fireEvent, render, screen, within } from "@testing-library/react";

import { creerCoeurDeDemonstration } from "../lib/coeur";
import { PageParametresImportExport } from "../pages/ParametresSauvegardes";
import { EtatFacturation } from "../seances/ListeSeances";

describe("import MonCabinetLibéral", () => {
  it("vérifie l'archive sans rien écrire, puis importe et donne le rapport", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    const avant = (await coeur.listerPatients()).length;
    render(<PageParametresImportExport coeur={coeur} />);
    const region = screen.getByRole("region", { name: "Import depuis MonCabinetLibéral" });
    expect(within(region).getByRole("listitem", { current: "step" })).toHaveTextContent("Fichier");

    fireEvent.click(within(region).getByRole("button", { name: "Choisir l’export…" }));
    expect(await within(region).findByRole("heading", { name: "export-mcl.zip" })).toBeInTheDocument();
    expect(within(region).getByRole("listitem", { current: "step" })).toHaveTextContent("Vérification");
    expect(within(region).getByRole("checkbox", { name: /^3 patients/ })).toBeChecked();
    expect(within(region).getByRole("checkbox", { name: /^28 séances/ })).toBeChecked();
    expect(within(region).getByText("La numérotation reprendra après la facture 2026-10-1771.")).toBeInTheDocument();
    expect(within(region).getByRole("table")).toHaveTextContent("Girard Thomas");
    // Rien n'est écrit avant d'avoir cliqué sur « Importer les données ».
    expect(await coeur.listerPatients()).toHaveLength(avant);

    fireEvent.click(within(region).getByRole("button", { name: "Importer les données" }));
    expect(await within(region).findByRole("heading", { name: "Import terminé" })).toBeInTheDocument();
    const patients = within(region).getByRole("row", { name: /^Patients/ });
    expect(within(patients).getAllByRole("cell").map((c) => c.textContent)).toEqual(["3", "0", "0"]);
    expect(within(region).getByText(/^Sauvegarde faite juste avant l’import/)).toBeInTheDocument();
    expect((await coeur.listerPatients()).map((p) => p.nom)).toEqual(expect.arrayContaining(["Girard", "Lemaire", "Haddad"]));

    // Un second import ne recopie rien.
    fireEvent.click(within(region).getByRole("button", { name: "Importer un autre fichier" }));
    fireEvent.click(within(region).getByRole("button", { name: "Choisir l’export…" }));
    expect(await within(region).findByText(/sont déjà dans Osteosphere : ils ne seront pas recopiés/)).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Importer les données" }));
    await within(region).findByRole("heading", { name: "Import terminé" });
    expect(within(within(region).getByRole("row", { name: /^Patients/ })).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0", "3", "0"]);
    expect(await coeur.listerPatients()).toHaveLength(avant + 3);
  });

  it("n'importe rien sans case cochée", async () => {
    render(<PageParametresImportExport coeur={creerCoeurDeDemonstration("ouvert")} />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir l’export…" }));
    await screen.findByRole("heading", { name: "export-mcl.zip" });
    for (const nom of [/^3 patients/, /^9 antécédents/, /^28 séances/, /^27 factures/]) fireEvent.click(screen.getByRole("checkbox", { name: nom }));
    expect(screen.getByRole("button", { name: "Importer les données" })).toBeDisabled();
  });

  it("signale une archive illisible sans changer d'étape", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    coeur.choisirFichier = async () => "C:\\Users\\Praticien\\Téléchargements\\notes.txt";
    render(<PageParametresImportExport coeur={coeur} />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir l’export…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce fichier n’est pas une archive zip lisible.");
    expect(screen.getByRole("button", { name: "Choisir l’export…" })).toBeInTheDocument();
  });

  it("montre l'historique importé à la place de l'état de facturation", () => {
    render(<EtatFacturation seance={{ facturation: "a_facturer", commentaire_gratuit: "", facture: null, importee: true }} />);
    expect(screen.getByText("Historique importé")).toBeInTheDocument();
  });
});
