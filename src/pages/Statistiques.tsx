import { useEffect, useMemo, useState } from "react";

import { dateDuJour, type Coeur } from "../lib/coeur";
import { dateCourte } from "../lib/dates";
import { euros, libelleMoyen, versCsv } from "../lib/facturation";
import { adresse } from "../lib/navigation";
import { bornesPeriode, type Periode } from "../lib/periodes";
import { evolution, unAnAvant, type BaseChiffre, type Comparaison, type Recence, type SemaineStatistiques, type Statistiques } from "../lib/statistiques";
import { colonne, type Feuille } from "../lib/tableur";
import { BarresHorizontales, ColonnesGroupees, creneauLePlusCharge, GrilleCreneaux, MOIS_COURTS, MOIS_LONGS, Repartition } from "../statistiques/Graphiques";
import { ChoixPeriode } from "./Facturation";

const nombreFr = (n: number, decimales = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/** « 34 600 € » : sans centimes, pour les tuiles et les axes. */
function eurosRonds(centimes: number): string {
  return `${nombreFr(Math.round(centimes / 100))} €`;
}

/** « janvier à septembre 2026 », « du 3 mars 2026 au 7 octobre 2026 ». */
function libelleDuree(du: string, au: string, aujourdhui: string): string {
  const [ad, md, jd] = du.split("-").map(Number);
  const [aa, ma, ja] = au.split("-").map(Number);
  const finDeMois = new Date(aa, ma, 0).getDate();
  if (jd === 1 && ad === aa && (ja === finDeMois || au === aujourdhui)) {
    const debut = MOIS_LONGS[md - 1];
    return md === ma ? `${debut} ${aa}` : `${debut} à ${MOIS_LONGS[ma - 1]} ${aa}`;
  }
  return `du ${dateCourte(du)} au ${dateCourte(au)}`;
}

function Tuile({ libelle, comparaison, format, annee }: { libelle: string; comparaison: Comparaison; format: (v: number) => string; annee: string }) {
  const ecart = evolution(comparaison);
  const sens = ecart === null || Math.abs(ecart) < 0.05 ? "stable" : ecart > 0 ? "hausse" : "baisse";
  return (
    <div className="tuile">
      <span>{libelle}</span>
      <strong>{format(comparaison.valeur)}</strong>
      <span className="variation" data-sens={sens}>
        {ecart === null ? (
          <span className="discret">Pas de comparaison avec {annee}</span>
        ) : (
          <>
            <span aria-hidden="true">{sens === "hausse" ? "↑" : sens === "baisse" ? "↓" : "="}</span> {sens === "baisse" ? "−" : sens === "hausse" ? "+" : ""}
            {nombreFr(Math.abs(ecart), 1)} % · {format(comparaison.precedent)} en {annee}
          </>
        )}
      </span>
    </div>
  );
}

function ChiffreParMois({ stats }: { stats: Statistiques }) {
  const [tableau, setTableau] = useState(false);
  const annee = stats.au.slice(0, 4);
  const anneeP = stats.au_precedent.slice(0, 4);
  const plusHauts = stats.par_mois.filter((m) => m.chiffre > m.chiffre_precedent).length;
  const titre =
    stats.par_mois.length === 0
      ? "Chiffre d’affaires par mois"
      : plusHauts === stats.par_mois.length
        ? `Chiffre d’affaires par mois : chaque mois dépasse ${anneeP}`
        : `Chiffre d’affaires par mois : ${plusHauts} mois sur ${stats.par_mois.length} au-dessus de ${anneeP}`;
  return (
    <section className="carte" aria-labelledby="titre-ca-mois">
      <div className="entete-carte">
        <h2 id="titre-ca-mois">{titre}</h2>
        <div className="rangee legende-series">
          <span>
            <span className="cle-rect" data-serie="courant" aria-hidden="true" /> {annee} · {eurosRonds(stats.chiffre.valeur)}
          </span>
          <span>
            <span className="cle-rect" data-serie="precedent" aria-hidden="true" /> {anneeP} · {eurosRonds(stats.chiffre.precedent)}
          </span>
          <button type="button" className="lien-bouton" aria-pressed={tableau} onClick={() => setTableau((t) => !t)}>
            {tableau ? "Voir en graphique" : "Voir en tableau"}
          </button>
        </div>
      </div>
      {tableau ? (
        <table className="tableau">
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col" className="nombre">
                {annee}
              </th>
              <th scope="col" className="nombre">
                {anneeP}
              </th>
              <th scope="col" className="nombre">
                Séances {annee}
              </th>
              <th scope="col" className="nombre">
                Séances {anneeP}
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.par_mois.map((m) => (
              <tr key={m.mois}>
                <td>{libelleMois(m.mois, true)}</td>
                <td className="nombre">{euros(m.chiffre)}</td>
                <td className="nombre">{euros(m.chiffre_precedent)}</td>
                <td className="nombre">{m.seances}</td>
                <td className="nombre">{m.seances_precedent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ColonnesGroupees
          description={titre}
          categories={stats.par_mois.map((m) => ({ cle: m.mois, libelle: libelleMois(m.mois), detail: libelleMois(m.mois, true) }))}
          series={[
            { cle: "precedent", libelle: anneeP, valeurs: stats.par_mois.map((m) => m.chiffre_precedent) },
            { cle: "courant", libelle: annee, valeurs: stats.par_mois.map((m) => m.chiffre) },
          ]}
          format={euros}
          formatAxe={eurosRonds}
        />
      )}
    </section>
  );
}

const libelleMois = (m: string, long = false) => {
  const [a, mo] = m.split("-").map(Number);
  return long ? `${MOIS_LONGS[mo - 1]} ${a}` : MOIS_COURTS[mo - 1];
};

/** « 3 mars », « 1er juin » : le lundi d'une semaine, pour les axes. */
function lundiCourt(date: string, annee = false): string {
  const [a, m, j] = date.split("-").map(Number);
  return `${j === 1 ? "1er" : j} ${annee ? MOIS_LONGS[m - 1] : MOIS_COURTS[m - 1]}${annee ? ` ${a}` : ""}`;
}

type VueActivite = "mois" | "semaine" | "nouveaux";

/** La moyenne des semaines où il y a eu au moins une séance, et la plus chargée. */
export function rythmeDesSemaines(semaines: SemaineStatistiques[]): { travaillees: number; moyenne: number; plusChargee: SemaineStatistiques | null } {
  const travaillees = semaines.filter((s) => s.seances > 0);
  return {
    travaillees: travaillees.length,
    moyenne: travaillees.length ? travaillees.reduce((t, s) => t + s.seances, 0) / travaillees.length : 0,
    plusChargee: travaillees.reduce<SemaineStatistiques | null>((m, s) => (!m || s.seances > m.seances ? s : m), null),
  };
}

const pluriel = (n: number, mot: string, motPluriel = `${mot}s`) => `${nombreFr(n)} ${n > 1 ? motPluriel : mot}`;

/** Séances par mois et par semaine, nouveaux patients par mois : comparés à l'année précédente. */
function Activite({ stats }: { stats: Statistiques }) {
  const [vue, setVue] = useState<VueActivite>("mois");
  const [tableau, setTableau] = useState(false);
  const annee = stats.au.slice(0, 4);
  const anneeP = stats.au_precedent.slice(0, 4);
  const premieres = stats.par_mois.reduce((t, m) => t + m.premieres, 0);
  const semaines = rythmeDesSemaines(stats.par_semaine);
  const mois = stats.par_mois.map((m) => ({ cle: m.mois, libelle: libelleMois(m.mois), detail: libelleMois(m.mois, true) }));

  const resume =
    vue === "mois"
      ? `${pluriel(stats.seances.valeur, "séance")}${stats.seances.valeur ? `, dont ${pluriel(premieres, "première")} (${Math.round((premieres / stats.seances.valeur) * 100)} %)` : ""} ; ${nombreFr(stats.seances.precedent)} en ${anneeP} sur la même période.`
      : vue === "semaine"
        ? semaines.plusChargee
          ? `${nombreFr(semaines.moyenne, 1)} séance${semaines.moyenne >= 2 ? "s" : ""} par semaine en moyenne, sur ${pluriel(semaines.travaillees, "semaine travaillée", "semaines travaillées")} ; la plus chargée : ${pluriel(semaines.plusChargee.seances, "séance")}, semaine du ${lundiCourt(semaines.plusChargee.lundi, true)}.`
          : "Aucune séance sur cette période."
        : `${pluriel(stats.nouveaux_patients.valeur, "nouveau patient", "nouveaux patients")}, contre ${nombreFr(stats.nouveaux_patients.precedent)} en ${anneeP} sur la même période : leur toute première séance au cabinet.`;

  const legende = (valeur: number, precedent: number) => (
    <>
      <span>
        <span className="cle-rect" data-serie="courant" aria-hidden="true" /> {annee} · {nombreFr(valeur)}
      </span>
      {vue !== "semaine" && (
        <span>
          <span className="cle-rect" data-serie="precedent" aria-hidden="true" /> {anneeP} · {nombreFr(precedent)}
        </span>
      )}
    </>
  );

  return (
    <section className="carte" aria-labelledby="titre-activite">
      <div className="entete-carte">
        <h2 id="titre-activite">Activité</h2>
        <div className="segments" role="group" aria-label="Activité affichée">
          <button type="button" aria-pressed={vue === "mois"} onClick={() => setVue("mois")}>
            Séances par mois
          </button>
          <button type="button" aria-pressed={vue === "semaine"} onClick={() => setVue("semaine")}>
            Par semaine
          </button>
          <button type="button" aria-pressed={vue === "nouveaux"} onClick={() => setVue("nouveaux")}>
            Nouveaux patients
          </button>
        </div>
      </div>
      <div className="entete-carte">
        <p className="resume-activite">{resume}</p>
        <div className="rangee legende-series">
          {vue === "nouveaux" ? legende(stats.nouveaux_patients.valeur, stats.nouveaux_patients.precedent) : legende(stats.seances.valeur, stats.seances.precedent)}
          <button type="button" className="lien-bouton" aria-pressed={tableau} onClick={() => setTableau((t) => !t)}>
            {tableau ? "Voir en graphique" : "Voir en tableau"}
          </button>
        </div>
      </div>
      {tableau ? (
        <div className="defilement-tableau">
          {vue === "semaine" ? (
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Semaine du</th>
                  <th scope="col" className="nombre">
                    Séances
                  </th>
                  <th scope="col" className="nombre">
                    Dont premières
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.par_semaine.map((s) => (
                  <tr key={s.lundi}>
                    <td>{lundiCourt(s.lundi, true)}</td>
                    <td className="nombre">{s.seances}</td>
                    <td className="nombre">{s.premieres}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Mois</th>
                  <th scope="col" className="nombre">
                    {vue === "mois" ? `Séances ${annee}` : annee}
                  </th>
                  {vue === "mois" && (
                    <th scope="col" className="nombre">
                      Dont premières
                    </th>
                  )}
                  <th scope="col" className="nombre">
                    {vue === "mois" ? `Séances ${anneeP}` : anneeP}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.par_mois.map((m) => (
                  <tr key={m.mois}>
                    <td>{libelleMois(m.mois, true)}</td>
                    <td className="nombre">{vue === "mois" ? m.seances : m.nouveaux}</td>
                    {vue === "mois" && <td className="nombre">{m.premieres}</td>}
                    <td className="nombre">{vue === "mois" ? m.seances_precedent : m.nouveaux_precedent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : vue === "semaine" ? (
        <ColonnesGroupees
          description={`Séances par semaine : ${resume}`}
          categories={stats.par_semaine.map((s) => ({ cle: s.lundi, libelle: lundiCourt(s.lundi), detail: `Semaine du ${lundiCourt(s.lundi, true)}` }))}
          series={[{ cle: "courant", libelle: "séances", valeurs: stats.par_semaine.map((s) => s.seances) }]}
          format={(v) => nombreFr(v)}
          formatAxe={(v) => nombreFr(v)}
          entiers
        />
      ) : (
        <ColonnesGroupees
          description={`${vue === "mois" ? "Séances par mois" : "Nouveaux patients par mois"} : ${resume}`}
          categories={mois}
          series={
            vue === "mois"
              ? [
                  { cle: "precedent", libelle: anneeP, valeurs: stats.par_mois.map((m) => m.seances_precedent) },
                  { cle: "courant", libelle: annee, valeurs: stats.par_mois.map((m) => m.seances) },
                ]
              : [
                  { cle: "precedent", libelle: anneeP, valeurs: stats.par_mois.map((m) => m.nouveaux_precedent) },
                  { cle: "courant", libelle: annee, valeurs: stats.par_mois.map((m) => m.nouveaux) },
                ]
          }
          format={(v) => nombreFr(v)}
          formatAxe={(v) => nombreFr(v)}
          entiers
        />
      )}
    </section>
  );
}

const RECENCES: { cle: keyof Recence; libelle: string; definition: string; filtre: string }[] = [
  { cle: "actifs", libelle: "Actifs", definition: "venus dans l’année", filtre: "actifs" },
  { cle: "dormants", libelle: "Dormants", definition: "il y a un à deux ans", filtre: "dormants" },
  { cle: "inactifs", libelle: "Inactifs", definition: "il y a plus de deux ans", filtre: "inactifs" },
];

/** Actifs, dormants et inactifs ; la liste des patients s'ouvre sur chacun quand la période finit aujourd'hui. */
function Fidelite({ stats, aujourdhui }: { stats: Statistiques; aujourdhui: string }) {
  const r = stats.recence;
  const total = r.actifs + r.dormants + r.inactifs;
  const liens = stats.au === aujourdhui;
  const depuis = unAnAvant(stats.au);
  return (
    <section className="carte" aria-labelledby="titre-recence">
      <h2 id="titre-recence">Fidélité des patients</h2>
      {total > 0 ? (
        <>
          <p className="discret">
            {Math.round((r.actifs / total) * 100)} % des patients suivis sont actifs : venus depuis le {dateCourte(depuis)}.
          </p>
          <Repartition
            famille="recence"
            description="Patients actifs, dormants et inactifs"
            parts={RECENCES.map((x) => ({ cle: x.cle, libelle: x.libelle, valeur: r[x.cle] }))}
            legende={(p) => {
              const x = RECENCES.find((y) => y.cle === p.cle)!;
              const texte = `${p.libelle} · ${nombreFr(p.valeur)}`;
              return (
                <span>
                  {liens && p.valeur > 0 ? <a href={adresse("patients", "recence", x.filtre)}>{texte}</a> : texte} <span className="discret">{x.definition}</span>
                </span>
              );
            }}
          />
          <p className="discret note-recence">Comptés à la fin de la période, sans les dossiers archivés ni les patients décédés.</p>
        </>
      ) : (
        <p className="discret">Aucune séance encore.</p>
      )}
      <dl className="chiffres-cles">
        <div>
          <dt>Séances par patient</dt>
          <dd>{nombreFr(stats.seances_par_patient, 1)}</dd>
        </div>
        <div>
          <dt>Premières séances</dt>
          <dd>{stats.seances.valeur ? `${Math.round((stats.premieres_seances / stats.seances.valeur) * 100)} %` : "—"}</dd>
        </div>
        <div>
          <dt>Actes gratuits</dt>
          <dd>{stats.actes_gratuits}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Jours et heures de début des séances. */
function Rythme({ stats }: { stats: Statistiques }) {
  const pic = creneauLePlusCharge(stats.creneaux);
  const titre = pic ? `Jours et heures des séances : le plus souvent le ${pic.jour} à ${pic.heure} h` : "Jours et heures des séances";
  const plus = Math.max(0, ...stats.jours.map((j) => j.nombre));
  const jourPrefere = stats.jours.filter((j) => j.nombre === plus).length === 1 ? stats.jours.find((j) => j.nombre === plus) : undefined;
  return (
    <section className="carte" aria-labelledby="titre-rythme">
      <div className="entete-carte">
        <h2 id="titre-rythme">{titre}</h2>
        {jourPrefere && (
          <span className="discret">
            Jour le plus chargé : {jourPrefere.libelle.toLocaleLowerCase("fr")}, {pluriel(jourPrefere.nombre, "séance")}
          </span>
        )}
      </div>
      <GrilleCreneaux creneaux={stats.creneaux} description="Séances par jour de la semaine et par heure de début" />
    </section>
  );
}

function Classement({ titre, lignes, vide, lien }: { titre: string; lignes: { libelle: string; nombre: number; id?: string }[]; vide: string; lien?: (id: string) => string }) {
  return (
    <section className="carte" aria-label={titre}>
      <h2>{titre}</h2>
      {lignes.length === 0 ? (
        <p className="discret">{vide}</p>
      ) : (
        <ul className="classement">
          {lignes.map((l) => (
            <li key={l.id ?? l.libelle}>
              {lien && l.id ? <a href={lien(l.id)}>{l.libelle}</a> : <span>{l.libelle}</span>}
              <strong>{l.nombre}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Le classeur Excel : une feuille par tableau, comparée à l'année précédente quand elle l'est à l'écran. */
function feuillesStatistiques(s: Statistiques): Feuille[] {
  const compte = (nom: string, titre: string, lignes: { libelle: string; nombre: number }[]): Feuille => ({
    nom,
    colonnes: [colonne(titre), colonne("Patients actifs", "nombre")],
    lignes: lignes.map((l) => [l.libelle, l.nombre]),
  });
  return [
    {
      nom: "Indicateurs",
      colonnes: [colonne("Indicateur"), colonne(`Du ${s.du} au ${s.au}`, "nombre"), colonne(`Du ${s.du_precedent} au ${s.au_precedent}`, "nombre")],
      lignes: [
        [`Chiffre d’affaires (€, selon ${s.base === "encaissement" ? "la date d’encaissement" : "la date de facture"})`, s.chiffre.valeur / 100, s.chiffre.precedent / 100],
        ["Séances", s.seances.valeur, s.seances.precedent],
        ["Panier moyen (€)", s.panier_moyen.valeur / 100, s.panier_moyen.precedent / 100],
        ["Nouveaux patients", s.nouveaux_patients.valeur, s.nouveaux_patients.precedent],
      ],
    },
    {
      nom: "Par mois",
      colonnes: [
        colonne("Mois"),
        colonne("Chiffre d’affaires", "montant"),
        colonne("Année précédente", "montant"),
        colonne("Séances", "nombre"),
        colonne("Dont premières", "nombre"),
        colonne("Séances année précédente", "nombre"),
        colonne("Nouveaux patients", "nombre"),
        colonne("Nouveaux année précédente", "nombre"),
      ],
      lignes: s.par_mois.map((m) => [m.mois, m.chiffre / 100, m.chiffre_precedent / 100, m.seances, m.premieres, m.seances_precedent, m.nouveaux, m.nouveaux_precedent]),
    },
    {
      nom: "Par semaine",
      colonnes: [colonne("Semaine du", "date"), colonne("Séances", "nombre"), colonne("Dont premières", "nombre")],
      lignes: s.par_semaine.map((x) => [x.lundi, x.seances, x.premieres]),
    },
    {
      nom: "Moyens de paiement",
      colonnes: [colonne("Moyen"), colonne("Montant", "montant"), colonne("Règlements", "nombre")],
      lignes: s.moyens.map((m) => [libelleMoyen(m.moyen), m.montant / 100, m.nombre]),
    },
    {
      nom: "Fidélité",
      colonnes: [colonne("Patients suivis"), colonne("Dernière séance"), colonne("Nombre", "nombre")],
      lignes: RECENCES.map((x) => [x.libelle, x.definition, s.recence[x.cle]]),
    },
    compte("Âges", "Tranche d’âge", s.ages),
    compte("Villes", "Ville", s.villes),
    compte("Antécédents", "Antécédent", s.antecedents),
    {
      nom: "Jours et heures",
      colonnes: [colonne("Jour"), ...HEURES.map((h) => colonne(`${h} h`, "nombre")), colonne("Total", "nombre")],
      lignes: s.jours.map((j, rang) => [j.libelle, ...HEURES.map((h) => s.creneaux[rang]?.[h] ?? 0), j.nombre]),
    },
  ];
}

const HEURES = Array.from({ length: 24 }, (_, h) => h);

function csvStatistiques(s: Statistiques): string {
  const lignes: (string | number)[][] = [
    ["Période", `${s.du} au ${s.au}`, `comparée au ${s.du_precedent} au ${s.au_precedent}`],
    ["Chiffre d’affaires selon", s.base === "encaissement" ? "la date d’encaissement" : "la date de facture"],
    [],
    ["Indicateur", "Période", "Année précédente"],
    ["Chiffre d’affaires (€)", s.chiffre.valeur / 100, s.chiffre.precedent / 100],
    ["Séances", s.seances.valeur, s.seances.precedent],
    ["Panier moyen (€)", s.panier_moyen.valeur / 100, s.panier_moyen.precedent / 100],
    ["Nouveaux patients", s.nouveaux_patients.valeur, s.nouveaux_patients.precedent],
    [],
    ["Mois", "Chiffre d’affaires (€)", "Année précédente (€)", "Séances", "Dont premières", "Séances année précédente", "Nouveaux patients", "Nouveaux année précédente"],
    ...s.par_mois.map((m) => [m.mois, m.chiffre / 100, m.chiffre_precedent / 100, m.seances, m.premieres, m.seances_precedent, m.nouveaux, m.nouveaux_precedent]),
    [],
    ["Semaine du", "Séances", "Dont premières"],
    ...s.par_semaine.map((x) => [x.lundi, x.seances, x.premieres]),
    [],
    ["Patients suivis", "Dernière séance", "Nombre"],
    ...RECENCES.map((x) => [x.libelle, x.definition, s.recence[x.cle]]),
    [],
    ["Moyen de paiement", "Montant (€)", "Règlements"],
    ...s.moyens.map((m) => [libelleMoyen(m.moyen), m.montant / 100, m.nombre]),
    [],
    ["Tranche d’âge", "Patients actifs"],
    ...s.ages.map((a) => [a.libelle, a.nombre]),
    [],
    ["Ville", "Patients actifs"],
    ...s.villes.map((v) => [v.libelle, v.nombre]),
    [],
    ["Antécédent", "Patients actifs"],
    ...s.antecedents.map((a) => [a.libelle, a.nombre]),
    [],
    ["Jour", ...HEURES.map((h) => `${h} h`), "Total"],
    ...s.jours.map((j, rang) => [j.libelle, ...HEURES.map((h) => s.creneaux[rang]?.[h] ?? 0), j.nombre]),
  ];
  return versCsv(["Statistiques Osteosphere"], lignes);
}

/** Statistiques : chiffre d'affaires, activité, patientèle et fidélité, comparés à l'année précédente. */
export function PageStatistiques({ coeur, aujourdhui }: { coeur: Coeur; aujourdhui?: Date }) {
  const jour = useMemo(() => aujourdhui ?? new Date(), [aujourdhui]);
  const [periode, setPeriode] = useState<Periode>({ type: "annee", reference: jour });
  const [base, setBase] = useState<BaseChiffre>("encaissement");
  const [stats, setStats] = useState<Statistiques | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [du, auBrut] = bornesPeriode(periode);
  // La période en cours s'arrête aujourd'hui : elle se compare à la même durée l'an passé.
  const today = dateDuJour(jour);
  const au = auBrut > today && du <= today ? today : auBrut;

  useEffect(() => {
    setChargement(true);
    coeur
      .statistiques(du, au, base)
      .then(setStats, (e: Error) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, [coeur, du, au, base]);

  async function exporter(format: "xlsx" | "csv") {
    if (!stats) return;
    const nom = `Statistiques ${stats.du} au ${stats.au}`;
    try {
      const chemin =
        format === "xlsx" ? await coeur.exporterClasseur(`${nom}.xlsx`, feuillesStatistiques(stats)) : await coeur.exporterFichier(`${nom}.csv`, csvStatistiques(stats));
      setMessage(`Export enregistré : ${chemin}`);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  const annee = (stats?.au_precedent ?? au).slice(0, 4);

  return (
    <main className="page page-large page-statistiques">
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Statistiques</h1>
          <p className="page-sous-titre">
            {libelleDuree(du, au, today).replace(/^./, (c) => c.toUpperCase())}, comparé à la même période de {Number(au.slice(0, 4)) - 1}
          </p>
        </div>
        <div className="rangee">
          <button type="button" className="bouton" disabled={!stats} onClick={() => void exporter("xlsx")}>
            Exporter (Excel)
          </button>
          <button type="button" className="bouton bouton-discret" disabled={!stats} onClick={() => void exporter("csv")}>
            CSV
          </button>
        </div>
      </div>
      <div className="filtres-statistiques">
        <ChoixPeriode periode={periode} changer={setPeriode} aujourdhui={jour} />
        <div className="pile-serree">
          <span className="libelle-champ">Chiffre d’affaires selon</span>
          <div className="segments" role="group" aria-label="Chiffre d’affaires selon">
            <button type="button" aria-pressed={base === "encaissement"} onClick={() => setBase("encaissement")}>
              la date d’encaissement
            </button>
            <button type="button" aria-pressed={base === "facture"} onClick={() => setBase("facture")}>
              la date de facture
            </button>
          </div>
        </div>
      </div>
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {stats && (
        <div className="pile" data-chargement={chargement || undefined}>
          <div className="tuiles tuiles-quatre">
            <Tuile libelle="Chiffre d’affaires" comparaison={stats.chiffre} format={eurosRonds} annee={annee} />
            <Tuile libelle="Séances" comparaison={stats.seances} format={(v) => nombreFr(v)} annee={annee} />
            <Tuile libelle="Panier moyen" comparaison={stats.panier_moyen} format={euros} annee={annee} />
            <Tuile libelle="Nouveaux patients" comparaison={stats.nouveaux_patients} format={(v) => nombreFr(v)} annee={annee} />
          </div>

          <ChiffreParMois stats={stats} />

          <Activite stats={stats} />

          <div className="colonnes-statistiques">
            <section className="carte" aria-labelledby="titre-ages">
              <h2 id="titre-ages">Patients actifs par âge</h2>
              {stats.patients_actifs === 0 ? (
                <p className="discret">Aucun patient venu sur cette période.</p>
              ) : (
                <>
                  <BarresHorizontales lignes={stats.ages.map((a) => ({ libelle: a.libelle, valeur: a.nombre }))} />
                  <p className="discret">
                    {nombreFr(stats.patients_actifs)} patient{stats.patients_actifs > 1 ? "s" : ""} actif{stats.patients_actifs > 1 ? "s" : ""}
                    {stats.age_moyen !== null && ` · âge moyen ${nombreFr(stats.age_moyen)} ans`}
                  </p>
                  <h3>Sexe</h3>
                  <Repartition
                    famille="sexe"
                    description="Patients actifs par sexe"
                    parts={[
                      { cle: "femmes", libelle: "Femmes", valeur: stats.sexes.femmes },
                      { cle: "hommes", libelle: "Hommes", valeur: stats.sexes.hommes },
                      { cle: "non_renseigne", libelle: "Non renseigné", valeur: stats.sexes.non_renseigne },
                    ].filter((p) => p.valeur > 0 || p.cle !== "non_renseigne")}
                  />
                </>
              )}
            </section>

            <Fidelite stats={stats} aujourdhui={today} />
          </div>

          <div className="colonnes-statistiques">
            <section className="carte" aria-labelledby="titre-moyens-stats">
              <h2 id="titre-moyens-stats">Encaissements par moyen de paiement</h2>
              {stats.moyens.length === 0 ? (
                <p className="discret">Aucun encaissement sur cette période.</p>
              ) : (
                <Repartition
                  famille="moyen"
                  description="Encaissements par moyen de paiement"
                  parts={stats.moyens.map((m) => ({ cle: m.moyen, libelle: libelleMoyen(m.moyen), valeur: m.montant, detail: euros(m.montant) }))}
                  legende={(p, pourcent) => `${p.libelle} · ${eurosRonds(p.valeur)} · ${pourcent} %`}
                />
              )}
            </section>
            <section className="carte" aria-labelledby="titre-douleur">
              <h2 id="titre-douleur">Douleur avant et après la séance</h2>
              {stats.douleur ? (
                <p className="douleur-moyenne">
                  <strong>
                    {nombreFr(stats.douleur.avant, 1)} → {nombreFr(stats.douleur.apres, 1)}
                  </strong>
                  <span className="discret">
                    douleur moyenne avant et après la séance, sur {stats.douleur.seances} séance{stats.douleur.seances > 1 ? "s" : ""} où elle est notée
                  </span>
                </p>
              ) : (
                <p className="discret">La douleur avant et après n’est notée dans aucune séance de la période.</p>
              )}
            </section>
          </div>

          <Rythme stats={stats} />

          <div className="colonnes-trois">
            <Classement titre="Villes les plus représentées" lignes={stats.villes} vide="Aucune ville renseignée." />
            <Classement titre="Antécédents les plus fréquents" lignes={stats.antecedents} vide="Aucun antécédent renseigné." />
            <Classement
              titre="Patients les plus suivis"
              lignes={stats.patients_suivis.map((p) => ({ id: p.id, libelle: `${p.prenom} ${p.nom}`, nombre: p.seances }))}
              vide="Aucune séance sur cette période."
              lien={(id) => adresse("patients", id)}
            />
          </div>
        </div>
      )}
    </main>
  );
}
