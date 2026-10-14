import type { ModeleEmail } from "./coeur";

/** Le texte d'origine, le même que dans le cœur (`emails.rs`). */
export const MODELE_EMAIL_DEFAUT: ModeleEmail = {
  objet: "Votre {document} n° {numéro}",
  message:
    "Bonjour {prénom} {nom},\n\nVeuillez trouver ci-joint votre {document} n° {numéro} du {date}, d'un montant de {montant}.\n\nBien cordialement,\n{praticien}\n{téléphone}",
};

export const VARIABLES_EMAIL: { nom: string; detail: string; exemple: string }[] = [
  { nom: "prénom", detail: "du patient ou du destinataire", exemple: "Camille" },
  { nom: "nom", detail: "du patient ou du destinataire", exemple: "Martin" },
  { nom: "document", detail: "facture ou avoir", exemple: "facture" },
  { nom: "numéro", detail: "de la facture", exemple: "2026-10-1772" },
  { nom: "date", detail: "d’émission", exemple: "6 octobre 2026" },
  { nom: "montant", detail: "total", exemple: "55,00 €" },
  { nom: "praticien", detail: "votre prénom et votre nom", exemple: "Alexandre Roux" },
  { nom: "téléphone", detail: "du cabinet", exemple: "06 00 00 00 00" },
];

const cle = (nom: string) =>
  nom
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Comme `emails::remplir` : variables connues remplacées, ligne vidée par une variable vide retirée. */
export function remplirModele(texte: string, valeurs: Record<string, string>): string {
  const connues = new Map(Object.entries(valeurs).map(([nom, valeur]) => [cle(nom), valeur]));
  const ligne = (l: string) => l.replace(/\{([^{}\n]*)\}/g, (tout, nom: string) => connues.get(cle(nom)) ?? tout);
  return texte
    .split("\n")
    .map((origine) => [origine, ligne(origine)] as const)
    .filter(([origine, remplie]) => !(remplie.trim() === "" && origine.trim() !== ""))
    .map(([, remplie]) => remplie.trimEnd())
    .join("\n");
}
