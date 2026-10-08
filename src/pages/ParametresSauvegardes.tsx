import { useEffect, useId, useState } from "react";

import { CarteChoix, FREQUENCES, INTERVALLES } from "../demarrage/PremierDemarrage";
import type { Coeur, EtatSauvegardes, FichierSauvegarde, IdentiteCabinet, LigneJournal, PreferencesSauvegarde, Securite } from "../lib/coeur";
import { ImportMcl } from "../import/ImportMcl";
import { adresse } from "../lib/navigation";
import { momentEnLettres, RestaurationSauvegarde } from "../sauvegardes/Restauration";

function Fil({ titre }: { titre: string }) {
  return (
    <nav className="fil" aria-label="Fil d’Ariane">
      <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> {titre}
    </nav>
  );
}

function Message({ texte, erreur = false }: { texte: string | null; erreur?: boolean }) {
  if (!texte) return null;
  return erreur ? (
    <p className="alerte" role="alert">
      {texte}
    </p>
  ) : (
    <p className="succes" role="status">
      {texte}
    </p>
  );
}

function taille(octets: number): string {
  return octets >= 1_000_000 ? `${(octets / 1_000_000).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(octets / 1000))} ko`;
}

/** Plus de 7 jours sans sauvegarde : le praticien est prévenu. */
export const ALERTE_SAUVEGARDE_JOURS = 7;

export function joursDepuis(secondes: number, maintenant = Date.now()): number {
  return Math.floor((maintenant / 1000 - secondes) / 86_400);
}

/** Sauvegardes : état, réglages, sauvegarde à la demande, liste et restauration. */
export function PageParametresSauvegardes({ coeur, surRestauration }: { coeur: Coeur; surRestauration: (cabinet: IdentiteCabinet) => void }) {
  const id = useId();
  const [etat, setEtat] = useState<EtatSauvegardes | null>(null);
  const [preferences, setPreferences] = useState<PreferencesSauvegarde | null>(null);
  const [liste, setListe] = useState<FichierSauvegarde[]>([]);
  const [restaurer, setRestaurer] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = async () => {
    const [e, l] = await Promise.all([coeur.etatDesSauvegardes(), coeur.listerSauvegardes()]);
    setEtat(e);
    setPreferences(e.preferences);
    setListe(l);
  };
  useEffect(() => {
    charger().catch((e: Error) => setErreur(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  async function agir(action: () => Promise<string | void>) {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      const texte = await action();
      if (texte) setMessage(texte);
      await charger();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  if (!etat || !preferences) return <main className="page">{erreur ? <Message texte={erreur} erreur /> : <p className="discret">Chargement…</p>}</main>;
  const ancienne = etat.derniere && joursDepuis(etat.derniere.le) > ALERTE_SAUVEGARDE_JOURS;

  return (
    <main className="page">
      <Fil titre="Sauvegardes" />
      <div>
        <h1 className="page-titre">Sauvegardes</h1>
        <p className="page-sous-titre">Chiffrées, elles ne s’ouvrent qu’avec votre clé de secours, sur cet ordinateur ou un autre</p>
      </div>

      <section className="carte" aria-labelledby={`${id}-etat`}>
        <div className="entete-carte">
          <h2 id={`${id}-etat`}>Dernière sauvegarde</h2>
          <button type="button" className="bouton bouton-principal" disabled={envoi} onClick={() => void agir(async () => `Sauvegarde enregistrée : ${(await coeur.sauvegarderMaintenant()).nom}`)}>
            {envoi ? "Sauvegarde…" : "Sauvegarder maintenant"}
          </button>
        </div>
        <p>
          {etat.derniere ? (
            <>
              Le <strong>{momentEnLettres(etat.derniere.le)}</strong>
            </>
          ) : (
            <strong>Aucune sauvegarde pour l’instant.</strong>
          )}
        </p>
        {(ancienne || !etat.derniere) && (
          <p className="avertissement">
            {etat.derniere ? `Plus de ${ALERTE_SAUVEGARDE_JOURS} jours sans sauvegarde.` : "Votre cabinet n’a encore jamais été sauvegardé."} Sauvegardez maintenant, de
            préférence sur une clé USB ou un disque externe.
          </p>
        )}
        {etat.erreur && <p className="alerte">La dernière sauvegarde automatique a échoué : {etat.erreur}</p>}
        <p className="discret">
          Dossier : <span className="chemin-fichier">{etat.dossier}</span>
        </p>
        <Message texte={message} />
        <Message texte={erreur} erreur />
      </section>

      <form
        className="carte"
        aria-labelledby={`${id}-reglages`}
        onSubmit={(e) => {
          e.preventDefault();
          void agir(async () => {
            await coeur.enregistrerPreferencesSauvegarde(preferences);
            return "Réglages des sauvegardes enregistrés.";
          });
        }}
      >
        <h2 id={`${id}-reglages`}>Quand et où sauvegarder</h2>
        <div className="choix-liste">
          {FREQUENCES.map((f) => (
            <CarteChoix key={f.valeur} nom="frequence" coche={preferences.frequence === f.valeur} choisir={() => setPreferences({ ...preferences, frequence: f.valeur })} titre={f.libelle}>
              {f.valeur === "intervalle" ? (
                <span className="choix-intervalle">
                  <select
                    aria-label="Intervalle entre deux sauvegardes"
                    value={preferences.intervalle_minutes}
                    onChange={(e) => setPreferences({ ...preferences, frequence: "intervalle", intervalle_minutes: Number(e.target.value) })}
                  >
                    {INTERVALLES.map((i) => (
                      <option key={i.minutes} value={i.minutes}>
                        {i.libelle}
                      </option>
                    ))}
                  </select>
                  <span>et à la fermeture, seulement si quelque chose a changé.</span>
                </span>
              ) : (
                f.detail
              )}
            </CarteChoix>
          ))}
        </div>
        <div className="champ">
          <label htmlFor={`${id}-dossier`}>Dossier des sauvegardes</label>
          <div className="rangee">
            <input
              id={`${id}-dossier`}
              className="champ-dossier"
              placeholder={etat.dossier}
              value={preferences.dossier}
              onChange={(e) => setPreferences({ ...preferences, dossier: e.target.value })}
            />
            <button
              type="button"
              className="bouton bouton-petit"
              onClick={() =>
                void coeur.choisirDossier().then((d) => d && setPreferences({ ...preferences, dossier: d }), (e: Error) => setErreur(e.message))
              }
            >
              Choisir…
            </button>
          </div>
          <span className="discret">Vide : le dossier proposé. Une clé USB ou un disque externe protège aussi contre la panne de l’ordinateur.</span>
        </div>
        <div className="champ champ-court">
          <label htmlFor={`${id}-conserver`}>Sauvegardes gardées</label>
          <input
            id={`${id}-conserver`}
            type="number"
            min={3}
            max={365}
            value={preferences.conserver}
            onChange={(e) => setPreferences({ ...preferences, conserver: Number(e.target.value) || 3 })}
          />
          <span className="discret">Au-delà, les plus anciennes sont effacées du dossier.</span>
        </div>
        <div className="rangee">
          <button type="submit" className="bouton" disabled={envoi}>
            Enregistrer les réglages
          </button>
        </div>
      </form>

      <section className="carte" aria-labelledby={`${id}-liste`}>
        <div className="entete-carte">
          <h2 id={`${id}-liste`}>Sauvegardes du dossier</h2>
          <button type="button" className="bouton bouton-petit" onClick={() => setRestaurer("")}>
            Restaurer depuis un autre fichier…
          </button>
        </div>
        {restaurer !== null && (
          <RestaurationSauvegarde key={restaurer} coeur={coeur} cheminInitial={restaurer} surRestauration={surRestauration} annuler={() => setRestaurer(null)} />
        )}
        {liste.length === 0 ? (
          <p className="discret">Aucune sauvegarde dans ce dossier.</p>
        ) : (
          <ul className="liste-sauvegardes">
            {liste.map((f) => (
              <li key={f.chemin}>
                <span className="pile-serree">
                  <strong>{momentEnLettres(f.cree_le)}</strong>
                  <span className="discret">
                    {f.nom} · {taille(f.taille)} · Osteosphere {f.logiciel}
                  </span>
                </span>
                <button type="button" className="bouton bouton-petit" onClick={() => setRestaurer(f.chemin)}>
                  Restaurer…
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** Mot de passe facultatif, verrouillage, clé de secours. */
export function PageParametresSecurite({ coeur, surVerrouillage }: { coeur: Coeur; surVerrouillage: () => void }) {
  const id = useId();
  const [securite, setSecurite] = useState<Securite | null>(null);
  const [edition, setEdition] = useState(false);
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const charger = () => coeur.securite().then(setSecurite, (e: Error) => setErreur(e.message));
  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  async function agir(action: () => Promise<void>, texte: string) {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      await action();
      setMessage(texte);
      setEdition(false);
      setMotDePasse("");
      setConfirmation("");
      await charger();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  if (!securite) return <main className="page">{erreur ? <Message texte={erreur} erreur /> : <p className="discret">Chargement…</p>}</main>;
  const verrouillageSysteme = securite.systeme === "linux" ? "le verrouillage de votre session" : securite.systeme === "macos" ? "le verrouillage de macOS" : "le verrouillage de Windows";

  return (
    <main className="page">
      <Fil titre="Sécurité et mot de passe" />
      <div>
        <h1 className="page-titre">Sécurité et mot de passe</h1>
        <p className="page-sous-titre">Vos données sont toujours chiffrées sur le disque ; le mot de passe est un choix</p>
      </div>
      <section className="carte" aria-labelledby={`${id}-mdp`}>
        <h2 id={`${id}-mdp`}>Mot de passe</h2>
        {securite.mot_de_passe_actif ? (
          <p>
            <strong>Activé.</strong> Osteosphere le demande à chaque ouverture. Oublié, il se remplace par la clé de secours.
          </p>
        ) : (
          <p>
            <strong>Désactivé</strong> (choix par défaut). Osteosphere s’ouvre directement sur cette session : la protection repose sur {verrouillageSysteme}.
          </p>
        )}
        {edition ? (
          <form
            className="pile-serree"
            onSubmit={(e) => {
              e.preventDefault();
              if (motDePasse !== confirmation) return setErreur("Les deux mots de passe ne sont pas identiques.");
              void agir(() => coeur.definirMotDePasse(motDePasse), "Mot de passe enregistré : il sera demandé à la prochaine ouverture.");
            }}
          >
            <div className="champs">
              <div className="champ">
                <label htmlFor={`${id}-nouveau`}>Nouveau mot de passe</label>
                <input id={`${id}-nouveau`} type="password" autoComplete="new-password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
                <span className="discret">8 caractères au moins.</span>
              </div>
              <div className="champ">
                <label htmlFor={`${id}-confirmation`}>Confirmation</label>
                <input id={`${id}-confirmation`} type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
              </div>
            </div>
            <div className="rangee">
              <button type="submit" className="bouton bouton-principal" disabled={envoi}>
                Enregistrer le mot de passe
              </button>
              <button type="button" className="lien-bouton" onClick={() => setEdition(false)}>
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <div className="rangee">
            <button type="button" className="bouton" onClick={() => setEdition(true)}>
              {securite.mot_de_passe_actif ? "Changer le mot de passe" : "Activer un mot de passe"}
            </button>
            {securite.mot_de_passe_actif && (
              <>
                <button
                  type="button"
                  className="bouton"
                  disabled={envoi || !securite.session_protegee}
                  onClick={() => void agir(() => coeur.retirerMotDePasse(), "Mot de passe retiré : Osteosphere s’ouvrira directement.")}
                >
                  Retirer le mot de passe
                </button>
                <button
                  type="button"
                  className="bouton"
                  onClick={() =>
                    void coeur.verrouiller().then(surVerrouillage, (e: Error) => setErreur(e.message))
                  }
                >
                  Verrouiller maintenant <kbd>Ctrl</kbd>+<kbd>L</kbd>
                </button>
              </>
            )}
          </div>
        )}
        {!securite.session_protegee && <p className="discret">Sans trousseau de session sur cet ordinateur, le mot de passe reste nécessaire.</p>}
        <Message texte={message} />
        <Message texte={erreur} erreur />
      </section>
      <section className="carte" aria-labelledby={`${id}-cle`}>
        <h2 id={`${id}-cle`}>Clé de secours</h2>
        <p>
          Remise à la création du cabinet, elle ouvre vos données et vos sauvegardes si le mot de passe est oublié, sur un autre
          ordinateur ou après une panne. Osteosphere ne la garde pas&nbsp;: rangez-la avec vos papiers importants.
        </p>
      </section>
    </main>
  );
}

export const ACTIONS: Record<string, string> = {
  "patient.cree": "Dossier patient créé",
  "patient.modifie": "Dossier patient modifié",
  "patient.archive": "Dossier patient archivé",
  "patient.desarchive": "Dossier patient sorti des archives",
  "patient.fusionne": "Deux dossiers fusionnés",
  "patient.efface": "Dossier patient effacé à la demande du patient",
  "patient.payeur": "Destinataire des factures changé",
  "famille.lien": "Lien familial ajouté ou changé",
  "famille.delie": "Lien familial retiré",
  "antecedent.cree": "Antécédent ajouté",
  "antecedent.modifie": "Antécédent modifié",
  "antecedent.supprime": "Antécédent supprimé",
  "seance.creee": "Séance créée",
  "seance.modifiee": "Séance modifiée",
  "seance.corbeille": "Séance mise à la corbeille",
  "seance.restauree": "Séance restaurée",
  "seance.effacee": "Séance effacée de la corbeille",
  "modele.cree": "Modèle de consultation créé",
  "modele.modifie": "Modèle de consultation modifié",
  "modele.par_defaut": "Modèle par défaut changé",
  "trame.creee": "Trame créée",
  "trame.modifiee": "Trame modifiée",
  "trame.supprimee": "Trame supprimée",
  "prestation.creee": "Prestation créée",
  "prestation.modifiee": "Prestation modifiée",
  "facture.brouillon": "Brouillon de facture créé",
  "facture.modifiee": "Brouillon de facture modifié",
  "facture.brouillon_supprime": "Brouillon de facture supprimé",
  "facture.emise": "Facture émise",
  "facture.annotee": "Commentaire interne de facture modifié",
  "facture.annulee": "Facture annulée par un avoir",
  "facture.corrigee": "Facture corrigée",
  "avoir.emis": "Avoir émis",
  "reglement.ajoute": "Règlement noté",
  "reglement.modifie": "Règlement modifié",
  "reglement.supprime": "Règlement supprimé",
  "cabinet.identite": "Identité du cabinet modifiée",
  "import.mcl": "Import depuis MonCabinetLibéral",
  "accueil.modifie": "Accueil personnalisé",
  "trames.caractere": "Caractère d’appel des trames changé",
  "document.ajoute": "Document ajouté",
  "document.modifie": "Document renommé ou rattaché",
  "document.supprime": "Document mis à la corbeille",
  "document.restaure": "Document restauré",
  "document.efface": "Document effacé de la corbeille",
  "documents.mise_en_page": "Présentation des documents modifiée",
  "documents.image": "Logo ou signature changé",
  "emails.modele": "Modèle d’email des factures modifié",
  "patients.statuts": "Statuts des patients modifiés",
  "groupe.cree": "Groupe de patients créé",
  "groupe.modifie": "Groupe de patients modifié",
  "groupe.supprime": "Groupe de patients supprimé",
};

/** Lien vers ce que concerne la ligne du journal, quand c'est possible. */
function lienJournal(l: LigneJournal): string | null {
  if (l.action === "patient.efface") return null;
  if (l.action.startsWith("patient.") || l.action.startsWith("famille.")) return adresse("patients", l.entite);
  if (l.action.startsWith("antecedent.")) return null;
  if (l.action.startsWith("seance.") && l.action !== "seance.effacee") return adresse("seances", l.entite);
  if ((l.action.startsWith("facture.") || l.action.startsWith("reglement.") || l.action === "avoir.emis") && l.action !== "facture.brouillon_supprime")
    return adresse("facturation", "facture", l.entite);
  return null;
}

/** Journal : chaque création, modification et suppression, datée. */
export function PageJournal({ coeur }: { coeur: Coeur }) {
  const [lignes, setLignes] = useState<LigneJournal[] | null>(null);
  const [fin, setFin] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const PAGE = 50;
  const suite = async (avant: number | null) => {
    const nouvelles = await coeur.journal(PAGE, avant);
    setLignes((l) => [...(avant === null ? [] : (l ?? [])), ...nouvelles]);
    setFin(nouvelles.length < PAGE);
  };
  useEffect(() => {
    suite(null).catch((e: Error) => setErreur(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  return (
    <main className="page">
      <Fil titre="Journal des modifications" />
      <div>
        <h1 className="page-titre">Journal des modifications</h1>
        <p className="page-sous-titre">Chaque création, modification et suppression, datée, de la plus récente à la plus ancienne</p>
      </div>
      <Message texte={erreur} erreur />
      <section className="carte carte-tableau" aria-label="Journal">
        {lignes === null ? (
          <p className="vide discret">Chargement…</p>
        ) : lignes.length === 0 ? (
          <p className="vide discret">Le journal est vide.</p>
        ) : (
          <table className="tableau tableau-journal">
            <thead>
              <tr>
                <th scope="col">Quand</th>
                <th scope="col">Quoi</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const lien = lienJournal(l);
                const texte = ACTIONS[l.action] ?? l.action;
                return (
                  <tr key={l.id}>
                    <td className="sans-retour">{l.le ? momentEnLettres(l.le) : "—"}</td>
                    <td>{lien ? <a href={lien}>{texte}</a> : texte}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {lignes && !fin && (
          <div className="pied-tableau">
            <button type="button" className="lien-bouton" onClick={() => void suite(lignes[lignes.length - 1].id)}>
              Afficher les plus anciennes
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

/** Export complet et import depuis un autre logiciel. */
export function PageParametresImportExport({ coeur }: { coeur: Coeur }) {
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  return (
    <main className="page">
      <Fil titre="Import et export" />
      <div>
        <h1 className="page-titre">Import et export</h1>
        <p className="page-sous-titre">Reprendre vos données d’un autre logiciel, ou les emporter</p>
      </div>
      <ImportMcl coeur={coeur} />
      <section className="carte" aria-labelledby="titre-export">
        <h2 id="titre-export">Export complet</h2>
        <p>
          Tout le cabinet en fichiers lisibles par un tableur (CSV) et en un fichier JSON complet&nbsp;: patients, antécédents,
          séances, factures, règlements, modèles, trames, réglages. Les pièces jointes et les PDF des factures émises sont
          joints, rangés par dossier.
        </p>
        <p className="avertissement">
          L’export n’est pas chiffré&nbsp;: rangez-le en lieu sûr, et effacez-le quand vous n’en avez plus besoin. Pour une copie de
          sécurité, préférez les sauvegardes, chiffrées.
        </p>
        <Message texte={message} />
        <Message texte={erreur} erreur />
        <div className="rangee">
          <button
            type="button"
            className="bouton"
            disabled={envoi}
            onClick={() => {
              setEnvoi(true);
              setErreur(null);
              coeur
                .exporterTout()
                .then((chemin) => setMessage(`Export enregistré dans ${chemin}`), (e: Error) => setErreur(e.message))
                .finally(() => setEnvoi(false));
            }}
          >
            {envoi ? "Export…" : "Exporter tout le cabinet"}
          </button>
        </div>
      </section>
    </main>
  );
}
