import { invoke, isTauri } from "@tauri-apps/api/core";

import bibliothequeDeDepart from "../../crates/osteosphere-core/src/bibliotheque_depart.json";

export interface IdentiteCabinet {
  prenom: string;
  nom: string;
  profession: string;
  adresse: string;
  code_postal: string;
  ville: string;
  telephone: string;
  email: string;
  siret: string;
  rpps: string;
}

export type CaractereTrames = "@" | "/";
export type FrequenceSauvegarde = "fermeture" | "jour" | "semaine" | "manuelle";

export interface ChoixPremierDemarrage {
  identite: IdentiteCabinet;
  mot_de_passe: string | null;
  cle_notee: boolean;
  caractere_trames: CaractereTrames;
  sauvegardes: { frequence: FrequenceSauvegarde; dossier: string };
}

export interface PreparationPremierDemarrage {
  cle_de_secours: string;
  dossier_sauvegardes_propose: string;
  session_protegee: boolean;
}

export type EtatDemarrage =
  | { etat: "premier_demarrage" }
  | { etat: "mot_de_passe_requis" }
  | { etat: "cle_de_secours_requise" }
  | { etat: "ouvert"; cabinet: IdentiteCabinet };

export interface Trame {
  id: string;
  code: string;
  titre: string;
  categorie: string;
  modele: string;
  origine: "depart" | "praticien";
  utilisations: number;
}

export interface SaisieTrame {
  code: string;
  titre: string;
  categorie: string;
  modele: string;
}

/** Ce que l'interface demande au cœur Rust. */
export interface Coeur {
  /** Vrai dans l'application ; faux dans le navigateur, où les données sont fictives. */
  readonly reel: boolean;
  etatDemarrage(): Promise<EtatDemarrage>;
  preparerPremierDemarrage(): Promise<PreparationPremierDemarrage>;
  terminerPremierDemarrage(choix: ChoixPremierDemarrage): Promise<IdentiteCabinet>;
  deverrouiller(motDePasse: string): Promise<IdentiteCabinet>;
  ouvrirAvecCleDeSecours(cle: string): Promise<IdentiteCabinet>;
  listerTrames(): Promise<Trame[]>;
  enregistrerTrame(id: string | null, saisie: SaisieTrame): Promise<Trame>;
  supprimerTrame(id: string): Promise<void>;
  noterUtilisationTrame(id: string): Promise<void>;
  caractereTrames(): Promise<CaractereTrames>;
  /** Facture d'essai en PDF, à la date locale `AAAA-MM-JJ`. */
  factureEssaiPdf(date: string): Promise<Uint8Array>;
  ouvrirFactureEssai(date: string): Promise<void>;
}

/** Date du jour sur l'ordinateur du praticien, au format `AAAA-MM-JJ`. */
export function dateDuJour(maintenant = new Date()): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`;
}

export const IDENTITE_VIDE: IdentiteCabinet = {
  prenom: "",
  nom: "",
  profession: "Ostéopathe D.O.",
  adresse: "",
  code_postal: "",
  ville: "",
  telephone: "",
  email: "",
  siret: "",
  rpps: "",
};

/** Les erreurs du cœur arrivent en texte ; elles deviennent des Error à message affichable. */
async function appeler<T>(commande: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(commande, args);
  } catch (erreur) {
    throw new Error(typeof erreur === "string" ? erreur : String(erreur));
  }
}

export const coeurTauri: Coeur = {
  reel: true,
  etatDemarrage: () => appeler("etat_demarrage"),
  preparerPremierDemarrage: () => appeler("preparer_premier_demarrage"),
  terminerPremierDemarrage: (choix) => appeler("terminer_premier_demarrage", { choix }),
  deverrouiller: (motDePasse) => appeler("deverrouiller", { motDePasse }),
  ouvrirAvecCleDeSecours: (cle) => appeler("ouvrir_avec_cle_de_secours", { cle }),
  listerTrames: () => appeler("lister_trames"),
  enregistrerTrame: (id, saisie) => appeler("enregistrer_trame", { id, saisie }),
  supprimerTrame: (id) => appeler("supprimer_trame", { id }),
  noterUtilisationTrame: (id) => appeler("noter_utilisation_trame", { id }),
  caractereTrames: () => appeler("caractere_trames"),
  factureEssaiPdf: async (date) => new Uint8Array(await appeler<ArrayBuffer>("facture_essai_pdf", { date })),
  ouvrirFactureEssai: (date) => appeler("ouvrir_facture_essai", { date }),
};

const CLE_DE_DEMONSTRATION = "7KQM-R4TX-9WBE-H2NC-PX6V-3DFA";

/**
 * Cœur simulé, en mémoire : l'interface fonctionne dans un navigateur et dans les tests,
 * sans base ni chiffrement. Rien n'y est enregistré.
 */
export function creerCoeurDeDemonstration(depart: EtatDemarrage["etat"] = "premier_demarrage"): Coeur {
  let etat = depart;
  let motDePasse: string | null = depart === "mot_de_passe_requis" ? "motdepasse" : null;
  let identite: IdentiteCabinet = { ...IDENTITE_VIDE, prenom: "Alexandre", nom: "Roux" };
  let caractere: CaractereTrames = "@";
  let trames: Trame[] = bibliothequeDeDepart.map((t, rang) => ({ ...t, id: `depart-${rang}`, origine: "depart", utilisations: 0 }));
  let compteur = 0;
  const codePropre = (code: string) => code.trim().replace(/^[@/]/, "").toLowerCase();
  const normaliser = (cle: string) => cle.toUpperCase().replace(/[\s-]/g, "");

  return {
    reel: false,
    async etatDemarrage() {
      return etat === "ouvert" ? { etat, cabinet: identite } : { etat };
    },
    async preparerPremierDemarrage() {
      return {
        cle_de_secours: CLE_DE_DEMONSTRATION,
        dossier_sauvegardes_propose: "C:\\Users\\Praticien\\Documents\\Osteosphere\\Sauvegardes",
        session_protegee: true,
      };
    },
    async terminerPremierDemarrage(choix) {
      if (!choix.cle_notee) throw new Error("Cochez la case qui confirme que la clé de secours est notée ou imprimée.");
      identite = choix.identite;
      motDePasse = choix.mot_de_passe;
      caractere = choix.caractere_trames;
      etat = "ouvert";
      return identite;
    },
    async deverrouiller(saisie) {
      if (saisie !== motDePasse) throw new Error("Mot de passe incorrect");
      etat = "ouvert";
      return identite;
    },
    async ouvrirAvecCleDeSecours(cle) {
      if (normaliser(cle) !== normaliser(CLE_DE_DEMONSTRATION)) throw new Error("Clé de secours incorrecte");
      etat = "ouvert";
      return identite;
    },
    async listerTrames() {
      return [...trames].sort((a, b) => a.code.localeCompare(b.code));
    },
    async enregistrerTrame(id, saisie) {
      const code = codePropre(saisie.code);
      if (!/^[a-z0-9-]{1,20}$/.test(code)) throw new Error("Le code ne contient que des lettres sans accent, des chiffres ou des tirets, 20 au plus");
      if (trames.some((t) => t.code === code && t.id !== id)) throw new Error(`Le code « ${code} » est déjà pris par une autre trame`);
      const existante = trames.find((t) => t.id === id);
      const trame: Trame = {
        id: id ?? `essai-${(compteur += 1)}`,
        code,
        titre: saisie.titre.trim(),
        categorie: saisie.categorie.trim(),
        modele: saisie.modele.trim(),
        origine: existante?.origine ?? "praticien",
        utilisations: existante?.utilisations ?? 0,
      };
      trames = [...trames.filter((t) => t.id !== trame.id), trame];
      return trame;
    },
    async supprimerTrame(id) {
      trames = trames.filter((t) => t.id !== id);
    },
    async noterUtilisationTrame(id) {
      trames = trames.map((t) => (t.id === id ? { ...t, utilisations: t.utilisations + 1 } : t));
    },
    async caractereTrames() {
      return caractere;
    },
    async factureEssaiPdf() {
      throw new Error("La facture PDF est mise en page par le cœur : ouvrez Osteosphere dans sa fenêtre pour l’essayer.");
    },
    async ouvrirFactureEssai() {
      throw new Error("La facture PDF est mise en page par le cœur : ouvrez Osteosphere dans sa fenêtre pour l’essayer.");
    },
  };
}

export function coeurParDefaut(): Coeur {
  return isTauri() ? coeurTauri : creerCoeurDeDemonstration();
}
