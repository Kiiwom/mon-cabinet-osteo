/** Les mêmes que le cœur : durées d'inactivité proposées, en minutes, et codes faux acceptés. */
export const DELAIS_INACTIVITE = [5, 10, 15, 30, 60];
export const ESSAIS_CODE_COURT = 5;

/** Le même contrôle que le cœur : 4 à 6 chiffres, ni suite ni chiffre répété. `null` si le code convient. */
export function erreurDeCode(code: string): string | null {
  if (!/^[0-9]{4,6}$/.test(code)) return "Le code court compte 4 à 6 chiffres";
  const chiffres = [...code].map(Number);
  const ecarts = chiffres.slice(1).map((c, rang) => c - chiffres[rang]);
  if (ecarts.every((e) => e === ecarts[0] && Math.abs(e) <= 1)) return "Ce code se devine trop facilement : évitez les suites et les chiffres répétés";
  return null;
}

/**
 * Enregistrements en attente, comme la séance ouverte : ils partent avant tout verrouillage, pour que
 * rien de saisi ne se perde quand la base se ferme. Chacun rend faux s'il n'a pas pu enregistrer.
 */
const enregistreurs = new Set<() => Promise<boolean>>();

export function enregistrerAvantVerrouillage(enregistrer: () => Promise<boolean>): () => void {
  enregistreurs.add(enregistrer);
  return () => {
    enregistreurs.delete(enregistrer);
  };
}

/** Vrai si tout est enregistré : le cabinet peut se verrouiller. */
export async function toutEnregistrer(): Promise<boolean> {
  const resultats = await Promise.all([...enregistreurs].map((enregistrer) => enregistrer().catch(() => false)));
  return resultats.every(Boolean);
}

/** Les réglages du verrouillage ont changé (mot de passe, durée) : la minuterie relit les siens. */
const EVENEMENT_REGLAGES = "osteosphere:verrouillage";

export function signalerReglagesVerrouillage() {
  window.dispatchEvent(new Event(EVENEMENT_REGLAGES));
}

export function surReglagesVerrouillage(rappel: () => void): () => void {
  window.addEventListener(EVENEMENT_REGLAGES, rappel);
  return () => window.removeEventListener(EVENEMENT_REGLAGES, rappel);
}
