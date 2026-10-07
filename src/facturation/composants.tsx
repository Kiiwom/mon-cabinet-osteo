import { useEffect, useId, useState } from "react";

import { dateDuJour, type Coeur } from "../lib/coeur";
import { ecrireDateFr, lireDateFr } from "../lib/dates";
import {
  ecrireMontant,
  etatPaiement,
  LIBELLES_ETAT,
  lireMontant,
  MOYENS,
  type Moyen,
  type ResumeFacture,
  type SaisieReglement,
} from "../lib/facturation";

/** Pastille de l'état de paiement d'une facture. */
export function EtatFacture({ facture }: { facture: Pick<ResumeFacture, "nature" | "etat" | "total_centimes" | "regle_centimes"> }) {
  const etat = etatPaiement(facture);
  return (
    <span className="puce" data-paiement={etat}>
      {etat === "reglee" && <span aria-hidden="true">✓</span>}
      {LIBELLES_ETAT[etat]}
    </span>
  );
}

/** Pastille de couleur d'un moyen de paiement, avec son libellé à côté : la couleur n'est jamais seule. */
export function PastilleMoyen({ moyen }: { moyen: Moyen }) {
  return <span className="pastille-moyen" data-moyen={moyen} aria-hidden="true" />;
}

/** Champ de montant en euros, à la française : « 55 », « 55,50 ». */
export function ChampMontant({
  id,
  libelle,
  centimes,
  changer,
  negatif = false,
}: {
  id: string;
  libelle: string;
  centimes: number | null;
  changer: (centimes: number | null) => void;
  negatif?: boolean;
}) {
  const [texte, setTexte] = useState(centimes === null ? "" : ecrireMontant(centimes));
  useEffect(() => {
    // Valeur changée depuis l'extérieur (prestation choisie) : le champ la reprend.
    if (centimes !== lireMontant(texte)) setTexte(centimes === null ? "" : ecrireMontant(centimes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centimes]);
  const lu = lireMontant(texte);
  const invalide = texte.trim() !== "" && (lu === null || (!negatif && lu < 0));
  return (
    <div className="champ champ-montant">
      <label htmlFor={id}>{libelle}</label>
      <div className="saisie-euros">
        <input
          id={id}
          inputMode="decimal"
          value={texte}
          aria-invalid={invalide || undefined}
          onChange={(e) => {
            setTexte(e.target.value);
            const valeur = lireMontant(e.target.value);
            changer(valeur === null || (!negatif && valeur < 0) ? null : valeur);
          }}
        />
        <span aria-hidden="true">€</span>
      </div>
    </div>
  );
}

/** Choix du moyen de paiement en boutons, avec « En attente » quand le règlement n'est pas encore reçu. */
export function ChoixMoyen({
  libelle,
  valeur,
  changer,
  enAttente = false,
}: {
  libelle: string;
  valeur: Moyen | null;
  changer: (moyen: Moyen | null) => void;
  enAttente?: boolean;
}) {
  return (
    <div className="segments segments-moyens" role="group" aria-label={libelle}>
      {MOYENS.map((m) => (
        <button key={m.valeur} type="button" aria-pressed={valeur === m.valeur} onClick={() => changer(m.valeur)}>
          {m.libelle}
        </button>
      ))}
      {enAttente && (
        <button type="button" aria-pressed={valeur === null} onClick={() => changer(null)}>
          En attente
        </button>
      )}
    </div>
  );
}

export const REGLEMENT_VIDE: SaisieReglement = { moyen: "carte", montant_centimes: 0, encaisse_le: "", reference: "", payeur: "", commentaire: "" };

/** Ajout ou modification d'un règlement : moyen, montant, date, numéro de chèque, payeur, commentaire. */
export function FormulaireReglement({
  initial,
  remboursement = false,
  valider,
  annuler,
  libelleValider,
}: {
  initial: SaisieReglement;
  remboursement?: boolean;
  valider: (saisie: SaisieReglement) => Promise<void>;
  annuler: () => void;
  libelleValider: string;
}) {
  const id = useId();
  const [saisie, setSaisie] = useState<SaisieReglement>({
    ...initial,
    montant_centimes: Math.abs(initial.montant_centimes),
    encaisse_le: initial.encaisse_le || dateDuJour(),
  });
  const [date, setDate] = useState(ecrireDateFr(initial.encaisse_le || dateDuJour()));
  const [montant, setMontant] = useState<number | null>(Math.abs(initial.montant_centimes) || null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    const encaisse = lireDateFr(date);
    if (!encaisse) return setErreur("Date d’encaissement invalide : JJ/MM/AAAA.");
    if (!montant) return setErreur("Indiquez le montant.");
    setEnvoi(true);
    setErreur(null);
    try {
      await valider({ ...saisie, encaisse_le: encaisse, montant_centimes: remboursement ? -montant : montant });
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="formulaire-reglement" onSubmit={(e) => void soumettre(e)}>
      <ChoixMoyen libelle="Moyen de paiement" valeur={saisie.moyen} changer={(m) => m && setSaisie({ ...saisie, moyen: m })} />
      <div className="rangee rangee-champs">
        <ChampMontant id={`${id}-montant`} libelle={remboursement ? "Montant remboursé" : "Montant"} centimes={montant} changer={setMontant} />
        <div className="champ">
          <label htmlFor={`${id}-date`}>{remboursement ? "Remboursé le" : "Encaissé le"}</label>
          <input id={`${id}-date`} value={date} inputMode="numeric" onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      {(saisie.moyen === "cheque" || saisie.moyen === "virement" || saisie.reference) && (
        <div className="champ">
          <label htmlFor={`${id}-reference`}>{saisie.moyen === "cheque" ? "N° du chèque" : "Référence"}</label>
          <input id={`${id}-reference`} value={saisie.reference} onChange={(e) => setSaisie({ ...saisie, reference: e.target.value })} />
        </div>
      )}
      <div className="champ">
        <label htmlFor={`${id}-payeur`}>Payé par (si ce n’est pas le patient)</label>
        <input id={`${id}-payeur`} value={saisie.payeur} onChange={(e) => setSaisie({ ...saisie, payeur: e.target.value })} />
      </div>
      <div className="champ">
        <label htmlFor={`${id}-commentaire`}>Commentaire interne</label>
        <input id={`${id}-commentaire`} value={saisie.commentaire} onChange={(e) => setSaisie({ ...saisie, commentaire: e.target.value })} />
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="rangee">
        <button type="submit" className="bouton bouton-principal" disabled={envoi}>
          {libelleValider}
        </button>
        <button type="button" className="lien-bouton" onClick={annuler}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/**
 * Aperçu de la facture : les pages mises en page par le cœur, en images vectorielles.
 * Dans la démonstration, sans cœur, un message le dit.
 */
export function ApercuFacture({ coeur, id, version }: { coeur: Coeur; id: string; version: number }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    setErreur(null);
    coeur.apercuFacture(id).then(
      (p) => actif && setPages(p),
      (e: Error) => actif && setErreur(e.message),
    );
    return () => {
      actif = false;
    };
  }, [coeur, id, version]);
  return <PagesApercu pages={pages} erreur={erreur} titre="Aperçu de la facture" />;
}

export function PagesApercu({ pages, erreur, titre }: { pages: string[] | null; erreur: string | null; titre: string }) {
  return (
    <section className="apercu-document" aria-label={titre}>
      {erreur ? (
        <p className="discret apercu-message">{erreur}</p>
      ) : pages === null ? (
        <p className="discret apercu-message">Mise en page…</p>
      ) : (
        pages.map((svg, rang) => (
          <img key={rang} className="page-document" alt={`${titre}, page ${rang + 1}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
        ))
      )}
    </section>
  );
}
