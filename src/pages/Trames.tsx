import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { CaractereTrames, Coeur, SaisieTrame, Trame } from "../lib/coeur";
import { documentDepuis } from "../lib/texteRiche";
import { BarreOutils, ChampTrame, extensionsTexte } from "../trames/ChampTrame";
import { signalerTrames } from "../trames/contexte";
import type { Segment } from "../trames/syntaxe";
import { TexteRiche } from "../trames/TexteRiche";
import { contenuVersInsertion } from "../trames/valider";

const SAISIE_VIDE: SaisieTrame = { code: "", titre: "", categorie: "", modele: "", contenu: null };

/** Texte de la trame, mis en forme : la syntaxe des choix et des blancs s'écrit dans le texte. */
function EditeurTexteTrame({ id, depart, changer }: { id: string; depart: JSONContent; changer: (contenu: JSONContent, modele: string) => void }) {
  const changement = useRef(changer);
  changement.current = changer;
  const editor = useEditor({
    extensions: [extensionsTexte(true)],
    content: depart,
    editorProps: {
      attributes: { class: "champ-trame-saisie", "aria-labelledby": `${id}-libelle-modele`, "aria-describedby": `${id}-syntaxe` },
    },
    onUpdate: ({ editor: e }) => changement.current(e.getJSON(), e.getText({ blockSeparator: "\n" })),
  });
  return (
    <div className="champ-trame">
      <span className="champ-trame-entete">
        <span id={`${id}-libelle-modele`} className="champ-trame-libelle">
          Texte de la trame
        </span>
        {editor && <BarreOutils editor={editor} />}
      </span>
      <EditorContent editor={editor} />
    </div>
  );
}

/** Aperçu non interactif : pastilles et blancs tels qu'ils apparaîtront en séance. */
export function ApercuTrame({ segments }: { segments: Segment[] }) {
  return (
    <p className="apercu-trame">
      {segments.map((segment, rang) => {
        if (segment.type === "texte") return <span key={rang}>{segment.texte}</span>;
        if (segment.type === "blanc")
          return (
            <span key={rang} className="apercu-blanc">
              {segment.indication || "…"}
            </span>
          );
        return (
          <span key={rang} className="apercu-choix" data-multiple={segment.multiple}>
            {segment.multiple && <span aria-hidden="true">+</span>}
            {segment.options.map((option, i) => (
              <span key={i} className="apercu-pastille">
                {option}
              </span>
            ))}
          </span>
        );
      })}
    </p>
  );
}

function EditeurTrame({
  trame,
  caractere,
  enregistrer,
  supprimer,
}: {
  trame: Trame | null;
  caractere: CaractereTrames;
  enregistrer: (saisie: SaisieTrame) => Promise<void>;
  supprimer: (() => Promise<void>) | null;
}) {
  const id = useId();
  const [saisie, setSaisie] = useState<SaisieTrame>(trame ?? SAISIE_VIDE);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const [enregistree, setEnregistree] = useState(false);

  useEffect(() => {
    setSaisie(trame ?? SAISIE_VIDE);
    setErreur(null);
    setConfirmerSuppression(false);
    setEnregistree(false);
  }, [trame]);

  // Le texte prêt à insérer : la syntaxe est vérifiée ligne par ligne, comme à l'insertion en séance.
  const conversion = useMemo((): { ok: true; blocs: JSONContent[] } | { ok: false; erreur: string } => {
    try {
      return { ok: true, blocs: contenuVersInsertion(saisie.contenu ?? documentDepuis(saisie.modele)) };
    } catch (e) {
      return { ok: false, erreur: (e as Error).message };
    }
  }, [saisie.contenu, saisie.modele]);
  const changer = (champ: "code" | "titre" | "categorie") => (valeur: string) => {
    setSaisie((s) => ({ ...s, [champ]: valeur }));
    setEnregistree(false);
  };

  async function valider() {
    setErreur(null);
    if (!saisie.titre.trim()) return setErreur("Donnez un titre à la trame.");
    if (!/^[a-z0-9-]{1,20}$/i.test(saisie.code.trim().replace(/^[@/]/, ""))) {
      return setErreur("Le code ne contient que des lettres sans accent, des chiffres ou des tirets, 20 au plus.");
    }
    if (!saisie.modele.trim()) return setErreur("Écrivez le texte de la trame.");
    if (!conversion.ok) return setErreur(conversion.erreur);
    try {
      await enregistrer(saisie);
      setEnregistree(true);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <section className="carte" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>{trame ? `Modifier ${caractere}${trame.code}` : "Nouvelle trame"}</h2>
      <div className="champs">
        <div className="champ">
          <label htmlFor={`${id}-titre-trame`}>Titre</label>
          <input id={`${id}-titre-trame`} value={saisie.titre} onChange={(e) => changer("titre")(e.target.value)} />
        </div>
        <div className="champ">
          <label htmlFor={`${id}-code`}>Code</label>
          <div className="champ-prefixe">
            <span aria-hidden="true">{caractere}</span>
            <input
              id={`${id}-code`}
              value={saisie.code}
              onChange={(e) => changer("code")(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="champ">
          <label htmlFor={`${id}-categorie`}>Catégorie</label>
          <input id={`${id}-categorie`} value={saisie.categorie} onChange={(e) => changer("categorie")(e.target.value)} list={`${id}-categories`} />
          <datalist id={`${id}-categories`}>
            {["Anamnèse", "Examen", "Tests", "Traitement", "Conseils"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="champ champ-large">
          <EditeurTexteTrame
            key={trame?.id ?? "nouvelle"}
            id={id}
            depart={trame?.contenu ?? documentDepuis(trame?.modele ?? "")}
            changer={(contenu, modele) => {
              setSaisie((s) => ({ ...s, contenu, modele }));
              setEnregistree(false);
            }}
          />
          <span id={`${id}-syntaxe`} className="discret">
            <code>{"{droite | gauche}"}</code> choix unique · <code>{"{+ a | b | c}"}</code> choix multiple ·{" "}
            <code>[durée]</code> blanc à compléter · gras, titres et listes restent à l’insertion
          </span>
        </div>
      </div>
      <div className="pile-serree">
        <span className="champ-trame-libelle">Aperçu</span>
        {conversion.ok ? (
          saisie.modele.trim() ? (
            <div className="apercu-trame">
              <TexteRiche document={{ type: "doc", content: conversion.blocs }} />
            </div>
          ) : (
            <p className="discret">L’aperçu apparaît dès que vous écrivez.</p>
          )
        ) : (
          <p className="champ-erreur">{conversion.erreur}</p>
        )}
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="rangee">
        <button type="button" className="bouton bouton-principal" onClick={valider}>
          Enregistrer
        </button>
        {enregistree && (
          <span className="etat-enregistre" role="status">
            Enregistrée
          </span>
        )}
        {supprimer &&
          (confirmerSuppression ? (
            <span className="rangee confirmation">
              <span>Supprimer {caractere}{trame?.code}&nbsp;?</span>
              <button type="button" className="bouton bouton-danger" onClick={() => void supprimer()}>
                Supprimer définitivement
              </button>
              <button type="button" className="bouton" onClick={() => setConfirmerSuppression(false)}>
                Annuler
              </button>
            </span>
          ) : (
            <button type="button" className="bouton bouton-discret" onClick={() => setConfirmerSuppression(true)}>
              Supprimer
            </button>
          ))}
      </div>
    </section>
  );
}

export function PageTrames({ coeur }: { coeur: Coeur }) {
  const [trames, setTrames] = useState<Trame[]>([]);
  const [caractere, setCaractere] = useState<CaractereTrames>("@");
  const [recherche, setRecherche] = useState("");
  const [choisie, setChoisie] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [texteValide, setTexteValide] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      setTrames(await coeur.listerTrames());
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, [coeur]);

  useEffect(() => {
    void recharger();
    coeur.caractereTrames().then(setCaractere, () => undefined);
  }, [coeur, recharger]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return trames.filter(
      (t) => !q || t.code.includes(q.replace(/^[@/]/, "")) || t.titre.toLowerCase().includes(q) || t.modele.toLowerCase().includes(q),
    );
  }, [trames, recherche]);

  const trame = nouvelle ? null : (trames.find((t) => t.id === choisie) ?? null);

  return (
    <main className="page">
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Trames</h1>
          <p className="page-sous-titre">
            Vos textes réutilisables&nbsp;: tapez {caractere} puis le code dans une séance, les remarques ou tout texte mis en forme
          </p>
        </div>
        <div className="segments" role="group" aria-label="Caractère d’appel des trames">
          {(["@", "/"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={caractere === c}
              title={c === "@" ? "Appel par @, comme sur MonCabinetLibéral" : "Appel par /, comme sur osteopathes.pro"}
              onClick={() => {
                coeur.definirCaractereTrames(c).then(
                  (nouveau) => {
                    setCaractere(nouveau);
                    signalerTrames();
                  },
                  (e: Error) => setErreur(e.message),
                );
              }}
            >
              Appel par {c}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="bouton bouton-principal"
          onClick={() => {
            setNouvelle(true);
            setChoisie(null);
          }}
        >
          + Nouvelle trame
        </button>
      </div>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="trames-colonnes">
        <section className="carte trames-liste" aria-label="Mes trames">
          <input
            type="search"
            className="recherche"
            placeholder="Code, titre ou contenu…"
            aria-label="Rechercher une trame"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
          <ul>
            {visibles.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="trame-ligne"
                  aria-current={!nouvelle && t.id === choisie ? "true" : undefined}
                  onClick={() => {
                    setChoisie(t.id);
                    setNouvelle(false);
                  }}
                >
                  <span className="trame-ligne-haut">
                    <span className="trame-code">
                      {caractere}
                      {t.code}
                    </span>
                    <span className="trame-titre">{t.titre}</span>
                  </span>
                  <span className="discret">
                    {t.categorie || "Sans catégorie"} · utilisée {t.utilisations} fois
                  </span>
                </button>
              </li>
            ))}
            {visibles.length === 0 && <li className="discret">Aucune trame ne correspond.</li>}
          </ul>
        </section>

        <div className="pile trames-detail">
          <section className="carte" aria-labelledby="titre-essai">
            <div className="pile-serree">
              <h2 id="titre-essai">Essai en séance</h2>
              <span className="discret">
                Comme dans la fiche de séance&nbsp;: tapez {caractere}lomb, complétez, puis Valider. Rien n’est enregistré ici.
              </span>
            </div>
            <ChampTrame
              key={caractere}
              miseEnForme
              libelle="Motif de consultation"
              trames={trames}
              caractere={caractere}
              surUtilisation={(t) => {
                void coeur.noterUtilisationTrame(t.id).then(recharger);
              }}
              surValidation={setTexteValide}
            />
            {texteValide !== null && (
              <div className="texte-valide">
                <span className="champ-trame-libelle">Texte enregistré dans la séance</span>
                <p>{texteValide || "(vide)"}</p>
              </div>
            )}
          </section>

          {(trame || nouvelle) && (
            <EditeurTrame
              trame={trame}
              caractere={caractere}
              enregistrer={async (saisie) => {
                const enregistree = await coeur.enregistrerTrame(trame?.id ?? null, saisie);
                await recharger();
                signalerTrames();
                setNouvelle(false);
                setChoisie(enregistree.id);
              }}
              supprimer={
                trame
                  ? async () => {
                      await coeur.supprimerTrame(trame.id);
                      setChoisie(null);
                      await recharger();
                      signalerTrames();
                    }
                  : null
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}
