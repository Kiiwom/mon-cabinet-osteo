import { useEffect, useState } from "react";

export type Ecran = "accueil" | "patients" | "seances" | "facturation" | "statistiques" | "trames" | "parametres";

export const ECRANS: readonly Ecran[] = [
  "accueil",
  "patients",
  "seances",
  "facturation",
  "statistiques",
  "trames",
  "parametres",
];

/** `#/patients/abc/identite` donne `["patients", "abc", "identite"]`. */
export function segmentsDepuisAdresse(adresse: string): string[] {
  return adresse
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}

export function ecranDepuisAdresse(adresse: string): Ecran {
  const [nom] = segmentsDepuisAdresse(adresse);
  return (ECRANS as readonly string[]).includes(nom) ? (nom as Ecran) : "accueil";
}

/** Adresse d'un écran : `adresse("patients", id)` donne `#/patients/<id>`. */
export function adresse(...segments: string[]): string {
  return `#/${segments.map(encodeURIComponent).join("/")}`;
}

export function aller(...segments: string[]) {
  window.location.hash = adresse(...segments);
}

/** Navigation par l'adresse (`#/patients/<id>`) : les boutons Précédent et Suivant fonctionnent. */
export function useAdresse(): { ecran: Ecran; segments: string[] } {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const suivre = () => setHash(window.location.hash);
    window.addEventListener("hashchange", suivre);
    return () => window.removeEventListener("hashchange", suivre);
  }, []);
  return { ecran: ecranDepuisAdresse(hash), segments: segmentsDepuisAdresse(hash) };
}

export function useEcranCourant(): Ecran {
  return useAdresse().ecran;
}
