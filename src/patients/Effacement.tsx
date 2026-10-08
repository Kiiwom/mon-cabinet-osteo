import { useEffect, useId, useState } from "react";

import type { BilanEffacement, Coeur, ContenuDossier, Patient } from "../lib/coeur";
import { adresse } from "../lib/navigation";
import { normaliser } from "../lib/recherche";

const compte = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Effacement définitif du dossier, à la demande du patient, après confirmation : les factures émises restent. */
export function PageEffacement({ coeur, id }: { coeur: Coeur; id: string }) {
  const champ = useId();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [contenu, setContenu] = useState<ContenuDossier | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [bilan, setBilan] = useState<BilanEffacement | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([coeur.lirePatient(id), coeur.contenuDossier(id)]).then(
      ([p, c]) => {
        setPatient(p);
        setContenu(c);
      },
      (e: Error) => setErreur(e.message),
    );
  }, [coeur, id]);

  if (bilan) {
    return (
      <main className="page">
        <h1 className="page-titre">Dossier effacé</h1>
        <section className="carte pile" role="status">
          <p>
            Le dossier, {compte(bilan.seances, "séance", "séances")}, {compte(bilan.antecedents, "antécédent", "antécédents")} et{" "}
            {compte(bilan.documents, "document", "documents")} ont été effacés, ainsi que leur historique.
          </p>
          {bilan.factures_conservees > 0 && (
            <p>{compte(bilan.factures_conservees, "facture ou avoir émis reste", "factures et avoirs émis restent")} dans la facturation, comme la loi le demande.</p>
          )}
          <p className="discret">Les sauvegardes faites avant l’effacement contiennent encore le dossier, jusqu’à ce qu’elles soient remplacées par de plus récentes.</p>
          <div>
            <a className="bouton bouton-principal" href={adresse("patients")}>
              Revenir à la liste des patients
            </a>
          </div>
        </section>
      </main>
    );
  }
  if (erreur && !patient) {
    return (
      <main className="page">
        <p className="alerte" role="alert">
          {erreur}
        </p>
        <a href={adresse("patients")}>Revenir à la liste des patients</a>
      </main>
    );
  }
  if (!patient || !contenu) return <p className="page discret">Ouverture du dossier…</p>;

  const confirme = normaliser(confirmation) !== "" && normaliser(confirmation) === normaliser(patient.nom);

  async function effacer() {
    setEnvoi(true);
    setErreur(null);
    try {
      setBilan(await coeur.effacerDossier(id));
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  }

  return (
    <main className="page">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("patients")}>Patients</a> <span aria-hidden="true">›</span>{" "}
        <a href={adresse("patients", patient.id)}>
          {patient.prenom} {patient.nom}
        </a>{" "}
        <span aria-hidden="true">›</span> Effacement
      </nav>
      <h1 className="page-titre">Effacer le dossier de {patient.prenom} {patient.nom}</h1>
      <section className="carte pile">
        <p>À la demande du patient, son dossier est effacé pour de bon : rien ne pourra être récupéré dans Osteosphere.</p>
        <ul className="liste-simple">
          <li>La fiche, les proches liés et l’historique des modifications</li>
          <li>{compte(contenu.seances, "séance", "séances")}, corbeille comprise</li>
          <li>{compte(contenu.antecedents, "antécédent", "antécédents")}</li>
          <li>{compte(contenu.documents, "document", "documents")}, corbeille comprise</li>
        </ul>
        {contenu.factures > 0 && (
          <p>
            Les factures et avoirs émis restent dans la facturation, comme la loi le demande : ils gardent le nom et l’adresse imprimés le jour de
            leur émission, sans lien avec un dossier. Les brouillons sont supprimés.
          </p>
        )}
        <p className="discret">
          Pensez à archiver plutôt le dossier si le patient ne l’a pas demandé : un dossier archivé reste consultable. Les sauvegardes déjà faites
          gardent le dossier jusqu’à leur remplacement.
        </p>
        <div className="champ">
          <label htmlFor={champ}>Pour confirmer, tapez le nom du patient : {patient.nom}</label>
          <input id={champ} className="saisie-courte" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        {erreur && (
          <p className="alerte" role="alert">
            {erreur}
          </p>
        )}
        <div className="rangee">
          <button type="button" className="bouton bouton-danger" disabled={!confirme || envoi} onClick={() => void effacer()}>
            Effacer définitivement le dossier
          </button>
          <a className="bouton" href={adresse("patients", patient.id)}>
            Garder le dossier
          </a>
        </div>
      </section>
    </main>
  );
}
