import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { creerCoeurDeDemonstration, type ResumePatient } from "../lib/coeur";
import { Accueil, anniversaires } from "./Accueil";

const CABINET = { prenom: "Alexandre", nom: "Roux" } as Parameters<typeof Accueil>[0]["cabinet"];

describe("accueil", () => {
  it("montre la journée, ce qui attend et les chiffres du mois", async () => {
    render(<Accueil coeur={creerCoeurDeDemonstration("ouvert")} cabinet={CABINET} aujourdhui={new Date(2026, 9, 6)} />);
    expect(await screen.findByRole("heading", { name: "Bonjour Alexandre, 1 séance aujourd’hui" })).toBeInTheDocument();
    expect(screen.getByText("Mardi 6 octobre 2026")).toBeInTheDocument();
    const jour = screen.getByRole("region", { name: "Séances du jour" });
    expect(within(jour).getByRole("link", { name: /16:00\s*Thomas Girard/ })).toHaveAttribute("href", "#/seances/seance-4");

    expect(await screen.findByRole("region", { name: "Octobre, au 6 du mois" })).toHaveTextContent("Séances");
    const attente = screen.getByRole("region", { name: "Paiements en attente" });
    expect(within(attente).getByRole("link", { name: "Voir les factures" })).toHaveAttribute("href", "#/facturation/en-attente");
    expect(screen.getByRole("region", { name: "Sauvegarde à jour" })).toHaveTextContent("Dernière sauvegarde le");
  });

  it("ajoute et retire des pense-bêtes, masque un bloc", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    render(<Accueil coeur={coeur} cabinet={CABINET} aujourdhui={new Date(2026, 9, 7)} />);
    const notes = await screen.findByRole("region", { name: "Pense-bêtes" });
    fireEvent.change(within(notes).getByLabelText("Nouveau pense-bête"), { target: { value: "Rappeler le fournisseur de table" } });
    fireEvent.click(within(notes).getByRole("button", { name: "Ajouter" }));
    expect(await within(notes).findByText("Rappeler le fournisseur de table")).toBeInTheDocument();
    expect((await coeur.accueil()).pense_betes[0]).toMatchObject({ texte: "Rappeler le fournisseur de table", le: "2026-10-07" });
    fireEvent.click(within(notes).getByRole("button", { name: "Fait : Commander des draps d’examen" }));
    await within(notes).findByText("Rappeler le fournisseur de table");
    expect(within(notes).queryByText("Commander des draps d’examen")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Personnaliser l’accueil" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Anniversaires de la semaine" }));
    expect(await screen.findByRole("checkbox", { name: "Anniversaires de la semaine" })).not.toBeChecked();
    expect(screen.queryByRole("region", { name: "Anniversaires de la semaine" })).not.toBeInTheDocument();
    expect((await coeur.accueil()).masques).toEqual(["anniversaires"]);
  });

  it("trouve les anniversaires des sept prochains jours", () => {
    const patient = (id: string, naissance: string, autres: Partial<ResumePatient> = {}) =>
      ({ id, nom: id, prenom: "", naissance, archive: false, decede: false, ...autres }) as ResumePatient;
    const liste = [
      patient("demain", "2014-10-08"),
      patient("aujourdhui", "1972-10-07"),
      patient("trop-tard", "1990-10-14"),
      patient("archive", "1980-10-09", { archive: true }),
    ];
    expect(anniversaires(liste, new Date(2026, 9, 7)).map((a) => [a.patient.id, a.age, a.jour])).toEqual([
      ["aujourdhui", 54, "aujourd’hui"],
      ["demain", 12, "demain"],
    ]);
    // Né un 29 février : fêté le 28 les années non bissextiles.
    expect(anniversaires([patient("bissextile", "2000-02-29")], new Date(2027, 1, 25)).map((a) => [a.age, a.jour])).toEqual([[27, "dimanche"]]);
  });
});

describe("nouvelle séance depuis l'accueil", () => {
  it("choisit le patient au clavier et ouvre la séance", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    window.location.hash = "#/";
    render(<Accueil coeur={coeur} cabinet={CABINET} aujourdhui={new Date(2026, 9, 7)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle séance" }));
    const recherche = await screen.findByLabelText("Pour quel patient ?");
    // Sans saisie : les patients vus récemment.
    expect(await screen.findByRole("list", { name: "Patients vus récemment" })).toBeInTheDocument();
    fireEvent.change(recherche, { target: { value: "girard" } });
    expect(within(screen.getByRole("list", { name: "Patients trouvés" })).getByRole("button", { name: /^Thomas Girard/ })).toBeInTheDocument();
    const avant = (await coeur.listerSeancesPatient("patient-7")).length;
    fireEvent.keyDown(recherche, { key: "Enter" });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/seances\/.+/));
    const apres = await coeur.listerSeancesPatient("patient-7");
    expect(apres).toHaveLength(avant + 1);
    expect(apres.find((s) => window.location.hash.endsWith(s.id))?.type).toBe("suivi");
  });
});
