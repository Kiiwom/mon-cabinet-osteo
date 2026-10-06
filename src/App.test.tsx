import { act, render, screen } from "@testing-library/react";

import { App } from "./App";
import { ecranDepuisAdresse } from "./lib/navigation";

describe("navigation", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("ouvre l'accueil par défaut", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Bienvenue dans Osteosphere" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
  });

  it("suit l'adresse pour changer d'écran", async () => {
    render(<App />);
    await act(async () => {
      window.location.hash = "#/trames";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { name: "Trames" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trames" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
  });

  it("revient à l'accueil pour une adresse inconnue", () => {
    expect(ecranDepuisAdresse("#/inconnu")).toBe("accueil");
    expect(ecranDepuisAdresse("#/patients")).toBe("patients");
  });
});
