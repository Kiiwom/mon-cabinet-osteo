import { fireEvent, render, screen, within } from "@testing-library/react";

import { APPARENCE_PAR_DEFAUT, apparenceMemorisee, appliquerApparence, modeTactile, themeSombre } from "../lib/apparence";
import { creerCoeurDeDemonstration } from "../lib/coeur";
import { PageParametresApparence } from "./ParametresApparence";
import { PageParametresModules } from "./ParametresModules";

afterEach(() => {
  appliquerApparence(APPARENCE_PAR_DEFAUT);
  window.localStorage.clear();
});

describe("apparence", () => {
  it("suit l'ordinateur ou le choix du praticien", () => {
    expect(themeSombre({ ...APPARENCE_PAR_DEFAUT, theme: "systeme" }, true)).toBe(true);
    expect(themeSombre({ ...APPARENCE_PAR_DEFAUT, theme: "clair" }, true)).toBe(false);
    expect(themeSombre({ ...APPARENCE_PAR_DEFAUT, theme: "sombre" }, false)).toBe(true);
    expect(modeTactile({ tactile: "auto" }, true)).toBe(true);
    expect(modeTactile({ tactile: "jamais" }, true)).toBe(false);
    expect(modeTactile({ tactile: "toujours" }, false)).toBe(true);
  });

  it("s'applique à la page et se garde pour les écrans d'avant l'ouverture", () => {
    appliquerApparence({ theme: "sombre", accent: "sauge", taille_texte: 130, tactile: "toujours" });
    const racine = document.documentElement;
    expect(racine.dataset).toMatchObject({ sombre: "true", accent: "sauge", tactile: "true" });
    expect(racine.style.getPropertyValue("zoom")).toBe("1.3");
    expect(apparenceMemorisee()).toEqual({ theme: "sombre", accent: "sauge", taille_texte: 130, tactile: "toujours" });
    // Une copie locale abîmée ou d'une autre version retombe sur des valeurs sûres.
    window.localStorage.setItem("osteosphere.apparence", JSON.stringify({ theme: "violet", taille_texte: 300, accent: "bleu" }));
    expect(apparenceMemorisee()).toEqual({ ...APPARENCE_PAR_DEFAUT, accent: "bleu" });
    window.localStorage.setItem("osteosphere.apparence", "{abîmé");
    expect(apparenceMemorisee()).toEqual(APPARENCE_PAR_DEFAUT);
  });
});

describe("Paramètres › Apparence", () => {
  it("applique et enregistre chaque choix tout de suite", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<PageParametresApparence coeur={coeur} />);
    fireEvent.click(await screen.findByRole("radio", { name: /^Sombre/ }));
    expect(await screen.findByText("Apparence enregistrée")).toBeInTheDocument();
    expect(document.documentElement.dataset.sombre).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /Terre cuite/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Taille du texte" })).getByRole("button", { name: /^120/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Toujours agrandi/ }));
    await screen.findByRole("button", { name: /^120/, pressed: true });
    expect(await coeur.apparence()).toEqual({ theme: "sombre", accent: "terracotta", taille_texte: 120, tactile: "toujours" });
    expect(document.documentElement.dataset).toMatchObject({ accent: "terracotta", tactile: "true" });
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.2");
  });
});

describe("Paramètres › Modules", () => {
  it("présente les treize modules prévus par famille, avec leurs dépendances", () => {
    render(<PageParametresModules />);
    expect(screen.getAllByRole("listitem").filter((li) => li.classList.contains("carte-module"))).toHaveLength(13);
    const rendezVous = screen.getByRole("region", { name: "Rendez-vous et courriers" });
    expect(within(rendezVous).getByText("Nécessite le module Agenda")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Séance et suivi" })).toHaveTextContent("Biokinergie");
    expect(screen.getByText(/Aucun module n’est encore disponible/)).toBeInTheDocument();
  });
});
