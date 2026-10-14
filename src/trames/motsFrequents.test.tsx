import type { Editor } from "@tiptap/react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { creerCoeurDeDemonstration, motsDuVocabulaire } from "../lib/coeur";
import { ChampTrame } from "./ChampTrame";
import { FournisseurTrames } from "./contexte";
import { completion } from "./motsFrequents";

const MOTS = ["lombalgie", "lombaire", "sacro-iliaque", "cervicalgie"];

describe("mots fréquents", () => {
  it("propose la fin du mot le plus fréquent, en gardant les capitales", () => {
    expect(completion(MOTS, "lom")).toBe("balgie");
    expect(completion(MOTS, "lombai")).toBe("re");
    expect(completion(MOTS, "Sacr")).toBe("o-iliaque");
    expect(completion(MOTS, "CERV")).toBe("ICALGIE");
    // Trop court, déjà complet ou inconnu : rien.
    expect(completion(MOTS, "lo")).toBeNull();
    expect(completion(MOTS, "lombalgi")).toBeNull();
    expect(completion(MOTS, "dors")).toBeNull();
  });

  it("tire le vocabulaire des séances (deux fois au moins) et des trames", () => {
    const mots = motsDuVocabulaire(["Lombalgie basse, sacro-iliaque", "lombalgie ; cervicalgie", "Sacro-iliaque libre"], ["Dorsalgie {haute | basse}"]);
    expect(mots).toEqual(["lombalgie", "sacro-iliaque", "dorsalgie"]);
  });

  async function champ(enveloppe: (enfant: ReactNode) => ReactNode) {
    let editeur: Editor | null = null;
    render(enveloppe(<ChampTrame libelle="Motif" trames={[]} caractere="@" surEditeur={(e) => (editeur = e)} />));
    await waitFor(() => expect(editeur).not.toBeNull());
    return editeur as unknown as Editor;
  }

  const taper = async (e: Editor, texte: string) => {
    for (const lettre of texte) await act(async () => void e.commands.insertContent(lettre));
  };

  it("affiche la fin en grisé pendant la frappe ; Tab l'accepte, Échap l'ignore", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    // Le vocabulaire de la démonstration vient de ses séances et des trames de départ.
    const vocabulaire = await coeur.motsFrequents();
    expect(vocabulaire).toContain("lombaire");
    const e = await champ((enfant) => <FournisseurTrames coeur={coeur}>{enfant}</FournisseurTrames>);
    await waitFor(() => expect(document.querySelector(".champ-trame-pied")).toHaveTextContent("Tab complète le mot proposé"));

    await taper(e, "Douleur lomb");
    await waitFor(() => expect(document.querySelector(".mot-propose")).toHaveTextContent("aire"));
    fireEvent.keyDown(e.view.dom, { key: "Tab" });
    expect(e.getText()).toBe("Douleur lombaire");
    expect(document.querySelector(".mot-propose")).toBeNull();

    await taper(e, " dors");
    const attendu = completion(vocabulaire, "dors");
    expect(attendu).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".mot-propose")?.textContent).toBe(attendu));
    fireEvent.keyDown(e.view.dom, { key: "Escape" });
    expect(document.querySelector(".mot-propose")).toBeNull();
    expect(e.getText()).toBe("Douleur lombaire dors");

    // Après le caractère d'appel, c'est le menu des trames qui répond.
    await taper(e, " @lomb");
    expect(document.querySelector(".mot-propose")).toBeNull();
  });

  it("ne propose rien quand la préférence est coupée", async () => {
    const coeur = creerCoeurDeDemonstration("ouvert");
    await coeur.enregistrerPreferences({ regrouper_seances_au_dela: 10, mots_frequents: false });
    expect(await coeur.motsFrequents()).toEqual([]);
    const e = await champ((enfant) => <FournisseurTrames coeur={coeur}>{enfant}</FournisseurTrames>);
    await taper(e, "lomb");
    expect(document.querySelector(".mot-propose")).toBeNull();
  });
});
