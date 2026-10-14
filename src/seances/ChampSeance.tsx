import type { JSONContent } from "@tiptap/core";
import { useEffect, useId, useState } from "react";

import type { CaractereTrames, Champ, ResumeSeance } from "../lib/coeur";
import { dateCourte, ecrireDateFr, lireDateFr } from "../lib/dates";
import { imc, nombreFr, type CasePrecision, type Mesures } from "../lib/seances";
import { ChampTrame } from "../trames/ChampTrame";
import type { TrameResume } from "../trames/valider";

export interface ContexteSaisie {
  trames: TrameResume[];
  caractere: CaractereTrames;
  noterUtilisation: (trame: TrameResume) => void;
  /** Pour le champ « Résumé de la séance précédente ». */
  precedente: ResumeSeance | null;
}

function Libelle({ champ, htmlFor, id }: { champ: Champ; htmlFor?: string; id?: string }) {
  return (
    <label htmlFor={htmlFor} id={id} className="libelle-seance">
      {champ.libelle}
      {champ.obligatoire && (
        <span className="obligatoire" title="Obligatoire pour terminer la séance">
          {" "}
          *<span className="lecteur-seulement"> obligatoire</span>
        </span>
      )}
    </label>
  );
}

/** Nombre tapé à la française (virgule ou point), `null` si vide. */
function lireNombre(texte: string): number | null | undefined {
  const t = texte.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function ChampNombre({ id, valeur, changer, ...autres }: { id: string; valeur: number | null; changer: (n: number | null) => void; "aria-label"?: string }) {
  const [texte, setTexte] = useState(valeur === null ? "" : nombreFr(valeur));
  const lu = lireNombre(texte);
  return (
    <input
      id={id}
      inputMode="decimal"
      value={texte}
      aria-invalid={lu === undefined ? true : undefined}
      onChange={(e) => {
        setTexte(e.target.value);
        const n = lireNombre(e.target.value);
        if (n !== undefined) changer(n);
      }}
      {...autres}
    />
  );
}

function ChampMesures({ valeur, changer }: { valeur: Mesures; changer: (m: Mesures) => void }) {
  const id = useId();
  const indice = imc(valeur);
  return (
    <div className="mesures">
      <div className="champ">
        <label htmlFor={`${id}-taille`}>Taille (cm)</label>
        <ChampNombre id={`${id}-taille`} valeur={valeur.taille} changer={(taille) => changer({ ...valeur, taille })} />
      </div>
      <div className="champ">
        <label htmlFor={`${id}-poids`}>Poids (kg)</label>
        <ChampNombre id={`${id}-poids`} valeur={valeur.poids} changer={(poids) => changer({ ...valeur, poids })} />
      </div>
      <div className="champ">
        <span className="libelle-seance">IMC</span>
        <output aria-live="polite" className="imc">
          {indice === null ? "—" : nombreFr(indice)}
        </output>
      </div>
    </div>
  );
}

function ChampDate({ champ, valeur, changer }: { champ: Champ; valeur: string | null; changer: (v: string | null) => void }) {
  const id = useId();
  const [texte, setTexte] = useState(ecrireDateFr(valeur));
  const lue = lireDateFr(texte);
  useEffect(() => setTexte(ecrireDateFr(valeur)), [valeur]);
  return (
    <div className="champ champ-court">
      <Libelle champ={champ} htmlFor={id} />
      <input
        id={id}
        value={texte}
        placeholder="JJ/MM/AAAA"
        inputMode="numeric"
        aria-invalid={lue === undefined ? true : undefined}
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => {
          if (lue !== undefined) changer(lue);
        }}
      />
      {lue === undefined && <span className="champ-erreur">Date incomplète ou impossible.</span>}
    </div>
  );
}

/** Un champ du modèle, en saisie. `valeur` est celle de la séance, `changer` l'enregistre. */
export function ChampSeance({
  champ,
  valeur,
  changer,
  contexte,
}: {
  champ: Champ;
  valeur: unknown;
  changer: (valeur: unknown) => void;
  contexte: ContexteSaisie;
}) {
  const id = useId();
  switch (champ.type) {
    case "intertitre":
      return <h3 className="intertitre-seance">{champ.libelle}</h3>;
    case "dessin":
      return null;
    case "texte_enrichi":
      return (
        <ChampTrame
          libelle={`${champ.libelle}${champ.obligatoire ? " *" : ""}`}
          trames={contexte.trames}
          caractere={contexte.caractere}
          surUtilisation={contexte.noterUtilisation}
          valeur={valeur as JSONContent | undefined}
          surChangement={changer}
          miseEnForme
        />
      );
    case "texte_court":
      return (
        <div className="champ">
          <Libelle champ={champ} htmlFor={id} />
          <input id={id} value={typeof valeur === "string" ? valeur : ""} onChange={(e) => changer(e.target.value)} />
        </div>
      );
    case "liste":
      return (
        <div className="champ champ-court">
          <Libelle champ={champ} htmlFor={id} />
          <select id={id} value={typeof valeur === "string" ? valeur : ""} onChange={(e) => changer(e.target.value || null)}>
            <option value="">—</option>
            {(champ.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
    case "cases": {
      const cochees = Array.isArray(valeur) ? (valeur as string[]) : [];
      return (
        <fieldset className="groupe-seance">
          <legend className="libelle-seance">{champ.libelle}</legend>
          <div className="cases">
            {(champ.options ?? []).map((o) => (
              <label key={o} className="case-simple">
                <input
                  type="checkbox"
                  checked={cochees.includes(o)}
                  onChange={(e) => changer(e.target.checked ? [...cochees, o] : cochees.filter((x) => x !== o))}
                />
                {o}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "case_precision": {
      const v = (valeur as CasePrecision | null) ?? { coche: false, precision: "" };
      return (
        <div className="case-precision">
          <label className="case-simple">
            <input type="checkbox" checked={v.coche} onChange={(e) => changer({ ...v, coche: e.target.checked })} />
            {champ.libelle}
          </label>
          {v.coche && (
            <input aria-label={`Précision : ${champ.libelle}`} value={v.precision} onChange={(e) => changer({ ...v, precision: e.target.value })} placeholder="Précision" />
          )}
        </div>
      );
    }
    case "curseur": {
      const n = typeof valeur === "number" ? valeur : null;
      const sur10 = champ.min === 0 && champ.max === 10 ? "/10" : "";
      return (
        <div className="curseur-seance" data-vide={n === null}>
          <span className="libelle-seance" id={`${id}-libelle`}>
            {champ.libelle} · {n === null ? "non renseignée" : `${nombreFr(n)}${sur10}`}
          </span>
          <span className="rangee curseur-ligne">
            <input
              type="range"
              min={champ.min}
              max={champ.max}
              step={champ.pas}
              value={n ?? champ.min ?? 0}
              aria-labelledby={`${id}-libelle`}
              onChange={(e) => changer(Number(e.target.value))}
            />
            {n !== null && (
              <button type="button" className="lien-bouton" onClick={() => changer(null)}>
                Effacer
              </button>
            )}
          </span>
        </div>
      );
    }
    case "date":
      return <ChampDate champ={champ} valeur={typeof valeur === "string" ? valeur : null} changer={changer} />;
    case "nombre":
      return (
        <div className="champ champ-court">
          <Libelle champ={champ} htmlFor={id} />
          <span className="rangee nombre-unite">
            <ChampNombre id={id} valeur={typeof valeur === "number" ? valeur : null} changer={changer} />
            {champ.unite && <span className="discret">{champ.unite}</span>}
          </span>
        </div>
      );
    case "mesures":
      return <ChampMesures valeur={(valeur as Mesures | null) ?? { taille: null, poids: null }} changer={changer} />;
    case "resume_precedent": {
      const p = contexte.precedente;
      return (
        <div className="resume-precedent">
          <span className="libelle-seance">{champ.libelle}</span>
          {p ? (
            <p>
              <strong>{dateCourte(p.debut.slice(0, 10))}</strong> · {p.titre || p.motif || "sans motif"}
            </p>
          ) : (
            <p className="discret">Première séance de ce patient.</p>
          )}
        </div>
      );
    }
  }
}
