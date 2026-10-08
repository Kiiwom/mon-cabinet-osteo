import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { creerCoeurDeDemonstration } from "../lib/coeur";
import { PageCorbeille } from "../pages/Seances";
import { Documents } from "./Documents";

async function afficher() {
  const coeur = creerCoeurDeDemonstration("ouvert");
  const seances = await coeur.listerSeancesPatient("patient-1");
  render(<Documents coeur={coeur} patientId="patient-1" seances={seances} titre="Documents du dossier" />);
  const zone = screen.getByRole("region", { name: /^Documents du dossier/ });
  await within(zone).findByRole("button", { name: "Radiographie lombaire.png" });
  return { coeur, zone, seances };
}

describe("pièces jointes", () => {
  it("ajoute, rattache à une séance, met à la corbeille et annule", async () => {
    const { coeur, zone, seances } = await afficher();
    fireEvent.click(within(zone).getByRole("button", { name: "Ajouter des documents…" }));
    expect(await within(zone).findByText("1 document ajouté.")).toBeInTheDocument();
    expect(await within(zone).findByRole("button", { name: "Radio du genou.png" })).toBeInTheDocument();

    const ligne = within(zone).getByRole("button", { name: "Radio du genou.png" }).closest("li") as HTMLElement;
    fireEvent.change(within(ligne).getByLabelText("Rattaché à"), { target: { value: seances[0].id } });
    await waitFor(async () => expect((await coeur.listerDocuments("patient-1")).find((d) => d.nom === "Radio du genou.png")?.seance_id).toBe(seances[0].id));

    fireEvent.click(within(ligne).getByRole("button", { name: "Mettre Radio du genou.png à la corbeille" }));
    expect(await within(zone).findByText(/est à la corbeille pour 30 jours/)).toBeInTheDocument();
    expect(within(zone).queryByRole("button", { name: "Radio du genou.png" })).not.toBeInTheDocument();
    fireEvent.click(within(zone).getByRole("button", { name: "Annuler" }));
    expect(await within(zone).findByRole("button", { name: "Radio du genou.png" })).toBeInTheDocument();
  });

  it("montre l'aperçu d'une image et le referme", async () => {
    const { zone } = await afficher();
    fireEvent.click(within(zone).getByRole("button", { name: "Aperçu de Radiographie lombaire.png" }));
    const dialogue = await screen.findByRole("dialog", { name: "Radiographie lombaire.png" });
    expect(await within(dialogue).findByRole("img", { name: "Radiographie lombaire.png" })).toBeInTheDocument();
    fireEvent.click(within(dialogue).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renomme un document", async () => {
    const { coeur, zone } = await afficher();
    fireEvent.click(within(zone).getByRole("button", { name: "Renommer Radiographie lombaire.png" }));
    fireEvent.change(within(zone).getByLabelText("Nouveau nom"), { target: { value: "Radio lombaire 2025.png" } });
    fireEvent.click(within(zone).getByRole("button", { name: "Renommer" }));
    expect(await within(zone).findByRole("button", { name: "Radio lombaire 2025.png" })).toBeInTheDocument();
    expect((await coeur.listerDocuments("patient-1"))[0].nom).toBe("Radio lombaire 2025.png");
  });

  it("restaure un document depuis la corbeille", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    await coeur.supprimerDocument("document-radio");
    render(<PageCorbeille coeur={coeur} />);
    const liste = await screen.findByRole("list", { name: "Documents à la corbeille" });
    expect(within(liste).getByText(/Radiographie lombaire\.png · Camille Martin/)).toBeInTheDocument();
    fireEvent.click(within(liste).getByRole("button", { name: "Restaurer Radiographie lombaire.png" }));
    expect(await screen.findByText("Aucun document à la corbeille.")).toBeInTheDocument();
    expect(await coeur.listerDocuments("patient-1")).toHaveLength(1);
  });
});
