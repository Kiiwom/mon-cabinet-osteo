import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration } from "../lib/coeur";

const saisir = (libelle: string | RegExp, valeur: string) =>
  fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });

async function ouvrir(adresse: string) {
  await act(async () => {
    window.location.hash = adresse;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function demarrer() {
  const coeur = creerCoeurDeDemonstration("ouvert");
  render(<App coeur={coeur} />);
  return coeur;
}

beforeEach(() => {
  window.location.hash = "";
});

describe("patients", () => {
  it("cherche sans accents ni fautes et ouvre le dossier au clavier", async () => {
    demarrer();
    await screen.findByRole("heading", { name: "Bienvenue, Alexandre" });
    await ouvrir("#/patients");
    const liste = await screen.findByRole("table");
    expect(within(liste).getAllByRole("row")).toHaveLength(9);
    expect(screen.getByText("8 dossiers actifs")).toBeInTheDocument();

    saisir("Rechercher un patient", "mrathe");
    expect(within(liste).getAllByRole("row")).toHaveLength(2);
    expect(within(liste).getByText(/orthographe proche/)).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Rechercher un patient"), { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "Élodie Marthe" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/patients/patient-6");
  });

  it("crée un dossier, vérifie la date et prévient d'un doublon probable", async () => {
    demarrer();
    await screen.findByRole("heading", { name: "Bienvenue, Alexandre" });
    await ouvrir("#/patients/nouveau");
    await screen.findByRole("heading", { name: "Nouveau patient" });
    saisir("Nom", "MARTIN");
    saisir("Prénom", "camille");
    expect(await screen.findByText("Un dossier ressemble à celui-ci.")).toBeInTheDocument();

    saisir("Prénom", "Inès");
    expect(screen.queryByText("Un dossier ressemble à celui-ci.")).not.toBeInTheDocument();
    saisir("Date de naissance", "32/01/1990");
    fireEvent.click(screen.getByRole("button", { name: "Créer le dossier" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Corrigez les champs signalés");
    expect(screen.getByLabelText("Date de naissance")).toHaveAttribute("aria-invalid", "true");

    saisir("Date de naissance", "12/01/1990");
    saisir("Profession ou scolarité", "Professeure des écoles");
    fireEvent.click(screen.getByRole("button", { name: "Créer le dossier" }));
    expect(await screen.findByRole("heading", { name: "Inès MARTIN" })).toBeInTheDocument();
    expect(screen.getByText(/36 ans · né\(e\) le 12 janvier 1990 · professeure des écoles/)).toBeInTheDocument();
  });

  it("modifie la fiche, puis archive le dossier", async () => {
    demarrer();
    await screen.findByRole("heading", { name: "Bienvenue, Alexandre" });
    await ouvrir("#/patients/patient-1/identite");
    await screen.findByRole("heading", { name: "Camille Martin" });
    const alertes = document.querySelectorAll(".entete-dossier .puce-alerte");
    expect([...alertes].map((p) => p.textContent?.trim())).toEqual(["⚠ Allergie aux AINS", "⚠ Allergies · AINS", "⚠ Orthopédique · prothèse hanche D"]);

    const enregistrer = screen.getByRole("button", { name: "Enregistrer les modifications" });
    expect(enregistrer).toBeDisabled();
    saisir("Profession ou scolarité", "Kinésithérapeute");
    fireEvent.click(enregistrer);
    expect(await screen.findByText("Fiche enregistrée")).toBeInTheDocument();
    expect(screen.getByText(/kinésithérapeute · droitière · Fumel/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Autres actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archiver le dossier" }));
    expect(await screen.findByText("Archivé")).toBeInTheDocument();

    await ouvrir("#/patients");
    const liste = await screen.findByRole("table");
    expect(within(liste).getByRole("link", { name: "Martin Lucas" })).toBeInTheDocument();
    expect(within(liste).queryByRole("link", { name: "Martin Camille" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Inclure les archives" }));
    expect(within(liste).getByRole("link", { name: "Martin Camille" })).toBeInTheDocument();
  });

  it("propose de créer le dossier cherché quand il n'existe pas", async () => {
    demarrer();
    await screen.findByRole("heading", { name: "Bienvenue, Alexandre" });
    await ouvrir("#/patients");
    await screen.findByRole("table");
    saisir("Rechercher un patient", "Durand Léa");
    fireEvent.click(screen.getByRole("button", { name: "Créer le dossier « Durand Léa »" }));
    await screen.findByRole("heading", { name: "Nouveau patient" });
    expect(screen.getByLabelText("Nom")).toHaveValue("Durand");
    expect(screen.getByLabelText("Prénom")).toHaveValue("Léa");
  });
});
