import { act, fireEvent, render, screen } from "@testing-library/react";

import { App } from "./App";
import { creerCoeurDeDemonstration } from "./lib/coeur";
import { ecranDepuisAdresse } from "./lib/navigation";

const continuer = () => fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));
const saisir = (libelle: RegExp | string, valeur: string) =>
  fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });

async function allerALaProtection() {
  render(<App coeur={creerCoeurDeDemonstration("premier_demarrage")} />);
  await screen.findByRole("heading", { name: "Bienvenue dans Osteosphere" });
  continuer();
  saisir(/Prénom/, "Alexandre");
  saisir(/^Nom/, "Roux");
  continuer();
  await screen.findByRole("heading", { name: "Protéger vos données" });
}

beforeEach(() => {
  window.location.hash = "";
});

describe("premier démarrage", () => {
  it("crée le cabinet sans mot de passe, le choix par défaut", async () => {
    await allerALaProtection();
    expect(screen.getByRole("radio", { name: /Non, ouvrir directement/ })).toBeChecked();
    expect(screen.getByLabelText("Clé de secours")).toHaveTextContent("7KQM-R4TX-9WBE-H2NC-PX6V-3DFA");

    continuer();
    expect(screen.getByRole("alert")).toHaveTextContent("Cochez la case");
    fireEvent.click(screen.getByRole("checkbox", { name: /J’ai imprimé ou noté/ }));
    continuer();
    await screen.findByRole("heading", { name: "Vos sauvegardes" });
    expect(screen.getByRole("radio", { name: /À chaque fermeture/ })).toBeChecked();
    continuer();
    await screen.findByRole("heading", { name: "Votre pratique" });
    expect(screen.getByRole("radio", { name: /@ \(arobase\)/ })).toBeChecked();
    continuer();
    await screen.findByRole("heading", { name: "Reprendre vos données ?" });
    fireEvent.click(screen.getByRole("button", { name: "Créer mon cabinet" }));

    expect(await screen.findByRole("heading", { name: "Bienvenue, Alexandre" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
  });

  it("signale les champs du cabinet à corriger", async () => {
    render(<App coeur={creerCoeurDeDemonstration("premier_demarrage")} />);
    await screen.findByRole("heading", { name: "Bienvenue dans Osteosphere" });
    continuer();
    saisir(/SIRET/, "123");
    continuer();
    expect(screen.getByRole("alert")).toHaveTextContent("Corrigez les champs signalés");
    expect(screen.getByLabelText(/Prénom/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Le SIRET compte 14 chiffres.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Votre cabinet" })).toBeInTheDocument();
  });

  it("exige deux mots de passe identiques quand le praticien en choisit un", async () => {
    await allerALaProtection();
    fireEvent.click(screen.getByRole("radio", { name: /Oui, à chaque ouverture/ }));
    saisir("Mot de passe", "un mot de passe");
    saisir("Confirmation", "un autre");
    fireEvent.click(screen.getByRole("checkbox", { name: /J’ai imprimé ou noté/ }));
    continuer();
    expect(screen.getByRole("alert")).toHaveTextContent("Les deux mots de passe ne sont pas identiques.");
    saisir("Confirmation", "un mot de passe");
    continuer();
    expect(await screen.findByRole("heading", { name: "Vos sauvegardes" })).toBeInTheDocument();
  });
});

describe("ouverture d'un cabinet existant", () => {
  it("demande le mot de passe quand il est activé", async () => {
    render(<App coeur={creerCoeurDeDemonstration("mot_de_passe_requis")} />);
    await screen.findByRole("heading", { name: "Cabinet protégé" });
    saisir("Mot de passe", "faux");
    fireEvent.click(screen.getByRole("button", { name: "Déverrouiller" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mot de passe incorrect");
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("");

    saisir("Mot de passe", "motdepasse");
    fireEvent.click(screen.getByRole("button", { name: "Déverrouiller" }));
    expect(await screen.findByRole("heading", { name: "Bienvenue, Alexandre" })).toBeInTheDocument();
  });

  it("ouvre avec la clé de secours quand le mot de passe est oublié", async () => {
    render(<App coeur={creerCoeurDeDemonstration("mot_de_passe_requis")} />);
    await screen.findByRole("heading", { name: "Cabinet protégé" });
    fireEvent.click(screen.getByRole("button", { name: /Mot de passe oublié/ }));
    await screen.findByRole("heading", { name: "Clé de secours" });

    saisir(/^Clé de secours/, "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF");
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le cabinet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Clé de secours incorrecte");

    saisir(/^Clé de secours/, "7kqm r4tx 9wbe h2nc px6v 3dfa");
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le cabinet" }));
    expect(await screen.findByRole("heading", { name: "Bienvenue, Alexandre" })).toBeInTheDocument();
  });

  it("explique le cas d'un autre ordinateur", async () => {
    render(<App coeur={creerCoeurDeDemonstration("cle_de_secours_requise")} />);
    expect(await screen.findByText(/créé sur un autre ordinateur/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revenir au mot de passe" })).not.toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("suit l'adresse pour changer d'écran", async () => {
    render(<App coeur={creerCoeurDeDemonstration("ouvert")} />);
    await screen.findByRole("heading", { name: "Bienvenue, Alexandre" });
    await act(async () => {
      window.location.hash = "#/trames";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { name: "Trames" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trames" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
  });

  it("revient à l'accueil pour une adresse inconnue", () => {
    expect(ecranDepuisAdresse("#/inconnu")).toBe("accueil");
    expect(ecranDepuisAdresse("#/patients")).toBe("patients");
  });
});

describe("français", () => {
  it("élide « de » devant une voyelle", async () => {
    const { deOuD } = await import("./pages/Accueil");
    expect(deOuD("Alexandre")).toBe("d’");
    expect(deOuD("Élise")).toBe("d’");
    expect(deOuD("Camille")).toBe("de ");
  });
});
