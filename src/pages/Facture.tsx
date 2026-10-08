import { useEffect, useId, useState } from "react";

import { EditeurFacture, saisieNeuve } from "../facturation/EditeurFacture";
import { ApercuFacture, EtatFacture, FormulaireReglement, PastilleMoyen, REGLEMENT_VIDE } from "../facturation/composants";
import { ErreurFacturation } from "../facturation/FinDeSeance";
import { dateDuJour, type Coeur, type ResumePatient } from "../lib/coeur";
import { dateCourte } from "../lib/dates";
import {
  euros,
  intituleFacture,
  libelleMoyen,
  signalerFacturation,
  texteEvenement,
  totalLignes,
  type EvenementFacture,
  type Facture,
  type Prestation,
  type Reglement,
  type SaisieFacture,
} from "../lib/facturation";
import { adresse, aller } from "../lib/navigation";

function saisieDe(f: Facture): SaisieFacture {
  const { patient_id, seance_id, date_seance, destinataire, lignes, commentaire_imprime, commentaire_interne } = f;
  return structuredClone({ patient_id, seance_id, date_seance, destinataire, lignes, commentaire_imprime, commentaire_interne });
}

function heure(le: number): string {
  const d = new Date(le * 1000);
  return `${dateCourte(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Reglements({ coeur, facture, changer }: { coeur: Coeur; facture: Facture; changer: (f: Facture) => void }) {
  const [edition, setEdition] = useState<Reglement | "nouveau" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const avoir = facture.nature === "avoir";
  const peutAjouter = facture.etat === "emise" && (avoir ? facture.remboursable_centimes > 0 : facture.reste_centimes > 0);

  async function supprimer(r: Reglement) {
    setErreur(null);
    try {
      changer(await coeur.supprimerReglement(r.id));
      setEdition(null);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <section className="carte" aria-labelledby="titre-reglements">
      <h2 id="titre-reglements">{avoir ? "Remboursements" : "Règlements"}</h2>
      {facture.reglements.length === 0 && (
        <p className="discret">
          {!avoir ? "Aucun règlement reçu." : peutAjouter ? "Aucun remboursement noté." : "Rien à rembourser : la facture annulée n’avait pas été réglée, ou son règlement est reporté sur la facture corrigée."}
        </p>
      )}
      {facture.reglements.map((r) =>
        edition !== "nouveau" && edition?.id === r.id ? (
          <FormulaireReglement
            key={r.id}
            initial={r}
            remboursement={r.montant_centimes < 0}
            libelleValider="Enregistrer"
            annuler={() => setEdition(null)}
            valider={async (saisie) => {
              changer(await coeur.modifierReglement(r.id, saisie));
              setEdition(null);
            }}
          />
        ) : (
          <div key={r.id} className="reglement">
            <div className="rangee entre">
              <strong>{euros(Math.abs(r.montant_centimes))}</strong>
              <span>
                <PastilleMoyen moyen={r.moyen} /> {libelleMoyen(r.moyen)}
                {r.reference && ` n° ${r.reference}`}
              </span>
              <span className="discret">{dateCourte(r.encaisse_le)}</span>
            </div>
            {(r.payeur || r.commentaire || r.montant_centimes < 0) && (
              <span className="discret">
                {[r.montant_centimes < 0 ? "Remboursement" : "", r.payeur && `payé par ${r.payeur}`, r.commentaire].filter(Boolean).join(" · ")}
              </span>
            )}
            {facture.etat !== "brouillon" && (
              <div className="rangee">
                {facture.etat === "emise" && (
                  <button type="button" className="bouton bouton-petit" onClick={() => setEdition(r)}>
                    Modifier
                  </button>
                )}
                <button type="button" className="lien-bouton" onClick={() => void supprimer(r)}>
                  Supprimer
                </button>
              </div>
            )}
          </div>
        ),
      )}
      {!avoir && facture.etat === "emise" && (
        <div className="rangee entre">
          <span>{facture.reste_centimes < 0 ? "Trop-perçu" : "Reste à régler"}</span>
          <strong>{euros(Math.abs(facture.reste_centimes))}</strong>
        </div>
      )}
      {facture.reste_centimes < 0 && <p className="discret">Le trop-perçu se rembourse avec un règlement de montant négatif : « Ajouter un remboursement ».</p>}
      {edition === "nouveau" ? (
        <FormulaireReglement
          initial={{ ...REGLEMENT_VIDE, montant_centimes: avoir ? facture.remboursable_centimes : facture.reste_centimes }}
          remboursement={avoir || facture.reste_centimes < 0}
          libelleValider={avoir || facture.reste_centimes < 0 ? "Enregistrer le remboursement" : "Enregistrer le règlement"}
          annuler={() => setEdition(null)}
          valider={async (saisie) => {
            changer(await coeur.ajouterReglement(facture.id, saisie));
            setEdition(null);
          }}
        />
      ) : (
        (peutAjouter || (facture.etat === "emise" && facture.reste_centimes < 0)) && (
          <button type="button" className="bouton" onClick={() => setEdition("nouveau")}>
            {avoir || facture.reste_centimes < 0 ? "Ajouter un remboursement" : "Ajouter un règlement"}
          </button>
        )
      )}
      {erreur && <ErreurFacturation message={erreur} />}
    </section>
  );
}

function Commentaires({ coeur, facture, changer }: { coeur: Coeur; facture: Facture; changer: (f: Facture) => void }) {
  const id = useId();
  const [interne, setInterne] = useState(facture.commentaire_interne);
  const [etat, setEtat] = useState<string | null>(null);
  async function enregistrer() {
    if (interne.trim() === facture.commentaire_interne) return;
    try {
      changer(await coeur.annoterFacture(facture.id, interne));
      setEtat("Enregistré");
    } catch (e) {
      setEtat((e as Error).message);
    }
  }
  return (
    <section className="carte" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>Commentaires</h2>
      <div className="champ">
        <span className="libelle-champ">Imprimé sur la facture</span>
        <p className={facture.commentaire_imprime ? "" : "discret"}>{facture.commentaire_imprime || "Aucun"}</p>
      </div>
      <div className="champ">
        <label htmlFor={`${id}-interne`}>Interne, jamais imprimé</label>
        <textarea id={`${id}-interne`} className="zone-texte" rows={2} value={interne} onChange={(e) => setInterne(e.target.value)} onBlur={() => void enregistrer()} />
        {etat && (
          <span className="discret" role="status">
            {etat}
          </span>
        )}
      </div>
    </section>
  );
}

function CorrigerOuAnnuler({ facture, corriger, annuler }: { facture: Facture; corriger: () => void; annuler: () => Promise<void> }) {
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <section className="carte" aria-labelledby="titre-corriger">
      <h2 id="titre-corriger">Corriger ou annuler</h2>
      <p className="discret">
        Une facture émise ne se modifie pas. Corriger crée un avoir qui l’annule et une nouvelle facture corrigée&nbsp;; le règlement y est reporté.
      </p>
      <button type="button" className="bouton" onClick={corriger}>
        Corriger la facture
      </button>
      {confirmer ? (
        <div className="confirmation">
          <p>
            Émettre un avoir de {euros(facture.total_centimes)} qui annule la facture {facture.numero}&nbsp;?
            {facture.regle_centimes > 0 && " Les règlements reçus restent comptés : notez le remboursement sur l’avoir si vous rendez l’argent."}
          </p>
          <div className="rangee">
            <button
              type="button"
              className="bouton bouton-danger"
              onClick={() => {
                setErreur(null);
                annuler().catch((e: Error) => setErreur(e.message));
              }}
            >
              Émettre l’avoir
            </button>
            <button type="button" className="lien-bouton" onClick={() => setConfirmer(false)}>
              Garder la facture
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="bouton bouton-danger" onClick={() => setConfirmer(true)}>
          Annuler par un avoir
        </button>
      )}
      {erreur && <ErreurFacturation message={erreur} />}
    </section>
  );
}

function Liens({ facture }: { facture: Facture }) {
  const liens = [
    facture.origine && {
      texte: facture.nature === "avoir" ? `Annule la facture ${facture.origine.numero}` : `Remplace la facture ${facture.origine.numero}`,
      href: adresse("facturation", "facture", facture.origine.id),
    },
    facture.avoir && { texte: `Annulée par l’avoir ${facture.avoir.numero}`, href: adresse("facturation", "facture", facture.avoir.id) },
    facture.rectificative && { texte: `Remplacée par la facture ${facture.rectificative.numero}`, href: adresse("facturation", "facture", facture.rectificative.id) },
    facture.seance_id && { texte: `Séance${facture.date_seance ? ` du ${dateCourte(facture.date_seance)}` : ""}`, href: adresse("seances", facture.seance_id) },
    facture.patient_id && { texte: "Dossier du patient", href: adresse("patients", facture.patient_id) },
  ].filter(Boolean) as { texte: string; href: string }[];
  if (liens.length === 0) return null;
  return (
    <ul className="liens-facture">
      {liens.map((l) => (
        <li key={l.href}>
          <a href={l.href}>{l.texte}</a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Une facture ou un avoir : aperçu, règlements, commentaires, correction ou annulation, historique.
 * Un brouillon s'y modifie et s'y émet.
 */
export function PageFacture({ coeur, id, mode }: { coeur: Coeur; id: string; mode?: string }) {
  const [facture, setFacture] = useState<Facture | null>(null);
  const [historique, setHistorique] = useState<EvenementFacture[]>([]);
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [saisie, setSaisie] = useState<SaisieFacture | null>(null);
  const [version, setVersion] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const correction = mode === "corriger";

  useEffect(() => {
    let actif = true;
    Promise.all([coeur.lireFacture(id), coeur.historiqueFacture(id), coeur.listerPrestations()]).then(
      ([f, h, p]) => {
        if (!actif) return;
        setFacture(f);
        setHistorique(h);
        setPrestations(p);
        setSaisie(f.etat === "brouillon" || correction ? saisieDe(f) : null);
      },
      (e: Error) => actif && setErreur(e.message),
    );
    return () => {
      actif = false;
    };
  }, [coeur, id, version, correction]);

  const changer = (f: Facture) => {
    setFacture(f);
    setVersion((v) => v + 1);
  };

  async function agir(action: () => Promise<void>) {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      await action();
      signalerFacturation();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  if (!facture) {
    return (
      <main className="page">
        {erreur ? <ErreurFacturation message={erreur} /> : <p className="discret">Ouverture de la facture…</p>}
        <a href={adresse("facturation", "factures")}>Revenir aux factures</a>
      </main>
    );
  }

  const titre = intituleFacture(facture);
  const brouillon = facture.etat === "brouillon";
  const fil = (
    <nav className="fil" aria-label="Fil d’Ariane">
      <a href={adresse("facturation", "factures")}>Facturation</a> <span aria-hidden="true">›</span> {correction ? `Corriger la facture ${facture.numero}` : titre}
    </nav>
  );

  if ((brouillon || correction) && saisie) {
    return (
      <main className="page page-large">
        {fil}
        <div className="entete-page">
          <div>
            <h1 className="page-titre">{correction ? `Corriger la facture ${facture.numero}` : "Brouillon de facture"}</h1>
            <p className="page-sous-titre">
              {correction
                ? "Un avoir annulera la facture d’origine et une facture corrigée sera émise, au numéro suivant. Les règlements y sont reportés."
                : "Rien n’est numéroté tant que la facture n’est pas émise."}
            </p>
          </div>
        </div>
        <div className="colonnes-facture">
          <section className="carte" aria-label="Contenu de la facture">
            <EditeurFacture saisie={saisie} changer={setSaisie} prestations={prestations} lirePatient={coeur.lirePatient} choixPatient={false} />
          </section>
          <div className="pile">
            <section className="carte" aria-label="Émission">
              <strong className="total-facture">Total : {euros(totalLignes(saisie.lignes))}</strong>
              {erreur && <ErreurFacturation message={erreur} />}
              {correction ? (
                <>
                  <button
                    type="button"
                    className="bouton bouton-principal"
                    disabled={envoi}
                    onClick={() =>
                      void agir(async () => {
                        const rectificative = await coeur.corrigerFacture(facture.id, saisie, dateDuJour());
                        aller("facturation", "facture", rectificative.id);
                      })
                    }
                  >
                    Émettre l’avoir et la facture corrigée
                  </button>
                  <a href={adresse("facturation", "facture", facture.id)}>Abandonner la correction</a>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="bouton bouton-principal"
                    disabled={envoi}
                    onClick={() =>
                      void agir(async () => {
                        await coeur.modifierFacture(facture.id, saisie);
                        changer(await coeur.emettreFacture(facture.id, dateDuJour()));
                      })
                    }
                  >
                    Émettre la facture
                  </button>
                  <button
                    type="button"
                    className="bouton"
                    disabled={envoi}
                    onClick={() =>
                      void agir(async () => {
                        changer(await coeur.modifierFacture(facture.id, saisie));
                        setMessage("Brouillon enregistré.");
                      })
                    }
                  >
                    Enregistrer le brouillon
                  </button>
                  <button
                    type="button"
                    className="lien-bouton"
                    disabled={envoi}
                    onClick={() =>
                      void agir(async () => {
                        await coeur.supprimerBrouillon(facture.id);
                        aller(...(facture.seance_id ? ["seances", facture.seance_id] : ["facturation", "factures"]));
                      })
                    }
                  >
                    Supprimer le brouillon
                  </button>
                </>
              )}
              {message && (
                <p className="succes" role="status">
                  {message}
                </p>
              )}
            </section>
            {brouillon && <ApercuFacture coeur={coeur} id={facture.id} version={version} />}
          </div>
        </div>
      </main>
    );
  }

  const telecharger = () =>
    agir(async () => {
      setMessage(`PDF enregistré : ${await coeur.enregistrerFacturePdf(facture.id)}`);
    });
  const email = () =>
    agir(async () => {
      const patient = facture.patient_id ? await coeur.lirePatient(facture.patient_id) : null;
      const email = await coeur.preparerEmailFacture(facture.id, patient?.email ?? "");
      setMessage(
        email.abandonne
          ? `Email abandonné. Le PDF reste rangé : ${email.chemin}`
          : email.piece_jointe
            ? "Email prêt dans votre messagerie, PDF joint : relisez-le puis envoyez-le."
            : `Email préparé dans votre messagerie : joignez le PDF ${email.chemin}, montré dans son dossier.`,
      );
    });
  const imprimer = () => agir(() => coeur.imprimerFacture(facture.id));

  return (
    <main className="page page-large">
      {fil}
      <div className="entete-page">
        <div className="rangee entete-facture">
          <h1 className="page-titre">{titre}</h1>
          {facture.date_emission && <span className="puce">Émise le {dateCourte(facture.date_emission)}</span>}
          <EtatFacture facture={facture} />
          {facture.importee && <span className="puce puce-discrete">Importée</span>}
        </div>
        {!facture.importee && (
          <div className="rangee">
            <button type="button" className="bouton bouton-principal" disabled={envoi} onClick={() => void telecharger()}>
              Télécharger le PDF
            </button>
            <button type="button" className="bouton" disabled={envoi} onClick={() => void email()}>
              Préparer l’email
            </button>
            <button type="button" className="bouton" disabled={envoi} onClick={() => void imprimer()}>
              Imprimer
            </button>
          </div>
        )}
      </div>
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
      {erreur && <ErreurFacturation message={erreur} />}
      <div className="colonnes-facture">
        {facture.importee ? (
          <section className="carte" aria-label="Facture importée">
            <p>
              Facture importée de MonCabinetLibéral : {euros(facture.total_centimes)}, destinataire {facture.destinataire.nom}. Son PDF d’origine reste dans
              votre ancien logiciel.
            </p>
          </section>
        ) : (
          <ApercuFacture coeur={coeur} id={facture.id} version={version} />
        )}
        <div className="pile">
          <Liens facture={facture} />
          <Reglements coeur={coeur} facture={facture} changer={changer} />
          <Commentaires key={facture.id} coeur={coeur} facture={facture} changer={changer} />
          {facture.nature === "facture" && facture.etat === "emise" && !facture.importee && (
            <CorrigerOuAnnuler
              facture={facture}
              corriger={() => aller("facturation", "facture", facture.id, "corriger")}
              annuler={async () => {
                const avoir = await coeur.annulerFacture(facture.id, dateDuJour());
                signalerFacturation();
                aller("facturation", "facture", avoir.id);
              }}
            />
          )}
          <section className="carte" aria-labelledby="titre-historique">
            <h2 id="titre-historique">Historique</h2>
            <ul className="historique">
              {[...historique].reverse().map((e, rang) => (
                <li key={rang}>
                  <span className="discret">{e.le ? heure(e.le) : "—"}</span>
                  <span>{texteEvenement(e)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

/** Facture sans séance : un brouillon, pour un patient ou pour un autre destinataire. */
export function PageNouvelleFacture({ coeur }: { coeur: Coeur }) {
  const [prestations, setPrestations] = useState<Prestation[] | null>(null);
  const [patients, setPatients] = useState<ResumePatient[]>([]);
  const [saisie, setSaisie] = useState<SaisieFacture | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    Promise.all([coeur.listerPrestations(), coeur.listerPatients()]).then(([p, l]) => {
      setPrestations(p);
      setPatients(l);
      setSaisie(saisieNeuve(p));
    }, (e: Error) => setErreur(e.message));
  }, [coeur]);

  async function creer(emettre: boolean) {
    if (!saisie) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const brouillon = await coeur.creerFacture(saisie);
      if (emettre) await coeur.emettreFacture(brouillon.id, dateDuJour());
      aller("facturation", "facture", brouillon.id);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <main className="page page-large">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("facturation", "factures")}>Facturation</a> <span aria-hidden="true">›</span> Nouvelle facture
      </nav>
      <div>
        <h1 className="page-titre">Nouvelle facture</h1>
        <p className="page-sous-titre">Sans séance : un atelier, une attestation, une facture adressée à un tiers…</p>
      </div>
      {saisie && prestations ? (
        <div className="colonnes-facture">
          <section className="carte" aria-label="Contenu de la facture">
            <EditeurFacture saisie={saisie} changer={setSaisie} prestations={prestations} patients={patients} lirePatient={coeur.lirePatient} choixPatient />
          </section>
          <section className="carte" aria-label="Émission">
            <strong className="total-facture">Total : {euros(totalLignes(saisie.lignes))}</strong>
            {erreur && <ErreurFacturation message={erreur} />}
            <button type="button" className="bouton bouton-principal" disabled={envoi} onClick={() => void creer(true)}>
              Émettre la facture
            </button>
            <button type="button" className="bouton" disabled={envoi} onClick={() => void creer(false)}>
              Enregistrer en brouillon
            </button>
          </section>
        </div>
      ) : erreur ? (
        <ErreurFacturation message={erreur} />
      ) : (
        <p className="discret">Chargement…</p>
      )}
    </main>
  );
}
