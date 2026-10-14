import { useId, useState } from "react";

import type { ApercuSauvegarde, Coeur, IdentiteCabinet } from "../lib/coeur";
import { dateEnLettres } from "../lib/dates";

/** « 7 octobre 2026 à 20:30 » */
export function momentEnLettres(secondes: number): string {
  const d = new Date(secondes * 1000);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${dateEnLettres(`${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`)} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/**
 * Restauration d'une sauvegarde : le fichier, la clé de secours, la vérification et l'aperçu de son
 * contenu, puis la confirmation. Rien n'est remplacé avant la confirmation ; les données en place sont
 * mises de côté, jamais effacées.
 */
export function RestaurationSauvegarde({
  coeur,
  cheminInitial = "",
  premierDemarrage = false,
  surRestauration,
  annuler,
}: {
  coeur: Coeur;
  cheminInitial?: string;
  premierDemarrage?: boolean;
  surRestauration: (cabinet: IdentiteCabinet) => void;
  annuler: () => void;
}) {
  const id = useId();
  const [chemin, setChemin] = useState(cheminInitial);
  const [cle, setCle] = useState("");
  const [apercu, setApercu] = useState<ApercuSauvegarde | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function agir(action: () => Promise<void>) {
    setEnvoi(true);
    setErreur(null);
    try {
      await action();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="carte restauration" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>Restaurer une sauvegarde</h2>
      {!apercu ? (
        <>
          <p className="discret">
            Une sauvegarde Osteosphere (fichier .osteosauve) s’ouvre avec la clé de secours remise à la création du cabinet.
          </p>
          <div className="champ">
            <span className="libelle-champ">Fichier de sauvegarde</span>
            <div className="rangee">
              <span className={chemin ? "chemin-fichier" : "discret"}>{chemin || "Aucun fichier choisi"}</span>
              <button
                type="button"
                className="bouton bouton-petit"
                onClick={() =>
                  void agir(async () => {
                    const choisi = await coeur.choisirFichier("sauvegarde");
                    if (choisi) setChemin(choisi);
                  })
                }
              >
                Choisir un fichier…
              </button>
            </div>
          </div>
          <div className="champ">
            <label htmlFor={`${id}-cle`}>Clé de secours</label>
            <input
              id={`${id}-cle`}
              className="saisie-cle"
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              value={cle}
              onChange={(e) => setCle(e.target.value)}
            />
          </div>
          {erreur && (
            <p className="alerte" role="alert">
              {erreur}
            </p>
          )}
          <div className="rangee">
            <button
              type="button"
              className="bouton bouton-principal"
              disabled={envoi || !chemin || !cle.trim()}
              onClick={() => void agir(async () => setApercu(await coeur.apercuRestauration(chemin, cle)))}
            >
              {envoi ? "Vérification…" : "Vérifier la sauvegarde"}
            </button>
            <button type="button" className="lien-bouton" onClick={annuler}>
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="succes" role="status">
            Sauvegarde intacte, déchiffrée avec votre clé de secours.
          </p>
          <dl className="apercu-sauvegarde">
            <div>
              <dt>Faite le</dt>
              <dd>{momentEnLettres(apercu.cree_le)}</dd>
            </div>
            <div>
              <dt>Cabinet</dt>
              <dd>{apercu.praticien || "—"}</dd>
            </div>
            <div>
              <dt>Patients</dt>
              <dd>{apercu.patients}</dd>
            </div>
            <div>
              <dt>Séances</dt>
              <dd>
                {apercu.seances}
                {apercu.derniere_seance && <span className="discret"> · la dernière le {dateEnLettres(apercu.derniere_seance)}</span>}
              </dd>
            </div>
            <div>
              <dt>Factures et avoirs</dt>
              <dd>{apercu.factures}</dd>
            </div>
          </dl>
          <p className="avertissement">
            {premierDemarrage
              ? "Le cabinet de cette sauvegarde sera installé sur cet ordinateur. Sa clé de secours reste celle que vous venez de saisir."
              : "Vos données actuelles seront remplacées par celles de la sauvegarde. Elles sont mises de côté dans le dossier du cabinet, jamais effacées. La clé de secours devient celle de la sauvegarde ; le mot de passe éventuel est retiré, vous pourrez en remettre un."}
          </p>
          {erreur && (
            <p className="alerte" role="alert">
              {erreur}
            </p>
          )}
          <div className="rangee">
            <button
              type="button"
              className="bouton bouton-principal"
              disabled={envoi}
              onClick={() => void agir(async () => surRestauration(await coeur.confirmerRestauration()))}
            >
              {envoi ? "Restauration…" : premierDemarrage ? "Installer ce cabinet" : "Remplacer mes données par cette sauvegarde"}
            </button>
            <button
              type="button"
              className="lien-bouton"
              disabled={envoi}
              onClick={() =>
                void agir(async () => {
                  await coeur.annulerRestauration();
                  setApercu(null);
                  annuler();
                })
              }
            >
              Annuler
            </button>
          </div>
        </>
      )}
    </section>
  );
}
