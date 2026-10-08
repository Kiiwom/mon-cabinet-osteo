import { useEffect, useId, useMemo, useState } from "react";

import { ficheDe } from "../antecedents/OngletAntecedents";
import type { Coeur, ContenuDossier, FichePatient, Groupe, Patient, ResumePatient } from "../lib/coeur";
import { ecrireDateFr, neLe } from "../lib/dates";
import { adresse, aller } from "../lib/navigation";
import { rechercherPatients, ressemblants } from "../lib/recherche";
import { documentDepuis, texteRiche } from "../lib/texteRiche";
import { groupesDe } from "./Groupes";

type Genre = "texte" | "long" | "riche" | "date" | "oui";
type Choix = "garde" | "autre" | "les_deux";

/** Les champs de la fiche comparés, dans l'ordre de la fiche. */
const CHAMPS: { champ: keyof FichePatient; libelle: string; genre: Genre }[] = [
  { champ: "sexe", libelle: "Sexe", genre: "texte" },
  { champ: "nom", libelle: "Nom", genre: "texte" },
  { champ: "prenom", libelle: "Prénom", genre: "texte" },
  { champ: "nom_naissance", libelle: "Nom de naissance", genre: "texte" },
  { champ: "naissance", libelle: "Date de naissance", genre: "date" },
  { champ: "portable", libelle: "Portable", genre: "texte" },
  { champ: "fixe", libelle: "Téléphone fixe", genre: "texte" },
  { champ: "email", libelle: "Email", genre: "texte" },
  { champ: "adresse", libelle: "Adresse", genre: "texte" },
  { champ: "complement_adresse", libelle: "Complément d’adresse", genre: "texte" },
  { champ: "code_postal", libelle: "Code postal", genre: "texte" },
  { champ: "ville", libelle: "Ville", genre: "texte" },
  { champ: "pays", libelle: "Pays", genre: "texte" },
  { champ: "profession", libelle: "Profession ou scolarité", genre: "texte" },
  { champ: "situation_familiale", libelle: "Situation familiale", genre: "texte" },
  { champ: "enfants", libelle: "Enfants", genre: "texte" },
  { champ: "lateralite", libelle: "Latéralité", genre: "texte" },
  { champ: "activites", libelle: "Activités", genre: "long" },
  { champ: "medecin_traitant", libelle: "Médecin traitant", genre: "texte" },
  { champ: "autres_therapeutes", libelle: "Autres thérapeutes", genre: "long" },
  { champ: "statut", libelle: "Statut", genre: "texte" },
  { champ: "consentement_le", libelle: "Consentement recueilli le", genre: "date" },
  { champ: "retraite", libelle: "Retraite", genre: "oui" },
  { champ: "mobilite_reduite", libelle: "Mobilité réduite", genre: "oui" },
  { champ: "decede", libelle: "Décès", genre: "oui" },
  { champ: "notes_importantes", libelle: "Notes importantes", genre: "long" },
  { champ: "remarques", libelle: "Remarques générales", genre: "riche" },
  { champ: "remarques_antecedents", libelle: "Remarques sur les antécédents", genre: "riche" },
];

type Valeur = FichePatient[keyof FichePatient];

const vide = (v: Valeur) => v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);

function enClair(genre: Genre, v: Valeur): string {
  if (vide(v)) return "—";
  if (genre === "oui") return "oui";
  if (genre === "date") return ecrireDateFr(v as string);
  if (genre === "riche") return texteRiche(v as string) || "—";
  if (v === "F") return "Femme";
  if (v === "M") return "Homme";
  const lisibles: Record<string, string> = { droitier: "Droitier", gaucher: "Gaucher", ambidextre: "Ambidextre" };
  return lisibles[String(v)] ?? String(v);
}

/** Deux textes mis en forme (ou deux textes simples d'avant) réunis l'un après l'autre. */
export function reunirTextes(a: string, b: string): string {
  return JSON.stringify({ type: "doc", content: [...(documentDepuis(a).content ?? []), ...(documentDepuis(b).content ?? [])] });
}

/** Ce qui diffère entre les deux fiches, et le choix proposé d'office : les deux textes longs, sinon le dossier gardé. */
export function conflits(garde: FichePatient, autre: FichePatient): Partial<Record<keyof FichePatient, Choix>> {
  const choix: Partial<Record<keyof FichePatient, Choix>> = {};
  for (const { champ, genre } of CHAMPS) {
    const [a, b] = [garde[champ], autre[champ]];
    if (genre === "oui" || vide(a) || vide(b) || JSON.stringify(a) === JSON.stringify(b)) continue;
    if (genre === "riche" && texteRiche(a as string) === texteRiche(b as string)) continue;
    choix[champ] = genre === "long" || genre === "riche" ? "les_deux" : "garde";
  }
  return choix;
}

/** La fiche du dossier fusionné : les champs vides prennent la valeur de l'autre, les conflits suivent le choix. */
export function ficheFusionnee(garde: FichePatient, autre: FichePatient, choix: Partial<Record<keyof FichePatient, Choix>>): FichePatient {
  const fiche: FichePatient = { ...garde, groupes: [...new Set([...garde.groupes, ...autre.groupes])].sort() };
  const ecrire = <K extends keyof FichePatient>(champ: K, valeur: FichePatient[K]) => {
    fiche[champ] = valeur;
  };
  for (const { champ, genre } of CHAMPS) {
    const [a, b] = [garde[champ], autre[champ]];
    if (genre === "oui") ecrire(champ, (Boolean(a) || Boolean(b)) as never);
    else if (vide(a)) ecrire(champ, b as never);
    else if (!vide(b) && choix[champ] === "autre") ecrire(champ, b as never);
    else if (!vide(b) && choix[champ] === "les_deux") ecrire(champ, (genre === "riche" ? reunirTextes(a as string, b as string) : `${String(a)}\n${String(b)}`) as never);
  }
  return fiche;
}

function ChoixAutreDossier({ coeur, patient }: { coeur: Coeur; patient: Patient }) {
  const [liste, setListe] = useState<ResumePatient[] | null>(null);
  const [texte, setTexte] = useState("");
  useEffect(() => {
    coeur.listerPatients().then(setListe, () => setListe([]));
  }, [coeur]);
  const proposes = useMemo(() => {
    if (!liste) return [];
    const autres = liste.filter((p) => p.id !== patient.id);
    if (texte.trim()) return rechercherPatients(autres, texte).slice(0, 8).map((r) => r.patient);
    return ressemblants(autres, patient, patient.id).slice(0, 8);
  }, [liste, texte, patient]);
  return (
    <section className="carte pile" aria-label="Choix de l’autre dossier">
      <p>Cherchez le dossier qui fait doublon avec celui-ci. Les dossiers qui lui ressemblent sont proposés d’abord.</p>
      <input type="search" className="saisie" aria-label="Chercher l’autre dossier" placeholder="Nom, prénom, téléphone…" value={texte} onChange={(e) => setTexte(e.target.value)} autoFocus autoComplete="off" />
      {liste === null ? (
        <p className="discret">Chargement…</p>
      ) : proposes.length === 0 ? (
        <p className="discret">{texte.trim() ? "Aucun dossier ne correspond." : "Aucun dossier ne ressemble à celui-ci : cherchez-le par son nom."}</p>
      ) : (
        <ul className="liste-doublons">
          {proposes.map((p) => (
            <li key={p.id}>
              <button type="button" className="bouton bouton-petit" onClick={() => aller("patients", patient.id, "fusion", p.id)}>
                {p.nom} {p.prenom}
              </button>
              <span className="discret">
                {[p.naissance ? neLe(p.sexe, p.naissance) : "", p.ville, `${p.seances} séance${p.seances > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const compte = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

function Comparaison({ coeur, garde, autre }: { coeur: Coeur; garde: Patient; autre: Patient }) {
  const id = useId();
  const [contenus, setContenus] = useState<[ContenuDossier, ContenuDossier] | null>(null);
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [choix, setChoix] = useState(() => conflits(ficheDe(garde), ficheDe(autre)));
  const [verifie, setVerifie] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([coeur.contenuDossier(garde.id), coeur.contenuDossier(autre.id)]).then(setContenus, (e: Error) => setErreur(e.message));
    coeur.listerGroupes().then(setGroupes, () => setGroupes([]));
  }, [coeur, garde.id, autre.id]);

  const [a, b] = [ficheDe(garde), ficheDe(autre)];
  const resultat = ficheFusionnee(a, b, choix);
  const total = contenus && {
    seances: contenus[0].seances + contenus[1].seances,
    antecedents: contenus[0].antecedents + contenus[1].antecedents,
    documents: contenus[0].documents + contenus[1].documents,
    factures: contenus[0].factures + contenus[1].factures,
  };

  async function fusionner() {
    setEnvoi(true);
    setErreur(null);
    try {
      await coeur.fusionnerDossiers(garde.id, autre.id, resultat);
      aller("patients", garde.id);
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  }

  const lignes = CHAMPS.filter(({ champ }) => !vide(a[champ]) || !vide(b[champ]));
  return (
    <div className="pile">
      <section className="carte carte-tableau" aria-labelledby={`${id}-fiche`}>
        <div className="entete-carte entete-carte-tableau">
          <h2 id={`${id}-fiche`}>Fiche du dossier fusionné</h2>
          <span className="discret">Un champ vide d’un côté prend la valeur de l’autre ; choisissez quand les deux diffèrent.</span>
        </div>
        <table className="tableau tableau-fusion">
          <thead>
            <tr>
              <th scope="col">Champ</th>
              <th scope="col">Ce dossier, gardé</th>
              <th scope="col">L’autre dossier</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(({ champ, libelle, genre }) => {
              const enConflit = choix[champ];
              const nom = `${id}-${champ}`;
              const option = (valeur: Choix, texte: string) => (
                <label className="case-simple">
                  <input type="radio" name={nom} checked={enConflit === valeur} onChange={() => setChoix({ ...choix, [champ]: valeur })} />
                  {texte}
                </label>
              );
              return (
                <tr key={champ} data-conflit={enConflit ? true : undefined}>
                  <th scope="row">{libelle}</th>
                  <td>{enConflit ? option("garde", enClair(genre, a[champ])) : <span data-garde={!vide(a[champ]) || undefined}>{enClair(genre, a[champ])}</span>}</td>
                  <td>
                    {enConflit ? (
                      <div className="pile-serree">
                        {option("autre", enClair(genre, b[champ]))}
                        {(genre === "long" || genre === "riche") && option("les_deux", "Garder les deux textes")}
                      </div>
                    ) : (
                      <span data-garde={(vide(a[champ]) && !vide(b[champ])) || undefined}>{enClair(genre, b[champ])}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {(a.groupes.length > 0 || b.groupes.length > 0) && (
              <tr>
                <th scope="row">Groupes</th>
                <td colSpan={2}>{groupesDe(resultat.groupes, groupes).map((g) => g.nom).join(", ")} (les deux dossiers réunis)</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="carte pile" aria-labelledby={`${id}-contenu`}>
        <h2 id={`${id}-contenu`}>Ce qui passe au dossier gardé</h2>
        {contenus && total ? (
          <ul className="liste-simple">
            <li>
              {compte(contenus[1].seances, "séance", "séances")} de l’autre dossier, soit {compte(total.seances, "séance", "séances")} en tout
            </li>
            <li>{compte(contenus[1].antecedents, "antécédent", "antécédents")}</li>
            <li>{compte(contenus[1].documents, "document", "documents")}</li>
            <li>{compte(contenus[1].factures, "facture ou avoir", "factures et avoirs")} : leurs numéros et leur contenu ne changent pas</li>
            <li>{compte(contenus[1].proches, "proche", "proches")}, et l’historique des modifications</li>
          </ul>
        ) : (
          <p className="discret">Chargement…</p>
        )}
        <p className="avertissement">
          L’autre dossier disparaît : la fusion ne se défait pas. Une sauvegarde récente permet de revenir en arrière si besoin.
        </p>
        <label className="case-simple">
          <input type="checkbox" checked={verifie} onChange={(e) => setVerifie(e.target.checked)} />
          J’ai vérifié qu’il s’agit du même patient
        </label>
        {erreur && (
          <p className="alerte" role="alert">
            {erreur}
          </p>
        )}
        <div className="rangee">
          <button type="button" className="bouton bouton-principal" disabled={!verifie || envoi || !contenus} onClick={() => void fusionner()}>
            Fusionner les deux dossiers
          </button>
          <a className="bouton" href={adresse("patients", autre.id, "fusion", garde.id)}>
            Garder plutôt l’autre dossier
          </a>
        </div>
      </section>
    </div>
  );
}

/** Fusion guidée de deux dossiers du même patient, avec l'aperçu de la fiche et de ce qui est déplacé. */
export function PageFusion({ coeur, id, autreId }: { coeur: Coeur; id: string; autreId?: string }) {
  const [patients, setPatients] = useState<[Patient, Patient | null] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    setPatients(null);
    Promise.all([coeur.lirePatient(id), autreId && autreId !== id ? coeur.lirePatient(autreId) : Promise.resolve(null)]).then(setPatients, (e: Error) => setErreur(e.message));
  }, [coeur, id, autreId]);

  if (erreur) {
    return (
      <main className="page">
        <p className="alerte" role="alert">
          {erreur}
        </p>
        <a href={adresse("patients")}>Revenir à la liste des patients</a>
      </main>
    );
  }
  if (!patients) return <p className="page discret">Ouverture des dossiers…</p>;
  const [garde, autre] = patients;
  return (
    <main className="page page-large">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("patients")}>Patients</a> <span aria-hidden="true">›</span>{" "}
        <a href={adresse("patients", garde.id)}>
          {garde.prenom} {garde.nom}
        </a>{" "}
        <span aria-hidden="true">›</span> Fusion
      </nav>
      <div>
        <h1 className="page-titre">Fusionner deux dossiers</h1>
        <p className="page-sous-titre">
          {autre
            ? `${garde.prenom} ${garde.nom} (gardé) et ${autre.prenom} ${autre.nom}`
            : `Le dossier de ${garde.prenom} ${garde.nom} est gardé ; tout ce que contient l’autre dossier y passe.`}
        </p>
      </div>
      {autre ? <Comparaison key={autre.id} coeur={coeur} garde={garde} autre={autre} /> : <ChoixAutreDossier coeur={coeur} patient={garde} />}
    </main>
  );
}
