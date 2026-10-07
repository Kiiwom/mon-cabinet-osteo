import { useEffect, useId, useState } from "react";

import { dateDuJour, type Coeur, type Patient, type SaisieSeance } from "../lib/coeur";
import {
  destinataireDuPatient,
  euros,
  ligneDePrestation,
  prestationParDefaut,
  signalerFacturation,
  type Facture,
  type LigneFacture,
  type Moyen,
  type Prestation,
} from "../lib/facturation";
import { adresse, aller } from "../lib/navigation";
import { ChampMontant, ChoixMoyen, EtatFacture } from "./composants";

/** Message d'erreur, avec le lien vers les paramètres quand il y renvoie. */
export function ErreurFacturation({ message }: { message: string }) {
  return (
    <p className="alerte" role="alert">
      {message}
      {message.includes("Paramètres › Cabinet") && (
        <>
          {" "}
          <a href={adresse("parametres", "cabinet")}>Compléter maintenant</a>
        </>
      )}
      {message.includes("Paramètres › Prestations") && (
        <>
          {" "}
          <a href={adresse("parametres", "facturation")}>Créer une prestation</a>
        </>
      )}
    </p>
  );
}

/**
 * Fin de séance : acte gratuit, ou facture émise en une fois avec la prestation, le montant et le
 * règlement s'il est reçu. Une fois la facture émise, son état et le règlement restant.
 */
export function FinDeSeance({
  coeur,
  seanceId,
  patient,
  saisie,
  changer,
  manquants,
  avantFacturer,
}: {
  coeur: Coeur;
  seanceId: string;
  patient: Patient;
  saisie: SaisieSeance;
  changer: (s: SaisieSeance) => void;
  manquants: string[];
  /** Enregistre la séance en attente avant de la facturer. */
  avantFacturer: () => Promise<void>;
}) {
  const id = useId();
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [facture, setFacture] = useState<Facture | null | undefined>(undefined);
  const [ligne, setLigne] = useState<LigneFacture | null>(null);
  const [moyen, setMoyen] = useState<Moyen | null>("carte");
  const [reference, setReference] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let actif = true;
    Promise.all([coeur.listerPrestations(), coeur.factureDeSeance(seanceId)]).then(
      ([p, f]) => {
        if (!actif) return;
        setPrestations(p);
        setFacture(f);
        const defaut = prestationParDefaut(p);
        setLigne(f?.etat === "brouillon" && f.lignes.length === 1 ? f.lignes[0] : defaut ? ligneDePrestation(defaut) : null);
      },
      (e: Error) => actif && setErreur(e.message),
    );
    return () => {
      actif = false;
    };
  }, [coeur, seanceId]);

  async function agir(action: () => Promise<void>) {
    setEnvoi(true);
    setErreur(null);
    try {
      await avantFacturer();
      await action();
      signalerFacturation();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  const emettre = () =>
    agir(async () => {
      if (!ligne) throw new Error("Créez d’abord une prestation dans Paramètres › Prestations et numérotation.");
      const montant = ligne.prix_unitaire_centimes * ligne.quantite - ligne.reduction_centimes;
      const reglement = moyen ? { moyen, montant_centimes: montant, encaisse_le: dateDuJour(), reference, payeur: "", commentaire: "" } : null;
      setFacture(await coeur.facturerSeance(seanceId, [ligne], montant > 0 ? reglement : null, dateDuJour()));
    });

  const preparer = () =>
    agir(async () => {
      let id = facture?.id;
      if (!id) {
        const brouillon = await coeur.creerFacture({
          patient_id: patient.id,
          seance_id: seanceId,
          date_seance: null,
          destinataire: destinataireDuPatient(patient),
          lignes: ligne ? [ligne] : [],
          commentaire_imprime: "",
          commentaire_interne: "",
        });
        id = brouillon.id;
      }
      aller("facturation", "facture", id);
    });

  const noterReglement = () =>
    agir(async () => {
      if (!facture || !moyen) return;
      setFacture(
        await coeur.ajouterReglement(facture.id, {
          moyen,
          montant_centimes: facture.reste_centimes,
          encaisse_le: dateDuJour(),
          reference,
          payeur: "",
          commentaire: "",
        }),
      );
      setReference("");
    });

  const emise = facture && facture.etat !== "brouillon";

  return (
    <section className="carte fin-de-seance" aria-labelledby={`${id}-titre`}>
      <div className="entete-carte">
        <h2 id={`${id}-titre`}>Fin de séance</h2>
        <label className="case-simple" title={emise ? "La séance est facturée : pour en faire un acte gratuit, annulez la facture par un avoir." : undefined}>
          <input
            type="checkbox"
            checked={saisie.facturation === "a_facturer"}
            disabled={Boolean(facture)}
            onChange={(e) => changer({ ...saisie, facturation: e.target.checked ? "a_facturer" : "gratuit" })}
          />
          Facturer
        </label>
      </div>

      {saisie.facturation === "gratuit" ? (
        <div className="champ">
          <label htmlFor={`${id}-commentaire`}>Acte gratuit : commentaire</label>
          <textarea
            id={`${id}-commentaire`}
            className="zone-texte"
            rows={2}
            value={saisie.commentaire_gratuit}
            onChange={(e) => changer({ ...saisie, commentaire_gratuit: e.target.value })}
          />
        </div>
      ) : facture === undefined ? (
        <p className="discret">Chargement…</p>
      ) : emise ? (
        <div className="pile-serree">
          <div className="rangee entre">
            <a href={adresse("facturation", "facture", facture.id)}>
              <strong>Facture {facture.numero}</strong>
            </a>
            <EtatFacture facture={facture} />
          </div>
          <span className="discret">
            {euros(facture.total_centimes)}
            {facture.reste_centimes > 0 && ` · reste ${euros(facture.reste_centimes)}`}
          </span>
          {facture.reste_centimes > 0 && (
            <div className="pile-serree reglement-rapide">
              <ChoixMoyen libelle="Règlement reçu" valeur={moyen} changer={setMoyen} />
              {moyen === "cheque" && (
                <div className="champ">
                  <label htmlFor={`${id}-cheque`}>N° du chèque (facultatif)</label>
                  <input id={`${id}-cheque`} value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              )}
              <button type="button" className="bouton" disabled={envoi || !moyen} onClick={() => void noterReglement()}>
                Noter le règlement de {euros(facture.reste_centimes)}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="pile-serree">
          {facture?.etat === "brouillon" && (
            <p className="discret">
              Un brouillon de facture attend : <a href={adresse("facturation", "facture", facture.id)}>l’ouvrir</a>.
            </p>
          )}
          {ligne ? (
            <>
              <div className="champ">
                <label htmlFor={`${id}-prestation`}>Prestation</label>
                <select
                  id={`${id}-prestation`}
                  value={ligne.prestation_id ?? ""}
                  onChange={(e) => {
                    const p = prestations.find((x) => x.id === e.target.value);
                    if (p) setLigne(ligneDePrestation(p));
                  }}
                >
                  {prestations
                    .filter((p) => !p.archivee || p.id === ligne.prestation_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.libelle}
                      </option>
                    ))}
                  {ligne.prestation_id === null && <option value="">{ligne.designation}</option>}
                </select>
              </div>
              <ChampMontant
                id={`${id}-montant`}
                libelle="Montant"
                centimes={ligne.prix_unitaire_centimes}
                changer={(c) => setLigne({ ...ligne, prix_unitaire_centimes: c ?? 0, quantite: 1, reduction_centimes: 0 })}
              />
              <ChoixMoyen libelle="Règlement" valeur={moyen} changer={setMoyen} enAttente />
              {moyen === "cheque" && (
                <div className="champ">
                  <label htmlFor={`${id}-cheque`}>N° du chèque (facultatif)</label>
                  <input id={`${id}-cheque`} value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              )}
              <button type="button" className="bouton bouton-principal" disabled={envoi} onClick={() => void emettre()}>
                {envoi ? "Émission…" : moyen ? `Émettre la facture réglée · ${euros(ligne.prix_unitaire_centimes)}` : "Émettre la facture"}
              </button>
              <button type="button" className="lien-bouton" disabled={envoi} onClick={() => void preparer()}>
                Modifier avant d’émettre (destinataire, lignes…)
              </button>
            </>
          ) : (
            <ErreurFacturation message="Aucune prestation : créez-en une dans Paramètres › Prestations et numérotation." />
          )}
        </div>
      )}
      {erreur && <ErreurFacturation message={erreur} />}
      {manquants.length > 0 && <p className="avertissement">À compléter avant de terminer : {manquants.join(", ")}.</p>}
    </section>
  );
}
