import type { ResumeSeance } from "../lib/coeur";
import { dateCourte } from "../lib/dates";
import { adresse } from "../lib/navigation";
import { evolutionDouleur, libelleFacturation, libelleType } from "../lib/seances";

/** Pastille d'état d'une séance dans les listes : à facturer, brouillon, facturée, réglée ou non, acte gratuit. */
export function EtatFacturation({ seance }: { seance: Pick<ResumeSeance, "facturation" | "commentaire_gratuit" | "facture"> }) {
  const f = seance.facture;
  if (seance.facturation === "a_facturer" && f) {
    const etat = f.numero === null ? "brouillon" : f.reste_centimes > 0 ? "en_attente" : "facturee";
    const libelle = etat === "brouillon" ? "Brouillon de facture" : etat === "en_attente" ? "En attente de règlement" : "Facturée";
    return (
      <span className="puce" data-facturation={etat} title={f.numero ? `Facture ${f.numero}` : undefined}>
        {libelle}
      </span>
    );
  }
  return (
    <span className="puce" data-facturation={seance.facturation} title={seance.commentaire_gratuit || undefined}>
      {libelleFacturation(seance.facturation)}
    </span>
  );
}

/** Séances d'un dossier, la plus récente en haut : date, motif, modèle et type, douleur, facturation. */
export function ListeSeancesPatient({ seances, limite }: { seances: ResumeSeance[]; limite?: number }) {
  const affichees = limite ? seances.slice(0, limite) : seances;
  if (seances.length === 0) return <p className="discret">Aucune séance pour l’instant.</p>;
  return (
    <ul className="liste-seances">
      {affichees.map((s) => (
        <li key={s.id}>
          <a href={adresse("seances", s.id)} className="ligne-seance">
            <strong className="ligne-seance-date">{dateCourte(s.debut.slice(0, 10))}</strong>
            <span className="ligne-seance-texte">
              <span className="ligne-seance-motif">
                {s.importante && <span aria-label="Importante">★ </span>}
                {s.titre || s.motif || "Sans motif"}
              </span>
              <span className="discret">
                {s.modele_nom} · {libelleType(s.type)}
              </span>
            </span>
            <span className="discret ligne-seance-douleur">{evolutionDouleur(s)}</span>
            <EtatFacturation seance={s} />
          </a>
        </li>
      ))}
    </ul>
  );
}
