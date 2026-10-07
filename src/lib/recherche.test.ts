import { describe, expect, it } from "vitest";

import { FICHE_VIDE, resumeDe, type FichePatient, type ResumePatient } from "./coeur";
import { distance, doublonsProbables, normaliser, plier, rechercherPatients, ressemblants } from "./recherche";

let rang = 0;
const patient = (fiche: Partial<FichePatient>): ResumePatient =>
  resumeDe({ ...FICHE_VIDE, ...fiche, id: `p${(rang += 1)}`, archive: false, cree_le: 0, modifie_le: 0 });

const LISTE = [
  patient({ nom: "Martin", prenom: "Camille", ville: "Fumel", portable: "06 12 34 56 78", naissance: "1988-03-14" }),
  patient({ nom: "Martinez", prenom: "Julie", ville: "Monflanquin" }),
  patient({ nom: "Aubert", prenom: "Martine", ville: "Villeréal" }),
  patient({ nom: "Morel", prenom: "Paul", adresse: "4 rue de la Martinie", ville: "Fumel" }),
  patient({ nom: "Marthe", prenom: "Élodie", ville: "Lacapelle-Biron" }),
  patient({ nom: "Lefèvre", prenom: "Hélène", nom_naissance: "Dupré", email: "helene.l@exemple.fr" }),
];
const noms = (texte: string) => rechercherPatients(LISTE, texte).map((r) => `${r.patient.nom} ${r.patient.prenom}`);

describe("recherche des patients", () => {
  it("plie accents et majuscules sans changer les positions", () => {
    expect(plier("Élodie Lefèvre")).toBe("elodie lefevre");
    expect(normaliser("  HÉLÈNE   d’Aubert ")).toBe("helene d aubert");
  });

  it("trouve le début des noms, prénoms et villes, le nom d'abord", () => {
    // Les noms d'abord, par ordre alphabétique, puis les prénoms, puis l'adresse.
    expect(noms("mart")).toEqual(["Marthe Élodie", "Martin Camille", "Martinez Julie", "Aubert Martine", "Morel Paul"]);
    expect(noms("martin camille")).toEqual(["Martin Camille"]);
    expect(noms("fumel")).toEqual(["Martin Camille", "Morel Paul"]);
  });

  it("ignore les accents et tolère une faute de frappe", () => {
    expect(noms("helene")).toEqual(["Lefèvre Hélène"]);
    expect(noms("lefevre")).toEqual(["Lefèvre Hélène"]);
    const approche = rechercherPatients(LISTE, "mrathe");
    expect(approche.map((r) => r.patient.nom)).toEqual(["Marthe"]);
    expect(approche[0].raison).toBe("orthographe proche");
  });

  it("cherche aussi le téléphone, l'adresse, l'email et le nom de naissance, en disant pourquoi", () => {
    expect(noms("0612")).toEqual(["Martin Camille"]);
    expect(noms("34 56")).toEqual(["Martin Camille"]);
    const adresse = rechercherPatients(LISTE, "martinie").find((r) => r.patient.nom === "Morel");
    expect(adresse?.raison).toBe("4 rue de la Martinie");
    expect(rechercherPatients(LISTE, "dupre")[0].raison).toBe("nom de naissance Dupré");
    expect(rechercherPatients(LISTE, "helene.l")[0].patient.nom).toBe("Lefèvre");
  });

  it("surligne le passage trouvé dans le nom", () => {
    const [premier] = rechercherPatients(LISTE, "mart");
    expect(premier.surlignage.nom).toEqual([{ debut: 0, fin: 4 }]);
    const [helene] = rechercherPatients(LISTE, "hel");
    expect(helene.surlignage.prenom).toEqual([{ debut: 0, fin: 3 }]);
  });

  it("rend toute la liste quand rien n'est tapé", () => {
    expect(rechercherPatients(LISTE, "  ")).toHaveLength(LISTE.length);
  });
});

describe("doublons", () => {
  it("compte les inversions de lettres comme une seule faute", () => {
    expect(distance("marthe", "mrathe")).toBe(1);
    expect(distance("martin", "martine")).toBe(1);
    expect(distance("camille", "camille")).toBe(0);
  });

  it("signale un dossier au même nom et prénom, accents et majuscules mis à part", () => {
    expect(ressemblants(LISTE, { nom: "MARTIN", prenom: "camille", naissance: null }).map((p) => p.prenom)).toEqual(["Camille"]);
    expect(ressemblants(LISTE, { nom: "Martin", prenom: "Lucas", naissance: null })).toEqual([]);
  });

  it("signale une faute de frappe seulement avec la même naissance", () => {
    expect(ressemblants(LISTE, { nom: "Martine", prenom: "Camile", naissance: "1988-03-14" })).toHaveLength(1);
    expect(ressemblants(LISTE, { nom: "Martine", prenom: "Camile", naissance: "1990-01-01" })).toHaveLength(0);
  });

  it("liste les paires probables", () => {
    const double = [...LISTE, patient({ nom: "Martin", prenom: "Camile", naissance: "1988-03-14" })];
    const paires = doublonsProbables(double);
    expect(paires).toHaveLength(1);
    expect(paires[0].map((p) => p.prenom).sort()).toEqual(["Camile", "Camille"]);
  });
});
