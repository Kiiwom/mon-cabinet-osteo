import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { CaractereTrames, Coeur } from "../lib/coeur";
import { ageEnClair, dateEnLettres } from "../lib/dates";
import type { TrameResume, ValeursVariables } from "./valider";

const EVENEMENT_TRAMES = "osteosphere:trames";

/** Prévient l'interface qu'une trame ou le caractère d'appel a changé. */
export function signalerTrames() {
  window.dispatchEvent(new Event(EVENEMENT_TRAMES));
}

interface ValeurTrames {
  trames: TrameResume[];
  caractere: CaractereTrames;
  noter: (trame: TrameResume) => void;
}

const ContexteTrames = createContext<ValeurTrames>({
  trames: [],
  caractere: "@",
  noter: () => undefined,
});

/** Les trames et le caractère d'appel, chargés une fois pour tous les champs texte de l'application. */
export function FournisseurTrames({ coeur, children }: { coeur: Coeur; children: ReactNode }) {
  const [trames, setTrames] = useState<TrameResume[]>([]);
  const [caractere, setCaractere] = useState<CaractereTrames>("@");

  const charger = useCallback(() => {
    coeur.listerTrames().then(setTrames, () => undefined);
    coeur.caractereTrames().then(setCaractere, () => undefined);
  }, [coeur]);

  useEffect(() => {
    charger();
    window.addEventListener(EVENEMENT_TRAMES, charger);
    return () => window.removeEventListener(EVENEMENT_TRAMES, charger);
  }, [charger]);

  const valeur = useMemo(
    () => ({
      trames,
      caractere,
      noter: (trame: TrameResume) => void coeur.noterUtilisationTrame(trame.id).catch(() => undefined),
    }),
    [trames, caractere, coeur],
  );
  return <ContexteTrames.Provider value={valeur}>{children}</ContexteTrames.Provider>;
}

export function useTrames(): ValeurTrames {
  return useContext(ContexteTrames);
}

const ContexteVariables = createContext<ValeursVariables>({});

/** Les variables des trames ({{prénom}}, {{âge}}…) pour les champs du dossier ou de la séance. */
export function FournisseurVariables({ valeurs, children }: { valeurs: ValeursVariables; children: ReactNode }) {
  return <ContexteVariables.Provider value={valeurs}>{children}</ContexteVariables.Provider>;
}

export function useVariablesTrames(): ValeursVariables {
  return useContext(ContexteVariables);
}

/** Les variables d'un patient à une date (`AAAA-MM-JJ`) : la séance, ou aujourd'hui dans le dossier. */
export function variablesDuPatient(patient: { prenom: string; nom: string; naissance: string | null }, date: string): ValeursVariables {
  const [a, m, j] = date.split("-").map(Number);
  return {
    prenom: patient.prenom,
    nom: patient.nom,
    age: patient.naissance ? ageEnClair(patient.naissance, new Date(a, m - 1, j)) : undefined,
    date: dateEnLettres(date),
  };
}
