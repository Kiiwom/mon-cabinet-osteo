import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration, type Coeur } from "../lib/coeur";
import { euros, lireMontant, versCsv } from "../lib/facturation";
import { bornesPeriode, libellePeriode, surLaPeriode } from "../lib/periodes";
import { PageFacturation } from "../pages/Facturation";

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

async function idDe(coeur: Coeur, numero: string): Promise<string> {
  const factures = await coeur.listerFactures("2000-01-01", "2100-12-31");
  return factures.find((f) => f.numero === numero)!.id;
}

beforeEach(() => {
  window.location.hash = "";
});

describe("montants, CSV et périodes", () => {
  it("écrit et lit les montants à la française", () => {
    expect(euros(125_000)).toBe("1 250,00 €");
    expect(euros(-5500)).toBe("-55,00 €");
    expect(lireMontant("55")).toBe(5500);
    expect(lireMontant("55,5")).toBe(5550);
    expect(lireMontant(" 1 250,00 € ")).toBe(125_000);
    expect(lireMontant("55,555")).toBeNull();
    expect(lireMontant("abc")).toBeNull();
  });

  it("produit un CSV lisible par un tableur français", () => {
    const csv = versCsv(["Patient", "Montant (€)"], [["Martin; Camille", 55.5]]);
    expect(csv).toBe('﻿Patient;Montant (€)\r\n"Martin; Camille";55,5\r\n');
  });

  it("calcule les bornes des périodes", () => {
    const octobre = new Date(2026, 9, 7);
    expect(bornesPeriode({ type: "mois", reference: octobre })).toEqual(["2026-10-01", "2026-10-31"]);
    expect(bornesPeriode({ type: "trimestre", reference: octobre })).toEqual(["2026-10-01", "2026-12-31"]);
    expect(libellePeriode({ type: "trimestre", reference: octobre })).toBe("4e trimestre 2026");
    expect(surLaPeriode({ type: "mois", reference: octobre })).toBe("en octobre");
    expect(bornesPeriode({ type: "periode", reference: octobre, du: "2026-09-15", au: "2026-10-06" })).toEqual(["2026-09-15", "2026-10-06"]);
  });
});

describe("facturation", () => {
  it("émet la facture en fin de séance, réglée par chèque", async () => {
    const coeur = await demarrer();
    await aller("#/seances/seance-5");
    await screen.findByRole("heading", { name: "Séance du samedi 3 octobre 2026" });
    const fin = screen.getByRole("region", { name: "Fin de séance" });
    expect(await within(fin).findByLabelText("Prestation")).toHaveDisplayValue("Consultation");
    expect(within(fin).getByLabelText("Montant")).toHaveValue("55,00");
    fireEvent.click(within(fin).getByRole("button", { name: "Chèque" }));
    fireEvent.change(within(fin).getByLabelText("N° du chèque (facultatif)"), { target: { value: "0004600" } });
    fireEvent.click(within(fin).getByRole("button", { name: /^Émettre la facture réglée · 55,00\s€$/ }));

    expect(await within(fin).findByRole("link", { name: /^Facture \d{4}-\d{2}-\d+$/ })).toBeInTheDocument();
    expect(within(fin).getByText("Réglée")).toBeInTheDocument();
    expect(within(fin).getByRole("checkbox", { name: "Facturer" })).toBeDisabled();
    const facture = await coeur.factureDeSeance("seance-5");
    expect(facture?.reglements[0]).toMatchObject({ moyen: "cheque", reference: "0004600", montant_centimes: 5500 });
    expect(facture?.destinataire).toMatchObject({ prenom: "Louis", nom: "Petit" });
  });

  it("montre les recettes du mois, la répartition par moyen et le journal", async () => {
    render(<PageFacturation coeur={creerCoeurDeDemonstration("ouvert")} onglet="recettes" aujourdhui={new Date(2026, 9, 7)} />);
    const encaisse = (await screen.findByText("Encaissé en octobre")).closest(".tuile") as HTMLElement;
    await waitFor(() => expect(within(encaisse).getByText("105,00 €")).toBeInTheDocument());
    expect(within(encaisse).getByText("2 règlements")).toBeInTheDocument();
    const aFacturer = screen.getByText("À facturer", { selector: ".tuile span" }).closest(".tuile") as HTMLElement;
    await waitFor(() => expect(within(aFacturer).getByText("1 séance")).toBeInTheDocument());
    const attente = screen.getByText("En attente de règlement", { selector: ".tuile span" }).closest(".tuile") as HTMLElement;
    expect(within(attente).getByText("55,00 €")).toBeInTheDocument();

    const moyens = screen.getByRole("region", { name: "Encaissements par moyen de paiement" });
    expect(within(moyens).getByRole("img")).toHaveAccessibleName("Chèque 52 %, Virement 48 %");
    fireEvent.click(within(moyens).getByRole("button", { name: "Voir en tableau" }));
    expect(within(moyens).getByRole("table")).toBeInTheDocument();

    const journal = screen.getByRole("region", { name: /Journal des recettes/ });
    const lignes = within(journal).getAllByRole("row");
    expect(lignes).toHaveLength(3);
    expect(lignes[1]).toHaveTextContent("Thomas Girard");
    expect(lignes[1]).toHaveTextContent("n° 0004512");
    expect(within(journal).getByText("Total en octobre : 105,00 €")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Période précédente" }));
    expect(await screen.findByText("Septembre 2026")).toBeInTheDocument();
    expect(await within(screen.getByRole("region", { name: /Journal des recettes/ })).findByText("Aucun règlement encaissé en septembre.")).toBeInTheDocument();
  });

  it("corrige une facture réglée : avoir, facture rectificative et règlement reporté", async () => {
    const coeur = await demarrer();
    const id = await idDe(coeur, "2026-10-1770");
    await aller(`#/facturation/facture/${id}`);
    await screen.findByRole("heading", { name: "Facture 2026-10-1770" });
    expect(screen.getByText(/ouvrez Osteosphere dans sa fenêtre/)).toBeInTheDocument();
    const reglements = screen.getByRole("region", { name: "Règlements" });
    expect(within(reglements).getByText(/n° 0004512/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Corriger la facture" }));
    await screen.findByRole("heading", { name: "Corriger la facture 2026-10-1770" });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Girard-Lemaire" } });
    fireEvent.click(screen.getByRole("button", { name: "Émettre l’avoir et la facture corrigée" }));

    const titre = await screen.findByRole("heading", { name: /^Facture \d{4}-\d{2}-\d+$/ });
    expect(titre).not.toHaveTextContent("2026-10-1770");
    expect(screen.getByRole("link", { name: "Remplace la facture 2026-10-1770" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Règlements" })).getByText(/n° 0004512/)).toBeInTheDocument();
    expect(screen.getAllByText("Réglée").length).toBeGreaterThan(0);

    const originale = await coeur.lireFacture(id);
    expect(originale.etat).toBe("annulee");
    expect(originale.reglements).toHaveLength(0);
    expect(originale.avoir).not.toBeNull();
    const rectificative = await coeur.lireFacture(originale.rectificative!.id);
    expect(rectificative.destinataire.nom).toBe("Girard-Lemaire");
    // Le chèque n'est compté qu'une fois.
    expect((await coeur.recettes("2026-10-01", "2026-10-31")).filter((r) => r.reference === "0004512")).toHaveLength(1);
  });

  it("annule une facture en attente par un avoir : la séance redevient à facturer", async () => {
    const coeur = await demarrer();
    const id = await idDe(coeur, "2026-09-1741");
    await aller(`#/facturation/facture/${id}`);
    await screen.findByRole("heading", { name: "Facture 2026-09-1741" });
    expect(screen.getByText("En attente de règlement")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuler par un avoir" }));
    fireEvent.click(screen.getByRole("button", { name: "Émettre l’avoir" }));
    await screen.findByRole("heading", { name: /^Avoir \d{4}-\d{2}-\d+$/ });
    expect(screen.getByRole("link", { name: "Annule la facture 2026-09-1741" })).toBeInTheDocument();
    expect((await coeur.seancesAFacturer()).map((s) => s.id)).toContain("seance-3");
  });

  it("demande les mentions du cabinet avant d'émettre", async () => {
    await demarrer();
    await aller("#/parametres/cabinet");
    const siret = await screen.findByLabelText("SIRET");
    fireEvent.change(siret, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText(/Identité enregistrée/)).toBeInTheDocument();
    expect(screen.getByText("À compléter avant la première facture : SIRET.")).toBeInTheDocument();

    await aller("#/seances/seance-5");
    const fin = await screen.findByRole("region", { name: "Fin de séance" });
    fireEvent.click(await within(fin).findByRole("button", { name: /^Émettre la facture/ }));
    const alerte = await within(fin).findByRole("alert");
    expect(alerte).toHaveTextContent("Paramètres › Cabinet avant d’émettre : SIRET");
    expect(within(alerte).getByRole("link", { name: "Compléter maintenant" })).toHaveAttribute("href", "#/parametres/cabinet");
  });

  it("règle les prestations et la numérotation", async () => {
    await demarrer();
    await aller("#/parametres/facturation");
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle prestation" }));
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "Consultation nourrisson" } });
    fireEvent.change(screen.getByLabelText("Tarif TTC"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la prestation" }));
    expect(await screen.findByText("Consultation nourrisson")).toBeInTheDocument();
    expect(screen.getByText("40,00 €")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Modèle de numéro"), { target: { value: "F-{N}" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la numérotation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("doit contenir l’année");
    fireEvent.change(screen.getByLabelText("Modèle de numéro"), { target: { value: "F{AA}-{N}" } });
    fireEvent.change(screen.getByLabelText("Chiffres du compteur, au moins"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la numérotation" }));
    expect(await screen.findByText("Numérotation enregistrée.")).toBeInTheDocument();
    expect(await screen.findByText(/^F\d{2}-\d{5}$/)).toBeInTheDocument();
  });

  it("émet une facture sans séance pour un patient choisi", async () => {
    const coeur = await demarrer();
    await aller("#/facturation/nouvelle");
    fireEvent.change(await screen.findByLabelText("Patient (facultatif)"), { target: { value: "morel" } });
    fireEvent.click(await screen.findByRole("button", { name: /Paul Morel/ }));
    await waitFor(() => expect(screen.getByLabelText("Nom")).toHaveValue("Morel"));
    expect(screen.getByLabelText("Adresse")).toHaveValue("4 rue de la Martinie");
    fireEvent.click(screen.getByRole("button", { name: "Émettre la facture" }));
    await screen.findByRole("heading", { name: /^Facture \d{4}-\d{2}-\d+$/ });
    const factures = await coeur.facturesPatient("patient-5");
    expect(factures.filter((f) => f.seance_id === null)).toHaveLength(2);
  });

  it("émet en une fois les factures des séances choisies", async () => {
    const coeur = await demarrer();
    await aller("#/facturation/a-facturer");
    const case_ = await screen.findByRole("checkbox", { name: /Louis Petit du 3 oct\. 2026/ });
    fireEvent.click(case_);
    fireEvent.click(screen.getByRole("button", { name: "Espèces" }));
    fireEvent.click(screen.getByRole("button", { name: /^Émettre 1 facture/ }));
    expect(await screen.findByText(/^1 facture émise : /)).toBeInTheDocument();
    const facture = await coeur.factureDeSeance("seance-5");
    expect(facture?.reglements[0]).toMatchObject({ moyen: "especes", montant_centimes: 5500 });
    expect(await screen.findByText("Toutes les séances sont facturées.")).toBeInTheDocument();
  });
});
