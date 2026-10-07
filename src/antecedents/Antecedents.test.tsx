import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration } from "../lib/coeur";
import { resumeSeances } from "./FriseDeVie";

const saisir = (libelle: string, valeur: string) => fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });

async function ouvrirDossier(adresse: string) {
  render(<App coeur={creerCoeurDeDemonstration("ouvert")} />);
  await screen.findByRole("heading", { name: "Bienvenue, Alexandre" });
  await act(async () => {
    window.location.hash = adresse;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await screen.findByRole("heading", { name: "Camille Martin" });
}

beforeEach(() => {
  window.location.hash = "";
});

describe("antécédents", () => {
  it("montre la frise et les antécédents par catégorie dans la synthèse", async () => {
    await ouvrirDossier("#/patients/patient-1");
    const frise = screen.getByRole("img", { name: /Frise de vie : 4 antécédents datés/ });
    expect(within(frise).getByText("2009 · Fracture · poignet G")).toBeInTheDocument();
    expect(within(frise).getByText(/depuis 2015 · Traitement longue durée · lévothyroxine/)).toBeInTheDocument();
    // Non daté : en tête de la frise.
    expect(screen.getByText("Sans date").parentElement).toHaveTextContent("Allergies · AINS");
    const carte = screen.getByRole("region", { name: "Antécédents" });
    expect(within(carte).getByText("Fracture · poignet G, 2009")).toBeInTheDocument();
    expect(carte).toHaveTextContent("Familiaux et psychologiques : rien de renseigné");

    fireEvent.click(screen.getByRole("button", { name: "12 mois" }));
    expect(within(frise).queryByText("2009 · Fracture · poignet G")).not.toBeInTheDocument();
  });

  it("ajoute, modifie et supprime un antécédent", async () => {
    await ouvrirDossier("#/patients/patient-1/antecedents");
    const familiaux = screen.getByRole("region", { name: "Familiaux" });
    fireEvent.click(within(familiaux).getByRole("button", { name: "Ajouter : Maladies" }));
    const editeur = screen.getByRole("form", { name: "Nouvel antécédent" });
    expect(within(editeur).getByLabelText("Catégorie")).toHaveValue("familiaux");
    expect(within(editeur).getByLabelText("Rubrique")).toHaveValue("Maladies");
    saisir("Précision", "diabète chez la mère");
    saisir("Début", "13/2009");
    fireEvent.click(within(editeur).getByRole("button", { name: "Enregistrer" }));
    expect(within(editeur).getByRole("alert")).toHaveTextContent("Date à écrire 2009, 03/2009 ou 14/03/2009.");
    saisir("Début", "03/2009");
    fireEvent.click(within(editeur).getByRole("checkbox", { name: /Important/ }));
    fireEvent.click(within(editeur).getByRole("button", { name: "Enregistrer" }));

    expect(await within(familiaux).findByText("Maladies · diabète chez la mère")).toBeInTheDocument();
    expect(within(familiaux).getByText("mars 2009")).toBeInTheDocument();
    expect(document.querySelector(".entete-dossier")).toHaveTextContent("Maladies · diabète chez la mère");

    fireEvent.click(within(familiaux).getByRole("button", { name: "Modifier Maladies · diabète chez la mère" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer définitivement" }));
    expect(await within(familiaux).findByRole("button", { name: "Ajouter : Maladies" })).toBeInTheDocument();
    expect(within(familiaux).queryByText("Maladies · diabète chez la mère")).not.toBeInTheDocument();
  });

  it("enregistre les remarques sur les antécédents", async () => {
    await ouvrirDossier("#/patients/patient-1/antecedents");
    const remarques = screen.getByRole("textbox", { name: "Remarques sur les antécédents" });
    fireEvent.change(remarques, { target: { value: "Opérée à Agen, suites simples." } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les remarques" }));
    expect(await screen.findByText("Remarques enregistrées")).toBeInTheDocument();
  });

  it("résume les séances de la frise", () => {
    expect(resumeSeances(["2023-02-01", "2024-05-02", "2026-10-06"])).toBe("3 séances de 2023 à 2026");
    expect(resumeSeances(["2026-10-06"])).toBe("1 séance en 2026");
  });
});
