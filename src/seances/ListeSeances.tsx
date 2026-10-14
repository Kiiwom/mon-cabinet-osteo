import type { ResumeSeance } from "../lib/coeur";
import { dateCourte } from "../lib/dates";
import { adresse } from "../lib/navigation";
import { evolutionDouleur, libelleFacturation, libelleType } from "../lib/seances";

/** Pastille d'état d'une séance dans les listes : à facturer, brouillon, facturée, réglée ou non, acte gratuit. */
export function EtatFacturation({ seance }: { seance: Pick<ResumeSeance, "facturation" | "commentaire_gratuit" | "facture" | "importee"> }) {
  const f = seance.facture;
  if (seance.importee && !f) {
    return (
      <span className="puce puce-discrete" title="Séance reprise d’un autre logiciel : sa facture a été reprise à part.">
        Historique importé
      </span>
    );
  }
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
function LigneSeance({ seance: s }: { seance: ResumeSeance }) {
  return (
    <li>
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
  );
}

/** Les séances par année, la plus récente d'abord, dans l'ordre reçu. */
export function seancesParAnnee(seances: ResumeSeance[]): { annee: string; seances: ResumeSeance[] }[] {
  const annees: { annee: string; seances: ResumeSeance[] }[] = [];
  for (const s of seances) {
    const annee = s.debut.slice(0, 4);
    const derniere = annees[annees.length - 1];
    if (derniere?.annee === annee) derniere.seances.push(s);
    else annees.push({ annee, seances: [s] });
  }
  return annees;
}

/**
 * Séances du dossier, de la plus récente à la plus ancienne. Au-delà de `regrouperAuDela`
 * séances, elles se rangent par année : la plus récente dépliée, les autres d'un clic.
 */
export function ListeSeancesPatient({ seances, limite, regrouperAuDela = null }: { seances: ResumeSeance[]; limite?: number; regrouperAuDela?: number | null }) {
  if (seances.length === 0) return <p className="discret">Aucune séance pour l’instant.</p>;
  if (!limite && regrouperAuDela !== null && seances.length > regrouperAuDela) {
    return (
      <div className="annees-seances">
        {seancesParAnnee(seances).map(({ annee, seances: liste }, rang) => (
          <details key={annee} className="annee-seances" open={rang === 0}>
            <summary>
              <strong>{annee}</strong>
              <span className="discret">
                {liste.length} séance{liste.length > 1 ? "s" : ""}
              </span>
            </summary>
            <ul className="liste-seances" aria-label={`Séances de ${annee}`}>
              {liste.map((s) => (
                <LigneSeance key={s.id} seance={s} />
              ))}
            </ul>
          </details>
        ))}
      </div>
    );
  }
  const affichees = limite ? seances.slice(0, limite) : seances;
  return (
    <ul className="liste-seances">
      {affichees.map((s) => (
        <LigneSeance key={s.id} seance={s} />
      ))}
    </ul>
  );
}
