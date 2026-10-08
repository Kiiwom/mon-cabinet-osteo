import { useEffect, useId, useMemo, useState } from "react";

import { ChoixMoyen, EtatFacture, FormulaireReglement, PastilleMoyen, REGLEMENT_VIDE } from "../facturation/composants";
import { ErreurFacturation } from "../facturation/FinDeSeance";
import { dateDuJour, type Coeur, type ResumeSeance } from "../lib/coeur";
import { dateCourte, ecrireDateFr, lireDateFr } from "../lib/dates";
import {
  euros,
  etatPaiement,
  intituleFacture,
  LIBELLES_ETAT,
  libelleMoyen,
  MOYENS,
  prestationParDefaut,
  signalerFacturation,
  type LigneRecette,
  type Moyen,
  type Prestation,
  type ResumeFacture,
} from "../lib/facturation";
import { adresse, aller } from "../lib/navigation";
import { bornesPeriode, decalerPeriode, isoDe, libellePeriode, surLaPeriode, type Periode, type TypePeriode } from "../lib/periodes";
import { normaliser } from "../lib/recherche";
import { colonne, feuilleVersCsv, type Feuille } from "../lib/tableur";

export type OngletFacturation = "recettes" | "factures" | "a-facturer" | "en-attente";

export function ongletFacturation(segment: string | undefined): OngletFacturation {
  return segment === "factures" || segment === "a-facturer" || segment === "en-attente" ? segment : "recettes";
}

const TYPES_PERIODE: { valeur: TypePeriode; libelle: string }[] = [
  { valeur: "jour", libelle: "Jour" },
  { valeur: "mois", libelle: "Mois" },
  { valeur: "trimestre", libelle: "Trimestre" },
  { valeur: "annee", libelle: "Année" },
  { valeur: "periode", libelle: "Période" },
];

const dateLocale = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Choix de la période : précédente, suivante, durée, ou dates libres ; le jour seulement avec `avecJour`. */
export function ChoixPeriode({
  periode,
  changer,
  aujourdhui,
  avecJour = false,
}: {
  periode: Periode;
  changer: (p: Periode) => void;
  aujourdhui: Date;
  avecJour?: boolean;
}) {
  const id = useId();
  const [bornes, setBornes] = useState(() => bornesPeriode(periode).map(ecrireDateFr));
  const types = TYPES_PERIODE.filter((t) => avecJour || t.valeur !== "jour");
  /** Le jour choisi : aujourd'hui s'il est dans la période affichée, sinon son premier jour. */
  const jourDansLaPeriode = () => {
    const [du, au] = bornesPeriode(periode);
    const iso = isoDe(aujourdhui);
    return iso >= du && iso <= au ? aujourdhui : dateLocale(du);
  };
  return (
    <div className="pile-serree choix-periode">
      <div className="rangee navigation-periode">
        {periode.type !== "periode" && (
          <button type="button" className="bouton" aria-label="Période précédente" onClick={() => changer(decalerPeriode(periode, -1))}>
            ‹
          </button>
        )}
        <strong className="libelle-periode" aria-live="polite">
          {libellePeriode(periode)}
        </strong>
        {periode.type !== "periode" && (
          <button type="button" className="bouton" aria-label="Période suivante" onClick={() => changer(decalerPeriode(periode, 1))}>
            ›
          </button>
        )}
        {periode.type === "jour" && isoDe(periode.reference) !== isoDe(aujourdhui) && (
          <button type="button" className="bouton bouton-petit" onClick={() => changer({ type: "jour", reference: aujourdhui })}>
            Aujourd’hui
          </button>
        )}
        <div className="segments" role="group" aria-label="Durée affichée">
          {types.map((t) => (
            <button
              key={t.valeur}
              type="button"
              aria-pressed={periode.type === t.valeur}
              onClick={() => {
                if (t.valeur === "jour") changer({ type: "jour", reference: jourDansLaPeriode() });
                else if (t.valeur === "periode") {
                  const [du, au] = bornesPeriode(periode);
                  setBornes([ecrireDateFr(du), ecrireDateFr(au)]);
                  changer({ ...periode, type: "periode", du, au });
                } else changer({ type: t.valeur, reference: periode.type === "periode" ? aujourdhui : periode.reference });
              }}
            >
              {t.libelle}
            </button>
          ))}
        </div>
      </div>
      {periode.type === "periode" && (
        <div className="rangee rangee-champs">
          {(["du", "au"] as const).map((borne, rang) => (
            <div className="champ" key={borne}>
              <label htmlFor={`${id}-${borne}`}>{borne === "du" ? "Du" : "Au"}</label>
              <input
                id={`${id}-${borne}`}
                inputMode="numeric"
                value={bornes[rang]}
                aria-invalid={lireDateFr(bornes[rang]) ? undefined : true}
                onChange={(e) => {
                  const nouvelles = rang === 0 ? [e.target.value, bornes[1]] : [bornes[0], e.target.value];
                  setBornes(nouvelles);
                  const iso = lireDateFr(e.target.value);
                  if (iso) changer({ ...periode, [borne]: iso });
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Onglets({ courant, aFacturer, enAttente }: { courant: OngletFacturation; aFacturer: number; enAttente: number }) {
  const onglets: { cle: OngletFacturation; libelle: string; compte?: number }[] = [
    { cle: "recettes", libelle: "Recettes" },
    { cle: "factures", libelle: "Factures et avoirs" },
    { cle: "a-facturer", libelle: "À facturer", compte: aFacturer },
    { cle: "en-attente", libelle: "En attente de règlement", compte: enAttente },
  ];
  return (
    <nav className="onglets" aria-label="Facturation">
      {onglets.map((o) => (
        <a key={o.cle} href={o.cle === "recettes" ? adresse("facturation") : adresse("facturation", o.cle)} aria-current={courant === o.cle ? "page" : undefined}>
          {o.libelle}
          {o.compte ? <span className="compte-onglet"> {o.compte}</span> : null}
        </a>
      ))}
    </nav>
  );
}

/** Répartition des encaissements par moyen : une barre empilée, sa légende chiffrée et son tableau. */
function ParMoyen({ recettes }: { recettes: LigneRecette[] }) {
  const [tableau, setTableau] = useState(false);
  const total = recettes.reduce((t, r) => t + r.montant_centimes, 0);
  const parts = MOYENS.map((m) => {
    const lignes = recettes.filter((r) => r.moyen === m.valeur);
    return { moyen: m.valeur, montant: lignes.reduce((t, r) => t + r.montant_centimes, 0), nombre: lignes.length };
  }).filter((p) => p.nombre > 0);
  const pourcent = (montant: number) => (total > 0 ? Math.round((montant / total) * 100) : 0);
  return (
    <section className="carte" aria-labelledby="titre-par-moyen">
      <div className="entete-carte">
        <h2 id="titre-par-moyen">Encaissements par moyen de paiement</h2>
        {parts.length > 0 && (
          <button type="button" className="lien-bouton" aria-pressed={tableau} onClick={() => setTableau((t) => !t)}>
            {tableau ? "Voir en barre" : "Voir en tableau"}
          </button>
        )}
      </div>
      {parts.length === 0 ? (
        <p className="discret">Aucun encaissement sur cette période.</p>
      ) : tableau ? (
        <table className="tableau">
          <thead>
            <tr>
              <th scope="col">Moyen</th>
              <th scope="col" className="nombre">
                Règlements
              </th>
              <th scope="col" className="nombre">
                Part
              </th>
              <th scope="col" className="nombre">
                Montant
              </th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.moyen}>
                <td>
                  <PastilleMoyen moyen={p.moyen} /> {libelleMoyen(p.moyen)}
                </td>
                <td className="nombre">{p.nombre}</td>
                <td className="nombre">{pourcent(p.montant)} %</td>
                <td className="nombre">{euros(p.montant)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="barre-moyens" role="img" aria-label={parts.map((p) => `${libelleMoyen(p.moyen)} ${pourcent(p.montant)} %`).join(", ")}>
            {parts
              .filter((p) => p.montant > 0)
              .map((p) => (
                <span
                  key={p.moyen}
                  className="segment-moyen"
                  data-moyen={p.moyen}
                  style={{ flexGrow: p.montant }}
                  title={`${libelleMoyen(p.moyen)} : ${euros(p.montant)} · ${p.nombre} règlement${p.nombre > 1 ? "s" : ""} · ${pourcent(p.montant)} %`}
                />
              ))}
          </div>
          <ul className="legende-moyens">
            {parts.map((p) => (
              <li key={p.moyen}>
                <span className="legende-moyen-titre">
                  <PastilleMoyen moyen={p.moyen} /> {libelleMoyen(p.moyen)}
                </span>
                <strong>{euros(p.montant)}</strong>
                <span className="discret">
                  {p.nombre} règlement{p.nombre > 1 ? "s" : ""} · {pourcent(p.montant)} %
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface RecetteDuJour {
  jour: string;
  nombre: number;
  parMoyen: Partial<Record<Moyen, number>>;
  total: number;
}

/** Les règlements regroupés par jour d'encaissement, du plus récent au plus ancien. */
export function recettesParJour(recettes: LigneRecette[]): RecetteDuJour[] {
  const jours = new Map<string, RecetteDuJour>();
  for (const r of recettes) {
    const jour = jours.get(r.encaisse_le) ?? { jour: r.encaisse_le, nombre: 0, parMoyen: {}, total: 0 };
    jour.nombre += 1;
    jour.parMoyen[r.moyen] = (jour.parMoyen[r.moyen] ?? 0) + r.montant_centimes;
    jour.total += r.montant_centimes;
    jours.set(r.encaisse_le, jour);
  }
  return [...jours.values()].sort((a, b) => b.jour.localeCompare(a.jour));
}

const moyensPresents = (recettes: LigneRecette[]) => MOYENS.map((m) => m.valeur).filter((m) => recettes.some((r) => r.moyen === m));

function feuillesRecettes(recettes: LigneRecette[]): Feuille[] {
  const moyens = moyensPresents(recettes);
  return [
    {
      nom: "Journal des recettes",
      colonnes: [
        colonne("Encaissé le", "date"),
        colonne("Patient"),
        colonne("Facture"),
        colonne("Date de la facture", "date"),
        colonne("Moyen"),
        colonne("Référence"),
        colonne("Payé par"),
        colonne("Montant", "montant"),
      ],
      lignes: recettes.map((r) => [r.encaisse_le, r.nom, r.facture_numero ?? "", r.facture_date, libelleMoyen(r.moyen), r.reference, r.payeur, r.montant_centimes / 100]),
    },
    {
      nom: "Recettes par jour",
      colonnes: [colonne("Jour", "date"), colonne("Règlements", "nombre"), ...moyens.map((m) => colonne(libelleMoyen(m), "montant")), colonne("Total", "montant")],
      lignes: recettesParJour(recettes).map((j) => [j.jour, j.nombre, ...moyens.map((m) => (j.parMoyen[m] ?? 0) / 100), j.total / 100]),
    },
  ];
}

const JOURS_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const jourCourt = (iso: string) => `${JOURS_COURTS[dateLocale(iso).getDay()]} ${dateCourte(iso)}`;

/** Recettes par jour : nombre de règlements, montant par moyen et total ; un jour s'ouvre en détail. */
function ParJour({ recettes, periode, voirJour }: { recettes: LigneRecette[]; periode: Periode; voirJour: (jour: string) => void }) {
  const jours = recettesParJour(recettes);
  const moyens = moyensPresents(recettes);
  const somme = (m: Moyen) => recettes.filter((r) => r.moyen === m).reduce((t, r) => t + r.montant_centimes, 0);
  return (
    <table className="tableau">
      <thead>
        <tr>
          <th scope="col">Jour</th>
          <th scope="col" className="nombre">
            Règlements
          </th>
          {moyens.map((m) => (
            <th key={m} scope="col" className="nombre">
              <PastilleMoyen moyen={m} /> {libelleMoyen(m)}
            </th>
          ))}
          <th scope="col" className="nombre">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {jours.map((j) => (
          <tr key={j.jour}>
            <th scope="row">
              <button type="button" className="lien-bouton" aria-label={`Détail du ${jourCourt(j.jour)}`} onClick={() => voirJour(j.jour)}>
                {jourCourt(j.jour)}
              </button>
            </th>
            <td className="nombre">{j.nombre}</td>
            {moyens.map((m) => (
              <td key={m} className="nombre">
                {j.parMoyen[m] ? euros(j.parMoyen[m]) : <span className="discret">—</span>}
              </td>
            ))}
            <td className="nombre">
              <strong>{euros(j.total)}</strong>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total {surLaPeriode(periode)}</th>
          <td className="nombre">{recettes.length}</td>
          {moyens.map((m) => (
            <td key={m} className="nombre">
              {euros(somme(m))}
            </td>
          ))}
          <td className="nombre">
            <strong>{euros(recettes.reduce((t, r) => t + r.montant_centimes, 0))}</strong>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Excel, CSV ou impression : les boutons d'export communs aux tableaux de la facturation. */
function Exports({ desactive, excel, csv, imprimer }: { desactive: boolean; excel: () => void; csv: () => void; imprimer?: () => void }) {
  return (
    <div className="rangee rangee-centree sans-impression">
      <span className="discret">Exporter</span>
      <button type="button" className="bouton bouton-petit" disabled={desactive} onClick={excel}>
        Excel
      </button>
      <button type="button" className="bouton bouton-petit" disabled={desactive} onClick={csv}>
        CSV
      </button>
      {imprimer && (
        <button type="button" className="bouton bouton-petit" disabled={desactive} onClick={imprimer}>
          Imprimer ou PDF
        </button>
      )}
    </div>
  );
}

function Recettes({
  coeur,
  periode,
  changerPeriode,
  aFacturer,
  enAttente,
  tarif,
}: {
  coeur: Coeur;
  periode: Periode;
  changerPeriode: (p: Periode) => void;
  aFacturer: ResumeSeance[];
  enAttente: ResumeFacture[];
  tarif: number;
}) {
  const [recettes, setRecettes] = useState<LigneRecette[] | null>(null);
  const [tout, setTout] = useState(false);
  const [vue, setVue] = useState<"detail" | "jour">("detail");
  const parJour = vue === "jour" && periode.type !== "jour";
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [du, au] = bornesPeriode(periode);

  useEffect(() => {
    setRecettes(null);
    coeur.recettes(du, au).then(setRecettes, (e: Error) => setErreur(e.message));
  }, [coeur, du, au]);

  const total = (recettes ?? []).reduce((t, r) => t + r.montant_centimes, 0);
  const visibles = tout ? (recettes ?? []) : (recettes ?? []).slice(0, 8);

  async function exporter(format: "xlsx" | "csv") {
    setErreur(null);
    try {
      const nom = du === au ? `Recettes du ${du}` : `Recettes ${du} au ${au}`;
      const feuilles = feuillesRecettes(recettes ?? []);
      const chemin =
        format === "xlsx" ? await coeur.exporterClasseur(`${nom}.xlsx`, feuilles) : await coeur.exporterFichier(`${nom}.csv`, feuilleVersCsv(feuilles[parJour ? 1 : 0]));
      setMessage(`Export enregistré : ${chemin}`);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <>
      <div className="tuiles">
        <div className="tuile">
          <span>Encaissé {surLaPeriode(periode)}</span>
          <strong>{recettes ? euros(total) : "…"}</strong>
          <span className="discret">
            {recettes?.length ?? 0} règlement{(recettes?.length ?? 0) > 1 ? "s" : ""}
          </span>
        </div>
        <a className="tuile" data-accent={aFacturer.length > 0 || undefined} href={adresse("facturation", "a-facturer")}>
          <span>À facturer</span>
          <strong>{euros(aFacturer.length * tarif)}</strong>
          <span className="discret">
            {aFacturer.length} séance{aFacturer.length > 1 ? "s" : ""}
          </span>
        </a>
        <a className="tuile" href={adresse("facturation", "en-attente")}>
          <span>En attente de règlement</span>
          <strong>{euros(enAttente.reduce((t, f) => t + f.reste_centimes, 0))}</strong>
          <span className="discret">
            {enAttente.length} facture{enAttente.length > 1 ? "s" : ""} émise{enAttente.length > 1 ? "s" : ""}
          </span>
        </a>
      </div>

      {recettes && <ParMoyen recettes={recettes} />}

      <section className="carte carte-tableau journal-recettes" aria-labelledby="titre-journal">
        <div className="entete-carte entete-tableau">
          <h2 id="titre-journal">
            {parJour ? "Recettes par jour" : "Journal des recettes"}
            <span className="impression-seule"> · {libellePeriode(periode)}</span>
          </h2>
          <div className="rangee">
            {periode.type !== "jour" && (
              <div className="segments sans-impression" role="group" aria-label="Présentation du journal">
                <button type="button" aria-pressed={!parJour} onClick={() => setVue("detail")}>
                  Détail
                </button>
                <button type="button" aria-pressed={parJour} onClick={() => setVue("jour")}>
                  Par jour
                </button>
              </div>
            )}
            <Exports desactive={!recettes?.length} excel={() => void exporter("xlsx")} csv={() => void exporter("csv")} imprimer={() => window.print()} />
          </div>
        </div>
        {message && (
          <p className="succes sans-impression" role="status">
            {message}
          </p>
        )}
        {erreur && <ErreurFacturation message={erreur} />}
        {recettes === null ? (
          <p className="vide discret">Chargement…</p>
        ) : recettes.length === 0 ? (
          <p className="vide discret">Aucun règlement encaissé {surLaPeriode(periode)}.</p>
        ) : parJour ? (
          <ParJour recettes={recettes} periode={periode} voirJour={(jour) => changerPeriode({ type: "jour", reference: dateLocale(jour) })} />
        ) : (
          <>
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Encaissé le</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Facture</th>
                  <th scope="col">Moyen</th>
                  <th scope="col" className="nombre">
                    Montant
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <tr key={r.id} data-importe={r.importe || undefined}>
                    <td>{dateCourte(r.encaisse_le)}</td>
                    <td>
                      <strong>{r.nom}</strong>
                    </td>
                    <td>
                      <a href={adresse("facturation", "facture", r.facture_id)}>{r.facture_numero ?? "brouillon"}</a>
                      {r.facture_date && r.facture_date.slice(0, 7) !== r.encaisse_le.slice(0, 7) && (
                        <span className="discret"> · facture du {dateCourte(r.facture_date)}</span>
                      )}
                    </td>
                    <td>
                      <PastilleMoyen moyen={r.moyen} /> {libelleMoyen(r.moyen)}
                      {r.reference && <span className="discret"> n° {r.reference}</span>}
                      {r.montant_centimes < 0 && <span className="discret"> · remboursement</span>}
                    </td>
                    <td className="nombre">{euros(r.montant_centimes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pied-tableau">
              <span>
                {visibles.length} règlement{visibles.length > 1 ? "s" : ""} affiché{visibles.length > 1 ? "s" : ""} sur {recettes.length}
                {!tout && recettes.length > visibles.length && (
                  <>
                    {" "}
                    ·{" "}
                    <button type="button" className="lien-bouton sans-impression" onClick={() => setTout(true)}>
                      tout afficher
                    </button>
                  </>
                )}
              </span>
              <span>
                Total {surLaPeriode(periode)} : {euros(total)}
              </span>
            </div>
          </>
        )}
      </section>
    </>
  );
}

type FiltreFactures = "toutes" | "factures" | "avoirs" | "brouillons" | "annulees";

/** Les factures visibles, en tableau : une ligne par facture ou avoir. */
function feuilleFactures(factures: ResumeFacture[]): Feuille {
  return {
    nom: "Factures et avoirs",
    colonnes: [
      colonne("N°"),
      colonne("Nature"),
      colonne("Émise le", "date"),
      colonne("Patient"),
      colonne("Destinataire"),
      colonne("Désignation"),
      colonne("Montant", "montant"),
      colonne("Réglé", "montant"),
      colonne("Reste", "montant"),
      colonne("Moyens"),
      colonne("État"),
    ],
    lignes: factures.map((f) => [
      f.numero ?? "",
      f.nature === "avoir" ? "Avoir" : "Facture",
      f.date_emission,
      [f.patient_prenom, f.patient_nom].filter(Boolean).join(" "),
      f.destinataire,
      f.designation,
      f.total_centimes / 100,
      f.regle_centimes / 100,
      f.etat === "emise" && f.nature === "facture" ? f.reste_centimes / 100 : null,
      f.moyens.map(libelleMoyen).join(", "),
      LIBELLES_ETAT[etatPaiement(f)],
    ]),
  };
}

function Factures({ coeur, periode }: { coeur: Coeur; periode: Periode }) {
  const id = useId();
  const [factures, setFactures] = useState<ResumeFacture[] | null>(null);
  const [filtre, setFiltre] = useState<FiltreFactures>("toutes");
  const [moyen, setMoyen] = useState<Moyen | "aucun" | "">("");
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [du, au] = bornesPeriode(periode);

  useEffect(() => {
    setFactures(null);
    coeur.listerFactures(du, au).then(setFactures, (e: Error) => setErreur(e.message));
  }, [coeur, du, au]);

  const garder: Record<FiltreFactures, (f: ResumeFacture) => boolean> = {
    toutes: () => true,
    factures: (f) => f.nature === "facture" && f.etat !== "brouillon",
    avoirs: (f) => f.nature === "avoir",
    brouillons: (f) => f.etat === "brouillon",
    annulees: (f) => f.etat === "annulee",
  };
  const t = normaliser(texte);
  const parMoyen = (f: ResumeFacture) => !moyen || (moyen === "aucun" ? f.moyens.length === 0 : f.moyens.includes(moyen));
  const visibles = (factures ?? [])
    .filter(garder[filtre])
    .filter(parMoyen)
    .filter((f) => !t || normaliser(`${f.numero ?? ""} ${f.destinataire} ${f.patient_prenom} ${f.patient_nom} ${f.designation}`).includes(t));
  const compte = (cle: FiltreFactures) => (factures ?? []).filter(garder[cle]).filter(parMoyen).length;

  async function exporter(format: "xlsx" | "csv") {
    setErreur(null);
    try {
      const nom = du === au ? `Factures du ${du}` : `Factures ${du} au ${au}`;
      const feuille = feuilleFactures(visibles);
      const chemin = format === "xlsx" ? await coeur.exporterClasseur(`${nom}.xlsx`, [feuille]) : await coeur.exporterFichier(`${nom}.csv`, feuilleVersCsv(feuille));
      setMessage(`Export enregistré : ${chemin}`);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }
  const FILTRES: { cle: FiltreFactures; libelle: string }[] = [
    { cle: "toutes", libelle: "Toutes" },
    { cle: "factures", libelle: "Factures" },
    { cle: "avoirs", libelle: "Avoirs" },
    { cle: "brouillons", libelle: "Brouillons" },
    { cle: "annulees", libelle: "Annulées" },
  ];

  return (
    <>
      <div className="filtres">
        <div className="rangee" role="group" aria-label="Type de document">
          {FILTRES.map((f) => (
            <button key={f.cle} type="button" className="filtre-puce" aria-pressed={filtre === f.cle} onClick={() => setFiltre(f.cle)}>
              {f.libelle} · {compte(f.cle)}
            </button>
          ))}
        </div>
        <div className="rangee">
          <label htmlFor={`${id}-moyen`} className="visuellement-cache">
            Moyen de paiement
          </label>
          <select id={`${id}-moyen`} className="choix-filtre" value={moyen} onChange={(e) => setMoyen(e.target.value as Moyen | "aucun" | "")}>
            <option value="">Tous les moyens de paiement</option>
            {MOYENS.map((m) => (
              <option key={m.valeur} value={m.valeur}>
                Réglées par {m.libelle.toLowerCase()}
              </option>
            ))}
            <option value="aucun">Sans règlement</option>
          </select>
          <input
            type="search"
            className="recherche recherche-seances"
            aria-label="Rechercher une facture"
            placeholder="N°, patient, désignation…"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
          />
        </div>
      </div>
      <div className="rangee rangee-centree rangee-exports">
        <span className="discret">
          {visibles.length} document{visibles.length > 1 ? "s" : ""} · total {euros(visibles.filter((f) => f.etat !== "brouillon").reduce((t, f) => t + f.total_centimes, 0))}
        </span>
        <Exports desactive={!visibles.length} excel={() => void exporter("xlsx")} csv={() => void exporter("csv")} />
      </div>
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
      {erreur && <ErreurFacturation message={erreur} />}
      <section className="carte carte-tableau" aria-label="Factures et avoirs de la période">
        {factures === null ? (
          <p className="vide discret">Chargement…</p>
        ) : visibles.length === 0 ? (
          <p className="vide discret">Aucune facture sur cette période.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th scope="col">N°</th>
                <th scope="col">Émise le</th>
                <th scope="col">Patient</th>
                <th scope="col">Désignation</th>
                <th scope="col" className="nombre">
                  Montant
                </th>
                <th scope="col">État</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} onClick={() => aller("facturation", "facture", f.id)}>
                  <td className="sans-retour">
                    <a href={adresse("facturation", "facture", f.id)} onClick={(e) => e.stopPropagation()}>
                      {f.numero ? intituleFacture(f) : "Brouillon"}
                    </a>
                  </td>
                  <td>{f.date_emission ? dateCourte(f.date_emission) : <span className="discret">—</span>}</td>
                  <td>
                    <strong>{[f.patient_prenom, f.patient_nom].filter(Boolean).join(" ") || f.destinataire}</strong>
                    {f.patient_id && f.destinataire && f.destinataire !== `${f.patient_prenom} ${f.patient_nom}` && (
                      <span className="discret"> · à {f.destinataire}</span>
                    )}
                  </td>
                  <td>
                    {f.designation}
                    {f.origine_numero && <span className="discret"> · {f.nature === "avoir" ? "annule" : "remplace"} {f.origine_numero}</span>}
                  </td>
                  <td className="nombre">{euros(f.total_centimes)}</td>
                  <td>
                    <EtatFacture facture={f} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function AFacturer({
  coeur,
  seances,
  prestation,
  recharger,
}: {
  coeur: Coeur;
  seances: ResumeSeance[];
  prestation: Prestation | null;
  recharger: () => void;
}) {
  const [choisies, setChoisies] = useState<string[]>([]);
  const [moyen, setMoyen] = useState<Moyen | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const emettables = seances.filter((s) => !s.facture);

  async function emettre() {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      const reglement = moyen ? { ...REGLEMENT_VIDE, moyen, encaisse_le: dateDuJour() } : null;
      const factures = await coeur.facturerSeances(choisies, reglement, dateDuJour());
      setMessage(`${factures.length} facture${factures.length > 1 ? "s" : ""} émise${factures.length > 1 ? "s" : ""} : ${factures.map((f) => f.numero).join(", ")}.`);
      setChoisies([]);
      signalerFacturation();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
      recharger();
    }
  }

  return (
    <>
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
      {erreur && <ErreurFacturation message={erreur} />}
      <section className="carte carte-tableau" aria-label="Séances à facturer">
        {seances.length === 0 ? (
          <p className="vide discret">Toutes les séances sont facturées.</p>
        ) : (
          <>
            <div className="entete-carte entete-tableau emission-groupee">
              <label className="case-simple">
                <input
                  type="checkbox"
                  checked={choisies.length === emettables.length && emettables.length > 0}
                  onChange={(e) => setChoisies(e.target.checked ? emettables.map((s) => s.id) : [])}
                />
                Tout sélectionner
              </label>
              {choisies.length > 0 && (
                <div className="rangee">
                  <ChoixMoyen libelle="Règlement" valeur={moyen} changer={setMoyen} enAttente />
                  <button type="button" className="bouton bouton-principal" disabled={envoi || !prestation} onClick={() => void emettre()}>
                    Émettre {choisies.length} facture{choisies.length > 1 ? "s" : ""}
                    {prestation && ` · ${prestation.libelle} ${euros(prestation.tarif_centimes)}`}
                  </button>
                </div>
              )}
            </div>
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visuellement-cache">Choisir</span>
                  </th>
                  <th scope="col">Séance</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Motif</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {seances.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {!s.facture && (
                        <input
                          type="checkbox"
                          aria-label={`Facturer la séance de ${s.patient_prenom} ${s.patient_nom} du ${dateCourte(s.debut.slice(0, 10))}`}
                          checked={choisies.includes(s.id)}
                          onChange={(e) => setChoisies(e.target.checked ? [...choisies, s.id] : choisies.filter((x) => x !== s.id))}
                        />
                      )}
                    </td>
                    <td>
                      <a href={adresse("seances", s.id)}>
                        {dateCourte(s.debut.slice(0, 10))} · {s.debut.slice(11, 16)}
                      </a>
                    </td>
                    <td>
                      <a href={adresse("patients", s.patient_id)}>
                        {s.patient_prenom} {s.patient_nom}
                      </a>
                    </td>
                    <td>{s.titre || s.motif || <span className="discret">Sans motif</span>}</td>
                    <td>
                      {s.facture ? (
                        <a href={adresse("facturation", "facture", s.facture.id)}>Brouillon de facture</a>
                      ) : (
                        <a href={adresse("seances", s.id)}>Facturer…</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </>
  );
}

function EnAttente({ coeur, factures, recharger }: { coeur: Coeur; factures: ResumeFacture[]; recharger: () => void }) {
  const [ouverte, setOuverte] = useState<string | null>(null);
  return (
    <section className="carte carte-tableau" aria-label="Factures en attente de règlement">
      {factures.length === 0 ? (
        <p className="vide discret">Aucune facture n’attend de règlement.</p>
      ) : (
        <table className="tableau">
          <thead>
            <tr>
              <th scope="col">Facture</th>
              <th scope="col">Émise le</th>
              <th scope="col">Patient</th>
              <th scope="col" className="nombre">
                Total
              </th>
              <th scope="col" className="nombre">
                Reste
              </th>
              <th scope="col">
                <span className="visuellement-cache">Action</span>
              </th>
            </tr>
          </thead>
          {factures.map((f) => (
            <tbody key={f.id}>
              <tr>
                <td>
                  <a href={adresse("facturation", "facture", f.id)}>{f.numero}</a>
                </td>
                <td>{f.date_emission && dateCourte(f.date_emission)}</td>
                <td>
                  <strong>{[f.patient_prenom, f.patient_nom].filter(Boolean).join(" ") || f.destinataire}</strong>
                </td>
                <td className="nombre">{euros(f.total_centimes)}</td>
                <td className="nombre">
                  <strong>{euros(f.reste_centimes)}</strong>
                </td>
                <td>
                  <button type="button" className="bouton bouton-petit" aria-expanded={ouverte === f.id} onClick={() => setOuverte(ouverte === f.id ? null : f.id)}>
                    Noter un règlement
                  </button>
                </td>
              </tr>
              {ouverte === f.id && (
                <tr className="ligne-formulaire">
                  <td colSpan={6}>
                    <FormulaireReglement
                      initial={{ ...REGLEMENT_VIDE, montant_centimes: f.reste_centimes }}
                      libelleValider="Enregistrer le règlement"
                      annuler={() => setOuverte(null)}
                      valider={async (saisie) => {
                        await coeur.ajouterReglement(f.id, saisie);
                        setOuverte(null);
                        recharger();
                      }}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      )}
    </section>
  );
}

/** Facturation : recettes de la période, factures et avoirs, séances à facturer, règlements attendus. */
export function PageFacturation({ coeur, onglet, aujourdhui }: { coeur: Coeur; onglet: OngletFacturation; aujourdhui?: Date }) {
  const jour = useMemo(() => aujourdhui ?? new Date(), [aujourdhui]);
  const [periode, setPeriode] = useState<Periode>({ type: "mois", reference: jour });
  const [aFacturer, setAFacturer] = useState<ResumeSeance[]>([]);
  const [enAttente, setEnAttente] = useState<ResumeFacture[]>([]);
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    Promise.all([coeur.seancesAFacturer(), coeur.facturesEnAttente(), coeur.listerPrestations()]).then(([s, f, p]) => {
      setAFacturer(s);
      setEnAttente(f);
      setPrestations(p);
    }, () => undefined);
  }, [coeur, version]);

  const prestation = prestationParDefaut(prestations);
  const recharger = () => setVersion((v) => v + 1);

  return (
    <main className="page page-large page-facturation">
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Facturation</h1>
          <p className="page-sous-titre">Recettes, factures et règlements du cabinet</p>
        </div>
        <div className="rangee">
          {(onglet === "recettes" || onglet === "factures") && <ChoixPeriode periode={periode} changer={setPeriode} aujourdhui={jour} avecJour />}
          <a className="bouton sans-impression" href={adresse("facturation", "nouvelle")}>
            Nouvelle facture
          </a>
        </div>
      </div>
      <Onglets courant={onglet} aFacturer={aFacturer.filter((s) => !s.facture).length} enAttente={enAttente.length} />
      {onglet === "recettes" && (
        <Recettes key={version} coeur={coeur} periode={periode} changerPeriode={setPeriode} aFacturer={aFacturer} enAttente={enAttente} tarif={prestation?.tarif_centimes ?? 0} />
      )}
      {onglet === "factures" && <Factures coeur={coeur} periode={periode} />}
      {onglet === "a-facturer" && <AFacturer coeur={coeur} seances={aFacturer} prestation={prestation} recharger={recharger} />}
      {onglet === "en-attente" && <EnAttente coeur={coeur} factures={enAttente} recharger={recharger} />}
    </main>
  );
}

