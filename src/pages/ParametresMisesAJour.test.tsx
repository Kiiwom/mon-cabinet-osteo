import { fireEvent, render, screen, within } from "@testing-library/react";

import { creerCoeurDeDemonstration, type Coeur } from "../lib/coeur";
import { PageParametresMisesAJour } from "./ParametresMisesAJour";

function coeurAvecVersion(installer: () => Promise<void>) {
  const demo = creerCoeurDeDemonstration("ouvert");
  const rechercherMiseAJour = vi.fn(async () => ({
    etat: "disponible" as const,
    version_actuelle: "0.8.0",
    version: "0.9.0",
    date: "2026-11-02",
    notes: "Agenda.\nCourriers au médecin traitant.",
  }));
  const installerMiseAJour = vi.fn(installer);
  const coeur: Coeur = { ...demo, rechercherMiseAJour, installerMiseAJour };
  return { coeur, rechercherMiseAJour, installerMiseAJour };
}

describe("version et mises à jour", () => {
  it("ne cherche qu'au clic, puis dit que la version est la dernière", async () => {
    const demo = creerCoeurDeDemonstration("ouvert");
    const rechercherMiseAJour = vi.fn(demo.rechercherMiseAJour);
    render(<PageParametresMisesAJour coeur={{ ...demo, rechercherMiseAJour }} />);
    expect(screen.getByText(/ne se connecte à internet que lorsque vous cliquez/)).toBeInTheDocument();
    expect(rechercherMiseAJour).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rechercher une mise à jour" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Vous avez la dernière version");
    expect(rechercherMiseAJour).toHaveBeenCalledTimes(1);
  });

  it("présente la nouvelle version et l'installe après la sauvegarde", async () => {
    const { coeur, installerMiseAJour } = coeurAvecVersion(async () => undefined);
    render(<PageParametresMisesAJour coeur={coeur} />);
    fireEvent.click(screen.getByRole("button", { name: "Rechercher une mise à jour" }));

    const section = await screen.findByRole("region", { name: "La version 0.9.0 est disponible" });
    expect(section).toHaveTextContent("Vous avez la version 0.8.0 · publiée le 02/11/2026");
    expect(section).toHaveTextContent("Courriers au médecin traitant.");
    expect(section).toHaveTextContent("une sauvegarde complète est faite avant l’installation");
    fireEvent.click(screen.getByRole("button", { name: "Installer la version 0.9.0" }));
    expect(await screen.findByRole("button", { name: "Sauvegarde, téléchargement et vérification…" })).toBeDisabled();
    expect(installerMiseAJour).toHaveBeenCalledTimes(1);
  });

  it("explique un refus sans rien installer", async () => {
    const { coeur } = coeurAvecVersion(async () => {
      throw new Error("La mise à jour téléchargée ne porte pas la signature d'Osteosphere : elle n'a pas été installée.");
    });
    render(<PageParametresMisesAJour coeur={coeur} />);
    fireEvent.click(screen.getByRole("button", { name: "Rechercher une mise à jour" }));
    fireEvent.click(await screen.findByRole("button", { name: "Installer la version 0.9.0" }));
    const section = screen.getByRole("region", { name: "La version 0.9.0 est disponible" });
    expect(await within(section).findByRole("alert")).toHaveTextContent("ne porte pas la signature");
    expect(screen.getByRole("button", { name: "Installer la version 0.9.0" })).toBeEnabled();
  });
});
