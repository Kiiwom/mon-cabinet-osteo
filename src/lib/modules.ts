/**
 * Les modules prévus après la version 1 (cahier des charges, section 8). Aucun n'est encore livré :
 * le socle (patients, séances, facturation, statistiques, sauvegardes) suffit à la pratique courante.
 * Quand un module arrivera, il déclarera ses données, ses écrans, ses champs et ses statistiques.
 */
export type FamilleModule = "cabinet" | "seance" | "rendez_vous" | "appareils";

export interface ModulePrevu {
  id: string;
  nom: string;
  famille: FamilleModule;
  description: string;
  /** Ce que le module ajoutera au logiciel. */
  ajoute: string;
  /** Un module qui en exige un autre ne s'active qu'avec lui. */
  exige?: string;
  /** Faux pour tous, sauf ce qui passe par un prestataire : rien ne sort du poste sans action du praticien. */
  internet?: boolean;
}

export const FAMILLES: { id: FamilleModule; nom: string }[] = [
  { id: "cabinet", nom: "Gestion du cabinet" },
  { id: "seance", nom: "Séance et suivi" },
  { id: "rendez_vous", nom: "Rendez-vous et courriers" },
  { id: "appareils", nom: "Appareils" },
];

export const MODULES_PREVUS: ModulePrevu[] = [
  { id: "depenses", nom: "Dépenses et remises", famille: "cabinet", description: "Dépenses par catégorie, bordereaux de remise de chèques et d’espèces, résultat de l’année.", ajoute: "L’écran Dépenses et le résultat au bilan" },
  { id: "devis", nom: "Devis et relances", famille: "cabinet", description: "Devis, relance des factures impayées.", ajoute: "Un onglet Devis à la facturation" },
  { id: "mutuelles", nom: "Mutuelles", famille: "cabinet", description: "Documents adaptés aux demandes de remboursement des mutuelles.", ajoute: "Un choix d’impression sur la facture" },
  { id: "plusieurs", nom: "Cabinet à plusieurs", famille: "cabinet", description: "Plusieurs praticiens, remplaçants, droits d’accès, rétrocessions.", ajoute: "Un mot de passe par praticien" },
  { id: "biokinergie", nom: "Biokinergie", famille: "seance", description: "Modèle de séance, trames et schémas propres à la Biokinergie.", ajoute: "Un modèle de séance et ses trames, contenu en cours de définition" },
  { id: "pediatrie", nom: "Pédiatrie et grossesse", famille: "seance", description: "Champs et statistiques pour le suivi des nourrissons et des femmes enceintes.", ajoute: "Des courbes de suivi et un tableau aux statistiques" },
  { id: "schema", nom: "Schéma corporel", famille: "seance", description: "Dessin à main levée et zones cliquables sur planches anatomiques libres de droits, au stylet ou au doigt.", ajoute: "Le champ « Schéma sur planches » des modèles de consultation" },
  { id: "provenance", nom: "Provenance des patients", famille: "seance", description: "Champ « envoyé par » et statistiques des personnes qui vous adressent des patients.", ajoute: "Un champ à la fiche et un tableau aux statistiques" },
  { id: "agenda", nom: "Agenda", famille: "rendez_vous", description: "Rendez-vous, codes couleur, disponibilités, import ICS et Doctolib, liste d’attente.", ajoute: "L’écran Agenda au menu" },
  { id: "courriers", nom: "Courriers", famille: "rendez_vous", description: "Courriers au médecin traitant, attestations, remplis depuis le dossier.", ajoute: "Des modèles de courrier dans le dossier" },
  { id: "rappels", nom: "Rappels de rendez-vous", famille: "rendez_vous", description: "Email ou SMS envoyés par le prestataire de votre choix.", ajoute: "L’envoi des rappels depuis l’agenda", exige: "agenda", internet: true },
  { id: "dictee", nom: "Dictée vocale", famille: "appareils", description: "Transcription de la voix sur ce poste, sans envoyer l’audio sur internet.", ajoute: "Un bouton micro dans les champs de saisie" },
  { id: "tablette", nom: "Version tablette", famille: "appareils", description: "Le cabinet sur une tablette Android ou iPad, synchronisée avec ce poste sans hébergeur.", ajoute: "L’appairage par QR code sur le réseau du cabinet" },
];

export function nomDuModule(id: string): string {
  return MODULES_PREVUS.find((m) => m.id === id)?.nom ?? id;
}
