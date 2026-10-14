import type { IdentiteCabinet } from "./coeur";

export type ErreursIdentite = Partial<Record<keyof IdentiteCabinet, string>>;

const sansEspaces = (texte: string) => texte.replace(/\s/g, "");
const chiffres = (texte: string, n: number) => texte === "" || new RegExp(`^\\d{${n}}$`).test(texte);

/** Mêmes règles que le cœur Rust, pour signaler les erreurs avant l'envoi. */
export function verifierIdentite(identite: IdentiteCabinet): ErreursIdentite {
  const erreurs: ErreursIdentite = {};
  if (!identite.prenom.trim()) erreurs.prenom = "Indiquez votre prénom.";
  if (!identite.nom.trim()) erreurs.nom = "Indiquez votre nom.";
  if (!chiffres(sansEspaces(identite.code_postal), 5)) erreurs.code_postal = "Le code postal compte 5 chiffres.";
  if (!chiffres(sansEspaces(identite.siret), 14)) erreurs.siret = "Le SIRET compte 14 chiffres.";
  if (!chiffres(sansEspaces(identite.rpps), 11)) erreurs.rpps = "Le numéro RPPS compte 11 chiffres.";
  const email = identite.email.trim();
  if (email && !/^[^@\s]+@[^@\s.][^@\s]*\.[^@\s]+$/.test(email)) erreurs.email = "L’adresse email semble incomplète.";
  return erreurs;
}
