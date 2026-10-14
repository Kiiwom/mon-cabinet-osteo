import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration } from "../lib/coeur";

async function ouvrir(adresse: string) {
  await act(async () => {
    window.location.hash = adresse;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => {
  window.location.hash = "";
});

describe("statuts et groupes", () => {
  it("renomme un statut dans les dossiers et en retire un autre", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<App coeur={coeur} />);
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
    await ouvrir("#/parametres/patients");
    const statuts = await screen.findByRole("region", { name: "Statuts" });
    expect(within(statuts).getByLabelText("Nom du statut 2")).toHaveValue("Suivi");
    expect(within(statuts).getByText("6 dossiers")).toBeInTheDocument();

    fireEvent.change(within(statuts).getByLabelText("Nom du statut 2"), { target: { value: "En suivi" } });
    fireEvent.click(within(within(statuts).getAllByRole("listitem")[2]).getByRole("button", { name: "Retirer" }));
    expect(within(statuts).getByText("« Ancien patient » sera retiré de 1 dossier.")).toBeInTheDocument();
    fireEvent.change(within(statuts).getByLabelText("Nouveau statut"), { target: { value: "Bilan annuel" } });
    fireEvent.click(within(statuts).getByRole("button", { name: "Ajouter" }));
    fireEvent.click(within(statuts).getByRole("button", { name: "Monter « Bilan annuel »" }));
    fireEvent.click(within(statuts).getByRole("button", { name: "Enregistrer les statuts" }));
    expect(await within(statuts).findByText("Statuts enregistrés.")).toBeInTheDocument();
    expect(await coeur.statutsPatients()).toEqual(["Nouveau", "Bilan annuel", "En suivi"]);
    expect((await coeur.lirePatient("patient-1")).statut).toBe("En suivi");
    expect((await coeur.lirePatient("patient-4")).statut).toBe("");
  });

  it("crée un groupe, le coche dans une fiche, puis le supprime sans toucher au dossier", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<App coeur={coeur} />);
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
    await ouvrir("#/parametres/patients");
    const groupes = await screen.findByRole("region", { name: "Groupes" });
    await within(groupes).findByText("Famille Martin");
    fireEvent.change(within(groupes).getByLabelText("Nom du nouveau groupe"), { target: { value: "famille martin" } });
    fireEvent.click(within(groupes).getByRole("button", { name: "Ajouter le groupe" }));
    expect(await within(groupes).findByRole("alert")).toHaveTextContent("Un groupe porte déjà ce nom");
    fireEvent.change(within(groupes).getByLabelText("Nom du nouveau groupe"), { target: { value: "Entreprise Lacroix" } });
    fireEvent.click(within(groupes).getByRole("button", { name: "Ajouter le groupe" }));
    expect(await within(groupes).findByText("Entreprise Lacroix")).toBeInTheDocument();

    await ouvrir("#/patients/patient-5/identite");
    await screen.findByRole("heading", { name: "Paul Morel" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Entreprise Lacroix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    expect(await screen.findByText("Fiche enregistrée")).toBeInTheDocument();
    expect(document.querySelector(".entete-dossier .puce-groupe")).toHaveTextContent("Entreprise Lacroix");

    await ouvrir("#/parametres/patients");
    const ligne = (await screen.findByText("Entreprise Lacroix")).closest("li")!;
    expect(within(ligne).getByText("1 dossier")).toBeInTheDocument();
    fireEvent.click(within(ligne).getByRole("button", { name: "Supprimer" }));
    expect(within(ligne).getByText("Le dossier reste, sans ce groupe.")).toBeInTheDocument();
    fireEvent.click(within(ligne).getByRole("button", { name: "Supprimer le groupe" }));
    await screen.findByRole("region", { name: "Groupes" });
    expect(await screen.findByText("Famille Martin")).toBeInTheDocument();
    expect(screen.queryByText("Entreprise Lacroix")).not.toBeInTheDocument();
    expect((await coeur.lirePatient("patient-5")).groupes).toEqual([]);
  });
});
