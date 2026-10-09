import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { CaractereTrames, Coeur } from "../lib/coeur";
import { ageEnClair, dateEnLettres } from "../lib/dates";
import type { TrameResume, ValeursVariables } from "./valider";

const EVENEMENT_TRAMES = "osteosphere:trames";

/** Prévient l'interface qu'une trame, le caractère d'appel ou une préférence de saisie a changé. */
export function signalerTrames() {
  window.dispatchEvent(new Event(EVENEMENT_TRAMES));
}

interface ValeurTrames {
  trames: TrameResume[];
  caractere: CaractereTrames;
  noter: (trame: TrameResume) => void;
  /** Le vocabulaire du praticien, pour proposer la fin des mots. */
  mots: string[];
}

const ContexteTrames = createContext<ValeurTrames>({
  trames: [],
  caractere: "@",
  noter: () => undefined,
  mots: [],
});

/** Les trames et le caractère d'appel, chargés une fois pour tous les champs texte de l'application. */
export function FournisseurTrames({ coeur, children }: { coeur: Coeur; children: ReactNode }) {
  const [trames, setTrames] = useState<TrameResume[]>([]);
  const [caractere, setCaractere] = useState<CaractereTrames>("@");
  const [mots, setMots] = useState<string[]>([]);

  const charger = useCallback(() => {
    coeur.listerTrames().then(setTrames, () => undefined);
    coeur.caractereTrames().then(setCaractere, () => undefined);
    coeur.motsFrequents().then(setMots, () => setMots([]));
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
      mots,
    }),
    [trames, caractere, coeur, mots],
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
