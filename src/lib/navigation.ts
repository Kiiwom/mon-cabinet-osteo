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

export function ecranDepuisAdresse(adresse: string): Ecran {
  const nom = adresse.replace(/^#\/?/, "");
  return (ECRANS as readonly string[]).includes(nom) ? (nom as Ecran) : "accueil";
}

/** Navigation par l'adresse (`#/patients`) : les boutons Précédent et Suivant fonctionnent. */
export function useEcranCourant(): Ecran {
  const [ecran, setEcran] = useState<Ecran>(() => ecranDepuisAdresse(window.location.hash));
  useEffect(() => {
    const suivre = () => setEcran(ecranDepuisAdresse(window.location.hash));
    window.addEventListener("hashchange", suivre);
    return () => window.removeEventListener("hashchange", suivre);
  }, []);
  return ecran;
}
