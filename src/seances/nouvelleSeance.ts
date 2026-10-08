import type { Coeur, Patient, ResumePatient, Seance } from "../lib/coeur";
import { modelePropose } from "../lib/modeles";
import { debutMaintenant } from "../lib/seances";

/**
 * Nouvelle séance, maintenant, avec le modèle proposé pour l'âge du patient : « première » s'il n'en a
 * encore aucune, « suivi » sinon. Date et heure restent modifiables dans la séance.
 */
export async function creerSeanceMaintenant(coeur: Coeur, patient: Pick<Patient | ResumePatient, "id" | "naissance">): Promise<Seance> {
  const [modeles, precedentes] = await Promise.all([coeur.listerModeles(), coeur.listerSeancesPatient(patient.id)]);
  const modele = modelePropose(modeles, patient.naissance);
  if (!modele) throw new Error("Aucun modèle de consultation actif : activez-en un dans Paramètres.");
  return coeur.creerSeance(patient.id, {
    debut: debutMaintenant(),
    modele_id: modele.id,
    modele_version: modele.version,
    type: precedentes.some((s) => s.supprimee_le === null) ? "suivi" : "premiere",
    titre: "",
    importante: false,
    valeurs: {},
    facturation: "a_facturer",
    commentaire_gratuit: "",
  });
}
