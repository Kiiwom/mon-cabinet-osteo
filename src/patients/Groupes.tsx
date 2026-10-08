import { useEffect, useState } from "react";

import { departementDe } from "../lib/codesPostaux";
import type { Coeur, Groupe } from "../lib/coeur";
import { adresse } from "../lib/navigation";

export function PuceGroupe({ groupe }: { groupe: Pick<Groupe, "nom" | "couleur"> }) {
  return (
    <span className="puce puce-groupe" data-couleur={groupe.couleur}>
      <span className="pastille-prestation" aria-hidden="true" />
      {groupe.nom}
    </span>
  );
}

/** Les groupes d'un patient, dans l'ordre de la liste des groupes. */
export function groupesDe(ids: string[], groupes: Groupe[]): Groupe[] {
  return groupes.filter((g) => ids.includes(g.id));
}

export function PucesGroupes({ ids, groupes }: { ids: string[]; groupes: Groupe[] }) {
  return (
    <>
      {groupesDe(ids, groupes).map((g) => (
        <PuceGroupe key={g.id} groupe={g} />
      ))}
    </>
  );
}

/** Cases à cocher des groupes, dans la fiche du patient. */
export function ChoixGroupes({ choisis, groupes, changer }: { choisis: string[]; groupes: Groupe[]; changer: (ids: string[]) => void }) {
  return (
    <fieldset className="champ champ-large choix-groupes">
      <legend>Groupes</legend>
      {groupes.length === 0 ? (
        <span className="discret">
          Aucun groupe pour l’instant. <a href={adresse("parametres", "patients")}>Créer des groupes</a>
        </span>
      ) : (
        <div className="rangee">
          {groupes.map((g) => (
            <label key={g.id} className="choix-groupe" data-couleur={g.couleur}>
              <input
                type="checkbox"
                checked={choisis.includes(g.id)}
                onChange={(e) => changer(e.target.checked ? [...choisis, g.id].sort() : choisis.filter((c) => c !== g.id))}
              />
              <span className="pastille-prestation" aria-hidden="true" />
              {g.nom}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Ce que la fiche propose : statuts, groupes et département du cabinet, pour classer les communes. */
export function useReglagesFiche(coeur: Coeur): { statuts: string[]; groupes: Groupe[]; departement: string } {
  const [statuts, setStatuts] = useState<string[]>([]);
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [departement, setDepartement] = useState("");
  useEffect(() => {
    coeur.statutsPatients().then(setStatuts, () => setStatuts([]));
    coeur.listerGroupes().then(setGroupes, () => setGroupes([]));
    coeur.identiteCabinet().then((c) => setDepartement(departementDe(c.code_postal)), () => setDepartement(""));
  }, [coeur]);
  return { statuts, groupes, departement };
}
