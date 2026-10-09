import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration, type Coeur } from "../lib/coeur";
import { erreurDeCode } from "../lib/verrouillage";

async function aller(adresse: string) {
  await act(async () => {
    window.location.hash = adresse;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

/**
 * Cabinet de démonstration protégé par un mot de passe, avec code court. Comme le vrai cœur, il refuse
 * d'enregistrer une séance une fois verrouillé : la saisie doit partir avant.
 */
async function cabinetProtege(): Promise<Coeur> {
  const demo = creerCoeurDeDemonstration("ouvert");
  await demo.definirMotDePasse("mot de passe fictif");
  await demo.definirCodeCourt("2468");
  let ferme = false;
  return {
    ...demo,
    async verrouiller() {
      ferme = true;
      return demo.verrouiller();
    },
    async deverrouillerAvecCode(code) {
      const reponse = await demo.deverrouillerAvecCode(code);
      if (reponse.etat === "ouvert") ferme = false;
      return reponse;
    },
    async deverrouiller(motDePasse) {
      const cabinet = await demo.deverrouiller(motDePasse);
      ferme = false;
      return cabinet;
    },
    async enregistrerSeance(id, saisie) {
      if (ferme) throw new Error("Le cabinet n'est pas ouvert.");
      return demo.enregistrerSeance(id, saisie);
    },
  };
}

// Quand toute la suite tourne, le verrouillage et le changement d'écran dépassent parfois une seconde.
const ATTENTE = { timeout: 5000 };

const taper = (code: string) => {
  const pave = screen.getByRole("group", { name: "Pavé numérique" });
  for (const chiffre of code) fireEvent.click(within(pave).getByRole("button", { name: chiffre }));
  fireEvent.click(within(pave).getByRole("button", { name: "Déverrouiller" }));
};

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("code court", () => {
  it("refuse les codes trop faciles, comme le cœur", () => {
    expect(erreurDeCode("2468")).toBeNull();
    expect(erreurDeCode("1234")).toMatch(/trop facilement/);
    expect(erreurDeCode("777777")).toMatch(/trop facilement/);
    expect(erreurDeCode("12a4")).toMatch(/4 à 6 chiffres/);
  });

  it("enregistre la séance en cours avant de verrouiller, puis rouvre le même écran", async () => {
    const coeur = await cabinetProtege();
    render(<App coeur={coeur} />);
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
    await aller("#/patients/patient-1");
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle séance" }));
    await screen.findByRole("heading", { name: /^Séance du / });
    const adresseSeance = window.location.hash;
    // Ctrl + L juste après la frappe, avant l'enregistrement automatique.
    fireEvent.change(screen.getByLabelText("Taille (cm)"), { target: { value: "172" } });
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });

    await screen.findByRole("heading", { name: "Cabinet verrouillé" }, ATTENTE);
    expect(screen.queryByText("Camille Martin")).not.toBeInTheDocument();
    taper("1357");
    expect(await screen.findByRole("alert", undefined, ATTENTE)).toHaveTextContent("Code incorrect. Encore 4 essais");
    taper("2468");

    await screen.findByRole("heading", { name: /^Séance du / }, ATTENTE);
    expect(window.location.hash).toBe(adresseSeance);
    expect((await coeur.lireSeance(adresseSeance.replace("#/seances/", ""))).valeurs).toMatchObject({ mesures: { taille: 172 } });
  });

  it("demande le mot de passe après cinq codes faux", async () => {
    const coeur = await cabinetProtege();
    render(<App coeur={coeur} />);
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    await screen.findByRole("heading", { name: "Cabinet verrouillé" }, ATTENTE);
    for (let essai = 1; essai <= 4; essai += 1) {
      taper("1357");
      await screen.findByText(new RegExp(`Encore ${5 - essai} essai`), undefined, ATTENTE);
    }
    taper("1357");
    expect(await screen.findByText("Trop de codes faux : saisissez votre mot de passe.", undefined, ATTENTE)).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe", { selector: "input" })).toBeInTheDocument();
    expect(await coeur.deverrouillerAvecCode("2468")).toEqual({ etat: "incorrect", essais_restants: 0 });
  });

  it("se règle dans Paramètres › Sécurité, avec le mot de passe seulement", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<App coeur={coeur} />);
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
    await aller("#/parametres/securite");
    expect(await screen.findByText(/Avec un mot de passe, Osteosphere peut se verrouiller seul/)).toBeInTheDocument();
    await coeur.definirMotDePasse("mot de passe fictif");
    await aller("#/parametres");
    await aller("#/parametres/securite");

    const section = await screen.findByRole("region", { name: "Verrouillage" });
    expect(within(section).getByLabelText("Verrouiller le cabinet")).toHaveValue("15");
    fireEvent.change(within(section).getByLabelText("Verrouiller le cabinet"), { target: { value: "5" } });
    expect(await within(section).findByText("Verrouillage après 5 minutes sans activité.")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Choisir un code court" }));
    fireEvent.change(within(section).getByLabelText("Code court"), { target: { value: "1111" } });
    fireEvent.change(within(section).getByLabelText("Confirmation"), { target: { value: "1111" } });
    fireEvent.click(within(section).getByRole("button", { name: "Enregistrer le code court" }));
    expect(within(section).getByRole("alert")).toHaveTextContent("trop facilement");
    fireEvent.change(within(section).getByLabelText("Code court"), { target: { value: "4826" } });
    fireEvent.change(within(section).getByLabelText("Confirmation"), { target: { value: "4826" } });
    fireEvent.click(within(section).getByRole("button", { name: "Enregistrer le code court" }));
    expect(await within(section).findByText(/Code court enregistré/)).toBeInTheDocument();
    expect((await coeur.securite()).verrouillage).toEqual({ inactivite_minutes: 5, code_court: true });

    // Retirer le mot de passe retire aussi le code court.
    fireEvent.click(screen.getByRole("button", { name: "Retirer le mot de passe" }));
    expect(await screen.findByText(/Mot de passe retiré/)).toBeInTheDocument();
    expect((await coeur.securite()).verrouillage.code_court).toBe(false);
    expect(await coeur.verrouillageAutomatique()).toBeNull();
  });
});

describe("verrouillage automatique", () => {
  it("verrouille après le temps choisi sans activité, et pas avant", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const coeur = creerCoeurDeDemonstration("ouvert");
    await coeur.definirMotDePasse("mot de passe fictif");
    await coeur.reglerVerrouillageAutomatique(5);
    render(<App coeur={coeur} />);
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });

    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    fireEvent.keyDown(document.body, { key: "a" });
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    expect(screen.getByRole("heading", { name: /^Bonjour Alexandre/ })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });
    expect(await screen.findByRole("heading", { name: "Cabinet protégé" }, ATTENTE)).toBeInTheDocument();
  });

  it("ne verrouille jamais sans mot de passe", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<App coeur={coeur} />);
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
    await act(async () => {
      vi.advanceTimersByTime(3 * 3_600_000);
    });
    expect(screen.getByRole("heading", { name: /^Bonjour Alexandre/ })).toBeInTheDocument();
  });
});
