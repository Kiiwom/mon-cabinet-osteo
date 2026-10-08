import { useEffect, useId, useState, type FormEvent } from "react";

import type { Coeur, CouleurGroupe, Groupe, ResumePatient, StatutSaisi } from "../lib/coeur";
import { COULEURS_PRESTATION } from "../lib/facturation";
import { adresse } from "../lib/navigation";

function Fil({ titre }: { titre: string }) {
  return (
    <nav className="fil" aria-label="Fil d’Ariane">
      <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> {titre}
    </nav>
  );
}

const nomCouleur = (c: string) => c[0].toUpperCase() + c.slice(1);
const dossiers = (n: number) => `${n} dossier${n > 1 ? "s" : ""}`;

/** Statuts proposés dans la fiche, dans l'ordre choisi ; renommer un statut le renomme dans les dossiers. */
function Statuts({ coeur, patients }: { coeur: Coeur; patients: ResumePatient[] }) {
  const id = useId();
  const [enregistres, setEnregistres] = useState<string[] | null>(null);
  const [liste, setListe] = useState<StatutSaisi[]>([]);
  const [nouveau, setNouveau] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    coeur.statutsPatients().then(
      (s) => {
        setEnregistres(s);
        setListe(s.map((nom) => ({ ancien: nom, nom })));
      },
      (e: Error) => setErreur(e.message),
    );
  }, [coeur]);

  if (!enregistres) return <p className="discret">{erreur ?? "Chargement…"}</p>;

  const porteurs = (statut: string) => patients.filter((p) => p.statut === statut).length;
  const retires = enregistres.filter((s) => !liste.some((l) => l.ancien === s));
  const modifie = JSON.stringify(liste) !== JSON.stringify(enregistres.map((nom) => ({ ancien: nom, nom })));
  const changer = (rang: number, valeur: Partial<StatutSaisi>) => {
    setListe(liste.map((l, r) => (r === rang ? { ...l, ...valeur } : l)));
    setMessage(null);
  };
  const deplacer = (rang: number, sens: -1 | 1) => {
    const copie = [...liste];
    [copie[rang], copie[rang + sens]] = [copie[rang + sens], copie[rang]];
    setListe(copie);
    setMessage(null);
  };

  function ajouter(e: FormEvent) {
    e.preventDefault();
    if (!nouveau.trim()) return;
    setListe([...liste, { ancien: null, nom: nouveau.trim() }]);
    setNouveau("");
    setMessage(null);
  }

  async function enregistrer() {
    setErreur(null);
    try {
      const s = await coeur.enregistrerStatuts(liste);
      setEnregistres(s);
      setListe(s.map((nom) => ({ ancien: nom, nom })));
      setMessage("Statuts enregistrés.");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <section className="carte pile" aria-labelledby={`${id}-titre`}>
      <div>
        <h2 id={`${id}-titre`}>Statuts</h2>
        <p className="discret">Un seul statut par patient, choisi dans la fiche. Renommer un statut le renomme dans les dossiers qui le portent.</p>
      </div>
      <ol className="liste-reglable">
        {liste.map((l, rang) => (
          <li key={`${l.ancien ?? "nouveau"}-${rang}`} className="ligne-reglable">
            <input aria-label={`Nom du statut ${rang + 1}`} value={l.nom} onChange={(e) => changer(rang, { nom: e.target.value })} autoComplete="off" />
            <span className="discret">{l.ancien === null ? "nouveau" : dossiers(porteurs(l.ancien))}</span>
            <span className="rangee">
              <button type="button" className="bouton bouton-petit bouton-icone" aria-label={`Monter « ${l.nom} »`} disabled={rang === 0} onClick={() => deplacer(rang, -1)}>
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                className="bouton bouton-petit bouton-icone"
                aria-label={`Descendre « ${l.nom} »`}
                disabled={rang === liste.length - 1}
                onClick={() => deplacer(rang, 1)}
              >
                <span aria-hidden="true">↓</span>
              </button>
              <button type="button" className="lien-bouton" onClick={() => setListe(liste.filter((_, r) => r !== rang))}>
                Retirer
              </button>
            </span>
          </li>
        ))}
      </ol>
      <form className="rangee saisie-reglable" onSubmit={ajouter}>
        <input aria-label="Nouveau statut" placeholder="Nouveau statut" value={nouveau} onChange={(e) => setNouveau(e.target.value)} autoComplete="off" />
        <button type="submit" className="bouton" disabled={!nouveau.trim()}>
          Ajouter
        </button>
      </form>
      {retires.some((s) => porteurs(s) > 0) && (
        <p className="avertissement">
          {retires
            .filter((s) => porteurs(s) > 0)
            .map((s) => `« ${s} » sera retiré de ${dossiers(porteurs(s))}`)
            .join(" ; ")}
          .
        </p>
      )}
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="rangee barre-actions">
        <span className="discret" role="status">
          {message ?? (modifie ? "Modifications non enregistrées" : "")}
        </span>
        <button type="button" className="bouton bouton-principal" disabled={!modifie} onClick={() => void enregistrer()}>
          Enregistrer les statuts
        </button>
      </div>
    </section>
  );
}

function ChoixCouleur({ id, valeur, changer }: { id: string; valeur: CouleurGroupe; changer: (c: CouleurGroupe) => void }) {
  return (
    <select id={id} aria-label="Couleur" value={valeur} onChange={(e) => changer(e.target.value as CouleurGroupe)}>
      {COULEURS_PRESTATION.map((c) => (
        <option key={c} value={c}>
          {nomCouleur(c)}
        </option>
      ))}
    </select>
  );
}

function LigneGroupe({ coeur, groupe, rafraichir }: { coeur: Coeur; groupe: Groupe; rafraichir: () => Promise<void> }) {
  const id = useId();
  const [edition, setEdition] = useState<{ nom: string; couleur: CouleurGroupe } | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    if (!edition) return;
    setErreur(null);
    try {
      await coeur.enregistrerGroupe(groupe.id, edition);
      setEdition(null);
      await rafraichir();
    } catch (raison) {
      setErreur((raison as Error).message);
    }
  }

  async function supprimer() {
    setErreur(null);
    try {
      await coeur.supprimerGroupe(groupe.id);
      await rafraichir();
    } catch (raison) {
      setErreur((raison as Error).message);
    }
  }

  return (
    <li className="ligne-reglable" data-couleur={edition?.couleur ?? groupe.couleur}>
      {edition ? (
        <form className="rangee ligne-reglable-edition" onSubmit={enregistrer}>
          <span className="pastille-prestation" aria-hidden="true" />
          <input aria-label="Nom du groupe" value={edition.nom} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} autoComplete="off" autoFocus />
          <ChoixCouleur id={`${id}-couleur`} valeur={edition.couleur} changer={(couleur) => setEdition({ ...edition, couleur })} />
          <button type="submit" className="bouton bouton-petit bouton-principal">
            Enregistrer
          </button>
          <button type="button" className="bouton bouton-petit" onClick={() => setEdition(null)}>
            Annuler
          </button>
        </form>
      ) : (
        <>
          <span className="pastille-prestation" aria-hidden="true" />
          <strong>{groupe.nom}</strong>
          <span className="discret">{groupe.patients === 0 ? "aucun dossier" : dossiers(groupe.patients)}</span>
          <span className="rangee">
            <button type="button" className="bouton bouton-petit" onClick={() => setEdition({ nom: groupe.nom, couleur: groupe.couleur })}>
              Modifier
            </button>
            {confirmer ? (
              <>
                {groupe.patients > 0 && (
                  <span className="discret">
                    {groupe.patients === 1 ? "Le dossier reste, sans ce groupe." : `Les ${dossiers(groupe.patients)} restent, sans ce groupe.`}
                  </span>
                )}
                <button type="button" className="bouton bouton-petit bouton-danger" onClick={() => void supprimer()}>
                  Supprimer le groupe
                </button>
                <button type="button" className="lien-bouton" onClick={() => setConfirmer(false)}>
                  Garder
                </button>
              </>
            ) : (
              <button type="button" className="lien-bouton" onClick={() => setConfirmer(true)}>
                Supprimer
              </button>
            )}
          </span>
        </>
      )}
      {erreur && (
        <span className="champ-erreur" role="alert">
          {erreur}
        </span>
      )}
    </li>
  );
}

/** Groupes colorés : un patient peut en avoir plusieurs, la liste des patients les filtre. */
function Groupes({ coeur }: { coeur: Coeur }) {
  const id = useId();
  const [groupes, setGroupes] = useState<Groupe[] | null>(null);
  const [nom, setNom] = useState("");
  const [couleur, setCouleur] = useState<CouleurGroupe>("bleu");
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = async () => setGroupes(await coeur.listerGroupes());
  useEffect(() => {
    rafraichir().catch((e: Error) => setErreur(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  async function ajouter(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    try {
      await coeur.enregistrerGroupe(null, { nom, couleur });
      setNom("");
      // La couleur suivante, pour que deux groupes créés à la suite se distinguent.
      setCouleur(COULEURS_PRESTATION[(COULEURS_PRESTATION.indexOf(couleur) + 1) % COULEURS_PRESTATION.length]);
      await rafraichir();
    } catch (raison) {
      setErreur((raison as Error).message);
    }
  }

  return (
    <section className="carte pile" aria-labelledby={`${id}-titre`}>
      <div>
        <h2 id={`${id}-titre`}>Groupes</h2>
        <p className="discret">Une famille, un club, une entreprise… Un patient peut appartenir à plusieurs groupes ; ils se cochent dans sa fiche et filtrent la liste des patients.</p>
      </div>
      {groupes === null ? (
        <p className="discret">Chargement…</p>
      ) : groupes.length === 0 ? (
        <p className="discret">Aucun groupe pour l’instant.</p>
      ) : (
        <ul className="liste-reglable">
          {groupes.map((g) => (
            <LigneGroupe key={g.id} coeur={coeur} groupe={g} rafraichir={rafraichir} />
          ))}
        </ul>
      )}
      <form className="rangee saisie-reglable" onSubmit={ajouter} data-couleur={couleur}>
        <span className="pastille-prestation" aria-hidden="true" />
        <input aria-label="Nom du nouveau groupe" placeholder="Nouveau groupe" value={nom} onChange={(e) => setNom(e.target.value)} autoComplete="off" />
        <ChoixCouleur id={`${id}-couleur`} valeur={couleur} changer={setCouleur} />
        <button type="submit" className="bouton" disabled={!nom.trim()}>
          Ajouter le groupe
        </button>
      </form>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
    </section>
  );
}

export function PageParametresPatients({ coeur }: { coeur: Coeur }) {
  const [patients, setPatients] = useState<ResumePatient[]>([]);
  useEffect(() => {
    coeur.listerPatients().then(setPatients, () => setPatients([]));
  }, [coeur]);
  return (
    <main className="page">
      <Fil titre="Statuts et groupes" />
      <div>
        <h1 className="page-titre">Statuts et groupes</h1>
        <p className="page-sous-titre">Ce que la fiche du patient propose, et ce que la liste des patients filtre</p>
      </div>
      <Statuts coeur={coeur} patients={patients} />
      <Groupes coeur={coeur} />
    </main>
  );
}
