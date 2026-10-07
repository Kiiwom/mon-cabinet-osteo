import { useEffect, useMemo, useState } from "react";

import { dateDuJour, type Coeur } from "../lib/coeur";
import { dateCourte } from "../lib/dates";
import { euros, libelleMoyen, versCsv } from "../lib/facturation";
import { adresse } from "../lib/navigation";
import { bornesPeriode, type Periode } from "../lib/periodes";
import { evolution, type BaseChiffre, type Comparaison, type Statistiques } from "../lib/statistiques";
import { BarresHorizontales, ColonnesGroupees, MOIS_COURTS, MOIS_LONGS, PetitesColonnes, Repartition } from "../statistiques/Graphiques";
import { ChoixPeriode } from "./Facturation";

const nombreFr = (n: number, decimales = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/** « 34 600 € » : sans centimes, pour les tuiles et les axes. */
function eurosRonds(centimes: number): string {
  return `${nombreFr(Math.round(centimes / 100))} €`;
}

/** « janvier à septembre 2026 », « du 3 mars 2026 au 7 octobre 2026 ». */
function libelleDuree(du: string, au: string): string {
  const [ad, md, jd] = du.split("-").map(Number);
  const [aa, ma, ja] = au.split("-").map(Number);
  const finDeMois = new Date(aa, ma, 0).getDate();
  if (jd === 1 && ad === aa && (ja === finDeMois || au === dateDuJour())) {
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
  const libelleMois = (m: string, long = false) => {
    const [a, mo] = m.split("-").map(Number);
    return long ? `${MOIS_LONGS[mo - 1]} ${a}` : MOIS_COURTS[mo - 1];
  };
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
    ["Mois", "Chiffre d’affaires (€)", "Année précédente (€)", "Séances", "Séances année précédente"],
    ...s.par_mois.map((m) => [m.mois, m.chiffre / 100, m.chiffre_precedent / 100, m.seances, m.seances_precedent]),
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
    ["Jour", "Séances"],
    ...s.jours.map((j) => [j.libelle, j.nombre]),
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

  async function exporter() {
    if (!stats) return;
    try {
      setMessage(`Export enregistré : ${await coeur.exporterFichier(`Statistiques ${stats.du} au ${stats.au}.csv`, csvStatistiques(stats))}`);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  const annee = (stats?.au_precedent ?? au).slice(0, 4);
  const r = stats?.recence;
  const totalRecence = r ? r.moins_6_mois + r.de_6_a_12_mois + r.de_1_a_2_ans + r.plus_2_ans : 0;

  return (
    <main className="page page-large page-statistiques">
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Statistiques</h1>
          <p className="page-sous-titre">
            {libelleDuree(du, au).replace(/^./, (c) => c.toUpperCase())}, comparé à la même période de {Number(au.slice(0, 4)) - 1}
          </p>
        </div>
        <button type="button" className="bouton" disabled={!stats} onClick={() => void exporter()}>
          Exporter (CSV)
        </button>
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

            <section className="carte" aria-labelledby="titre-recence">
              <h2 id="titre-recence">Dernière visite des patients</h2>
              {r && totalRecence > 0 ? (
                <>
                  <p className="discret">
                    {Math.round((r.moins_6_mois / totalRecence) * 100)} % des patients sont venus dans les six derniers mois.
                  </p>
                  <Repartition
                    famille="recence"
                    description="Dernière visite des patients"
                    parts={[
                      { cle: "moins_6_mois", libelle: "Moins de 6 mois", valeur: r.moins_6_mois },
                      { cle: "de_6_a_12_mois", libelle: "6 à 12 mois", valeur: r.de_6_a_12_mois },
                      { cle: "de_1_a_2_ans", libelle: "1 à 2 ans", valeur: r.de_1_a_2_ans },
                      { cle: "plus_2_ans", libelle: "Plus de 2 ans", valeur: r.plus_2_ans },
                    ]}
                    legende={(p) => `${p.libelle} · ${nombreFr(p.valeur)}`}
                  />
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
              <h2 id="titre-douleur">Douleur et rythme</h2>
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
              <h3>Séances par jour de la semaine</h3>
              <PetitesColonnes colonnes={stats.jours.map((j) => ({ libelle: j.libelle, valeur: j.nombre }))} />
            </section>
          </div>

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
