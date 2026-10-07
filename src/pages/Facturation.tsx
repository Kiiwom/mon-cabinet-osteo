import { useEffect, useState } from "react";

import { dateDuJour, type Coeur } from "../lib/coeur";

/** Facturation du prototype : la facture d'essai. L'écran complet arrive en phase 4. */
export function PageFacturation({ coeur }: { coeur: Coeur }) {
  const [apercu, setApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => () => {
    if (apercu) URL.revokeObjectURL(apercu);
  }, [apercu]);

  async function creer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const pdf = await coeur.factureEssaiPdf(dateDuJour());
      setApercu(URL.createObjectURL(new Blob([pdf.slice()], { type: "application/pdf" })));
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  async function ouvrir() {
    setErreur(null);
    try {
      await coeur.ouvrirFactureEssai(dateDuJour());
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <main className="page">
      <div>
        <h1 className="page-titre">Facturation</h1>
        <p className="page-sous-titre">Tableau des recettes, factures et avoirs&nbsp;: phase 4. Ici, l’essai de la facture PDF.</p>
      </div>
      <section className="carte" aria-labelledby="titre-essai-facture">
        <div className="pile-serree">
          <h2 id="titre-essai-facture">Facture d’essai</h2>
          <span className="discret">
            Mise en page de la maquette, avec l’identité de votre cabinet, une patiente fictive et le filigrane «&nbsp;ESSAI
            — SANS VALEUR&nbsp;». Aucun numéro de facture n’est réservé.
          </span>
        </div>
        {erreur && (
          <p className="alerte" role="alert">
            {erreur}
          </p>
        )}
        <div className="rangee">
          <button type="button" className="bouton bouton-principal" onClick={creer} disabled={envoi}>
            {envoi ? "Mise en page…" : apercu ? "Refaire la facture d’essai" : "Créer la facture d’essai"}
          </button>
          <button type="button" className="bouton" onClick={ouvrir} disabled={envoi}>
            Ouvrir dans le lecteur PDF
          </button>
        </div>
        {apercu && <iframe className="apercu-pdf" title="Aperçu de la facture d’essai" src={apercu} />}
      </section>
    </main>
  );
}
