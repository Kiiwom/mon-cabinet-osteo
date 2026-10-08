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
    // Nouveaux patients par mois, comparés à 2025.
    expect(stats.par_mois.map((m) => m.nouveaux)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(stats.par_mois[2].nouveaux_precedent).toBe(1);
    expect(stats.par_mois[8].premieres).toBe(1);
    // Du lundi 29 décembre 2025 au lundi 5 octobre 2026.
    expect(stats.par_semaine).toHaveLength(41);
    expect(stats.par_semaine.filter((s) => s.seances).map((s) => s.lundi)).toEqual(["2026-02-16", "2026-06-29", "2026-09-07", "2026-09-28", "2026-10-05"]);
    expect(stats.recence).toEqual({ actifs: 3, dormants: 1, inactifs: 0 });
    expect(stats.creneaux[1][16]).toBe(1);
    expect(stats.creneaux[5].reduce((t, n) => t + n, 0)).toBe(2);
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
    const fidelite = screen.getByRole("region", { name: "Fidélité des patients" });
    expect(within(fidelite).getByText("75 % des patients suivis sont actifs : venus depuis le 7 oct. 2025.")).toBeInTheDocument();
    expect(within(fidelite).getByRole("link", { name: "Dormants · 1" })).toHaveAttribute("href", "#/patients/recence/dormants");
    expect(within(fidelite).queryByRole("link", { name: /Inactifs/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "la date de facture" }));
    expect(await within(tuile).findByText("215 €")).toBeInTheDocument();
  });

  it("montre l'activité par mois et par semaine, les nouveaux patients et les créneaux", async () => {
    render(<PageStatistiques coeur={creerCoeurDeDemonstration("ouvert")} aujourdhui={new Date(2026, 9, 7)} />);
    const activite = await screen.findByRole("region", { name: "Activité" });
    expect(activite).toHaveTextContent("5 séances, dont 1 première (20 %) ; 1 en 2025 sur la même période.");

    fireEvent.click(within(activite).getByRole("button", { name: "Par semaine" }));
    expect(activite).toHaveTextContent("1,0 séance par semaine en moyenne, sur 5 semaines travaillées ; la plus chargée : 1 séance, semaine du 16 février 2026.");
    fireEvent.click(within(activite).getByRole("button", { name: "Voir en tableau" }));
    expect(within(activite).getByRole("row", { name: "29 décembre 2025 0 0" })).toBeInTheDocument();

    fireEvent.click(within(activite).getByRole("button", { name: "Nouveaux patients" }));
    expect(activite).toHaveTextContent("3 nouveaux patients, contre 1 en 2025 sur la même période");
    expect(within(activite).getByRole("row", { name: "octobre 2026 2 0" })).toBeInTheDocument();

    const rythme = screen.getByRole("region", { name: "Jours et heures des séances" });
    expect(rythme).toHaveTextContent("Jour le plus chargé : samedi, 2 séances");
    expect(within(rythme).getByTitle("Samedi à 11 h : 1 séance")).toHaveTextContent("1");
    expect(within(rythme).getByTitle("Samedi à 12 h : 0 séance")).toHaveTextContent("0");
    expect(within(rythme).queryByRole("rowheader", { name: "Dimanche" })).not.toBeInTheDocument();
    expect(within(rythme).getByRole("columnheader", { name: "16 h" })).toBeInTheDocument();
  });
});
