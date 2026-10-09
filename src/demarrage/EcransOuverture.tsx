import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { LogoOsteosphere } from "../composants/Marque";
import type { Coeur, IdentiteCabinet } from "../lib/coeur";

function CarteCentrale({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div className="ecran-centre">
      <main className="carte-centrale">
        <div className="marque-centree">
          <div className="marque-logo">
            <LogoOsteosphere />
          </div>
          <strong>Osteosphere</strong>
        </div>
        <h1>{titre}</h1>
        {children}
      </main>
    </div>
  );
}

interface PropsOuverture {
  coeur: Coeur;
  surOuverture: (cabinet: IdentiteCabinet) => void;
}

/**
 * Cabinet protégé par le mot de passe : à l'ouverture du logiciel, ou verrouillé pendant la journée.
 * Verrouillé avec un code court, c'est lui qui est d'abord demandé ; le mot de passe reste possible.
 */
export function Verrouillage({
  coeur,
  surOuverture,
  utiliserCle,
  codeCourt = false,
}: PropsOuverture & { utiliserCle: () => void; codeCourt?: boolean }) {
  const [mode, setMode] = useState<"code" | "mot_de_passe">(codeCourt ? "code" : "mot_de_passe");
  const [avis, setAvis] = useState<string | null>(null);
  if (mode === "code") {
    return (
      <SaisieCodeCourt
        coeur={coeur}
        surOuverture={surOuverture}
        utiliserMotDePasse={(raison) => {
          setAvis(raison ?? null);
          setMode("mot_de_passe");
        }}
      />
    );
  }
  return <SaisieMotDePasse coeur={coeur} surOuverture={surOuverture} utiliserCle={utiliserCle} avis={avis} verrouille={codeCourt} />;
}

function SaisieMotDePasse({
  coeur,
  surOuverture,
  utiliserCle,
  avis,
  verrouille,
}: PropsOuverture & { utiliserCle: () => void; avis: string | null; verrouille: boolean }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [visible, setVisible] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const id = useId();

  async function valider(e: FormEvent) {
    e.preventDefault();
    if (!motDePasse) return;
    setEnvoi(true);
    setErreur(null);
    try {
      surOuverture(await coeur.deverrouiller(motDePasse));
    } catch (raison) {
      setErreur((raison as Error).message);
      setMotDePasse("");
      setEnvoi(false);
      champ.current?.focus();
    }
  }

  return (
    <CarteCentrale titre={verrouille ? "Cabinet verrouillé" : "Cabinet protégé"}>
      {avis && (
        <p className="alerte" role="alert">
          {avis}
        </p>
      )}
      <p className="discret-centre">Saisissez le mot de passe choisi pour ouvrir Osteosphere.</p>
      <form className="formulaire" onSubmit={valider}>
        <label htmlFor={id}>Mot de passe</label>
        <div className="champ-avec-bouton">
          <input
            id={id}
            ref={champ}
            type={visible ? "text" : "password"}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            autoComplete="current-password"
            aria-invalid={erreur ? true : undefined}
            aria-describedby={erreur ? `${id}-erreur` : undefined}
            autoFocus
          />
          <button type="button" className="bouton-icone" aria-pressed={visible} onClick={() => setVisible(!visible)}>
            {visible ? "Masquer" : "Afficher"}
          </button>
        </div>
        {erreur && (
          <p id={`${id}-erreur`} className="alerte" role="alert">
            {erreur}
          </p>
        )}
        <button type="submit" className="bouton bouton-principal bouton-plein" disabled={envoi || !motDePasse}>
          {envoi ? "Ouverture…" : "Déverrouiller"}
        </button>
      </form>
      <button type="button" className="lien-bouton" onClick={utiliserCle}>
        Mot de passe oublié&nbsp;? Utiliser la clé de secours
      </button>
    </CarteCentrale>
  );
}

const TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Code court de 4 à 6 chiffres, au clavier ou sur le pavé, utilisable au doigt. */
function SaisieCodeCourt({ coeur, surOuverture, utiliserMotDePasse }: PropsOuverture & { utiliserMotDePasse: (raison?: string) => void }) {
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const id = useId();
  const ajouter = (chiffre: string) => {
    setCode((c) => (c.length < 6 ? c + chiffre : c));
    champ.current?.focus();
  };

  async function valider(e?: FormEvent) {
    e?.preventDefault();
    if (code.length < 4 || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await coeur.deverrouillerAvecCode(code);
      if (reponse.etat === "ouvert") return surOuverture(reponse.cabinet);
      if (reponse.essais_restants === 0) return utiliserMotDePasse("Trop de codes faux : saisissez votre mot de passe.");
      setErreur(`Code incorrect. Encore ${reponse.essais_restants} essai${reponse.essais_restants > 1 ? "s" : ""}, puis le mot de passe sera demandé.`);
    } catch (raison) {
      setErreur((raison as Error).message);
    }
    setCode("");
    setEnvoi(false);
    champ.current?.focus();
  }

  return (
    <CarteCentrale titre="Cabinet verrouillé">
      <p className="discret-centre">Saisissez votre code court pour reprendre.</p>
      <form className="formulaire" onSubmit={valider}>
        <label htmlFor={id}>Code court</label>
        <input
          id={id}
          ref={champ}
          className="saisie-code"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? `${id}-erreur` : undefined}
          autoFocus
        />
        <div className="pave-numerique" role="group" aria-label="Pavé numérique">
          {TOUCHES.map((t) => (
            <button key={t} type="button" className="bouton" onClick={() => ajouter(t)} disabled={envoi}>
              {t}
            </button>
          ))}
          <button type="button" className="bouton" onClick={() => setCode((c) => c.slice(0, -1))} disabled={envoi || !code} aria-label="Effacer le dernier chiffre">
            ⌫
          </button>
          <button type="button" className="bouton" onClick={() => ajouter("0")} disabled={envoi}>
            0
          </button>
          <button type="submit" className="bouton bouton-principal" disabled={envoi || code.length < 4} aria-label="Déverrouiller">
            ✓
          </button>
        </div>
        {erreur && (
          <p id={`${id}-erreur`} className="alerte" role="alert">
            {erreur}
          </p>
        )}
      </form>
      <button type="button" className="lien-bouton" onClick={() => utiliserMotDePasse()}>
        Utiliser le mot de passe
      </button>
    </CarteCentrale>
  );
}

/** Ouverture avec la clé de secours : mot de passe oublié, autre poste, autre compte ou trousseau de session effacé. */
export function SaisieCleDeSecours({
  coeur,
  surOuverture,
  origine,
  retour,
}: PropsOuverture & { origine: "mot_de_passe_oublie" | "autre_poste"; retour?: () => void }) {
  const [cle, setCle] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const id = useId();

  async function valider(e: FormEvent) {
    e.preventDefault();
    if (!cle.trim()) return;
    setEnvoi(true);
    setErreur(null);
    try {
      surOuverture(await coeur.ouvrirAvecCleDeSecours(cle));
    } catch (raison) {
      setErreur((raison as Error).message);
      setEnvoi(false);
    }
  }

  return (
    <CarteCentrale titre="Clé de secours">
      <p className="discret-centre">
        {origine === "autre_poste"
          ? "Ce cabinet a été créé sur un autre ordinateur ou dans une autre session. Saisissez sa clé de secours : ensuite, il s’ouvrira directement ici."
          : "Saisissez la clé de secours remise au premier démarrage. Votre mot de passe actuel reste valable."}
      </p>
      <form className="formulaire" onSubmit={valider}>
        <label htmlFor={id}>Clé de secours</label>
        <input
          id={id}
          className="saisie-cle"
          value={cle}
          onChange={(e) => setCle(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={`${id}-aide${erreur ? ` ${id}-erreur` : ""}`}
          autoFocus
        />
        <span id={`${id}-aide`} className="discret">
          Majuscules ou minuscules, avec ou sans tirets.
        </span>
        {erreur && (
          <p id={`${id}-erreur`} className="alerte" role="alert">
            {erreur}
          </p>
        )}
        <button type="submit" className="bouton bouton-principal bouton-plein" disabled={envoi || !cle.trim()}>
          {envoi ? "Ouverture…" : "Ouvrir le cabinet"}
        </button>
      </form>
      {retour && (
        <button type="button" className="lien-bouton" onClick={retour}>
          Revenir au mot de passe
        </button>
      )}
    </CarteCentrale>
  );
}
