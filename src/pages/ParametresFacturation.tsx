import { useEffect, useId, useState } from "react";

import { ChampsIdentite } from "../demarrage/PremierDemarrage";
import { ChampMontant, PagesApercu } from "../facturation/composants";
import { ErreurFacturation } from "../facturation/FinDeSeance";
import { ReglagesMiseEnPage } from "../documents/MiseEnPage";
import { dateDuJour, MENTION_TVA, type ChampTexteIdentite, type Coeur, type IdentiteCabinet } from "../lib/coeur";
import { COULEURS_PRESTATION, euros, type Prestation, type ReglagesNumerotation, type SaisiePrestation } from "../lib/facturation";
import { verifierIdentite, type ErreursIdentite } from "../lib/identite";
import { adresse } from "../lib/navigation";

function Fil({ titre }: { titre: string }) {
  return (
    <nav className="fil" aria-label="Fil d’Ariane">
      <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> {titre}
    </nav>
  );
}

/** Identité, mentions et présentation des factures, avec l'aperçu d'une facture d'essai. */
export function PageParametresCabinet({ coeur }: { coeur: Coeur }) {
  const [identite, setIdentite] = useState<IdentiteCabinet | null>(null);
  const [erreurs, setErreurs] = useState<ErreursIdentite>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [apercu, setApercu] = useState<{ pages: string[] | null; erreur: string | null } | null>(null);

  useEffect(() => {
    coeur.identiteCabinet().then(setIdentite, (e: Error) => setErreur(e.message));
  }, [coeur]);

  if (!identite) return <main className="page">{erreur ? <ErreurFacturation message={erreur} /> : <p className="discret">Chargement…</p>}</main>;

  const modifier = (champs: Partial<IdentiteCabinet>) => {
    setIdentite({ ...identite, ...champs });
    setMessage(null);
  };
  const changer = (champ: ChampTexteIdentite) => (valeur: string) => modifier({ [champ]: valeur });
  const manquantes = (
    [
      ["adresse", identite.adresse],
      ["code postal", identite.code_postal],
      ["ville", identite.ville],
      ["SIRET", identite.siret],
      ["RPPS", identite.rpps],
    ] as const
  )
    .filter(([, v]) => !v.trim())
    .map(([m]) => m);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    const trouvees = verifierIdentite(identite!);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setErreur(null);
    try {
      setIdentite(await coeur.enregistrerIdentiteCabinet(identite!));
      setMessage("Identité enregistrée. Les factures déjà émises gardent l’identité du jour de leur émission.");
      if (apercu) void essayer();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function essayer() {
    setApercu({ pages: null, erreur: null });
    try {
      setApercu({ pages: await coeur.apercuFactureEssai(dateDuJour()), erreur: null });
    } catch (err) {
      setApercu({ pages: null, erreur: (err as Error).message });
    }
  }

  return (
    <main className="page">
      <Fil titre="Cabinet et mentions légales" />
      <div>
        <h1 className="page-titre">Cabinet et mentions légales</h1>
        <p className="page-sous-titre">Ce qui figure en tête et au pied de vos factures et comptes rendus</p>
      </div>
      <form className="carte pile" onSubmit={(e) => void enregistrer(e)}>
        <ChampsIdentite identite={identite} erreurs={erreurs} changer={changer} />
        {manquantes.length > 0 && <p className="avertissement">À compléter avant la première facture : {manquantes.join(", ")}.</p>}
        <MentionsFactures identite={identite} modifier={modifier} />
        {erreur && <ErreurFacturation message={erreur} />}
        {message && (
          <p className="succes" role="status">
            {message}
          </p>
        )}
        <div className="rangee">
          <button type="submit" className="bouton bouton-principal">
            Enregistrer
          </button>
        </div>
      </form>
      <ReglagesMiseEnPage coeur={coeur} surChangement={() => apercu && void essayer()} />
      {apercu ? (
        <PagesApercu pages={apercu.pages} erreur={apercu.erreur} titre="Facture d’essai" />
      ) : (
        <div className="rangee">
          <button type="button" className="bouton" onClick={() => void essayer()}>
            Voir le résultat sur une facture d’essai
          </button>
        </div>
      )}
    </main>
  );
}

/** « EI », mention de TVA et mentions libres : gardées avec l'identité sur chaque facture émise. */
function MentionsFactures({ identite, modifier }: { identite: IdentiteCabinet; modifier: (champs: Partial<IdentiteCabinet>) => void }) {
  const id = useId();
  return (
    <fieldset className="groupe-champs">
      <legend>Mentions des factures</legend>
      <div className="pile-serree">
        <label className="case-simple">
          <input type="checkbox" checked={!identite.sans_ei} onChange={(e) => modifier({ sans_ei: !e.target.checked })} />
          Faire suivre mon nom de « EI » (entrepreneur individuel)
        </label>
        <span className="discret">Obligatoire en entreprise individuelle, micro-entreprise comprise. Décochez si vous exercez en société.</span>
      </div>
      <div className="champ champ-large">
        <label htmlFor={`${id}-tva`}>Mention de TVA</label>
        <input
          id={`${id}-tva`}
          value={identite.mention_tva}
          placeholder={MENTION_TVA}
          maxLength={200}
          aria-describedby={`${id}-tva-aide`}
          onChange={(e) => modifier({ mention_tva: e.target.value })}
        />
        <span id={`${id}-tva-aide`} className="discret">
          Laissez vide pour la mention des ostéopathes exonérés : « {MENTION_TVA} ».
        </span>
      </div>
      <div className="champ champ-large">
        <label htmlFor={`${id}-mentions`}>Mentions libres en bas de page</label>
        <textarea
          id={`${id}-mentions`}
          rows={3}
          value={identite.mentions}
          maxLength={600}
          placeholder="Ex. : Membre d’une association agréée, le règlement des honoraires par chèque est accepté."
          aria-describedby={`${id}-mentions-aide`}
          onChange={(e) => modifier({ mentions: e.target.value })}
        />
        <span id={`${id}-mentions-aide`} className="discret">
          Association agréée, assurance professionnelle, médiateur de la consommation… 600 caractères au plus.
        </span>
      </div>
    </fieldset>
  );
}

const PRESTATION_VIDE: SaisiePrestation = { libelle: "", libelle_imprime: "", tarif_centimes: 0, couleur: "bleu", par_defaut: false, archivee: false };

function FichePrestation({
  initiale,
  enregistrer,
  annuler,
}: {
  initiale: SaisiePrestation;
  enregistrer: (s: SaisiePrestation) => Promise<void>;
  annuler: () => void;
}) {
  const id = useId();
  const [saisie, setSaisie] = useState(initiale);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <form
      className="fiche-prestation"
      onSubmit={(e) => {
        e.preventDefault();
        setErreur(null);
        enregistrer(saisie).catch((err: Error) => setErreur(err.message));
      }}
    >
      <div className="champs">
        <div className="champ">
          <label htmlFor={`${id}-libelle`}>Libellé</label>
          <input id={`${id}-libelle`} value={saisie.libelle} onChange={(e) => setSaisie({ ...saisie, libelle: e.target.value })} />
        </div>
        <div className="champ">
          <label htmlFor={`${id}-imprime`}>Libellé imprimé (facultatif)</label>
          <input
            id={`${id}-imprime`}
            placeholder={saisie.libelle}
            value={saisie.libelle_imprime}
            onChange={(e) => setSaisie({ ...saisie, libelle_imprime: e.target.value })}
          />
        </div>
        <ChampMontant id={`${id}-tarif`} libelle="Tarif TTC" centimes={saisie.tarif_centimes} changer={(c) => setSaisie({ ...saisie, tarif_centimes: c ?? 0 })} />
        <div className="champ">
          <label htmlFor={`${id}-couleur`}>Couleur</label>
          <select id={`${id}-couleur`} value={saisie.couleur} onChange={(e) => setSaisie({ ...saisie, couleur: e.target.value as SaisiePrestation["couleur"] })}>
            {COULEURS_PRESTATION.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="rangee">
        <label className="case-simple">
          <input
            type="checkbox"
            checked={saisie.par_defaut}
            onChange={(e) => setSaisie({ ...saisie, par_defaut: e.target.checked, archivee: e.target.checked ? false : saisie.archivee })}
          />
          Proposée par défaut en fin de séance
        </label>
        <label className="case-simple">
          <input
            type="checkbox"
            checked={saisie.archivee}
            onChange={(e) => setSaisie({ ...saisie, archivee: e.target.checked, par_defaut: e.target.checked ? false : saisie.par_defaut })}
          />
          Archivée (n’est plus proposée)
        </label>
      </div>
      {erreur && <ErreurFacturation message={erreur} />}
      <div className="rangee">
        <button type="submit" className="bouton bouton-principal">
          Enregistrer la prestation
        </button>
        <button type="button" className="lien-bouton" onClick={annuler}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Numerotation({ coeur }: { coeur: Coeur }) {
  const id = useId();
  const [reglages, setReglages] = useState<ReglagesNumerotation | null>(null);
  const [suivant, setSuivant] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const annee = new Date().getFullYear();

  const rafraichir = () => coeur.numeroSuivant(dateDuJour()).then((n) => setSuivant(n), (e: Error) => setSuivant(`indisponible : ${e.message}`));
  useEffect(() => {
    coeur.reglagesNumerotation().then(setReglages, (e: Error) => setErreur(e.message));
    void rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  if (!reglages) return null;

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setMessage(null);
    try {
      setReglages(await coeur.enregistrerReglagesNumerotation(reglages!));
      setMessage("Numérotation enregistrée.");
      await rafraichir();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  return (
    <form className="carte" aria-labelledby={`${id}-titre`} onSubmit={(e) => void enregistrer(e)}>
      <h2 id={`${id}-titre`}>Numérotation des factures</h2>
      <p className="discret">
        Continue et chronologique, sans trou : le compteur repart chaque année. Factures et avoirs partagent la même numérotation. Après un import, la
        numérotation reprend après le dernier numéro de l’historique.
      </p>
      <div className="champs">
        <div className="champ">
          <label htmlFor={`${id}-modele`}>Modèle de numéro</label>
          <input
            id={`${id}-modele`}
            value={reglages.format.modele}
            onChange={(e) => setReglages({ ...reglages, format: { ...reglages.format, modele: e.target.value } })}
          />
          <span className="discret">{"{AAAA}"} année, {"{AA}"} année sur 2 chiffres, {"{MM}"} mois, {"{N}"} compteur</span>
        </div>
        <div className="champ">
          <label htmlFor={`${id}-chiffres`}>Chiffres du compteur, au moins</label>
          <input
            id={`${id}-chiffres`}
            type="number"
            min={1}
            max={8}
            value={reglages.format.chiffres}
            onChange={(e) => setReglages({ ...reglages, format: { ...reglages.format, chiffres: Number(e.target.value) || 1 } })}
          />
        </div>
        <div className="champ">
          <label htmlFor={`${id}-depart`}>Compteur de départ en {annee} (facultatif)</label>
          <input
            id={`${id}-depart`}
            type="number"
            min={1}
            value={reglages.depart?.annee === annee ? reglages.depart.compteur : ""}
            onChange={(e) => setReglages({ ...reglages, depart: e.target.value ? { annee, compteur: Math.max(1, Number(e.target.value)) } : null })}
          />
          <span className="discret">Si vous changez de logiciel en cours d’année sans importer vos factures.</span>
        </div>
      </div>
      <p>
        Prochain numéro : <strong>{suivant ?? "…"}</strong>
      </p>
      {erreur && <ErreurFacturation message={erreur} />}
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
      <div className="rangee">
        <button type="submit" className="bouton bouton-principal">
          Enregistrer la numérotation
        </button>
      </div>
    </form>
  );
}

/** Prestations (libellé, tarif, couleur, libellé imprimé) et numérotation des factures. */
export function PageParametresFacturation({ coeur }: { coeur: Coeur }) {
  const [prestations, setPrestations] = useState<Prestation[] | null>(null);
  const [edition, setEdition] = useState<string | "nouvelle" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = () => coeur.listerPrestations().then(setPrestations, (e: Error) => setErreur(e.message));
  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  const enregistrer = (id: string | null) => async (saisie: SaisiePrestation) => {
    await coeur.enregistrerPrestation(id, saisie);
    setEdition(null);
    await charger();
  };

  return (
    <main className="page">
      <Fil titre="Prestations et numérotation" />
      <div>
        <h1 className="page-titre">Prestations et numérotation</h1>
        <p className="page-sous-titre">Vos actes et leurs tarifs, le numéro de vos factures</p>
      </div>
      <section className="carte" aria-labelledby="titre-prestations">
        <div className="entete-carte">
          <h2 id="titre-prestations">Prestations</h2>
          {edition !== "nouvelle" && (
            <button type="button" className="bouton bouton-petit" onClick={() => setEdition("nouvelle")}>
              Nouvelle prestation
            </button>
          )}
        </div>
        <p className="discret">Changer un tarif ne modifie jamais une facture déjà faite.</p>
        {erreur && <ErreurFacturation message={erreur} />}
        {edition === "nouvelle" && <FichePrestation initiale={PRESTATION_VIDE} enregistrer={enregistrer(null)} annuler={() => setEdition(null)} />}
        <ul className="liste-prestations">
          {(prestations ?? []).map((p) =>
            edition === p.id ? (
              <li key={p.id}>
                <FichePrestation initiale={p} enregistrer={enregistrer(p.id)} annuler={() => setEdition(null)} />
              </li>
            ) : (
              <li key={p.id} className="ligne-prestation" data-archivee={p.archivee || undefined}>
                <span className="pastille-prestation" data-couleur={p.couleur} aria-hidden="true" />
                <span className="pile-serree">
                  <strong>
                    {p.libelle}
                    {p.par_defaut && <span className="puce">Par défaut</span>}
                    {p.archivee && <span className="puce puce-discrete">Archivée</span>}
                  </strong>
                  {p.libelle_imprime && <span className="discret">Imprimé : {p.libelle_imprime}</span>}
                </span>
                <strong>{euros(p.tarif_centimes)}</strong>
                <button type="button" className="bouton bouton-petit" onClick={() => setEdition(p.id)}>
                  Modifier
                </button>
              </li>
            ),
          )}
        </ul>
      </section>
      <Numerotation coeur={coeur} />
    </main>
  );
}

