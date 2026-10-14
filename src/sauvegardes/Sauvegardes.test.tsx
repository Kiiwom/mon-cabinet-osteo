import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration, type Coeur } from "../lib/coeur";
import { joursDepuis } from "../pages/ParametresSauvegardes";

async function aller(adresse: string) {
  await act(async () => {
    window.location.hash = adresse;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function demarrer(coeur: Coeur = creerCoeurDeDemonstration("ouvert")): Promise<Coeur> {
  render(<App coeur={coeur} />);
  await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
  return coeur;
}

const CLE = "7KQM-R4TX-9WBE-H2NC-PX6V-3DFA";

beforeEach(() => {
  window.location.hash = "";
});

describe("sauvegardes", () => {
  it("compte les jours depuis la dernière sauvegarde", () => {
    const maintenant = Date.UTC(2026, 9, 7, 20);
    expect(joursDepuis(maintenant / 1000 - 3_600, maintenant)).toBe(0);
    expect(joursDepuis(maintenant / 1000 - 8 * 86_400, maintenant)).toBe(8);
  });

  it("sauvegarde à la demande, règle la fréquence et garde la liste", async () => {
    const coeur = await demarrer();
    await aller("#/parametres/sauvegardes");
    await screen.findByRole("heading", { name: "Sauvegardes", level: 1 });
    const liste = screen.getByRole("region", { name: "Sauvegardes du dossier" });
    expect(within(liste).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Sauvegarder maintenant" }));
    expect(await screen.findByText(/^Sauvegarde enregistrée : Osteosphere /)).toBeInTheDocument();
    expect(await within(liste).findAllByRole("listitem")).toHaveLength(4);

    fireEvent.click(screen.getByRole("radio", { name: /Régulièrement, pendant l’utilisation/ }));
    fireEvent.change(screen.getByLabelText("Intervalle entre deux sauvegardes"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Choisir…" }));
    await screen.findByDisplayValue("D:\\Sauvegardes Osteosphere");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    expect(await screen.findByText("Réglages des sauvegardes enregistrés.")).toBeInTheDocument();
    expect((await coeur.etatDesSauvegardes()).preferences).toMatchObject({ frequence: "intervalle", intervalle_minutes: 30, dossier: "D:\\Sauvegardes Osteosphere" });
  });

  it("restaure une sauvegarde après l'avoir vérifiée avec la clé de secours", async () => {
    await demarrer();
    await aller("#/parametres/sauvegardes");
    const liste = await screen.findByRole("region", { name: "Sauvegardes du dossier" });
    fireEvent.click(within(liste).getAllByRole("button", { name: "Restaurer…" })[0]);
    const restauration = await screen.findByRole("region", { name: "Restaurer une sauvegarde" });
    fireEvent.change(within(restauration).getByLabelText("Clé de secours"), { target: { value: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF" } });
    fireEvent.click(within(restauration).getByRole("button", { name: "Vérifier la sauvegarde" }));
    expect(await within(restauration).findByRole("alert")).toHaveTextContent("Clé de secours incorrecte");

    fireEvent.change(within(restauration).getByLabelText("Clé de secours"), { target: { value: CLE.toLowerCase() } });
    fireEvent.click(within(restauration).getByRole("button", { name: "Vérifier la sauvegarde" }));
    expect(await within(restauration).findByText("Sauvegarde intacte, déchiffrée avec votre clé de secours.")).toBeInTheDocument();
    expect(within(restauration).getByText("Patients").nextElementSibling).toHaveTextContent("8");
    fireEvent.click(within(restauration).getByRole("button", { name: "Remplacer mes données par cette sauvegarde" }));
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
  });

  it("restaure une sauvegarde dès le premier démarrage", async () => {
    const coeur = creerCoeurDeDemonstration("premier_demarrage");
    render(<App coeur={coeur} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurer une sauvegarde" }));
    const restauration = screen.getByRole("region", { name: "Restaurer une sauvegarde" });
    fireEvent.click(within(restauration).getByRole("button", { name: "Choisir un fichier…" }));
    expect(await within(restauration).findByText(/\.osteosauve$/)).toBeInTheDocument();
    fireEvent.change(within(restauration).getByLabelText("Clé de secours"), { target: { value: CLE } });
    fireEvent.click(within(restauration).getByRole("button", { name: "Vérifier la sauvegarde" }));
    fireEvent.click(await within(restauration).findByRole("button", { name: "Installer ce cabinet" }));
    await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
  });

  it("active le mot de passe, verrouille avec Ctrl+L puis déverrouille", async () => {
    const coeur = await demarrer();
    await aller("#/parametres/securite");
    expect(await screen.findByText("Désactivé")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activer un mot de passe" }));
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), { target: { value: "court" } });
    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "court" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("au moins 8 caractères");
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), { target: { value: "mot de passe fictif" } });
    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "mot de passe fictif" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(await screen.findByText(/Mot de passe enregistré/)).toBeInTheDocument();
    expect((await coeur.securite()).mot_de_passe_actif).toBe(true);

    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    await screen.findByRole("heading", { name: "Cabinet protégé" });
    fireEvent.change(screen.getByLabelText("Mot de passe", { selector: "input" }), { target: { value: "mot de passe fictif" } });
    fireEvent.click(screen.getByRole("button", { name: "Déverrouiller" }));
    // Le cabinet rouvre sur l'écran quitté.
    await screen.findByRole("heading", { name: "Sécurité et mot de passe", level: 1 });
  });

  it("affiche le journal et l'export complet", async () => {
    await demarrer();
    await aller("#/parametres/journal");
    const journal = await screen.findByRole("region", { name: "Journal" });
    expect(within(journal).getAllByRole("link", { name: "Séance créée" }).length).toBeGreaterThan(0);
    await aller("#/parametres/import");
    fireEvent.click(await screen.findByRole("button", { name: "Exporter tout le cabinet" }));
    expect(await screen.findByText(/^Export enregistré dans /)).toBeInTheDocument();
  });
});
