import { useEffect, useId, useState } from "react";

import type { Coeur, Groupe, Modification, Patient, ResumePatient } from "../lib/coeur";
import { dateCourte, ecrireDateFr } from "../lib/dates";
import { ACTIONS } from "../pages/ParametresSauvegardes";
import { momentEnLettres } from "../sauvegardes/Restauration";

/** Les champs de la fiche, tels qu'affichés dans l'historique. */
const CHAMPS: Record<string, string> = {
  sexe: "Sexe",
  nom: "Nom",
  nom_naissance: "Nom de naissance",
  prenom: "Prénom",
  naissance: "Date de naissance",
  adresse: "Adresse",
  complement_adresse: "Complément d’adresse",
  code_postal: "Code postal",
  ville: "Ville",
  pays: "Pays",
  portable: "Portable",
  fixe: "Téléphone fixe",
  email: "Email",
  profession: "Profession ou scolarité",
  retraite: "Retraite",
  situation_familiale: "Situation familiale",
  enfants: "Enfants",
  lateralite: "Latéralité",
  activites: "Activités",
  medecin_traitant: "Médecin traitant",
  autres_therapeutes: "Autres thérapeutes",
  mobilite_reduite: "Mobilité réduite",
  decede: "Décès",
  statut: "Statut",
  notes_importantes: "Notes importantes",
  remarques: "Remarques générales",
  remarques_antecedents: "Remarques sur les antécédents",
  consentement_le: "Consentement",
  groupes: "Groupes",
  archive: "Archives",
  factures_a: "Destinataire des factures",
  // Antécédents.
  categorie: "Catégorie",
  rubrique: "Rubrique",
  precision: "Précision",
  debut: "Début",
  fin: "Fin",
  en_cours: "En cours",
  couleur: "Couleur",
  important: "Important",
};

const TEXTES_MIS_EN_FORME = ["remarques", "remarques_antecedents"];
const DATES = ["naissance", "consentement_le"];

type Objet = Record<string, unknown>;
const objet = (v: unknown): Objet | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Objet) : null);

function valeur(champ: string, v: unknown, noms: (id: string) => string, groupes: Groupe[]): string {
  if (v === null || v === undefined || v === "") return "vide";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (champ === "groupes" && Array.isArray(v)) return v.length ? v.map((g) => groupes.find((x) => x.id === g)?.nom ?? "groupe supprimé").join(", ") : "aucun";
  if (champ === "factures_a" && typeof v === "string") return noms(v);
  if (DATES.includes(champ) && typeof v === "string") return ecrireDateFr(v);
  return String(v);
}

/** Ce que la ligne d'historique dit de plus que son action : les champs changés, la séance, le document… */
function details(m: Modification, patientId: string, noms: (id: string) => string, groupes: Groupe[]): string[] {
  const apres = objet(m.apres);
  const avant = objet(m.avant);
  const etat = apres ?? avant;
  if (m.action === "famille.lien" || m.action === "famille.delie") {
    // Le lien dit ce que le proche est pour le dossier qui l'a noté ; vu de l'autre côté, il s'inverse.
    const procheId = String(etat?.proche_id ?? "");
    const vuDuProche = procheId === patientId;
    const lien = String(etat?.lien ?? "");
    const lu = vuDuProche ? ({ parent: "enfant", enfant: "parent" } as Record<string, string>)[lien] ?? lien : lien;
    return [`${noms(vuDuProche ? m.entite : procheId)}, ${lu === "fratrie" ? "frère ou sœur" : lu}`];
  }
  if (m.action === "patient.fusionne" && avant) return [`Avec le dossier ${String(avant.prenom ?? "")} ${String(avant.nom ?? "")}`.trim()];
  if (m.action.startsWith("seance.") && typeof etat?.debut === "string") return [`Séance du ${dateCourte(etat.debut.slice(0, 10))}`];
  if (m.action.startsWith("document.") && typeof etat?.nom === "string") {
    return m.action === "document.modifie" && avant && apres && avant.nom !== apres.nom ? [`${String(avant.nom)} → ${String(apres.nom)}`] : [etat.nom];
  }
  if ((m.action.startsWith("facture.") || m.action.startsWith("reglement.") || m.action === "avoir.emis") && typeof etat?.numero === "string") return [`N° ${etat.numero}`];
  if (m.action.startsWith("antecedent.") && etat) {
    const intitule = [etat.rubrique, etat.precision].filter((t) => typeof t === "string" && t).join(" · ");
    const changes = m.action === "antecedent.modifie" ? m.changements.filter((c) => CHAMPS[c.champ]).map((c) => CHAMPS[c.champ].toLocaleLowerCase("fr")) : [];
    return [intitule + (changes.length ? ` (${changes.join(", ")})` : "")];
  }
  if (m.action === "patient.modifie" || m.action === "patient.payeur") {
    return m.changements
      .filter((c) => CHAMPS[c.champ])
      .map((c) =>
        TEXTES_MIS_EN_FORME.includes(c.champ)
          ? `${CHAMPS[c.champ]} : texte modifié`
          : `${CHAMPS[c.champ]} : ${valeur(c.champ, c.avant, noms, groupes)} → ${valeur(c.champ, c.apres, noms, groupes)}`,
      );
  }
  return [];
}

const PAGE = 50;

/** Chaque changement du dossier, daté : fiche, proches, antécédents, séances, documents et factures. */
export function OngletHistorique({ coeur, patient }: { coeur: Coeur; patient: Patient }) {
  const id = useId();
  const [lignes, setLignes] = useState<Modification[] | null>(null);
  const [fin, setFin] = useState(false);
  const [patients, setPatients] = useState<ResumePatient[]>([]);
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  const suite = async (avant: number | null) => {
    const nouvelles = await coeur.historiqueDossier(patient.id, PAGE, avant);
    setLignes((l) => [...(avant === null ? [] : (l ?? [])), ...nouvelles]);
    setFin(nouvelles.length < PAGE);
  };
  useEffect(() => {
    suite(null).catch((e: Error) => setErreur(e.message));
    coeur.listerPatients().then(setPatients, () => setPatients([]));
    coeur.listerGroupes().then(setGroupes, () => setGroupes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur, patient.id, patient.modifie_le]);

  const noms = (identifiant: string) => {
    const p = patients.find((x) => x.id === identifiant);
    return p ? `${p.prenom} ${p.nom}` : "dossier effacé";
  };

  return (
    <section className="carte carte-tableau" aria-labelledby={`${id}-titre`}>
      <div className="entete-carte entete-carte-tableau">
        <h2 id={`${id}-titre`}>Historique des modifications</h2>
        <span className="discret">De la plus récente à la plus ancienne</span>
      </div>
      {erreur ? (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      ) : lignes === null ? (
        <p className="vide discret">Chargement…</p>
      ) : lignes.length === 0 ? (
        <p className="vide discret">Aucune modification enregistrée.</p>
      ) : (
        <table className="tableau tableau-journal">
          <thead>
            <tr>
              <th scope="col">Quand</th>
              <th scope="col">Quoi</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((m) => {
              const lignesDetail = details(m, patient.id, noms, groupes);
              return (
                <tr key={`${m.id}-${m.action}`}>
                  <td className="sans-retour">{m.le ? momentEnLettres(m.le) : "—"}</td>
                  <td>
                    {ACTIONS[m.action] ?? m.action}
                    {lignesDetail.length > 0 && (
                      <ul className="details-historique">
                        {lignesDetail.map((d, rang) => (
                          <li key={rang} className="discret">
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {lignes && !fin && (
        <div className="pied-tableau">
          <button type="button" className="lien-bouton" onClick={() => void suite(lignes[lignes.length - 1].id).catch((e: Error) => setErreur(e.message))}>
            Afficher les plus anciennes
          </button>
        </div>
      )}
    </section>
  );
}
