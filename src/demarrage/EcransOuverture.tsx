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

/** Ouverture avec le mot de passe choisi par le praticien. */
export function Verrouillage({ coeur, surOuverture, utiliserCle }: PropsOuverture & { utiliserCle: () => void }) {
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
    <CarteCentrale titre="Cabinet protégé">
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

/** Ouverture avec la clé de secours : mot de passe oublié, autre poste ou autre compte Windows. */
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
          ? "Ce cabinet a été créé sur un autre ordinateur ou une autre session Windows. Saisissez sa clé de secours : ensuite, il s’ouvrira directement ici."
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
