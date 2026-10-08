import { useId, useState } from "react";

import type { Patient, ResumePatient } from "../lib/coeur";
import { ecrireDateFr, lireDateFr } from "../lib/dates";
import {
  destinataireDesFactures,
  euros,
  ligneDePrestation,
  montantLigne,
  prestationParDefaut,
  totalLignes,
  type LigneFacture,
  type Prestation,
  type SaisieFacture,
} from "../lib/facturation";
import { rechercherPatients } from "../lib/recherche";
import { ChampMontant } from "./composants";

const CIVILITES = ["", "Mme", "M."];

/** Une ligne : prestation (ou saisie libre), désignation, quantité, prix, remise, total. */
function LigneEditee({
  ligne,
  rang,
  prestations,
  changer,
  retirer,
}: {
  ligne: LigneFacture;
  rang: number;
  prestations: Prestation[];
  changer: (l: LigneFacture) => void;
  retirer: (() => void) | null;
}) {
  const id = useId();
  const actives = prestations.filter((p) => !p.archivee || p.id === ligne.prestation_id);
  return (
    <fieldset className="ligne-facture">
      <legend>Ligne {rang + 1}</legend>
      <div className="champ">
        <label htmlFor={`${id}-prestation`}>Prestation</label>
        <select
          id={`${id}-prestation`}
          value={ligne.prestation_id ?? ""}
          onChange={(e) => {
            const p = prestations.find((x) => x.id === e.target.value);
            changer(p ? { ...ligneDePrestation(p), quantite: ligne.quantite } : { ...ligne, prestation_id: null });
          }}
        >
          {actives.map((p) => (
            <option key={p.id} value={p.id}>
              {p.libelle} · {euros(p.tarif_centimes)}
            </option>
          ))}
          <option value="">Saisie libre</option>
        </select>
      </div>
      <div className="champ ligne-facture-designation">
        <label htmlFor={`${id}-designation`}>Désignation imprimée</label>
        <input id={`${id}-designation`} value={ligne.designation} onChange={(e) => changer({ ...ligne, designation: e.target.value })} />
      </div>
      <div className="champ champ-quantite">
        <label htmlFor={`${id}-quantite`}>Qté</label>
        <input
          id={`${id}-quantite`}
          type="number"
          min={1}
          max={999}
          value={ligne.quantite}
          onChange={(e) => changer({ ...ligne, quantite: Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))) })}
        />
      </div>
      <ChampMontant id={`${id}-prix`} libelle="Prix unitaire" centimes={ligne.prix_unitaire_centimes} changer={(c) => changer({ ...ligne, prix_unitaire_centimes: c ?? 0 })} />
      <ChampMontant id={`${id}-remise`} libelle="Remise" centimes={ligne.reduction_centimes || null} changer={(c) => changer({ ...ligne, reduction_centimes: c ?? 0 })} />
      <div className="champ ligne-facture-total">
        <span className="libelle-champ">Total</span>
        <strong>{euros(montantLigne(ligne))}</strong>
      </div>
      {retirer && (
        <button type="button" className="lien-bouton ligne-facture-retirer" onClick={retirer}>
          Retirer la ligne
        </button>
      )}
    </fieldset>
  );
}

/** Choix du patient d'une facture sans séance : recherche instantanée dans la liste. */
function ChoixPatient({
  patients,
  choisi,
  choisir,
}: {
  patients: ResumePatient[];
  choisi: ResumePatient | null;
  choisir: (id: string | null) => void;
}) {
  const id = useId();
  const [texte, setTexte] = useState("");
  const resultats = texte.trim() ? rechercherPatients(patients.filter((p) => !p.archive), texte).slice(0, 6) : [];
  if (choisi) {
    return (
      <div className="rangee">
        <span>
          Patient : <strong>{choisi.prenom} {choisi.nom}</strong>
        </span>
        <button type="button" className="lien-bouton" onClick={() => choisir(null)}>
          Changer
        </button>
      </div>
    );
  }
  return (
    <div className="champ">
      <label htmlFor={`${id}-patient`}>Patient (facultatif)</label>
      <input id={`${id}-patient`} type="search" placeholder="Nom, prénom…" value={texte} onChange={(e) => setTexte(e.target.value)} />
      {resultats.length > 0 && (
        <ul className="suggestions-patients">
          {resultats.map((r) => (
            <li key={r.patient.id}>
              <button type="button" className="lien-bouton" onClick={() => choisir(r.patient.id)}>
                {r.patient.prenom} {r.patient.nom}
                {r.patient.ville && <span className="discret"> · {r.patient.ville}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Saisie d'une facture : destinataire, lignes, commentaires. Sert au brouillon, à la facture sans
 * séance et à la correction d'une facture émise.
 */
export function EditeurFacture({
  saisie,
  changer,
  prestations,
  patients,
  lirePatient,
  choixPatient,
}: {
  saisie: SaisieFacture;
  changer: (s: SaisieFacture) => void;
  prestations: Prestation[];
  /** Pour le choix du patient d'une facture sans séance. */
  patients?: ResumePatient[];
  lirePatient: (id: string) => Promise<Patient>;
  choixPatient: boolean;
}) {
  const id = useId();
  const [dateSeance, setDateSeance] = useState(ecrireDateFr(saisie.date_seance));
  const d = saisie.destinataire;
  const changerDestinataire = (champ: keyof typeof d, valeur: string) => changer({ ...saisie, destinataire: { ...d, [champ]: valeur } });
  const changerLigne = (rang: number) => (l: LigneFacture) => changer({ ...saisie, lignes: saisie.lignes.map((x, i) => (i === rang ? l : x)) });
  const defaut = prestationParDefaut(prestations);

  async function reprendrePatient(patientId: string | null) {
    if (!patientId) return changer({ ...saisie, patient_id: null });
    const patient = await lirePatient(patientId);
    changer({ ...saisie, patient_id: patientId, destinataire: await destinataireDesFactures(patient, lirePatient) });
  }

  return (
    <div className="editeur-facture">
      {choixPatient && patients && (
        <ChoixPatient patients={patients} choisi={patients.find((p) => p.id === saisie.patient_id) ?? null} choisir={(p) => void reprendrePatient(p)} />
      )}

      <fieldset className="groupe-champs">
        <legend>Destinataire</legend>
        <p className="discret">Le patient, ou la personne qui règle : un parent, un employeur…</p>
        <div className="rangee rangee-champs">
          <div className="champ champ-civilite">
            <label htmlFor={`${id}-civilite`}>Civilité</label>
            <select id={`${id}-civilite`} value={d.civilite} onChange={(e) => changerDestinataire("civilite", e.target.value)}>
              {CIVILITES.map((c) => (
                <option key={c} value={c}>
                  {c || "—"}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label htmlFor={`${id}-prenom`}>Prénom</label>
            <input id={`${id}-prenom`} value={d.prenom} onChange={(e) => changerDestinataire("prenom", e.target.value)} />
          </div>
          <div className="champ">
            <label htmlFor={`${id}-nom`}>Nom</label>
            <input id={`${id}-nom`} value={d.nom} onChange={(e) => changerDestinataire("nom", e.target.value)} />
          </div>
        </div>
        <div className="champ">
          <label htmlFor={`${id}-adresse`}>Adresse</label>
          <textarea id={`${id}-adresse`} className="zone-texte" rows={2} value={d.adresse} onChange={(e) => changerDestinataire("adresse", e.target.value)} />
        </div>
        <div className="rangee rangee-champs">
          <div className="champ champ-code-postal">
            <label htmlFor={`${id}-cp`}>Code postal</label>
            <input id={`${id}-cp`} inputMode="numeric" value={d.code_postal} onChange={(e) => changerDestinataire("code_postal", e.target.value)} />
          </div>
          <div className="champ">
            <label htmlFor={`${id}-ville`}>Ville</label>
            <input id={`${id}-ville`} value={d.ville} onChange={(e) => changerDestinataire("ville", e.target.value)} />
          </div>
        </div>
        <div className="champ">
          <label htmlFor={`${id}-soins`}>Patient soigné, si la facture est adressée à un proche</label>
          <input id={`${id}-soins`} value={d.patient} placeholder="Prénom et nom du patient" onChange={(e) => changerDestinataire("patient", e.target.value)} />
        </div>
        {saisie.patient_id && (
          <button type="button" className="lien-bouton" onClick={() => void reprendrePatient(saisie.patient_id)}>
            Reprendre les coordonnées du patient
          </button>
        )}
      </fieldset>

      <fieldset className="groupe-champs">
        <legend>Lignes</legend>
        {saisie.lignes.map((l, rang) => (
          <LigneEditee
            key={rang}
            ligne={l}
            rang={rang}
            prestations={prestations}
            changer={changerLigne(rang)}
            retirer={saisie.lignes.length > 1 ? () => changer({ ...saisie, lignes: saisie.lignes.filter((_, i) => i !== rang) }) : null}
          />
        ))}
        <div className="rangee entre">
          <button
            type="button"
            className="bouton bouton-petit"
            onClick={() =>
              changer({
                ...saisie,
                lignes: [
                  ...saisie.lignes,
                  defaut ? ligneDePrestation(defaut) : { prestation_id: null, designation: "", quantite: 1, prix_unitaire_centimes: 0, reduction_centimes: 0 },
                ],
              })
            }
          >
            Ajouter une ligne
          </button>
          <strong className="total-facture">Total : {euros(totalLignes(saisie.lignes))}</strong>
        </div>
        {defaut === null && <p className="discret">Aucune prestation : créez les vôtres dans Paramètres › Prestations et numérotation.</p>}
      </fieldset>

      <div className="rangee rangee-champs">
        <div className="champ">
          <label htmlFor={`${id}-date-seance`}>Date de la séance (facultative)</label>
          <input
            id={`${id}-date-seance`}
            inputMode="numeric"
            value={dateSeance}
            aria-invalid={lireDateFr(dateSeance) === undefined || undefined}
            onChange={(e) => {
              setDateSeance(e.target.value);
              const lue = lireDateFr(e.target.value);
              if (lue !== undefined) changer({ ...saisie, date_seance: lue });
            }}
          />
        </div>
      </div>
      <div className="champ">
        <label htmlFor={`${id}-imprime`}>Commentaire imprimé sur la facture</label>
        <textarea
          id={`${id}-imprime`}
          className="zone-texte"
          rows={2}
          value={saisie.commentaire_imprime}
          onChange={(e) => changer({ ...saisie, commentaire_imprime: e.target.value })}
        />
      </div>
      <div className="champ">
        <label htmlFor={`${id}-interne`}>Commentaire interne, jamais imprimé</label>
        <textarea
          id={`${id}-interne`}
          className="zone-texte"
          rows={2}
          value={saisie.commentaire_interne}
          onChange={(e) => changer({ ...saisie, commentaire_interne: e.target.value })}
        />
      </div>
    </div>
  );
}

/** Une saisie de facture neuve, avec la prestation par défaut. */
export function saisieNeuve(prestations: Prestation[]): SaisieFacture {
  const defaut = prestationParDefaut(prestations);
  return {
    patient_id: null,
    seance_id: null,
    date_seance: null,
    destinataire: { civilite: "", prenom: "", nom: "", adresse: "", code_postal: "", ville: "", patient: "" },
    lignes: defaut ? [ligneDePrestation(defaut)] : [{ prestation_id: null, designation: "", quantite: 1, prix_unitaire_centimes: 0, reduction_centimes: 0 }],
    commentaire_imprime: "",
    commentaire_interne: "",
  };
}
