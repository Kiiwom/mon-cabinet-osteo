import type { Antecedent, Patient, ResumeSeance } from "./coeur";
import type { LigneRecette, Moyen, ResumeFacture } from "./facturation";

export type BaseChiffre = "encaissement" | "facture";

export interface Comparaison {
  valeur: number;
  precedent: number;
}

export interface MoisStatistiques {
  /** `AAAA-MM`. */
  mois: string;
  chiffre: number;
  chiffre_precedent: number;
  seances: number;
  seances_precedent: number;
  /** Premières séances du mois, les autres étant des suivis. */
  premieres: number;
  /** Patients dont la toute première séance tombe dans le mois. */
  nouveaux: number;
  nouveaux_precedent: number;
}

export interface SemaineStatistiques {
  /** Le lundi, `AAAA-MM-JJ`, parfois avant le début de la période. */
  lundi: string;
  seances: number;
  premieres: number;
}

/** Patients suivis selon leur dernière séance : dans l'année, il y a un à deux ans, au-delà. */
export interface Recence {
  actifs: number;
  dormants: number;
  inactifs: number;
}

export interface Compte {
  libelle: string;
  nombre: number;
}

export interface Statistiques {
  du: string;
  au: string;
  du_precedent: string;
  au_precedent: string;
  base: BaseChiffre;
  chiffre: Comparaison;
  seances: Comparaison;
  panier_moyen: Comparaison;
  nouveaux_patients: Comparaison;
  par_mois: MoisStatistiques[];
  moyens: { moyen: Moyen; montant: number; nombre: number }[];
  patients_actifs: number;
  age_moyen: number | null;
  ages: Compte[];
  sexes: { femmes: number; hommes: number; non_renseigne: number };
  recence: Recence;
  seances_par_patient: number;
  premieres_seances: number;
  actes_gratuits: number;
  villes: Compte[];
  antecedents: Compte[];
  patients_suivis: { id: string; nom: string; prenom: string; seances: number }[];
  douleur: { seances: number; avant: number; apres: number } | null;
  jours: Compte[];
  /** Séances par jour (du lundi au dimanche) et par heure de début (de 0 à 23 h). */
  creneaux: number[][];
  par_semaine: SemaineStatistiques[];
}

const TRANCHES: [number, string][] = [
  [3, "Moins de 3 ans"],
  [12, "3 à 11 ans"],
  [18, "12 à 17 ans"],
  [30, "18 à 29 ans"],
  [45, "30 à 44 ans"],
  [60, "45 à 59 ans"],
  [75, "60 à 74 ans"],
  [Infinity, "75 ans et plus"],
];
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function unAnAvant(date: string): string {
  const [a, m, j] = date.split("-");
  return `${Number(a) - 1}-${m}-${m === "02" && j === "29" ? "28" : j}`;
}

function jours(date: string): number {
  const [a, m, j] = date.split("-").map(Number);
  return Math.floor(Date.UTC(a, m - 1, j) / 86_400_000);
}

function classement(comptes: Map<string, number>, n: number): Compte[] {
  return [...comptes.entries()]
    .filter(([l]) => l.trim())
    .map(([libelle, nombre]) => ({ libelle, nombre }))
    .sort((a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle))
    .slice(0, n);
}

/** Le même calcul que le cœur, pour la démonstration : à partir des listes déjà disponibles. */
export function calculerStatistiques(
  donnees: {
    patients: Patient[];
    seances: ResumeSeance[];
    antecedents: Antecedent[];
    recettes: LigneRecette[];
    factures: ResumeFacture[];
  },
  du: string,
  au: string,
  base: BaseChiffre,
): Statistiques {
  const duP = unAnAvant(du);
  const auP = unAnAvant(au);
  const dans = (d: string, a: string, b: string) => d >= a && d <= b;
  const chiffre = (a: string, b: string) =>
    base === "encaissement"
      ? donnees.recettes.filter((r) => dans(r.encaisse_le, a, b)).map((r) => ({ date: r.encaisse_le, montant: r.montant_centimes }))
      : donnees.factures.filter((f) => f.numero && dans(f.date_emission!, a, b)).map((f) => ({ date: f.date_emission!, montant: f.total_centimes }));
  const vivantes = donnees.seances.filter((s) => s.supprimee_le === null);
  const seancesEntre = (a: string, b: string) => vivantes.filter((s) => dans(s.debut.slice(0, 10), a, b));
  const ca = chiffre(du, au);
  const caP = chiffre(duP, auP);
  const liste = seancesEntre(du, au);
  const listeP = seancesEntre(duP, auP);
  const somme = (l: { montant: number }[]) => l.reduce((t, x) => t + x.montant, 0);
  const facturees = (l: ResumeSeance[]) => l.filter((s) => s.facturation === "a_facturer").length;
  const panier = (c: number, n: number) => (n > 0 ? Math.trunc(c / n) : 0);

  const premieres = new Map<string, string>();
  for (const s of vivantes) {
    const d = s.debut.slice(0, 10);
    if (!premieres.has(s.patient_id) || d < premieres.get(s.patient_id)!) premieres.set(s.patient_id, d);
  }
  const nouveaux = (a: string, b: string) => [...premieres.values()].filter((d) => dans(d, a, b)).length;
  const nouveauxDuMois = (cle: string, a: string, b: string) => [...premieres.values()].filter((d) => dans(d, a, b) && d.startsWith(cle)).length;

  const parMois: MoisStatistiques[] = [];
  let [annee, mois] = du.split("-").map(Number);
  const [anneeFin, moisFin] = au.split("-").map(Number);
  while (annee < anneeFin || (annee === anneeFin && mois <= moisFin)) {
    const cle = `${annee}-${String(mois).padStart(2, "0")}`;
    const cleP = `${annee - 1}-${String(mois).padStart(2, "0")}`;
    parMois.push({
      mois: cle,
      chiffre: somme(ca.filter((x) => x.date.startsWith(cle))),
      chiffre_precedent: somme(caP.filter((x) => x.date.startsWith(cleP))),
      seances: liste.filter((s) => s.debut.startsWith(cle)).length,
      seances_precedent: listeP.filter((s) => s.debut.startsWith(cleP)).length,
      premieres: liste.filter((s) => s.debut.startsWith(cle) && s.type === "premiere").length,
      nouveaux: nouveauxDuMois(cle, du, au),
      nouveaux_precedent: nouveauxDuMois(cleP, duP, auP),
    });
    [annee, mois] = mois === 12 ? [annee + 1, 1] : [annee, mois + 1];
  }

  const moyens = new Map<Moyen, { montant: number; nombre: number }>();
  for (const r of donnees.recettes.filter((r) => dans(r.encaisse_le, du, au))) {
    const m = moyens.get(r.moyen) ?? { montant: 0, nombre: 0 };
    moyens.set(r.moyen, { montant: m.montant + r.montant_centimes, nombre: m.nombre + 1 });
  }
  const ordre: Moyen[] = ["carte", "cheque", "especes", "virement", "autre"];

  const parPatient = new Map<string, number>();
  for (const s of liste) parPatient.set(s.patient_id, (parPatient.get(s.patient_id) ?? 0) + 1);
  const actifs = donnees.patients.filter((p) => parPatient.has(p.id));
  const ages = new Map<string, number>();
  let sommeAges = 0;
  let nombreAges = 0;
  for (const p of actifs) {
    let tranche = "Âge non renseigné";
    if (p.naissance) {
      const [an, mo, jo] = p.naissance.split("-").map(Number);
      const [af, mf, jf] = au.split("-").map(Number);
      const age = af - an - (mf < mo || (mf === mo && jf < jo) ? 1 : 0);
      sommeAges += age;
      nombreAges += 1;
      tranche = TRANCHES.find(([limite]) => age < limite)![1];
    }
    ages.set(tranche, (ages.get(tranche) ?? 0) + 1);
  }
  const recence: Recence = { actifs: 0, dormants: 0, inactifs: 0 };
  const unAn = unAnAvant(au);
  const deuxAns = unAnAvant(unAn);
  for (const p of donnees.patients.filter((p) => !p.archive && !p.decede)) {
    const derniere = vivantes
      .filter((s) => s.patient_id === p.id && s.debut.slice(0, 10) <= au)
      .map((s) => s.debut.slice(0, 10))
      .sort()
      .pop();
    if (!derniere) continue;
    if (derniere >= unAn) recence.actifs += 1;
    else if (derniere >= deuxAns) recence.dormants += 1;
    else recence.inactifs += 1;
  }
  const villes = new Map<string, number>();
  for (const p of actifs) villes.set(p.ville.trim(), (villes.get(p.ville.trim()) ?? 0) + 1);
  const antecedents = new Map<string, number>();
  const vus = new Set<string>();
  for (const a of donnees.antecedents) {
    const cle = `${a.patient_id}/${a.rubrique}`;
    if (parPatient.has(a.patient_id) && !vus.has(cle)) {
      vus.add(cle);
      antecedents.set(a.rubrique, (antecedents.get(a.rubrique) ?? 0) + 1);
    }
  }
  const notees = liste.filter((s) => s.douleur_avant !== null && s.douleur_apres !== null);
  const parJour = [0, 0, 0, 0, 0, 0, 0];
  const creneaux = JOURS.map(() => Array<number>(24).fill(0));
  const lundi = (d: string) => jours(d) - ((jours(d) + 3) % 7);
  const semaines = new Map<number, { seances: number; premieres: number }>();
  for (const s of liste) {
    const jour = (jours(s.debut.slice(0, 10)) + 3) % 7;
    parJour[jour] += 1;
    const heure = Number(s.debut.slice(11, 13));
    if (Number.isInteger(heure) && heure >= 0 && heure < 24) creneaux[jour][heure] += 1;
    const semaine = semaines.get(lundi(s.debut.slice(0, 10))) ?? { seances: 0, premieres: 0 };
    semaines.set(lundi(s.debut.slice(0, 10)), { seances: semaine.seances + 1, premieres: semaine.premieres + (s.type === "premiere" ? 1 : 0) });
  }
  const parSemaine: SemaineStatistiques[] = [];
  for (let l = lundi(du); l <= lundi(au); l += 7) {
    parSemaine.push({ lundi: new Date(l * 86_400_000).toISOString().slice(0, 10), ...(semaines.get(l) ?? { seances: 0, premieres: 0 }) });
  }

  return {
    du,
    au,
    du_precedent: duP,
    au_precedent: auP,
    base,
    chiffre: { valeur: somme(ca), precedent: somme(caP) },
    seances: { valeur: liste.length, precedent: listeP.length },
    panier_moyen: { valeur: panier(somme(ca), facturees(liste)), precedent: panier(somme(caP), facturees(listeP)) },
    nouveaux_patients: { valeur: nouveaux(du, au), precedent: nouveaux(duP, auP) },
    par_mois: parMois,
    moyens: ordre.filter((m) => moyens.has(m)).map((m) => ({ moyen: m, ...moyens.get(m)! })),
    patients_actifs: actifs.length,
    age_moyen: nombreAges ? sommeAges / nombreAges : null,
    ages: [...TRANCHES.map(([, l]) => l), "Âge non renseigné"].filter((l) => ages.has(l)).map((l) => ({ libelle: l, nombre: ages.get(l)! })),
    sexes: {
      femmes: actifs.filter((p) => p.sexe === "F").length,
      hommes: actifs.filter((p) => p.sexe === "M").length,
      non_renseigne: actifs.filter((p) => p.sexe === "").length,
    },
    recence,
    seances_par_patient: actifs.length ? liste.length / actifs.length : 0,
    premieres_seances: liste.filter((s) => s.type === "premiere").length,
    actes_gratuits: liste.filter((s) => s.facturation === "gratuit").length,
    villes: classement(villes, 6),
    antecedents: classement(antecedents, 6),
    patients_suivis: actifs
      .map((p) => ({ id: p.id, nom: p.nom, prenom: p.prenom, seances: parPatient.get(p.id) ?? 0 }))
      .sort((a, b) => b.seances - a.seances || a.nom.localeCompare(b.nom))
      .slice(0, 5),
    douleur: notees.length
      ? {
          seances: notees.length,
          avant: notees.reduce((t, s) => t + s.douleur_avant!, 0) / notees.length,
          apres: notees.reduce((t, s) => t + s.douleur_apres!, 0) / notees.length,
        }
      : null,
    jours: JOURS.map((libelle, i) => ({ libelle, nombre: parJour[i] })),
    creneaux,
    par_semaine: parSemaine,
  };
}

/** « +7,5 % », « −3 % », ou `null` sans base de comparaison. */
export function evolution(c: Comparaison): number | null {
  if (c.precedent === 0) return null;
  return ((c.valeur - c.precedent) / Math.abs(c.precedent)) * 100;
}
