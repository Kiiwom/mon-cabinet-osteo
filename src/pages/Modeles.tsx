import { useEffect, useId, useState, type DragEvent } from "react";

import type { Champ, Coeur, Modele, RoleChamp, SaisieModele, TypeChamp } from "../lib/coeur";
import { completerChamp } from "../lib/coeur";
import { dateEnLettres } from "../lib/dates";
import { champDisponible, descriptionChamp, nouveauChamp, resumeProposition, TYPES_CHAMPS, TYPES_UNIQUES } from "../lib/modeles";
import { adresse } from "../lib/navigation";

type Tranche = "main" | "nourrisson" | "mineur" | "adulte" | "autre";

const TRANCHES: { valeur: Tranche; libelle: string; age_min: number | null; age_max: number | null }[] = [
  { valeur: "main", libelle: "Choisi à la main", age_min: null, age_max: null },
  { valeur: "nourrisson", libelle: "Patients de moins de 2 ans", age_min: null, age_max: 2 },
  { valeur: "mineur", libelle: "Patients de moins de 18 ans", age_min: null, age_max: 18 },
  { valeur: "adulte", libelle: "Patients de 18 ans et plus", age_min: 18, age_max: null },
  { valeur: "autre", libelle: "Autre tranche d’âge…", age_min: null, age_max: null },
];

function trancheDe(s: Pick<SaisieModele, "age_min" | "age_max">): Tranche {
  return TRANCHES.find((t) => t.valeur !== "autre" && t.age_min === s.age_min && t.age_max === s.age_max)?.valeur ?? "autre";
}

function saisieDe(m: Modele): SaisieModele {
  return { nom: m.nom, age_min: m.age_min, age_max: m.age_max, actif: m.actif, definition: m.definition };
}

const NOUVEAU: SaisieModele = {
  nom: "Nouveau modèle",
  age_min: null,
  age_max: null,
  actif: true,
  definition: { champs: [completerChamp({ id: "note", type: "texte_enrichi", libelle: "Note de séance", role: "motif" })] },
};

/** Aperçu non modifiable du champ, tel qu'il apparaîtra en séance. */
export function ApercuChamp({ champ }: { champ: Champ }) {
  const id = useId();
  switch (champ.type) {
    case "curseur": {
      const milieu = Math.round(((champ.min ?? 0) + (champ.max ?? 10)) / 2 / (champ.pas ?? 1)) * (champ.pas ?? 1);
      return (
        <div className="pile-serree">
          <label htmlFor={id}>
            {champ.libelle} · {milieu}
            {champ.max === 10 && champ.min === 0 ? "/10" : ""}
          </label>
          <input id={id} type="range" min={champ.min} max={champ.max} step={champ.pas} defaultValue={milieu} readOnly tabIndex={-1} />
        </div>
      );
    }
    case "liste":
      return (
        <div className="pile-serree">
          <label htmlFor={id}>{champ.libelle}</label>
          <select id={id} tabIndex={-1}>
            {(champ.options ?? []).map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    case "cases":
      return (
        <fieldset className="groupe-apercu">
          <legend>{champ.libelle}</legend>
          {(champ.options ?? []).map((o) => (
            <label key={o} className="case-simple">
              <input type="checkbox" tabIndex={-1} readOnly /> {o}
            </label>
          ))}
        </fieldset>
      );
    case "case_precision":
      return (
        <label className="case-simple">
          <input type="checkbox" tabIndex={-1} readOnly /> {champ.libelle}
        </label>
      );
    case "intertitre":
      return <h3>{champ.libelle}</h3>;
    case "mesures":
      return <p className="discret">Taille (cm) · Poids (kg) · IMC calculé</p>;
    case "resume_precedent":
      return <p className="discret">Le motif et les traitements de la séance précédente, en lecture.</p>;
    case "dessin":
      return <p className="discret">Dessin sur planches anatomiques : module Schéma corporel, à venir.</p>;
    default:
      return (
        <div className="pile-serree">
          <span>{champ.libelle}</span>
          <span className="apercu-zone">{champ.type === "texte_enrichi" ? `Tapez @ pour insérer une trame` : champ.type === "date" ? "JJ/MM/AAAA" : ""}</span>
        </div>
      );
  }
}

function ReglagesChamp({
  champ,
  nouveau,
  changer,
  retirer,
}: {
  champ: Champ;
  nouveau: boolean;
  changer: (c: Champ) => void;
  retirer: () => void;
}) {
  const id = useId();
  const nombre = (valeur: string) => (valeur.trim() === "" ? undefined : Number(valeur.replace(",", ".")));
  const saisissable = !["intertitre", "dessin", "resume_precedent", "mesures"].includes(champ.type);
  return (
    <section className="carte reglages-champ" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>Champ sélectionné</h2>
      <div className="champ">
        <label htmlFor={`${id}-libelle`}>Libellé</label>
        <input id={`${id}-libelle`} value={champ.libelle} onChange={(e) => changer({ ...champ, libelle: e.target.value })} />
      </div>
      <div className="champ">
        <label htmlFor={`${id}-type`}>Type</label>
        {nouveau ? (
          <select id={`${id}-type`} value={champ.type} onChange={(e) => changer(completerChamp({ ...champ, type: e.target.value as TypeChamp, options: champ.options }))}>
            {TYPES_CHAMPS.map((t) => (
              <option key={t.type} value={t.type}>
                {t.libelle}
              </option>
            ))}
          </select>
        ) : (
          <input id={`${id}-type`} value={TYPES_CHAMPS.find((t) => t.type === champ.type)?.libelle ?? champ.type} readOnly aria-describedby={`${id}-type-aide`} />
        )}
        {!nouveau && (
          <span id={`${id}-type-aide`} className="discret">
            Fixé : les séances passées gardent leurs valeurs.
          </span>
        )}
      </div>
      {champ.type === "curseur" && (
        <>
          <div className="trois-colonnes">
            {(["min", "max", "pas"] as const).map((cle) => (
              <div key={cle} className="champ">
                <label htmlFor={`${id}-${cle}`}>{cle === "min" ? "Min." : cle === "max" ? "Max." : "Pas"}</label>
                <input
                  id={`${id}-${cle}`}
                  inputMode="decimal"
                  value={champ[cle] ?? ""}
                  onChange={(e) => changer({ ...champ, [cle]: nombre(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <div className="champ">
            <label htmlFor={`${id}-role`}>Utilisé dans les statistiques comme</label>
            <select id={`${id}-role`} value={champ.role} onChange={(e) => changer({ ...champ, role: e.target.value as RoleChamp })}>
              <option value="">Rien de particulier</option>
              <option value="douleur_avant">Douleur avant la séance</option>
              <option value="douleur_apres">Douleur après la séance</option>
            </select>
          </div>
        </>
      )}
      {(champ.type === "texte_court" || champ.type === "texte_enrichi") && (
        <label className="case-simple">
          <input type="checkbox" checked={champ.role === "motif"} onChange={(e) => changer({ ...champ, role: e.target.checked ? "motif" : "" })} />
          Motif de la séance, repris dans la liste des séances
        </label>
      )}
      {(champ.type === "liste" || champ.type === "cases") && (
        <div className="champ">
          <label htmlFor={`${id}-options`}>Choix, un par ligne</label>
          <textarea
            id={`${id}-options`}
            rows={4}
            value={(champ.options ?? []).join("\n")}
            onChange={(e) => changer({ ...champ, options: e.target.value.split("\n") })}
          />
        </div>
      )}
      {champ.type === "nombre" && (
        <div className="champ">
          <label htmlFor={`${id}-unite`}>Unité</label>
          <input id={`${id}-unite`} value={champ.unite ?? ""} onChange={(e) => changer({ ...champ, unite: e.target.value })} placeholder="cm, kg, bpm…" />
        </div>
      )}
      {champ.type !== "dessin" && (
        <label className="case-simple">
          <input type="checkbox" checked={champ.imprimer} onChange={(e) => changer({ ...champ, imprimer: e.target.checked })} />
          Imprimer dans le compte rendu PDF
        </label>
      )}
      {saisissable && (
        <label className="case-simple">
          <input type="checkbox" checked={champ.obligatoire} onChange={(e) => changer({ ...champ, obligatoire: e.target.checked })} />
          Obligatoire pour terminer la séance
        </label>
      )}
      <div className="apercu-champ">
        <span className="discret">Aperçu</span>
        <ApercuChamp champ={champ} />
      </div>
      <button type="button" className="lien-bouton" onClick={retirer}>
        Retirer ce champ du modèle
      </button>
    </section>
  );
}

function nombreDeChamps(m: Pick<Modele, "definition">): string {
  const n = m.definition.champs.filter((c) => c.visible).length;
  return `${n} champ${n > 1 ? "s" : ""}`;
}

export function PageModeles({ coeur }: { coeur: Coeur }) {
  const id = useId();
  const [modeles, setModeles] = useState<Modele[] | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<SaisieModele | null>(null);
  const [champActif, setChampActif] = useState<string | null>(null);
  const [modifie, setModifie] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [glisse, setGlisse] = useState<number | null>(null);
  const [trancheAutre, setTrancheAutre] = useState(false);
  /** Modèle demandé alors que le brouillon n'est pas enregistré : on demande avant d'abandonner. */
  const [enAttente, setEnAttente] = useState<{ modele: Modele | null; importe?: SaisieModele } | null>(null);

  useEffect(() => {
    coeur.listerModeles().then(
      (liste) => {
        setModeles(liste);
        if (liste[0]) choisir(liste[0]);
      },
      (e: Error) => setErreur(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coeur]);

  const modele = modeles?.find((m) => m.id === selection) ?? null;
  const champsSauves = new Set(modele?.definition.champs.map((c) => c.id) ?? []);

  /** Ouvre un modèle enregistré, un nouveau modèle, ou celui lu dans un fichier (pas encore enregistré). */
  function choisir(m: Modele | null, abandonner = false, importe?: SaisieModele) {
    if (modifie && !abandonner) {
      setEnAttente({ modele: m, importe });
      return;
    }
    setEnAttente(null);
    setSelection(m?.id ?? null);
    const saisie = m ? saisieDe(m) : (importe ?? structuredClone(NOUVEAU));
    setBrouillon(saisie);
    setTrancheAutre(trancheDe(saisie) === "autre");
    setChampActif(saisie.definition.champs[0]?.id ?? null);
    setModifie(Boolean(importe));
    setMessage(importe ? `« ${importe.nom} » lu dans le fichier : relisez-le, puis enregistrez-le.` : null);
    setErreur(null);
  }

  if (erreur && !brouillon) return <main className="page"><p className="alerte" role="alert">{erreur}</p></main>;
  if (!modeles || !brouillon) return <p className="page discret">Chargement des modèles…</p>;

  const changer = (s: SaisieModele) => {
    setBrouillon(s);
    setModifie(true);
    setMessage(null);
  };
  const champs = brouillon.definition.champs;
  const changerChamps = (nouveaux: Champ[]) => changer({ ...brouillon, definition: { champs: nouveaux } });
  const champ = champs.find((c) => c.id === champActif) ?? null;

  const deplacer = (de: number, vers: number) => {
    if (vers < 0 || vers >= champs.length || de === vers) return;
    const copie = [...champs];
    const [pris] = copie.splice(de, 1);
    copie.splice(vers, 0, pris);
    changerChamps(copie);
  };

  const ajouter = (type: TypeChamp) => {
    const nouveau = nouveauChamp(type, champs);
    changerChamps([...champs, nouveau]);
    setChampActif(nouveau.id);
  };

  const tranche = trancheAutre ? "autre" : trancheDe(brouillon);

  async function enregistrer() {
    if (!brouillon) return;
    setErreur(null);
    const propre: SaisieModele = {
      ...brouillon,
      definition: { champs: brouillon.definition.champs.map((c) => ({ ...c, options: c.options?.map((o) => o.trim()).filter(Boolean) })) },
    };
    try {
      const enregistre = await coeur.enregistrerModele(selection, propre);
      const liste = await coeur.listerModeles();
      setModeles(liste);
      setSelection(enregistre.id);
      setBrouillon(saisieDe(enregistre));
      setModifie(false);
      setMessage(enregistre.version > (modele?.version ?? 0) ? `Modèle enregistré, version ${enregistre.version}` : "Modèle enregistré");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function importer() {
    setErreur(null);
    try {
      const chemin = await coeur.choisirFichier("modele");
      if (!chemin) return;
      const lu = await coeur.lireModeleImporte(chemin);
      // Un nom déjà pris reçoit « (importé) » : les deux modèles restent distincts.
      const pris = (nom: string) => (modeles ?? []).some((m) => m.nom.toLocaleLowerCase("fr") === nom.toLocaleLowerCase("fr"));
      choisir(null, false, { ...lu, nom: pris(lu.nom) ? `${lu.nom} (importé)` : lu.nom });
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function exporter() {
    if (!selection) return;
    setErreur(null);
    try {
      setMessage(`Modèle exporté : ${await coeur.exporterModele(selection)}`);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function parDefaut() {
    if (!selection) return;
    try {
      await coeur.definirModeleParDefaut(selection);
      setModeles(await coeur.listerModeles());
      setMessage("Modèle par défaut");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  const surDepot = (rang: number) => (e: DragEvent) => {
    e.preventDefault();
    if (glisse !== null) deplacer(glisse, rang);
    setGlisse(null);
  };

  return (
    <main className="page page-large">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> Modèles de consultation
      </nav>
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Modèles de consultation</h1>
          <p className="page-sous-titre">Les champs proposés à chaque séance, selon le patient</p>
        </div>
        <div className="rangee">
          <button type="button" className="bouton" onClick={() => void importer()}>
            Importer un modèle…
          </button>
          <button type="button" className="bouton bouton-principal" onClick={() => choisir(null)}>
            <span aria-hidden="true">+</span> Nouveau modèle
          </button>
        </div>
      </div>

      {enAttente && (
        <div className="avertissement rangee abandon" role="alert">
          <span>Les modifications de « {brouillon.nom} » ne sont pas enregistrées.</span>
          <button type="button" className="bouton" onClick={() => choisir(enAttente.modele, true, enAttente.importe)}>
            Abandonner les modifications
          </button>
          <button type="button" className="bouton" onClick={() => setEnAttente(null)}>
            Rester sur ce modèle
          </button>
        </div>
      )}

      <div className="constructeur">
        <nav className="liste-modeles" aria-label="Modèles">
          {modeles.map((m) => (
            <button
              key={m.id}
              type="button"
              className="carte-modele"
              aria-current={m.id === selection ? "true" : undefined}
              data-inactif={!m.actif}
              onClick={() => choisir(m)}
            >
              <span className="carte-modele-titre">
                <strong>{m.nom}</strong>
                {m.par_defaut && <span className="etiquette">par défaut</span>}
                {!m.actif && <span className="etiquette">désactivé</span>}
              </span>
              <span className="discret">
                {resumeProposition(m)} · {nombreDeChamps(m)}
              </span>
            </button>
          ))}
          {selection === null && (
            <button type="button" className="carte-modele" aria-current="true">
              <strong>{brouillon.nom || "Nouveau modèle"}</strong>
              <span className="discret">pas encore enregistré · {nombreDeChamps(brouillon)}</span>
            </button>
          )}
        </nav>

        <section className="carte" aria-labelledby={`${id}-titre`}>
          <h2 id={`${id}-titre`} className="lecteur-seulement">
            {brouillon.nom}
          </h2>
          <div className="champs">
            <div className="champ">
              <label htmlFor={`${id}-nom`}>Nom du modèle</label>
              <input id={`${id}-nom`} value={brouillon.nom} onChange={(e) => changer({ ...brouillon, nom: e.target.value })} />
            </div>
            <div className="champ">
              <label htmlFor={`${id}-pour`}>Proposé automatiquement pour</label>
              <select
                id={`${id}-pour`}
                value={tranche}
                onChange={(e) => {
                  const t = TRANCHES.find((x) => x.valeur === e.target.value)!;
                  setTrancheAutre(t.valeur === "autre");
                  if (t.valeur !== "autre") changer({ ...brouillon, age_min: t.age_min, age_max: t.age_max });
                }}
              >
                {TRANCHES.map((t) => (
                  <option key={t.valeur} value={t.valeur}>
                    {t.libelle}
                  </option>
                ))}
              </select>
            </div>
            {tranche === "autre" && (
              <div className="champ champ-large rangee tranche-age">
                <label>
                  À partir de{" "}
                  <input
                    inputMode="numeric"
                    value={brouillon.age_min ?? ""}
                    onChange={(e) => changer({ ...brouillon, age_min: e.target.value ? Number(e.target.value) : null })}
                    aria-label="Âge minimum, en années"
                  />{" "}
                  ans
                </label>
                <label>
                  et avant{" "}
                  <input
                    inputMode="numeric"
                    value={brouillon.age_max ?? ""}
                    onChange={(e) => changer({ ...brouillon, age_max: e.target.value ? Number(e.target.value) : null })}
                    aria-label="Âge maximum exclu, en années"
                  />{" "}
                  ans
                </label>
              </div>
            )}
          </div>

          <ol className="liste-champs" aria-label="Champs du modèle, dans l’ordre de la séance">
            {champs.map((c, rang) => {
              const disponible = champDisponible(c);
              return (
                <li
                  key={c.id}
                  className="ligne-champ"
                  aria-current={c.id === champActif ? "true" : undefined}
                  data-indisponible={!disponible}
                  data-glisse={glisse === rang}
                  draggable
                  onDragStart={() => setGlisse(rang)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={surDepot(rang)}
                  onDragEnd={() => setGlisse(null)}
                >
                  <span className="poignee" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <button type="button" className="ligne-champ-nom" onClick={() => setChampActif(c.id)}>
                    {c.libelle}
                    {!disponible && <span className="discret"> · module Schéma corporel, à venir</span>}
                  </button>
                  <span className="discret ligne-champ-type">{descriptionChamp(c)}</span>
                  <span className="ligne-champ-ordre">
                    <button type="button" className="bouton-icone" aria-label={`Monter « ${c.libelle} »`} disabled={rang === 0} onClick={() => deplacer(rang, rang - 1)}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="bouton-icone"
                      aria-label={`Descendre « ${c.libelle} »`}
                      disabled={rang === champs.length - 1}
                      onClick={() => deplacer(rang, rang + 1)}
                    >
                      ↓
                    </button>
                  </span>
                  <input
                    type="checkbox"
                    className="case-visible"
                    checked={c.visible}
                    aria-label={`Afficher « ${c.libelle} » en séance`}
                    onChange={(e) => changerChamps(champs.map((x) => (x.id === c.id ? { ...x, visible: e.target.checked } : x)))}
                  />
                </li>
              );
            })}
          </ol>

          <section className="ajout-champ" aria-labelledby={`${id}-ajout`}>
            <h3 id={`${id}-ajout`}>Ajouter un champ</h3>
            <div className="grille-types">
              {TYPES_CHAMPS.map((t) => {
                const deja = TYPES_UNIQUES.includes(t.type) && champs.some((c) => c.type === t.type);
                return (
                  <button key={t.type} type="button" className="bouton" data-module={!!t.module} disabled={deja} onClick={() => ajouter(t.type)}>
                    {t.libelle}
                    {t.module && <span className="discret"> · module</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <p className="info">
            {modele
              ? `Version ${modele.version}${modele.version_le ? ` depuis le ${dateEnLettres(new Date(modele.version_le * 1000).toISOString().slice(0, 10))}` : ""}. `
              : "Version 1 à l’enregistrement. "}
            Les séances déjà saisies gardent la version de modèle avec laquelle elles ont été écrites.
          </p>

          {erreur && (
            <p className="alerte" role="alert">
              {erreur}
            </p>
          )}
          <div className="rangee barre-actions">
            <span className="discret" role="status">
              {message ?? (modifie ? "Modifications non enregistrées" : "")}
            </span>
            <label className="case-simple">
              <input type="checkbox" checked={brouillon.actif} onChange={(e) => changer({ ...brouillon, actif: e.target.checked })} />
              Proposé en séance
            </label>
            {modele && !modele.par_defaut && modele.actif && (
              <button type="button" className="bouton" onClick={() => void parDefaut()} disabled={modifie}>
                Modèle par défaut
              </button>
            )}
            {modele && (
              <button type="button" className="bouton" onClick={() => void exporter()} disabled={modifie} title="Pour le partager avec un confrère">
                Exporter
              </button>
            )}
            <button type="button" className="bouton bouton-principal" disabled={!modifie} onClick={() => void enregistrer()}>
              Enregistrer le modèle
            </button>
          </div>
        </section>

        {champ ? (
          <ReglagesChamp
            key={champ.id}
            champ={champ}
            nouveau={!champsSauves.has(champ.id)}
            changer={(c) => changerChamps(champs.map((x) => (x.id === champ.id ? c : x)))}
            retirer={() => {
              const restants = champs.filter((x) => x.id !== champ.id);
              changerChamps(restants);
              setChampActif(restants[0]?.id ?? null);
            }}
          />
        ) : (
          <section className="carte">
            <p className="discret">Choisissez un champ pour le régler.</p>
          </section>
        )}
      </div>
    </main>
  );
}
