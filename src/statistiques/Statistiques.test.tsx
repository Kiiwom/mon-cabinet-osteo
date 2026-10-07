import { fireEvent, render, screen, within } from "@testing-library/react";

import { creerCoeurDeDemonstration } from "../lib/coeur";
import { evolution, unAnAvant } from "../lib/statistiques";
import { PageStatistiques } from "../pages/Statistiques";
import { graduations } from "./Graphiques";

describe("calculs", () => {
  it("gradue les axes en valeurs rondes", () => {
    expect(graduations(4_400)).toEqual([0, 1_000, 2_000, 3_000, 4_000, 5_000]);
    expect(graduations(0)).toEqual([0, 1]);
    expect(graduations(90)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("compare à l'année précédente", () => {
    expect(unAnAvant("2028-02-29")).toBe("2027-02-28");
    expect(evolution({ valeur: 110, precedent: 100 })).toBeCloseTo(10);
    expect(evolution({ valeur: 5, precedent: 0 })).toBeNull();
  });

  it("calcule les statistiques de la démonstration comme le cœur", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    const stats = await coeur.statistiques("2026-01-01", "2026-10-07", "encaissement");
    expect(stats.chiffre).toEqual({ valeur: 16_000, precedent: 5_000 });
    expect(stats.seances).toEqual({ valeur: 5, precedent: 1 });
    expect(stats.actes_gratuits).toBe(1);
    expect(stats.par_mois).toHaveLength(10);
    expect(stats.patients_suivis[0]).toMatchObject({ prenom: "Camille", seances: 3 });
    expect(stats.douleur?.seances).toBe(5);
    const parFacture = await coeur.statistiques("2026-01-01", "2026-10-07", "facture");
    expect(parFacture.chiffre.valeur).toBe(5_500 + 5_500 + 5_000 + 5_500);
  });
});

describe("écran des statistiques", () => {
  it("montre les tuiles, le chiffre d'affaires par mois et la patientèle", async () => {
    render(<PageStatistiques coeur={creerCoeurDeDemonstration("ouvert")} aujourdhui={new Date(2026, 9, 7)} />);
    expect(await screen.findByText("Janvier à octobre 2026, comparé à la même période de 2025")).toBeInTheDocument();
    const tuile = (await screen.findByText("Chiffre d’affaires", { selector: ".tuile span" })).closest(".tuile") as HTMLElement;
    expect(within(tuile).getByText("160 €")).toBeInTheDocument();
    expect(within(tuile).getByText(/\+220,0 % · 50 € en 2025/)).toBeInTheDocument();

    const graphique = screen.getByRole("region", { name: /^Chiffre d’affaires par mois/ });
    expect(within(graphique).getByRole("img")).toBeInTheDocument();
    fireEvent.focus(within(graphique).getByRole("img").querySelectorAll("rect.cible")[6]);
    expect(within(graphique).getByRole("status")).toHaveTextContent("juillet 2026");
    fireEvent.click(within(graphique).getByRole("button", { name: "Voir en tableau" }));
    expect(within(graphique).getByRole("table")).toHaveTextContent("juillet 2026");

    expect(screen.getByRole("region", { name: "Patients les plus suivis" })).toHaveTextContent("Camille Martin3");
    expect(screen.getByRole("region", { name: "Dernière visite des patients" })).toHaveTextContent("Moins de 6 mois");

    fireEvent.click(screen.getByRole("button", { name: "la date de facture" }));
    expect(await within(tuile).findByText("215 €")).toBeInTheDocument();
  });
});
