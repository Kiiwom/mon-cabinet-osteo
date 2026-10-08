import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { chargerCommunes, chercherCommunes, communesDuCode, plierCommune, type Commune, type IndexCommunes } from "../lib/codesPostaux";

const MAX_DU_CODE = 12;

/** Ce que les champs proposent, d'après ce qui est tapé. */
export function propositionsCommune(
  index: IndexCommunes,
  codePostal: string,
  ville: string,
  saisie: "cp" | "ville",
  departement: string,
): { communes: Commune[]; avecCode: boolean; plus: number } {
  const cp = codePostal.replace(/\s/g, "");
  const duCode = /^\d{5}$/.test(cp) ? communesDuCode(index, cp) : [];
  const villePliee = plierCommune(ville);
  if (duCode.some((c) => plierCommune(c.nom) === villePliee)) return { communes: [], avecCode: false, plus: 0 };
  if (duCode.length > 0) {
    const gardees = villePliee ? duCode.filter((c) => plierCommune(c.nom).startsWith(villePliee) || plierCommune(c.nom).includes(` ${villePliee}`)) : duCode;
    if (gardees.length > 0 || saisie === "cp") return { communes: gardees.slice(0, MAX_DU_CODE), avecCode: false, plus: Math.max(0, gardees.length - MAX_DU_CODE) };
  }
  if (saisie === "ville") return { communes: chercherCommunes(index, ville, departement), avecCode: true, plus: 0 };
  return { communes: [], avecCode: false, plus: 0 };
}

/**
 * Code postal et ville, avec complétion : le code propose ses communes (la seule est remplie
 * d'office), le début du nom de la ville propose les communes et leur code, celles du
 * département du cabinet d'abord. Hors de France, les champs restent libres.
 */
export function ChampsCommune({
  codePostal,
  ville,
  pays,
  changer,
  erreur,
  departement = "",
}: {
  codePostal: string;
  ville: string;
  pays: string;
  changer: (codePostal: string, ville: string) => void;
  erreur?: string;
  departement?: string;
}) {
  const id = useId();
  const [index, setIndex] = useState<IndexCommunes | null>(null);
  const [saisie, setSaisie] = useState<"cp" | "ville" | null>(null);
  const propositions = useRef<HTMLDivElement>(null);
  const francais = !pays.trim() || pays.trim().toLowerCase() === "france";

  const charger = () => {
    if (francais && !index) chargerCommunes().then(setIndex, () => undefined);
  };
  useEffect(() => {
    if (saisie) charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisie]);

  const proposees = index && francais && saisie ? propositionsCommune(index, codePostal, ville, saisie, departement) : { communes: [], avecCode: false, plus: 0 };

  function changerCode(valeur: string) {
    setSaisie("cp");
    const cp = valeur.replace(/\s/g, "");
    const duCode = index && francais && /^\d{5}$/.test(cp) ? communesDuCode(index, cp) : [];
    // Une seule commune pour ce code : la ville se remplit d'elle-même, si elle est vide.
    changer(valeur, duCode.length === 1 && !ville.trim() ? duCode[0].nom : ville);
  }

  function choisir(commune: Commune) {
    changer(commune.code_postal, commune.nom);
    setSaisie(null);
  }

  function clavier(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && proposees.communes.length > 0) {
      e.preventDefault();
      propositions.current?.querySelector("button")?.focus();
    } else if (e.key === "Escape" && saisie) {
      e.preventDefault();
      setSaisie(null);
    }
  }

  function clavierPropositions(e: KeyboardEvent<HTMLDivElement>) {
    const boutons = [...(propositions.current?.querySelectorAll("button") ?? [])];
    const rang = boutons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      boutons[Math.min(rang + 1, boutons.length - 1)]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rang <= 0) document.getElementById(`${id}-ville`)?.focus();
      else boutons[rang - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSaisie(null);
      document.getElementById(`${id}-ville`)?.focus();
    }
  }

  const libelle = (c: Commune) => {
    const nom = c.rattachee ? `${c.nom} (${c.rattachee})` : c.nom;
    return proposees.avecCode ? `${c.code_postal} ${nom}` : nom;
  };

  return (
    <>
      <div className="champ">
        <label htmlFor={`${id}-cp`}>Code postal</label>
        <input
          id={`${id}-cp`}
          value={codePostal}
          onChange={(e) => changerCode(e.target.value)}
          onFocus={charger}
          onKeyDown={clavier}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? `${id}-erreur` : undefined}
        />
        {erreur && (
          <span id={`${id}-erreur`} className="champ-erreur">
            {erreur}
          </span>
        )}
      </div>
      <div className="champ">
        <label htmlFor={`${id}-ville`}>Ville</label>
        <input
          id={`${id}-ville`}
          value={ville}
          onChange={(e) => {
            setSaisie("ville");
            changer(codePostal, e.target.value);
          }}
          onFocus={charger}
          onKeyDown={clavier}
          autoComplete="off"
          aria-describedby={proposees.communes.length > 0 ? `${id}-propositions` : undefined}
        />
      </div>
      {proposees.communes.length > 0 && (
        <div className="champ-large propositions-communes" id={`${id}-propositions`} role="group" aria-label="Communes proposées" ref={propositions} onKeyDown={clavierPropositions}>
          <span className="discret">{proposees.avecCode ? "Communes :" : `Communes du ${codePostal.replace(/\s/g, "")} :`}</span>
          {proposees.communes.map((c) => (
            <button key={`${c.code_postal}-${c.nom}`} type="button" className="bouton bouton-petit" onClick={() => choisir(c)}>
              {libelle(c)}
            </button>
          ))}
          {proposees.plus > 0 && <span className="discret">et {proposees.plus} autres : tapez le début du nom</span>}
        </div>
      )}
    </>
  );
}
