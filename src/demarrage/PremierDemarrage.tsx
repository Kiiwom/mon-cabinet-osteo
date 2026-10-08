import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Marque } from "../composants/Marque";
import {
  IDENTITE_VIDE,
  type CaractereTrames,
  type ChampTexteIdentite,
  type Coeur,
  type FrequenceSauvegarde,
  type IdentiteCabinet,
  type PreparationPremierDemarrage,
} from "../lib/coeur";
import { verifierIdentite, type ErreursIdentite } from "../lib/identite";
import { RestaurationSauvegarde } from "../sauvegardes/Restauration";

const ETAPES = [
  { titre: "Bienvenue", detail: "Présentation et licence" },
  { titre: "Votre cabinet", detail: "Identité, adresse, SIRET, RPPS" },
  { titre: "Protection des données", detail: "Mot de passe, clé de secours" },
  { titre: "Sauvegardes", detail: "Fréquence et emplacement" },
  { titre: "Votre pratique", detail: "Trames et modules" },
  { titre: "Reprise des données", detail: "Facultatif · depuis un autre logiciel" },
] as const;

export const FREQUENCES: { valeur: FrequenceSauvegarde; libelle: string; detail: string }[] = [
  { valeur: "fermeture", libelle: "À chaque fermeture du logiciel", detail: "Conseillé : rien n’est perdu d’une journée à l’autre." },
  { valeur: "intervalle", libelle: "Régulièrement, pendant l’utilisation", detail: "" },
  { valeur: "jour", libelle: "Une fois par jour", detail: "À la première ouverture de la journée." },
  { valeur: "semaine", libelle: "Une fois par semaine", detail: "Le lundi, à la première ouverture." },
  { valeur: "manuelle", libelle: "Seulement quand je le demande", detail: "Depuis Paramètres › Sauvegardes." },
];

/** Intervalles proposés pour la sauvegarde régulière, en minutes (les mêmes que le cœur). */
export const INTERVALLES: { minutes: number; libelle: string }[] = [
  { minutes: 10, libelle: "Toutes les 10 minutes" },
  { minutes: 15, libelle: "Toutes les 15 minutes" },
  { minutes: 30, libelle: "Toutes les 30 minutes" },
  { minutes: 60, libelle: "Toutes les heures" },
  { minutes: 120, libelle: "Toutes les 2 heures" },
  { minutes: 240, libelle: "Toutes les 4 heures" },
];

interface Props {
  coeur: Coeur;
  /** `destination` : l'écran à montrer après l'ouverture, l'accueil sinon. */
  surOuverture: (cabinet: IdentiteCabinet, destination?: string) => void;
}

export function PremierDemarrage({ coeur, surOuverture }: Props) {
  const [etape, setEtape] = useState(0);
  const [preparation, setPreparation] = useState<PreparationPremierDemarrage | null>(null);
  const [identite, setIdentite] = useState<IdentiteCabinet>(IDENTITE_VIDE);
  const [erreursIdentite, setErreursIdentite] = useState<ErreursIdentite>({});
  const [avecMotDePasse, setAvecMotDePasse] = useState(false);
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [cleNotee, setCleNotee] = useState(false);
  const [cleCopiee, setCleCopiee] = useState(false);
  const [frequence, setFrequence] = useState<FrequenceSauvegarde>("fermeture");
  const [intervalle, setIntervalle] = useState(60);
  const [dossier, setDossier] = useState("");
  const [caractere, setCaractere] = useState<CaractereTrames>("@");
  const [reprise, setReprise] = useState<"vide" | "mcl">("vide");
  const [restauration, setRestauration] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const titre = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    coeur.preparerPremierDemarrage().then(
      (p) => {
        setPreparation(p);
        setDossier((d) => d || p.dossier_sauvegardes_propose);
      },
      (e: Error) => setErreur(e.message),
    );
  }, [coeur]);

  useEffect(() => {
    titre.current?.focus();
  }, [etape]);

  const changerIdentite = (champ: ChampTexteIdentite) => (valeur: string) =>
    setIdentite((i) => ({ ...i, [champ]: valeur }));

  function etapeValide(): boolean {
    setErreur(null);
    if (etape === 1) {
      const erreurs = verifierIdentite(identite);
      setErreursIdentite(erreurs);
      if (Object.keys(erreurs).length > 0) {
        setErreur("Corrigez les champs signalés pour continuer.");
        return false;
      }
    }
    if (etape === 2) {
      if (avecMotDePasse && !motDePasse) {
        setErreur("Choisissez un mot de passe, ou gardez l’ouverture directe.");
        return false;
      }
      if (avecMotDePasse && motDePasse !== confirmation) {
        setErreur("Les deux mots de passe ne sont pas identiques.");
        return false;
      }
      if (!avecMotDePasse && preparation && sansTrousseau(preparation)) {
        setErreur("Sans trousseau de session, choisissez un mot de passe pour ce cabinet.");
        return false;
      }
      if (!cleNotee) {
        setErreur("Cochez la case qui confirme que la clé de secours est notée ou imprimée.");
        return false;
      }
    }
    return true;
  }

  async function terminer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const cabinet = await coeur.terminerPremierDemarrage({
        identite,
        mot_de_passe: avecMotDePasse ? motDePasse : null,
        cle_notee: cleNotee,
        caractere_trames: caractere,
        sauvegardes: { frequence, intervalle_minutes: intervalle, dossier: dossier.trim(), conserver: 30 },
      });
      surOuverture(cabinet, reprise === "mcl" ? "#/parametres/import" : undefined);
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  }

  function continuer() {
    if (!etapeValide()) return;
    if (etape === ETAPES.length - 1) void terminer();
    else setEtape(etape + 1);
  }

  const derniere = etape === ETAPES.length - 1;

  return (
    <div className="assistant">
      <aside className="assistant-cote" aria-label="Progression de la configuration">
        <Marque />
        <div className="assistant-intro">
          <strong>Configuration</strong>
          <span>Environ 5 minutes. Tout reste modifiable ensuite dans les Paramètres.</span>
        </div>
        <ol className="assistant-etapes" aria-label="Étapes de la configuration">
          {ETAPES.map((e, rang) => {
            const etat = rang < etape ? "fait" : rang === etape ? "courant" : "a-venir";
            return (
              <li key={e.titre} data-etat={etat} aria-current={etat === "courant" ? "step" : undefined}>
                <span className="assistant-pastille" aria-hidden="true">
                  {etat === "fait" ? "✓" : rang + 1}
                </span>
                <span>
                  <strong>
                    {e.titre}
                    {etat === "fait" && <span className="lecteur-seulement">, terminée</span>}
                  </strong>
                  <span className="discret">{e.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="assistant-note">
          Logiciel libre et gratuit. Vos données restent sur cet ordinateur&nbsp;: aucun compte, aucun hébergeur.
        </p>
      </aside>

      <main className="assistant-principal">
        <div className="assistant-contenu">
          <p className="assistant-numero">
            Étape {etape + 1} sur {ETAPES.length}
          </p>
          <h1 ref={titre} tabIndex={-1} className="assistant-titre">
            {[
              "Bienvenue dans Osteosphere",
              "Votre cabinet",
              "Protéger vos données",
              "Vos sauvegardes",
              "Votre pratique",
              "Reprendre vos données ?",
            ][etape]}
          </h1>

          {erreur && (
            <p className="alerte" role="alert">
              {erreur}
            </p>
          )}

          {etape === 0 &&
            (restauration ? (
              <RestaurationSauvegarde coeur={coeur} premierDemarrage surRestauration={(cabinet) => surOuverture(cabinet)} annuler={() => setRestauration(false)} />
            ) : (
              <EtapeBienvenue restaurer={() => setRestauration(true)} />
            ))}
          {etape === 1 && <EtapeCabinet identite={identite} erreurs={erreursIdentite} changer={changerIdentite} />}
          {etape === 2 && (
            <EtapeProtection
              preparation={preparation}
              avecMotDePasse={avecMotDePasse}
              setAvecMotDePasse={setAvecMotDePasse}
              motDePasse={motDePasse}
              setMotDePasse={setMotDePasse}
              confirmation={confirmation}
              setConfirmation={setConfirmation}
              cleNotee={cleNotee}
              setCleNotee={setCleNotee}
              cleCopiee={cleCopiee}
              copier={() => {
                if (preparation) void navigator.clipboard?.writeText(preparation.cle_de_secours).then(() => setCleCopiee(true));
              }}
            />
          )}
          {etape === 3 && (
            <EtapeSauvegardes
              frequence={frequence}
              setFrequence={setFrequence}
              intervalle={intervalle}
              setIntervalle={setIntervalle}
              dossier={dossier}
              setDossier={setDossier}
            />
          )}
          {etape === 4 && <EtapePratique caractere={caractere} setCaractere={setCaractere} />}
          {etape === 5 && <EtapeReprise reprise={reprise} setReprise={setReprise} />}

          <div className="assistant-actions">
            {etape > 0 && (
              <button type="button" className="bouton" onClick={() => {
                  setErreur(null);
                  setEtape(etape - 1);
                }} disabled={envoi}>
                Retour
              </button>
            )}
            {!derniere && <span className="assistant-ensuite">Ensuite&nbsp;: {ETAPES[etape + 1].titre.toLowerCase()}</span>}
            <button type="button" className="bouton bouton-principal" onClick={continuer} disabled={envoi || (etape >= 2 && !preparation) || restauration}>
              {derniere ? (envoi ? "Création du cabinet…" : "Créer mon cabinet") : "Continuer"}
              {!derniere && <span aria-hidden="true">→</span>}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function EtapeBienvenue({ restaurer }: { restaurer: () => void }) {
  return (
    <div className="pile">
      <p className="introduction">
        Osteosphere est un logiciel libre et gratuit de gestion de cabinet pour ostéopathes. Il fonctionne sur cet
        ordinateur, sans abonnement ni connexion obligatoire.
      </p>
      <ul className="liste-points">
        <li>Vos dossiers sont chiffrés sur le disque.</li>
        <li>Une clé de secours vous est remise pour retrouver vos données en cas de panne.</li>
        <li>Les fonctions dont vous n’avez pas besoin restent masquées, et s’activent en un clic.</li>
      </ul>
      <p className="discret">
        Osteosphere est distribué sous licence GPL-3.0, sans garantie. Version d’essai&nbsp;: gardez votre ancien logiciel en
        parallèle tant que vous n’avez pas vérifié la reprise de vos données.
      </p>
      <p className="info">
        Vous avez déjà un cabinet Osteosphere, sur un autre ordinateur&nbsp;?{" "}
        <button type="button" className="lien-bouton" onClick={restaurer}>
          Restaurer une sauvegarde
        </button>
      </p>
    </div>
  );
}

function Champ({
  libelle,
  valeur,
  changer,
  erreur,
  aide,
  type = "text",
  autoComplete,
  obligatoire = false,
  large = false,
}: {
  libelle: string;
  valeur: string;
  changer: (v: string) => void;
  erreur?: string;
  aide?: string;
  type?: string;
  autoComplete?: string;
  obligatoire?: boolean;
  large?: boolean;
}) {
  const id = useId();
  const description = erreur ? `${id}-erreur` : aide ? `${id}-aide` : undefined;
  return (
    <div className={large ? "champ champ-large" : "champ"}>
      <label htmlFor={id}>
        {libelle}
        {obligatoire && <span className="obligatoire"> (obligatoire)</span>}
      </label>
      <input
        id={id}
        type={type}
        value={valeur}
        onChange={(e) => changer(e.target.value)}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={description}
        autoComplete={autoComplete}
        required={obligatoire}
      />
      {erreur ? (
        <span id={`${id}-erreur`} className="champ-erreur">
          {erreur}
        </span>
      ) : (
        aide && (
          <span id={`${id}-aide`} className="discret">
            {aide}
          </span>
        )
      )}
    </div>
  );
}

/** Les champs de l'identité du cabinet, repris dans Paramètres › Cabinet. */
export function ChampsIdentite({
  identite,
  erreurs,
  changer,
}: {
  identite: IdentiteCabinet;
  erreurs: ErreursIdentite;
  changer: (champ: ChampTexteIdentite) => (valeur: string) => void;
}) {
  return (
    <div className="champs">
      <Champ libelle="Prénom" valeur={identite.prenom} changer={changer("prenom")} erreur={erreurs.prenom} autoComplete="given-name" obligatoire />
      <Champ libelle="Nom" valeur={identite.nom} changer={changer("nom")} erreur={erreurs.nom} autoComplete="family-name" obligatoire />
      <Champ libelle="Profession" valeur={identite.profession} changer={changer("profession")} large />
      <Champ libelle="Adresse du cabinet" valeur={identite.adresse} changer={changer("adresse")} autoComplete="street-address" large />
      <Champ libelle="Code postal" valeur={identite.code_postal} changer={changer("code_postal")} erreur={erreurs.code_postal} autoComplete="postal-code" />
      <Champ libelle="Ville" valeur={identite.ville} changer={changer("ville")} autoComplete="address-level2" />
      <Champ libelle="Téléphone" valeur={identite.telephone} changer={changer("telephone")} type="tel" autoComplete="tel" />
      <Champ libelle="Email" valeur={identite.email} changer={changer("email")} erreur={erreurs.email} type="email" autoComplete="email" />
      <Champ libelle="SIRET" valeur={identite.siret} changer={changer("siret")} erreur={erreurs.siret} aide="14 chiffres, espaces acceptés" />
      <Champ libelle="Numéro RPPS" valeur={identite.rpps} changer={changer("rpps")} erreur={erreurs.rpps} aide="11 chiffres" />
    </div>
  );
}

function EtapeCabinet({
  identite,
  erreurs,
  changer,
}: {
  identite: IdentiteCabinet;
  erreurs: ErreursIdentite;
  changer: (champ: ChampTexteIdentite) => (valeur: string) => void;
}) {
  return (
    <div className="pile">
      <p className="introduction">
        Ces informations figurent sur vos factures. Seuls le prénom et le nom sont nécessaires maintenant&nbsp;; le
        reste sera demandé avant la première facture.
      </p>
      <ChampsIdentite identite={identite} erreurs={erreurs} changer={changer} />
    </div>
  );
}

/** Sous Linux, l'ouverture directe s'appuie sur le trousseau de la session : sans lui, pas d'ouverture directe. */
function sansTrousseau(preparation: PreparationPremierDemarrage): boolean {
  return preparation.systeme === "linux" && !preparation.session_protegee;
}

function verrouillageDuSysteme(systeme: string | undefined): string {
  if (systeme === "linux") return "le verrouillage de votre session";
  if (systeme === "macos") return "le verrouillage de macOS";
  return "le verrouillage de Windows";
}

export function CarteChoix({
  nom,
  coche,
  choisir,
  titre,
  etiquette,
  children,
  desactive = false,
}: {
  nom: string;
  coche: boolean;
  choisir: () => void;
  titre: string;
  etiquette?: string;
  children: ReactNode;
  desactive?: boolean;
}) {
  return (
    <label className="carte-choix" data-coche={coche} data-desactive={desactive}>
      <input type="radio" name={nom} checked={coche} onChange={choisir} disabled={desactive} />
      <span className="pile-serree">
        <span className="carte-choix-titre">
          <strong>{titre}</strong>
          {etiquette && <span className="etiquette">{etiquette}</span>}
        </span>
        <span>{children}</span>
      </span>
    </label>
  );
}

function EtapeProtection(props: {
  preparation: PreparationPremierDemarrage | null;
  avecMotDePasse: boolean;
  setAvecMotDePasse: (v: boolean) => void;
  motDePasse: string;
  setMotDePasse: (v: string) => void;
  confirmation: string;
  setConfirmation: (v: string) => void;
  cleNotee: boolean;
  setCleNotee: (v: boolean) => void;
  cleCopiee: boolean;
  copier: () => void;
}) {
  const { preparation, avecMotDePasse } = props;
  return (
    <div className="pile">
      <p className="introduction">
        Vos dossiers sont chiffrés sur cet ordinateur et s’ouvrent avec votre session. Une personne qui emporterait le
        disque ne pourrait pas les lire.
      </p>

      <fieldset className="groupe">
        <legend>Demander un mot de passe à l’ouverture&nbsp;?</legend>
        <div className="choix-cartes">
          <CarteChoix nom="mot-de-passe" coche={!avecMotDePasse} choisir={() => props.setAvecMotDePasse(false)} titre="Non, ouvrir directement" etiquette="par défaut">
            Le logiciel s’ouvre directement. Vous protégez l’écran avec {verrouillageDuSysteme(preparation?.systeme)}.
          </CarteChoix>
          <CarteChoix nom="mot-de-passe" coche={avecMotDePasse} choisir={() => props.setAvecMotDePasse(true)} titre="Oui, à chaque ouverture">
            Mot de passe à l’ouverture et verrouillage après une absence, avec un code court facultatif pour la journée.
          </CarteChoix>
        </div>
        {avecMotDePasse && (
          <div className="champs">
            <Champ libelle="Mot de passe" type="password" valeur={props.motDePasse} changer={props.setMotDePasse} autoComplete="new-password" />
            <Champ libelle="Confirmation" type="password" valeur={props.confirmation} changer={props.setConfirmation} autoComplete="new-password" />
          </div>
        )}
        <span className="discret">Modifiable à tout moment dans Paramètres › Sécurité et mot de passe, sans perte de données.</span>
        {preparation && !preparation.session_protegee && !avecMotDePasse && (
          <p className="info">
            {sansTrousseau(preparation)
              ? "Le trousseau de votre session (GNOME, KDE…) ne répond pas : sans lui, Osteosphere ne peut pas s’ouvrir directement sur cet ordinateur. Choisissez un mot de passe, ou démarrez le trousseau puis relancez Osteosphere."
              : "Version de développement : sur ce système, la session ne protège pas encore la clé. Sous Windows et Linux, elle est protégée par votre session."}
          </p>
        )}
      </fieldset>

      <section className="carte cle-carte" aria-labelledby="titre-cle">
        <div className="pile-serree">
          <h2 id="titre-cle">Votre clé de secours</h2>
          <span>
            Si cet ordinateur tombe en panne ou est volé, cette clé est le seul moyen d’ouvrir vos sauvegardes sur un autre
            poste. Elle remplace aussi un mot de passe oublié.
          </span>
        </div>
        <div className="cle-imprimable">
          <span className="discret">Clé de secours Osteosphere</span>
          <span className="cle-valeur" aria-label="Clé de secours">
            {preparation?.cle_de_secours ?? "…"}
          </span>
        </div>
        <div className="rangee">
          <button type="button" className="bouton bouton-principal" onClick={() => window.print()} disabled={!preparation}>
            Imprimer la clé
          </button>
          <button type="button" className="bouton" onClick={props.copier} disabled={!preparation}>
            {props.cleCopiee ? "Clé copiée" : "Copier"}
          </button>
        </div>
        <p className="avertissement">
          <strong>Personne ne peut la retrouver à votre place</strong>, pas même les auteurs du logiciel. Rangez-la hors
          du cabinet, avec vos papiers importants.
        </p>
        <label className="case">
          <input type="checkbox" checked={props.cleNotee} onChange={(e) => props.setCleNotee(e.target.checked)} />
          <span>J’ai imprimé ou noté ma clé de secours et je la range en lieu sûr.</span>
        </label>
      </section>
    </div>
  );
}

function EtapeSauvegardes(props: {
  frequence: FrequenceSauvegarde;
  setFrequence: (f: FrequenceSauvegarde) => void;
  intervalle: number;
  setIntervalle: (minutes: number) => void;
  dossier: string;
  setDossier: (d: string) => void;
}) {
  return (
    <div className="pile">
      <p className="introduction">
        Chaque sauvegarde est chiffrée&nbsp;: elle ne s’ouvre qu’avec votre clé de secours ou sur ce poste.
      </p>
      <fieldset className="groupe">
        <legend>Quand sauvegarder&nbsp;?</legend>
        <div className="choix-liste">
          {FREQUENCES.map((f) => (
            <CarteChoix key={f.valeur} nom="frequence" coche={props.frequence === f.valeur} choisir={() => props.setFrequence(f.valeur)} titre={f.libelle}>
              {f.valeur === "intervalle" ? (
                <span className="choix-intervalle">
                  <select
                    aria-label="Intervalle entre deux sauvegardes"
                    value={props.intervalle}
                    onChange={(e) => {
                      props.setIntervalle(Number(e.target.value));
                      props.setFrequence("intervalle");
                    }}
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
      </fieldset>
      <Champ
        libelle="Dossier des sauvegardes"
        valeur={props.dossier}
        changer={props.setDossier}
        aide="Une clé USB ou un disque externe protège aussi contre la panne de l’ordinateur."
        large
      />
      <p className="info">Vous pourrez tout changer ensuite dans Paramètres › Sauvegardes, et sauvegarder à la demande.</p>
    </div>
  );
}

function EtapePratique(props: { caractere: CaractereTrames; setCaractere: (c: CaractereTrames) => void }) {
  return (
    <div className="pile">
      <fieldset className="groupe">
        <legend>Quel caractère ouvre le menu des trames&nbsp;?</legend>
        <div className="choix-cartes">
          <CarteChoix nom="caractere" coche={props.caractere === "@"} choisir={() => props.setCaractere("@")} titre="@ (arobase)" etiquette="par défaut">
            Le réflexe de MonCabinetLibéral et d’osteopathes.pro&nbsp;: tapez @lomb pour insérer la trame «&nbsp;lomb&nbsp;».
          </CarteChoix>
          <CarteChoix nom="caractere" coche={props.caractere === "/"} choisir={() => props.setCaractere("/")} titre="/ (barre oblique)">
            Comme dans les éditeurs récents&nbsp;: tapez /lomb.
          </CarteChoix>
        </div>
      </fieldset>
      <p className="info">
        Les modules (agenda, dépenses, schéma corporel, Biokinergie…) s’activeront dans Paramètres › Modules quand ils
        seront prêts.
      </p>
    </div>
  );
}

function EtapeReprise({ reprise, setReprise }: { reprise: "vide" | "mcl"; setReprise: (r: "vide" | "mcl") => void }) {
  return (
    <div className="pile">
      <fieldset className="groupe">
        <legend>Point de départ</legend>
        <div className="choix-liste">
          <CarteChoix nom="reprise" coche={reprise === "vide"} choisir={() => setReprise("vide")} titre="Commencer avec un cabinet vide">
            Vous pourrez importer vos données plus tard, depuis Paramètres › Import et export.
          </CarteChoix>
          <CarteChoix nom="reprise" coche={reprise === "mcl"} choisir={() => setReprise("mcl")} titre="Importer depuis MonCabinetLibéral">
            Juste après la création du cabinet : patients, séances, antécédents, factures et règlements, vérifiés avant tout
            enregistrement.
          </CarteChoix>
        </div>
      </fieldset>
    </div>
  );
}
