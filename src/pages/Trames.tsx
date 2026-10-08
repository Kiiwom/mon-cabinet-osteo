import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { dateDuJour, type BilanEchangeTrames, type CaractereTrames, type Coeur, type ConflitTrames, type SaisieTrame, type Trame, type TrameImportee } from "../lib/coeur";
import { dateEnLettres } from "../lib/dates";
import { documentDepuis } from "../lib/texteRiche";
import { BarreOutils, ChampTrame, extensionsTexte } from "../trames/ChampTrame";
import { FournisseurVariables, signalerTrames } from "../trames/contexte";
import { VARIABLES, type Segment } from "../trames/syntaxe";
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
      <div className="rangee rangee-centree variables-trame" role="group" aria-label="Insérer une variable">
        <span className="discret">Variables&nbsp;:</span>
        {VARIABLES.map((v) => (
          <button
            key={v.nom}
            type="button"
            className="bouton bouton-petit"
            title={`Remplacée par ${v.description}`}
            disabled={!editor}
            // Le curseur reste dans le texte : la frappe continue après la variable.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().insertContent(`{{${v.ecrit}}}`).run()}
          >
            {`{{${v.ecrit}}}`}
          </button>
        ))}
      </div>
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
        if (segment.type === "variable")
          return (
            <span key={rang} className="apercu-blanc">
              {VARIABLES.find((v) => v.nom === segment.nom)?.ecrit}
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
            <code>[durée]</code> blanc à compléter · <code>{"{{prénom}}"}</code> variable remplie d’après le patient · gras, titres et listes
            restent à l’insertion
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

const ETATS_IMPORT: Record<TrameImportee["etat"], string> = { nouvelle: "Nouvelle", identique: "Déjà là", differente: "Code déjà pris" };

/** « 2 trames ajoutées, 1 remplacée, 1 déjà là ou gardée. » */
export function bilanEnClair(b: BilanEchangeTrames): string {
  const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
  const parties = [
    b.ajoutees && pluriel(b.ajoutees, "trame ajoutée", "trames ajoutées"),
    b.renommees && pluriel(b.renommees, "ajoutée sous un autre code", "ajoutées sous un autre code"),
    b.remplacees && pluriel(b.remplacees, "remplacée", "remplacées"),
    b.ignorees && pluriel(b.ignorees, "déjà là ou gardée", "déjà là ou gardées"),
  ].filter(Boolean);
  return parties.length ? `${parties.join(", ")}.` : "Aucune trame importée.";
}

/** Les trames d'un fichier d'échange, comparées aux siennes, avant de les importer. */
function ImportTrames({
  chemin,
  trames,
  caractere,
  importer,
  annuler,
}: {
  chemin: string;
  trames: TrameImportee[];
  caractere: CaractereTrames;
  importer: (conflit: ConflitTrames) => Promise<void>;
  annuler: () => void;
}) {
  const id = useId();
  const [conflit, setConflit] = useState<ConflitTrames>("garder");
  const [envoi, setEnvoi] = useState(false);
  const compte = (etat: TrameImportee["etat"]) => trames.filter((t) => t.etat === etat).length;
  const nom = chemin.split(/[\\/]/).pop();
  const aImporter = compte("nouvelle") + (conflit === "garder" ? 0 : compte("differente"));
  return (
    <section className="carte" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>Importer «&nbsp;{nom}&nbsp;»</h2>
      <p className="discret">
        {trames.length} trame{trames.length > 1 ? "s" : ""} dans le fichier&nbsp;: {compte("nouvelle")} nouvelle{compte("nouvelle") > 1 ? "s" : ""},{" "}
        {compte("identique")} déjà là, {compte("differente")} dont le code est pris par une autre trame.
      </p>
      <div className="defilement-tableau">
        <table className="tableau">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Titre</th>
              <th scope="col">Texte</th>
              <th scope="col">Dans votre cabinet</th>
            </tr>
          </thead>
          <tbody>
            {trames.map((t) => (
              <tr key={t.code}>
                <td className="sans-retour">
                  {caractere}
                  {t.code}
                </td>
                <td>{t.titre}</td>
                <td className="discret">{t.modele.length > 90 ? `${t.modele.slice(0, 90)}…` : t.modele}</td>
                <td>
                  <span className="etat-import-trame" data-etat={t.etat}>
                    {ETATS_IMPORT[t.etat]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compte("differente") > 0 && (
        <fieldset className="groupe">
          <legend>Quand le code est déjà pris par une autre trame</legend>
          {(
            [
              ["garder", "Garder la mienne, ignorer celle du fichier"],
              ["renommer", "Ajouter celle du fichier sous un autre code (lomb-2…)"],
              ["remplacer", "Remplacer la mienne par celle du fichier"],
            ] as const
          ).map(([valeur, libelle]) => (
            <label key={valeur} className="case-simple">
              <input type="radio" name={`${id}-conflit`} checked={conflit === valeur} onChange={() => setConflit(valeur)} />
              {libelle}
            </label>
          ))}
        </fieldset>
      )}
      <div className="rangee">
        <button
          type="button"
          className="bouton bouton-principal"
          disabled={envoi || aImporter === 0}
          onClick={() => {
            setEnvoi(true);
            void importer(conflit).finally(() => setEnvoi(false));
          }}
        >
          {aImporter === 0 ? "Rien de nouveau à importer" : `Importer ${aImporter} trame${aImporter > 1 ? "s" : ""}`}
        </button>
        <button type="button" className="bouton" onClick={annuler}>
          Annuler
        </button>
      </div>
    </section>
  );
}

const ORDRE_CATEGORIES = ["Anamnèse", "Examen", "Tests", "Traitement", "Conseils"];
const SANS_CATEGORIE = "Sans catégorie";

/** Les trames rangées par catégorie : l'ordre de la consultation d'abord, les autres par nom, puis les sans catégorie. */
export function parCategorie(trames: Trame[]): { categorie: string; trames: Trame[] }[] {
  const groupes = new Map<string, Trame[]>();
  for (const t of trames) {
    const cle = t.categorie.trim() || SANS_CATEGORIE;
    groupes.set(cle, [...(groupes.get(cle) ?? []), t]);
  }
  const rang = (c: string) => (c === SANS_CATEGORIE ? 1_000 : ORDRE_CATEGORIES.includes(c) ? ORDRE_CATEGORIES.indexOf(c) : 100);
  return [...groupes.entries()]
    .sort(([a], [b]) => rang(a) - rang(b) || a.localeCompare(b, "fr"))
    .map(([categorie, liste]) => ({ categorie, trames: liste }));
}

/** Une patiente fictive pour essayer les variables. */
const VARIABLES_ESSAI = { prenom: "Camille", nom: "Martin", age: "38 ans", date: dateEnLettres(dateDuJour()) };

export function PageTrames({ coeur }: { coeur: Coeur }) {
  const [trames, setTrames] = useState<Trame[]>([]);
  const [caractere, setCaractere] = useState<CaractereTrames>("@");
  const [recherche, setRecherche] = useState("");
  const [choisie, setChoisie] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [texteValide, setTexteValide] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [importation, setImportation] = useState<{ chemin: string; trames: TrameImportee[] } | null>(null);

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
  const groupes = useMemo(() => parCategorie(visibles), [visibles]);

  async function agir(action: () => Promise<void>) {
    setErreur(null);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setErreur((e as Error).message);
    }
  }
  const exporter = () =>
    agir(async () => {
      // Une recherche en cours : seules les trames affichées partent.
      const ids = recherche.trim() ? visibles.map((t) => t.id) : null;
      const chemin = await coeur.exporterTrames(ids);
      const nombre = ids?.length ?? trames.length;
      setMessage(`${nombre} trame${nombre > 1 ? "s" : ""} exportée${nombre > 1 ? "s" : ""} : ${chemin}`);
    });
  const choisirImport = () =>
    agir(async () => {
      const chemin = await coeur.choisirFichier("trames");
      if (!chemin) return;
      setImportation({ chemin, trames: await coeur.analyserTrames(chemin) });
    });
  const importer = (conflit: ConflitTrames) =>
    agir(async () => {
      if (!importation) return;
      const bilan = await coeur.importerTrames(importation.chemin, conflit);
      setImportation(null);
      await recharger();
      signalerTrames();
      setMessage(`Import terminé : ${bilanEnClair(bilan)}`);
    });

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
        <div className="rangee">
          <button type="button" className="bouton" onClick={() => void choisirImport()}>
            Importer…
          </button>
          <button type="button" className="bouton" onClick={() => void exporter()} disabled={visibles.length === 0}>
            {recherche.trim() ? `Exporter les ${visibles.length} affichées` : "Exporter"}
          </button>
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
      </div>
      <p className="discret">
        Les trames s’échangent en fichier entre praticiens.{" "}
        <button type="button" className="lien-bouton" onClick={() => void agir(() => coeur.ouvrirCatalogueTrames())}>
          Le catalogue de trames partagées
        </button>{" "}
        en propose d’autres, à importer.
      </p>
      {erreur && (
        <p className="alerte" role="alert">
          {erreur}
        </p>
      )}
      {message && (
        <p className="succes" role="status">
          {message}
        </p>
      )}
      {importation && (
        <ImportTrames chemin={importation.chemin} trames={importation.trames} caractere={caractere} importer={importer} annuler={() => setImportation(null)} />
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
          {groupes.map((g) => (
            <div key={g.categorie} className="pile-serree">
              <h3 className="trames-categorie">{g.categorie}</h3>
          <ul aria-label={g.categorie}>
            {g.trames.map((t) => (
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
                  {(t.origine === "importee" || t.utilisations > 0) && (
                    <span className="discret">
                      {[t.origine === "importee" && "importée", t.utilisations > 0 && `utilisée ${t.utilisations} fois`].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
            </div>
          ))}
          {visibles.length === 0 && <p className="discret">Aucune trame ne correspond.</p>}
        </section>

        <div className="pile trames-detail">
          <section className="carte" aria-labelledby="titre-essai">
            <div className="pile-serree">
              <h2 id="titre-essai">Essai en séance</h2>
              <span className="discret">
                Comme dans la fiche de séance&nbsp;: tapez {caractere}lomb, complétez, puis Valider. Rien n’est enregistré ici. Les variables
                prennent les valeurs d’une patiente fictive, Camille Martin, 38&nbsp;ans.
              </span>
            </div>
            <FournisseurVariables valeurs={VARIABLES_ESSAI}>
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
            </FournisseurVariables>
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
