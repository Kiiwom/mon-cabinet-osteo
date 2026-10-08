import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { App } from "../App";
import { creerCoeurDeDemonstration, FICHE_VIDE, type FichePatient } from "../lib/coeur";
import { conflits, ficheFusionnee, reunirTextes } from "../patients/Fusion";

async function ouvrir(adresse: string) {
  await act(async () => {
    window.location.hash = adresse;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function demarrer() {
  const coeur = creerCoeurDeDemonstration("ouvert");
  render(<App coeur={coeur} />);
  await screen.findByRole("heading", { name: /^Bonjour Alexandre/ });
  return coeur;
}

beforeEach(() => {
  window.location.hash = "";
  try {
    localStorage.clear();
  } catch {
    // Sans stockage local.
  }
});

describe("proches et factures au parent", () => {
  it("lie les proches dans les deux sens et adresse les factures de l'enfant à sa mère", async () => {
    const coeur = await demarrer();
    await ouvrir("#/patients/patient-2");
    await screen.findByRole("heading", { name: "Lucas Martin" });
    const proches = screen.getByRole("region", { name: "Proches" });
    expect(await within(proches).findByRole("link", { name: "Camille Martin" })).toBeInTheDocument();
    expect(within(proches).getByText(/· mère/)).toBeInTheDocument();
    fireEvent.click(within(proches).getByRole("checkbox", { name: "Reçoit les factures" }));
    await within(proches).findByRole("checkbox", { name: "Reçoit les factures", checked: true });
    expect((await coeur.lirePatient("patient-2")).factures_a).toBe("patient-1");

    // La facture de la séance de Lucas va à Camille, avec le nom de Lucas.
    const modele = (await coeur.listerModeles())[0];
    const seance = await coeur.creerSeance("patient-2", {
      debut: "2026-10-08T10:00",
      modele_id: modele.id,
      modele_version: modele.version,
      type: "suivi",
      titre: "",
      importante: false,
      valeurs: {},
      facturation: "a_facturer",
      commentaire_gratuit: "",
    });
    const ligne = { prestation_id: null, designation: "Consultation enfant", quantite: 1, prix_unitaire_centimes: 4500, reduction_centimes: 0 };
    const facture = await coeur.facturerSeance(seance.id, [ligne], null, "2026-10-08");
    expect([facture.destinataire.prenom, facture.destinataire.nom, facture.destinataire.patient]).toEqual(["Camille", "Martin", "Lucas Martin"]);

    // Un nouveau proche, puis le lien retiré.
    fireEvent.click(within(proches).getByRole("button", { name: "Ajouter un proche" }));
    fireEvent.change(within(proches).getByLabelText("Chercher le dossier du proche"), { target: { value: "Petit" } });
    fireEvent.click(await within(proches).findByRole("button", { name: /Louis Petit/ }));
    fireEvent.change(within(proches).getByLabelText("est"), { target: { value: "fratrie" } });
    fireEvent.click(within(proches).getByRole("button", { name: "Lier les dossiers" }));
    expect(await within(proches).findByRole("link", { name: "Louis Petit" })).toBeInTheDocument();
    expect((await coeur.prochesPatient("patient-8"))[0]).toMatchObject({ id: "patient-2", lien: "fratrie" });
    fireEvent.click(within(proches).getByRole("button", { name: "Retirer le lien avec Louis Petit" }));
    fireEvent.click(within(proches).getByRole("button", { name: "Retirer le lien" }));
    await screen.findByText("Lucas Martin", { selector: "h1" });
    expect(within(proches).queryByRole("link", { name: "Louis Petit" })).not.toBeInTheDocument();
  });
});

describe("fusion de deux dossiers", () => {
  const fiche = (champs: Partial<FichePatient>): FichePatient => ({ ...FICHE_VIDE, nom: "Martin", prenom: "Camille", ...champs });

  it("prend les champs vides de l'autre, garde les deux textes longs et réunit les groupes", () => {
    const garde = fiche({ portable: "06 00 00 00 01", notes_importantes: "Allergie aux AINS", groupes: ["g1"], retraite: false });
    const autre = fiche({ portable: "07 00 00 00 02", email: "camille@exemple.fr", notes_importantes: "Prothèse de hanche", groupes: ["g2"], retraite: true });
    const choix = conflits(garde, autre);
    expect(choix).toEqual({ portable: "garde", notes_importantes: "les_deux" });
    const resultat = ficheFusionnee(garde, autre, choix);
    expect(resultat).toMatchObject({ portable: "06 00 00 00 01", email: "camille@exemple.fr", notes_importantes: "Allergie aux AINS\nProthèse de hanche", retraite: true, groupes: ["g1", "g2"] });
    expect(ficheFusionnee(garde, autre, { ...choix, portable: "autre" }).portable).toBe("07 00 00 00 02");
    expect(JSON.parse(reunirTextes("Ligne un", '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"deux"}]}]}')).content).toHaveLength(2);
  });

  it("fusionne après vérification et ouvre le dossier gardé", async () => {
    const coeur = await demarrer();
    await ouvrir("#/patients/patient-1/fusion/patient-6");
    await screen.findByRole("heading", { name: "Fusionner deux dossiers" });
    const fusionner = screen.getByRole("button", { name: "Fusionner les deux dossiers" });
    expect(fusionner).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "07 00 00 00 05" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "J’ai vérifié qu’il s’agit du même patient" }));
    fireEvent.click(fusionner);
    expect(await screen.findByRole("heading", { name: "Camille Martin" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/patients/patient-1");
    expect((await coeur.lirePatient("patient-1")).portable).toBe("07 00 00 00 05");
    await expect(coeur.lirePatient("patient-6")).rejects.toThrow("Ce dossier n’existe plus");
  });

  it("propose les doublons probables comme autre dossier", async () => {
    await demarrer();
    await ouvrir("#/patients/patient-1/fusion");
    await screen.findByRole("heading", { name: "Fusionner deux dossiers" });
    fireEvent.change(screen.getByLabelText("Chercher l’autre dossier"), { target: { value: "Marthe" } });
    fireEvent.click(screen.getByRole("button", { name: "Marthe Élodie" }));
    expect(await screen.findByText("Camille Martin (gardé) et Élodie Marthe")).toBeInTheDocument();
  });
});

describe("effacement, historique, frise et dossier PDF", () => {
  it("efface le dossier après avoir tapé le nom, et garde les factures émises", async () => {
    const coeur = await demarrer();
    await ouvrir("#/patients/patient-7/effacement");
    await screen.findByRole("heading", { name: "Effacer le dossier de Thomas Girard" });
    const effacer = screen.getByRole("button", { name: "Effacer définitivement le dossier" });
    fireEvent.change(screen.getByLabelText(/Pour confirmer, tapez le nom du patient/), { target: { value: "girar" } });
    expect(effacer).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Pour confirmer, tapez le nom du patient/), { target: { value: "GIRARD" } });
    fireEvent.click(effacer);
    expect(await screen.findByRole("heading", { name: "Dossier effacé" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 facture ou avoir émis reste dans la facturation");
    expect(await coeur.listerPatients()).toHaveLength(7);
    const factures = await coeur.listerFactures("2026-10-01", "2026-10-31");
    expect(factures.find((f) => f.numero === "2026-10-1770")?.patient_id).toBeNull();
  });

  it("montre l'historique des champs changés et replie la frise sur tous les onglets", async () => {
    await demarrer();
    await ouvrir("#/patients/patient-3/identite");
    await screen.findByRole("heading", { name: "Julie Martinez" });
    fireEvent.change(screen.getByLabelText("Profession ou scolarité"), { target: { value: "Comptable" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await screen.findByText("Fiche enregistrée");
    fireEvent.click(screen.getByRole("button", { name: "Replier" }));
    expect(screen.getByRole("button", { name: "Déplier" })).toHaveAttribute("aria-expanded", "false");

    await ouvrir("#/patients/patient-3/historique");
    expect(await screen.findByText("Profession ou scolarité : vide → Comptable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Déplier" })).toBeInTheDocument();
  });

  it("ouvre le dossier PDF avec toutes les rubriques et les séances cochées", async () => {
    await demarrer();
    await ouvrir("#/patients/patient-1");
    await screen.findByRole("heading", { name: "Camille Martin" });
    fireEvent.click(screen.getByRole("button", { name: "Autres actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dossier PDF…" }));
    const fenetre = screen.getByRole("dialog", { name: "Dossier PDF de Camille Martin" });
    expect(within(fenetre).getByRole("checkbox", { name: "Antécédents" })).toBeChecked();
    expect(within(fenetre).getByText("3 sur 3")).toBeInTheDocument();
    fireEvent.click(within(fenetre).getByRole("button", { name: "Aucune" }));
    expect(within(fenetre).getByText("0 sur 3")).toBeInTheDocument();
    expect(await within(fenetre).findByText(/Le dossier PDF est mis en page par le cœur/)).toBeInTheDocument();
  });
});
