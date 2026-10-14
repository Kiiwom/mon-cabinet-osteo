import { useEffect, useId, useRef, useState } from "react";

import { COULEURS_DOCUMENTS, type Coeur, type MiseEnPage, type QuelleImage } from "../lib/coeur";

const TEXTES: Record<QuelleImage, { titre: string; vide: string; alt: string; imprimer: string; aide: string }> = {
  logo: {
    titre: "Logo",
    vide: "Aucun logo",
    alt: "Logo du cabinet",
    imprimer: "Imprimer le logo",
    aide: "PNG ou JPEG, 2 Mo au plus. Il s’imprime en haut des factures et des comptes rendus.",
  },
  signature: {
    titre: "Signature",
    vide: "Aucune image : votre nom s’imprime à la place",
    alt: "Votre signature",
    imprimer: "Imprimer la signature",
    aide: "Une signature scannée sur fond blanc, en PNG ou JPEG, 2 Mo au plus.",
  },
};

/** Logo, signature, couleur et place du logo : enregistrés dès qu'ils changent. */
export function ReglagesMiseEnPage({ coeur, surChangement }: { coeur: Coeur; surChangement: () => void }) {
  const id = useId();
  const [miseEnPage, setMiseEnPage] = useState<MiseEnPage | null>(null);
  const [images, setImages] = useState<Record<QuelleImage, string | null>>({ logo: null, signature: null });
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const adresses = useRef(images);

  async function chargerImage(quelle: QuelleImage) {
    const octets = await coeur.imageDocuments(quelle);
    const adresse = octets.byteLength ? URL.createObjectURL(new Blob([octets])) : null;
    const ancienne = adresses.current[quelle];
    if (ancienne) URL.revokeObjectURL(ancienne);
    adresses.current = { ...adresses.current, [quelle]: adresse };
    setImages(adresses.current);
  }

  useEffect(() => {
    coeur.miseEnPage().then(setMiseEnPage, (e: Error) => setErreur(e.message));
    void chargerImage("logo").catch((e: Error) => setErreur(e.message));
    void chargerImage("signature").catch((e: Error) => setErreur(e.message));
    return () => Object.values(adresses.current).forEach((a) => a && URL.revokeObjectURL(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  async function agir(action: () => Promise<string | null>) {
    setErreur(null);
    setMessage(null);
    try {
      const fait = await action();
      if (fait) {
        setMessage(fait);
        surChangement();
      }
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  const changer = (champs: Partial<MiseEnPage>) =>
    agir(async () => {
      const voulue = { ...miseEnPage!, ...champs };
      setMiseEnPage(voulue);
      setMiseEnPage(await coeur.enregistrerMiseEnPage(voulue));
      return "Présentation enregistrée.";
    });

  const choisir = (quelle: QuelleImage) =>
    agir(async () => {
      if (!(await coeur.choisirImageDocuments(quelle))) return null;
      await chargerImage(quelle);
      return quelle === "logo" ? "Logo enregistré." : "Signature enregistrée.";
    });

  const retirer = (quelle: QuelleImage) =>
    agir(async () => {
      await coeur.supprimerImageDocuments(quelle);
      await chargerImage(quelle);
      return quelle === "logo" ? "Logo retiré." : "Signature retirée : votre nom s’imprime à la place.";
    });

  if (!miseEnPage) return erreur ? <p className="champ-erreur">{erreur}</p> : <p className="discret">Chargement…</p>;

  return (
    <section className="carte pile" aria-labelledby={`${id}-titre`}>
      <div>
        <h2 id={`${id}-titre`}>Présentation des documents</h2>
        <p className="discret">
          Factures, avoirs et comptes rendus. Une facture déjà émise se réimprime avec la présentation du jour, mais garde les mentions de
          son émission.
        </p>
      </div>
      <div className="images-documents">
        {(["logo", "signature"] as const).map((quelle) => {
          const t = TEXTES[quelle];
          const adresse = images[quelle];
          return (
            <div key={quelle} className="image-document">
              <strong>{t.titre}</strong>
              <div className="cadre-image">{adresse ? <img src={adresse} alt={t.alt} /> : <span className="discret">{t.vide}</span>}</div>
              <div className="rangee">
                <button type="button" className="bouton bouton-petit" onClick={() => void choisir(quelle)}>
                  {adresse ? "Changer…" : "Choisir une image…"}
                </button>
                {adresse && (
                  <button type="button" className="bouton bouton-petit bouton-discret" onClick={() => void retirer(quelle)}>
                    Retirer
                  </button>
                )}
              </div>
              {adresse && (
                <label className="case-simple">
                  <input type="checkbox" checked={miseEnPage[quelle]} onChange={(e) => void changer({ [quelle]: e.target.checked })} />
                  {t.imprimer}
                </label>
              )}
              <span className="discret">{t.aide}</span>
            </div>
          );
        })}
      </div>
      {images.logo && miseEnPage.logo && (
        <div className="rangee rangee-centree">
          <span id={`${id}-place`}>Place du logo</span>
          <div className="segments" role="group" aria-labelledby={`${id}-place`}>
            {(["gauche", "droite"] as const).map((place) => (
              <button key={place} type="button" aria-pressed={miseEnPage.position_logo === place} onClick={() => void changer({ position_logo: place })}>
                {place === "gauche" ? "À gauche" : "À droite"}
              </button>
            ))}
          </div>
        </div>
      )}
      <fieldset className="nuancier">
        <legend>Couleur du titre et des filets</legend>
        {COULEURS_DOCUMENTS.map((c) => (
          <label key={c.valeur} className="teinte">
            <input type="radio" name={`${id}-couleur`} checked={miseEnPage.couleur === c.valeur} onChange={() => void changer({ couleur: c.valeur })} />
            <span className="echantillon" style={{ background: c.valeur }} aria-hidden="true" />
            {c.nom}
          </label>
        ))}
      </fieldset>
      {erreur && <p className="champ-erreur">{erreur}</p>}
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
