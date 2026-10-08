import type { IdentiteCabinet, Patient, Seance } from "./coeur";
import {
  destinataireDuPatient,
  montantLigne,
  type EvenementFacture,
  type Facture,
  type FactureDeSeance,
  type LigneFacture,
  type LigneRecette,
  type Moyen,
  type Nature,
  type Prestation,
  type ReglagesNumerotation,
  type Reglement,
  type ResumeFacture,
  type SaisieFacture,
  type SaisiePrestation,
  type SaisieReglement,
} from "./facturation";

/** Ce que la facturation de démonstration lit du reste du cœur simulé. */
export interface AccesDemonstration {
  patient(id: string): Patient;
  /** Le proche qui reçoit les factures du patient, s'il y en a un. */
  payeur(patient: Patient): Patient | null;
  seance(id: string): Seance | undefined;
  identite(): IdentiteCabinet;
}

interface Brute extends SaisieFacture {
  id: string;
  nature: Nature;
  etat: Facture["etat"];
  numero: string | null;
  date_emission: string | null;
  annee: number | null;
  sequence: number | null;
  total_centimes: number;
  praticien: IdentiteCabinet | null;
  origine_id: string | null;
  importee: boolean;
  cree_le: number;
  modifie_le: number;
}

const PRESTATIONS_FICTIVES: SaisiePrestation[] = [
  { libelle: "Consultation", libelle_imprime: "Consultation d’ostéopathie", tarif_centimes: 5500, couleur: "bleu", par_defaut: true, archivee: false },
  { libelle: "Consultation enfant", libelle_imprime: "", tarif_centimes: 4500, couleur: "vert", par_defaut: false, archivee: false },
  { libelle: "Séance de Biokinergie", libelle_imprime: "", tarif_centimes: 5500, couleur: "violet", par_defaut: false, archivee: false },
];

/** Factures fictives des séances de démonstration ; une facture sans séance pour Paul Morel. */
const FACTURES_FICTIVES: { seance?: string; patient: string; numero: string; date: string; prix: number; reglement?: { moyen: Moyen; le: string; reference?: string } }[] = [
  { seance: "seance-6", patient: "patient-4", numero: "2025-03-412", date: "2025-03-05", prix: 5000, reglement: { moyen: "especes", le: "2025-03-05" } },
  { seance: "seance-2", patient: "patient-1", numero: "2026-07-1650", date: "2026-07-03", prix: 5500, reglement: { moyen: "carte", le: "2026-07-03" } },
  { seance: "seance-3", patient: "patient-1", numero: "2026-09-1741", date: "2026-09-12", prix: 5500 },
  { patient: "patient-5", numero: "2026-10-1769", date: "2026-10-05", prix: 5000, reglement: { moyen: "virement", le: "2026-10-05" } },
  { seance: "seance-4", patient: "patient-7", numero: "2026-10-1770", date: "2026-10-06", prix: 5500, reglement: { moyen: "cheque", le: "2026-10-06", reference: "0004512" } },
];

const propre = (t: string) => t.trim().replace(/\s+/g, " ");

/**
 * Facturation simulée en mémoire, avec les mêmes règles que le cœur : brouillon, émission
 * numérotée et chronologique, correction par avoir et facture rectificative, règlements.
 */
export function creerFacturationDeDemonstration(acces: AccesDemonstration, exemples: boolean) {
  let compteur = 0;
  const nouvelId = (prefixe: string) => `${prefixe}-${(compteur += 1)}`;
  const maintenant = () => Math.floor(Date.now() / 1000);
  let prestations: Prestation[] = PRESTATIONS_FICTIVES.map((p, rang) => ({ ...p, id: `prestation-${rang + 1}`, rang: rang + 1, cree_le: 0, modifie_le: 0 }));
  let reglages: ReglagesNumerotation = { format: { modele: "{AAAA}-{MM}-{N}", chiffres: 1 }, depart: null };
  let factures: Brute[] = [];
  let reglements: Reglement[] = [];
  let journal: (EvenementFacture & { entite: string })[] = [];

  const noter = (entite: string, action: string, detail: Partial<EvenementFacture> = {}) => {
    journal = [...journal, { entite, action, le: maintenant(), numero: null, montant_centimes: null, moyen: null, ...detail }];
  };

  const trouver = (id: string) => {
    const f = factures.find((x) => x.id === id);
    if (!f) throw new Error("Cette facture n’existe plus");
    return f;
  };
  const remplacer = (f: Brute) => {
    factures = factures.map((x) => (x.id === f.id ? f : x));
    return f;
  };
  const regle = (id: string) => reglements.filter((r) => r.facture_id === id).reduce((t, r) => t + r.montant_centimes, 0);
  const reste = (f: Brute, r: number) => (f.nature === "facture" && f.etat === "emise" ? f.total_centimes - r : 0);
  const renvoi = (f: Brute | undefined) => (f && f.numero && f.date_emission ? { id: f.id, numero: f.numero, date_emission: f.date_emission } : null);

  function lire(id: string): Facture {
    const f = trouver(id);
    const { annee: _a, sequence: _s, origine_id, ...reste_ } = f;
    const r = regle(id);
    return structuredClone({
      ...reste_,
      regle_centimes: r,
      reste_centimes: reste(f, r),
      remboursable_centimes: f.nature === "avoir" && origine_id ? Math.max(0, regle(origine_id) + r) : 0,
      origine: renvoi(factures.find((x) => x.id === origine_id)),
      avoir: f.etat === "annulee" ? renvoi(factures.find((x) => x.origine_id === id && x.nature === "avoir")) : null,
      rectificative: f.etat === "annulee" ? renvoi(factures.find((x) => x.origine_id === id && x.nature === "facture")) : null,
      reglements: reglements.filter((x) => x.facture_id === id).sort((a, b) => a.encaisse_le.localeCompare(b.encaisse_le)),
    });
  }

  function resume(f: Brute): ResumeFacture {
    const r = regle(f.id);
    const patient = f.patient_id ? (() => { try { return acces.patient(f.patient_id!); } catch { return null; } })() : null;
    const premiere = f.lignes[0]?.designation ?? "";
    return {
      id: f.id,
      nature: f.nature,
      etat: f.etat,
      numero: f.numero,
      date_emission: f.date_emission,
      patient_id: f.patient_id,
      patient_nom: patient?.nom ?? "",
      patient_prenom: patient?.prenom ?? "",
      destinataire: [f.destinataire.prenom, f.destinataire.nom].filter(Boolean).join(" "),
      seance_id: f.seance_id,
      date_seance: f.date_seance,
      designation: f.lignes.length > 1 ? `${premiere}…` : premiere,
      total_centimes: f.total_centimes,
      regle_centimes: r,
      reste_centimes: reste(f, r),
      moyens: [...new Set(reglements.filter((x) => x.facture_id === f.id).map((x) => x.moyen))],
      origine_numero: factures.find((x) => x.id === f.origine_id)?.numero ?? null,
      importee: f.importee,
    };
  }

  const trier = (liste: Brute[]) =>
    [...liste]
      .sort(
        (a, b) =>
          Number(b.numero === null) - Number(a.numero === null) ||
          (b.date_emission ?? "").localeCompare(a.date_emission ?? "") ||
          (b.annee ?? 0) - (a.annee ?? 0) ||
          (b.sequence ?? 0) - (a.sequence ?? 0),
      )
      .map(resume);

  function verifier(saisie: SaisieFacture): { saisie: SaisieFacture; total: number } {
    if (saisie.lignes.length === 0) throw new Error("Une facture compte au moins une ligne");
    const lignes: LigneFacture[] = saisie.lignes.map((l) => {
      const ligne = { ...l, designation: propre(l.designation) };
      if (!ligne.designation) throw new Error("Chaque ligne de la facture a besoin d’une désignation");
      if (!Number.isInteger(ligne.quantite) || ligne.quantite < 1 || ligne.quantite > 999) throw new Error("Quantité impossible");
      if (ligne.prix_unitaire_centimes < 0) throw new Error("Prix impossible");
      if (ligne.reduction_centimes < 0 || ligne.reduction_centimes > ligne.prix_unitaire_centimes * ligne.quantite)
        throw new Error("La réduction dépasse le montant de la ligne");
      return ligne;
    });
    if (!propre(saisie.destinataire.nom)) throw new Error("Indiquez le nom du destinataire de la facture");
    return {
      saisie: {
        ...saisie,
        lignes,
        destinataire: { ...saisie.destinataire, nom: propre(saisie.destinataire.nom), prenom: propre(saisie.destinataire.prenom) },
        commentaire_imprime: saisie.commentaire_imprime.trim(),
        commentaire_interne: saisie.commentaire_interne.trim(),
      },
      total: lignes.reduce((t, l) => t + montantLigne(l), 0),
    };
  }

  const enCours = (seanceId: string, sauf?: string) =>
    factures.find((f) => f.seance_id === seanceId && f.nature === "facture" && (f.etat === "brouillon" || f.etat === "emise") && f.id !== sauf);

  function verifierLiens(saisie: SaisieFacture, sauf?: string): SaisieFacture {
    if (saisie.seance_id) {
      const seance = acces.seance(saisie.seance_id);
      if (!seance) throw new Error("Cette séance n’existe plus");
      if (seance.supprimee_le !== null) throw new Error("Cette séance est à la corbeille");
      if (seance.facturation === "gratuit") throw new Error("Cette séance est un acte gratuit");
      if (enCours(seance.id, sauf)) throw new Error("Cette séance a déjà sa facture");
      return { ...saisie, patient_id: seance.patient_id, date_seance: saisie.date_seance ?? seance.debut.slice(0, 10) };
    }
    if (saisie.patient_id) acces.patient(saisie.patient_id);
    return saisie;
  }

  function inserer(nature: Nature, saisie: SaisieFacture, total: number, origine: string | null): Brute {
    const f: Brute = {
      ...saisie,
      id: nouvelId(nature),
      nature,
      etat: "brouillon",
      numero: null,
      date_emission: null,
      annee: null,
      sequence: null,
      total_centimes: total,
      praticien: null,
      origine_id: origine,
      importee: false,
      cree_le: maintenant(),
      modifie_le: maintenant(),
    };
    factures = [...factures, f];
    return f;
  }

  function numeroSuivant(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date invalide");
    const emises = factures.filter((f) => f.numero && !f.importee);
    const derniere = emises.map((f) => f.date_emission!).sort().pop();
    if (derniere && date < derniere) throw new Error(`Cette date précède la facture du ${derniere}, déjà émise : l’ordre chronologique doit être respecté`);
    const annee = Number(date.slice(0, 4));
    const dansLAnnee = factures.filter((f) => f.annee === annee && f.sequence !== null);
    const depart = reglages.depart?.annee === annee ? reglages.depart.compteur : 1;
    const sequence = dansLAnnee.length ? Math.max(...dansLAnnee.map((f) => f.sequence!)) + 1 : depart;
    const numero = reglages.format.modele
      .replace("{AAAA}", String(annee))
      .replace("{AA}", String(annee % 100).padStart(2, "0"))
      .replace("{MM}", date.slice(5, 7))
      .replace("{N}", String(sequence).padStart(reglages.format.chiffres, "0"));
    return { numero, annee, sequence };
  }

  function numeroter(f: Brute, date: string): Brute {
    const identite = acces.identite();
    const manquantes = (
      [
        ["adresse", identite.adresse],
        ["code postal", identite.code_postal],
        ["ville", identite.ville],
        ["SIRET", identite.siret],
        ["RPPS", identite.rpps],
      ] as const
    )
      .filter(([, v]) => !v.trim())
      .map(([m]) => m);
    if (manquantes.length) throw new Error(`Mentions obligatoires à compléter dans Paramètres › Cabinet avant d’émettre : ${manquantes.join(", ")}`);
    const { numero, annee, sequence } = numeroSuivant(date);
    return remplacer({ ...f, etat: "emise", numero, annee, sequence, date_emission: date, praticien: { ...identite }, modifie_le: maintenant() });
  }

  /** Les opérations en plusieurs temps sont annulées en bloc si l'une échoue. */
  function atomique<T>(operation: () => T): T {
    const avant = { factures, reglements, journal, compteur };
    try {
      return operation();
    } catch (e) {
      ({ factures, reglements, journal, compteur } = avant);
      throw e;
    }
  }

  function emettre(id: string, date: string): Facture {
    return atomique(() => {
      const f = trouver(id);
      if (f.etat !== "brouillon") throw new Error("Cette facture est déjà émise");
      verifierLiens(f, id);
      const emise = numeroter(f, date);
      noter(id, "facture.emise", { numero: emise.numero });
      return lire(id);
    });
  }

  function emettreAvoir(originale: Brute, date: string): Brute {
    if (originale.nature !== "facture" || originale.etat !== "emise") throw new Error("Seule une facture émise peut être corrigée ou annulée");
    remplacer({ ...originale, etat: "annulee", modifie_le: maintenant() });
    const avoir = numeroter(inserer("avoir", { ...originale, commentaire_imprime: "", commentaire_interne: "" }, -originale.total_centimes, originale.id), date);
    noter(avoir.id, "avoir.emis", { numero: avoir.numero });
    return avoir;
  }

  function verifierReglement(saisie: SaisieReglement): SaisieReglement {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saisie.encaisse_le)) throw new Error("Date invalide");
    if (!saisie.montant_centimes) throw new Error("Montant du règlement impossible");
    return { ...saisie, reference: propre(saisie.reference), payeur: propre(saisie.payeur), commentaire: saisie.commentaire.trim() };
  }

  function verifierMontant(f: Brute, remplace: number, montant: number) {
    if (f.etat === "brouillon") throw new Error("Émettez la facture avant d’y noter un règlement");
    if (f.etat === "annulee") throw new Error("Cette facture est annulée : un remboursement se note sur son avoir");
    const total = regle(f.id) - remplace + montant;
    if (f.nature === "facture" && montant > 0 && total > f.total_centimes) throw new Error("Le règlement dépasse le reste à régler");
    if (f.nature === "facture" && total < 0) throw new Error("Le remboursement dépasse ce qui a été réglé");
    if (f.nature === "avoir" && montant > 0) throw new Error("Sur un avoir, notez un remboursement : un montant négatif");
    if (f.nature === "avoir" && total < f.total_centimes) throw new Error("Le remboursement dépasse le montant de l’avoir");
    if (f.nature === "avoir" && montant < 0 && f.origine_id && -montant > Math.max(0, regle(f.origine_id) + regle(f.id)) + Math.abs(remplace))
      throw new Error("Le remboursement dépasse ce que le patient avait réglé sur la facture annulée");
  }

  function ajouterReglement(factureId: string, saisie: SaisieReglement): Facture {
    const r = verifierReglement(saisie);
    verifierMontant(trouver(factureId), 0, r.montant_centimes);
    reglements = [...reglements, { ...r, id: nouvelId("reglement"), facture_id: factureId, importe: false, cree_le: maintenant(), modifie_le: maintenant() }];
    noter(factureId, "reglement.ajoute", { montant_centimes: r.montant_centimes, moyen: r.moyen });
    return lire(factureId);
  }

  function facturerSeance(seanceId: string, lignes: LigneFacture[], reglement: SaisieReglement | null, date: string): Facture {
    return atomique(() => {
      const existante = enCours(seanceId);
      if (existante?.etat === "emise") throw new Error("Cette séance est déjà facturée");
      let id: string;
      if (existante) {
        id = modifier(existante.id, { ...existante, lignes }).id;
      } else {
        const seance = acces.seance(seanceId);
        if (!seance) throw new Error("Cette séance n’existe plus");
        const patient = acces.patient(seance.patient_id);
        const destinataire = destinataireDuPatient(patient, acces.payeur(patient));
        id = creer({ patient_id: patient.id, seance_id: seanceId, date_seance: null, destinataire, lignes, commentaire_imprime: "", commentaire_interne: "" }).id;
      }
      emettre(id, date);
      if (reglement) ajouterReglement(id, reglement);
      return lire(id);
    });
  }

  function creer(saisie: SaisieFacture): Facture {
    const { saisie: propreSaisie, total } = verifier(saisie);
    const f = inserer("facture", verifierLiens(propreSaisie), total, null);
    noter(f.id, "facture.brouillon");
    return lire(f.id);
  }

  function modifier(id: string, saisie: SaisieFacture): Facture {
    const avant = trouver(id);
    if (avant.etat !== "brouillon") throw new Error("Une facture émise ne se modifie pas : corrigez-la par un avoir");
    const { saisie: propreSaisie, total } = verifier(saisie);
    remplacer({ ...avant, ...verifierLiens(propreSaisie, id), total_centimes: total, modifie_le: maintenant() });
    noter(id, "facture.modifiee");
    return lire(id);
  }

  if (exemples) {
    for (const f of FACTURES_FICTIVES) {
      const patient = acces.patient(f.patient);
      const id = nouvelId("facture");
      const [annee, , sequence] = f.numero.split("-").map(Number);
      factures.push({
        id,
        nature: "facture",
        etat: "emise",
        numero: f.numero,
        date_emission: f.date,
        annee,
        sequence,
        patient_id: patient.id,
        seance_id: f.seance ?? null,
        date_seance: f.seance ? f.date : null,
        destinataire: destinataireDuPatient(patient),
        lignes: [{ prestation_id: "prestation-1", designation: "Consultation d’ostéopathie", quantite: 1, prix_unitaire_centimes: f.prix, reduction_centimes: 0 }],
        total_centimes: f.prix,
        commentaire_imprime: "",
        commentaire_interne: "",
        praticien: acces.identite(),
        origine_id: null,
        importee: false,
        cree_le: 0,
        modifie_le: 0,
      });
      journal.push({ entite: id, action: "facture.emise", le: 0, numero: f.numero, montant_centimes: null, moyen: null });
      if (f.reglement) {
        reglements.push({
          id: nouvelId("reglement"),
          facture_id: id,
          moyen: f.reglement.moyen,
          montant_centimes: f.prix,
          encaisse_le: f.reglement.le,
          reference: f.reglement.reference ?? "",
          payeur: "",
          commentaire: "",
          importe: false,
          cree_le: 0,
          modifie_le: 0,
        });
        journal.push({ entite: id, action: "reglement.ajoute", le: 0, numero: null, montant_centimes: f.prix, moyen: f.reglement.moyen });
      }
    }
  }

  return {
    /** Pour les listes de séances : la facture en cours de la séance. */
    factureDeSeanceResumee(seanceId: string): FactureDeSeance | null {
      const f = enCours(seanceId);
      return f ? { id: f.id, numero: f.numero, reste_centimes: reste(f, regle(f.id)) } : null;
    },
    /** La séance a-t-elle été facturée (facture émise, annulée ou avoir) ? */
    seanceFacturee(seanceId: string): boolean {
      return factures.some((f) => f.seance_id === seanceId && f.etat !== "brouillon");
    },
    supprimerBrouillonsDeSeance(seanceId: string) {
      factures = factures.filter((f) => !(f.seance_id === seanceId && f.etat === "brouillon"));
    },
    nombreFactures(patientId: string): number {
      return factures.filter((f) => f.patient_id === patientId).length;
    },
    /** Fusion de deux dossiers : les factures de l'un passent à l'autre. */
    deplacerFactures(de: string, vers: string) {
      factures = factures.map((f) => (f.patient_id === de ? { ...f, patient_id: vers } : f));
    },
    /** Effacement d'un dossier : les brouillons partent, les factures émises restent sans dossier. */
    detacherFactures(patientId: string, seancesIds: string[]): { conservees: number; brouillons: number } {
      const concernee = (f: Brute) => f.patient_id === patientId || (f.seance_id !== null && seancesIds.includes(f.seance_id));
      const brouillons = factures.filter((f) => concernee(f) && f.etat === "brouillon").length;
      factures = factures.filter((f) => !(concernee(f) && f.etat === "brouillon"));
      const conservees = factures.filter(concernee).length;
      factures = factures.map((f) => (concernee(f) ? { ...f, patient_id: null, seance_id: null } : f));
      return { conservees, brouillons };
    },
    async listerPrestations() {
      return [...prestations].sort((a, b) => Number(a.archivee) - Number(b.archivee) || a.rang - b.rang);
    },
    async enregistrerPrestation(id: string | null, saisie: SaisiePrestation) {
      const libelle = propre(saisie.libelle);
      if (!libelle) throw new Error("Donnez un libellé à la prestation");
      if (saisie.tarif_centimes < 0) throw new Error("Tarif impossible");
      if (saisie.archivee && saisie.par_defaut) throw new Error("Une prestation archivée ne peut pas être proposée par défaut");
      if (saisie.par_defaut) prestations = prestations.map((p) => ({ ...p, par_defaut: false }));
      const avant = prestations.find((p) => p.id === id);
      if (id && !avant) throw new Error("Cette prestation n’existe plus");
      const prestation: Prestation = {
        ...saisie,
        libelle,
        libelle_imprime: propre(saisie.libelle_imprime),
        id: avant?.id ?? nouvelId("prestation"),
        rang: avant?.rang ?? prestations.length + 1,
        cree_le: avant?.cree_le ?? maintenant(),
        modifie_le: maintenant(),
      };
      prestations = avant ? prestations.map((p) => (p.id === prestation.id ? prestation : p)) : [...prestations, prestation];
      return prestation;
    },
    async reglagesNumerotation() {
      return structuredClone(reglages);
    },
    async enregistrerReglagesNumerotation(r: ReglagesNumerotation) {
      if (!r.format.modele.includes("{N}")) throw new Error("Le modèle de numéro doit contenir {N}");
      if (!r.format.modele.includes("{AAAA}") && !r.format.modele.includes("{AA}")) throw new Error("Le modèle de numéro doit contenir l’année, {AAAA} ou {AA}");
      if (r.format.chiffres < 1 || r.format.chiffres > 8) throw new Error("Le compteur compte de 1 à 8 chiffres");
      reglages = { ...structuredClone(r), format: { ...r.format, modele: r.format.modele.trim() } };
      return structuredClone(reglages);
    },
    async numeroSuivant(date: string) {
      return numeroSuivant(date).numero;
    },
    async lireFacture(id: string) {
      return lire(id);
    },
    async creerFacture(saisie: SaisieFacture) {
      return creer(saisie);
    },
    async modifierFacture(id: string, saisie: SaisieFacture) {
      return modifier(id, saisie);
    },
    async annoterFacture(id: string, commentaire: string) {
      const f = trouver(id);
      if (f.commentaire_interne !== commentaire.trim()) {
        remplacer({ ...f, commentaire_interne: commentaire.trim() });
        noter(id, "facture.annotee");
      }
      return lire(id);
    },
    async supprimerBrouillon(id: string) {
      if (trouver(id).etat !== "brouillon") throw new Error("Une facture émise ne se supprime pas : annulez-la par un avoir");
      factures = factures.filter((f) => f.id !== id);
    },
    async emettreFacture(id: string, date: string) {
      return emettre(id, date);
    },
    async facturerSeance(seanceId: string, lignes: LigneFacture[], reglement: SaisieReglement | null, date: string) {
      return facturerSeance(seanceId, lignes, reglement, date);
    },
    async facturerSeances(seances: string[], reglement: SaisieReglement | null, date: string) {
      const prestation = prestations.find((p) => p.par_defaut && !p.archivee) ?? prestations.find((p) => !p.archivee);
      if (!prestation) throw new Error("Créez d’abord une prestation dans Paramètres › Prestations et numérotation.");
      const ligne: LigneFacture = {
        prestation_id: prestation.id,
        designation: prestation.libelle_imprime || prestation.libelle,
        quantite: 1,
        prix_unitaire_centimes: prestation.tarif_centimes,
        reduction_centimes: 0,
      };
      return seances.map((s) => facturerSeance(s, [ligne], reglement ? { ...reglement, montant_centimes: ligne.prix_unitaire_centimes } : null, date));
    },
    async corrigerFacture(id: string, saisie: SaisieFacture, date: string) {
      const { saisie: propreSaisie, total } = verifier(saisie);
      return atomique(() => {
        const originale = trouver(id);
        emettreAvoir(originale, date);
        const rectificative = numeroter(
          inserer(
            "facture",
            { ...propreSaisie, patient_id: originale.patient_id, seance_id: originale.seance_id, date_seance: propreSaisie.date_seance ?? originale.date_seance },
            total,
            id,
          ),
          date,
        );
        reglements = reglements.map((r) => (r.facture_id === id ? { ...r, facture_id: rectificative.id } : r));
        noter(rectificative.id, "facture.emise", { numero: rectificative.numero });
        noter(id, "facture.corrigee", { numero: rectificative.numero });
        return lire(rectificative.id);
      });
    },
    async annulerFacture(id: string, date: string) {
      return atomique(() => {
        const avoir = emettreAvoir(trouver(id), date);
        noter(id, "facture.annulee", { numero: avoir.numero });
        return lire(avoir.id);
      });
    },
    async ajouterReglement(factureId: string, saisie: SaisieReglement) {
      return ajouterReglement(factureId, saisie);
    },
    async modifierReglement(id: string, saisie: SaisieReglement) {
      const avant = reglements.find((r) => r.id === id);
      if (!avant) throw new Error("Ce règlement n’existe plus");
      const r = verifierReglement(saisie);
      verifierMontant(trouver(avant.facture_id), avant.montant_centimes, r.montant_centimes);
      reglements = reglements.map((x) => (x.id === id ? { ...x, ...r, modifie_le: maintenant() } : x));
      noter(avant.facture_id, "reglement.modifie", { montant_centimes: r.montant_centimes, moyen: r.moyen });
      return lire(avant.facture_id);
    },
    async supprimerReglement(id: string) {
      const avant = reglements.find((r) => r.id === id);
      if (!avant) throw new Error("Ce règlement n’existe plus");
      reglements = reglements.filter((r) => r.id !== id);
      noter(avant.facture_id, "reglement.supprime", { montant_centimes: avant.montant_centimes, moyen: avant.moyen });
      return lire(avant.facture_id);
    },
    async listerFactures(du: string, au: string) {
      return trier(factures.filter((f) => f.etat === "brouillon" || (f.date_emission! >= du && f.date_emission! <= au)));
    },
    async facturesEnAttente() {
      return trier(factures.filter((f) => f.nature === "facture" && f.etat === "emise" && f.total_centimes > regle(f.id)));
    },
    async facturesPatient(patientId: string) {
      return trier(factures.filter((f) => f.patient_id === patientId));
    },
    async factureDeSeance(seanceId: string) {
      const f = enCours(seanceId);
      return f ? lire(f.id) : null;
    },
    async historiqueFacture(id: string) {
      return journal.filter((e) => e.entite === id).map(({ entite: _e, ...e }) => e);
    },
    async recettes(du: string, au: string): Promise<LigneRecette[]> {
      return reglements
        .filter((r) => r.encaisse_le >= du && r.encaisse_le <= au)
        .sort((a, b) => b.encaisse_le.localeCompare(a.encaisse_le) || b.cree_le - a.cree_le)
        .map((r) => {
          const f = trouver(r.facture_id);
          const resumee = resume(f);
          const nom = [resumee.patient_prenom, resumee.patient_nom].filter(Boolean).join(" ") || resumee.destinataire;
          const { id, facture_id, importe, cree_le: _c, modifie_le: _m, ...saisie } = r;
          return { ...saisie, id, facture_id, importe, facture_numero: f.numero, facture_date: f.date_emission, nature: f.nature, patient_id: f.patient_id, nom };
        });
    },
  };
}

export type FacturationDeDemonstration = ReturnType<typeof creerFacturationDeDemonstration>;
