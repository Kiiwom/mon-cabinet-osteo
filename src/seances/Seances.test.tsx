import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration, type Coeur } from "../lib/coeur";
import { PageSeances } from "../pages/Seances";

async function aller(adresse: string) {
  await act(async () => {
    window.location.hash = adresse;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function demarrer(): Promise<Coeur> {
  const coeur = creerCoeurDeDemonstration("ouvert");
  render(<App coeur={coeur} />);
  await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
  return coeur;
}

beforeEach(() => {
  window.location.hash = "";
});

describe("séances", () => {
  it("crée une séance depuis le dossier et l'enregistre au fil de la saisie", async () => {
    const coeur = await demarrer();
    await aller("#/patients/patient-1");
    await screen.findByRole("heading", { name: "Camille Martin" });
    const dernieres = screen.getByRole("region", { name: "Dernières séances" });
    expect(within(dernieres).getAllByRole("listitem")).toHaveLength(3);
    expect(within(dernieres).getByText("Lombalgie aiguë après port de charge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nouvelle séance" }));
    await screen.findByRole("heading", { name: /^Séance du / });
    const id = window.location.hash.replace("#/seances/", "");
    expect(screen.getByLabelText("Modèle")).toHaveDisplayValue("Adulte");
    expect(screen.getByLabelText("Type")).toHaveDisplayValue("Suivi");

    fireEvent.change(screen.getByLabelText("Taille (cm)"), { target: { value: "168" } });
    fireEvent.change(screen.getByLabelText("Poids (kg)"), { target: { value: "61,5" } });
    expect(document.querySelector(".imc")).toHaveTextContent("21,8");

    fireEvent.change(screen.getByRole("slider", { name: /Douleur avant la séance/ }), { target: { value: "6" } });
    expect(screen.getByText("Douleur avant la séance · 6/10")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/^Enregistré à \d\d:\d\d$/)).toBeInTheDocument(), { timeout: 3000 });
    const enregistree = await coeur.lireSeance(id);
    expect(enregistree.valeurs).toMatchObject({ mesures: { taille: 168, poids: 61.5 }, douleur_avant: 6 });
  });

  it("reprend les champs choisis de la séance précédente", async () => {
    const coeur = await demarrer();
    await aller("#/patients/patient-1");
    await screen.findByRole("heading", { name: "Camille Martin" });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle séance" }));
    await screen.findByRole("heading", { name: /^Séance du / });
    const id = window.location.hash.replace("#/seances/", "");

    const precedentes = screen.getByRole("region", { name: "Séances précédentes" });
    expect(within(precedentes).getByText("Douleur 7 → 3")).toBeInTheDocument();
    fireEvent.click(within(precedentes).getAllByRole("button", { name: "Reprendre dans cette séance" })[0]);
    const choix = await within(precedentes).findByRole("group", { name: "Champs à reprendre" });
    expect(within(choix).getByRole("checkbox", { name: "Motif de consultation" })).toBeChecked();
    expect(within(choix).getByRole("checkbox", { name: "Traitements" })).toBeChecked();
    expect(within(choix).getByRole("checkbox", { name: "Douleur avant la séance" })).not.toBeChecked();
    fireEvent.click(within(choix).getByRole("checkbox", { name: "Traitements" }));
    fireEvent.click(within(precedentes).getByRole("button", { name: "Reprendre ces champs" }));

    await waitFor(async () => expect((await coeur.lireSeance(id)).valeurs).toHaveProperty("motif"), { timeout: 3000 });
    const valeurs = (await coeur.lireSeance(id)).valeurs;
    expect(valeurs).not.toHaveProperty("traitements");
    expect(JSON.stringify(valeurs.motif)).toContain("Lombalgie aiguë après port de charge");
  });

  it("met une séance à la corbeille puis la restaure", async () => {
    await demarrer();
    await aller("#/seances/seance-5");
    await screen.findByRole("heading", { name: "Séance du samedi 3 octobre 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Autres actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mettre la séance à la corbeille" }));
    const liste = await screen.findByRole("region", { name: "Séances du dossier" });
    expect(within(liste).queryByText("Bilan postural, scoliose à surveiller")).not.toBeInTheDocument();

    await aller("#/seances/corbeille");
    const corbeille = await screen.findByRole("region", { name: "Séances à la corbeille" });
    expect(within(corbeille).getByText(/Bilan postural, scoliose à surveiller/)).toBeInTheDocument();
    fireEvent.click(within(corbeille).getByRole("button", { name: "Restaurer" }));
    expect(await within(corbeille).findByText("La corbeille est vide.")).toBeInTheDocument();
  });

  it("garde une séance facturée hors de la corbeille", async () => {
    await demarrer();
    await aller("#/seances/seance-2");
    await screen.findByRole("heading", { name: "Séance du vendredi 3 juillet 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Autres actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mettre la séance à la corbeille" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette séance a été facturée");
  });

  it("liste les séances d'une période, par jour, avec filtres et recherche", async () => {
    render(<PageSeances coeur={creerCoeurDeDemonstration("ouvert")} aujourdhui={new Date(2026, 9, 7)} />);
    expect(await screen.findByText("Octobre 2026")).toBeInTheDocument();
    const tableau = await screen.findByRole("table");
    expect(within(tableau).getByText("Mardi 6 octobre · 1 séance")).toBeInTheDocument();
    expect(within(tableau).getByRole("link", { name: "Thomas Girard" })).toBeInTheDocument();
    expect(within(tableau).getByRole("link", { name: "Louis Petit" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rechercher une séance"), { target: { value: "entorse" } });
    expect(within(tableau).queryByRole("link", { name: "Louis Petit" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Période précédente" }));
    expect(await screen.findByText("Septembre 2026")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rechercher une séance"), { target: { value: "" } });
    expect(await screen.findByRole("link", { name: "Camille Martin" })).toBeInTheDocument();
  });
});
