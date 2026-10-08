import { useEffect, useMemo, useState, type FormEvent } from "react";

import { FICHE_VIDE, type Coeur, type ResumePatient } from "../lib/coeur";
import { lireDateFr, neLe } from "../lib/dates";
import { adresse, aller } from "../lib/navigation";
import { ressemblants } from "../lib/recherche";
import { depuisBrouillon, FormulaireFiche, versBrouillon, type BrouillonFiche, type ErreursFiche } from "../patients/FormulaireFiche";
import { useReglagesFiche } from "../patients/Groupes";

/** Création d'un dossier, avec l'alerte de doublon dès que le nom et le prénom sont tapés. */
export function NouveauPatient({ coeur, depuisRecherche = "" }: { coeur: Coeur; depuisRecherche?: string }) {
  const [brouillon, setBrouillon] = useState<BrouillonFiche>(() => {
    const [nom = "", ...prenom] = depuisRecherche.trim().split(/\s+/);
    return versBrouillon({ ...FICHE_VIDE, nom, prenom: prenom.join(" "), statut: "Nouveau" });
  });
  const [erreurs, setErreurs] = useState<ErreursFiche>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [liste, setListe] = useState<ResumePatient[]>([]);
  const { statuts, groupes, departement } = useReglagesFiche(coeur);

  useEffect(() => {
    coeur.listerPatients().then(setListe, () => setListe([]));
  }, [coeur]);

  // Le statut « Nouveau » proposé d'office, s'il est encore dans la liste du praticien.
  useEffect(() => {
    if (statuts.length > 0 && !statuts.includes("Nouveau")) setBrouillon((b) => (b.statut === "Nouveau" ? { ...b, statut: "" } : b));
  }, [statuts]);

  const semblables = useMemo(
    () => ressemblants(liste, { nom: brouillon.nom, prenom: brouillon.prenom, naissance: lireDateFr(brouillon.naissance) ?? null }),
    [liste, brouillon.nom, brouillon.prenom, brouillon.naissance],
  );

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    const { fiche, erreurs } = depuisBrouillon(brouillon);
    setErreurs(erreurs);
    if (!fiche) {
      setErreur("Corrigez les champs signalés pour créer le dossier.");
      return;
    }
    setEnvoi(true);
    try {
      const patient = await coeur.creerPatient(fiche);
      aller("patients", patient.id);
    } catch (raison) {
      setErreur((raison as Error).message);
      setEnvoi(false);
    }
  }

  return (
    <main className="page">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("patients")}>Patients</a> <span aria-hidden="true">›</span> Nouveau patient
      </nav>
      <h1 className="page-titre">Nouveau patient</h1>
      <form className="pile" onSubmit={enregistrer} noValidate>
        {semblables.length > 0 && (
          <div className="avertissement" role="status">
            <strong>Un dossier ressemble à celui-ci.</strong> Vérifiez qu’il ne s’agit pas du même patient :
            <ul className="liste-doublons">
              {semblables.map((p) => (
                <li key={p.id}>
                  <a href={adresse("patients", p.id)}>
                    {p.nom} {p.prenom}
                  </a>
                  {p.naissance && <span className="discret">{neLe(p.sexe, p.naissance)}</span>}
                  {p.ville && <span className="discret">{p.ville}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="carte">
          <FormulaireFiche
            brouillon={brouillon}
            changer={setBrouillon}
            erreurs={erreurs}
            statuts={statuts}
            groupes={groupes}
            departement={departement}
            premierChampAutoFocus
          />
        </div>
        {erreur && (
          <p className="alerte" role="alert">
            {erreur}
          </p>
        )}
        <div className="rangee barre-actions">
          <a className="bouton" href={adresse("patients")}>
            Annuler
          </a>
          <button type="submit" className="bouton bouton-principal" disabled={envoi}>
            Créer le dossier
          </button>
        </div>
      </form>
    </main>
  );
}
