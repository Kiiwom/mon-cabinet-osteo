import { Suspense, lazy, useEffect, useState } from "react";

import { BarreLaterale } from "./composants/BarreLaterale";
import { SaisieCleDeSecours, Verrouillage } from "./demarrage/EcransOuverture";
import { PremierDemarrage } from "./demarrage/PremierDemarrage";
import { coeurParDefaut, type Coeur, type IdentiteCabinet } from "./lib/coeur";
import { surFacturation } from "./lib/facturation";
import { useAdresse, type Ecran } from "./lib/navigation";
import { Accueil } from "./pages/Accueil";
import { DossierPatient, ongletDepuis } from "./pages/Dossier";
import { EcranAVenir } from "./pages/EcranAVenir";
import { ongletFacturation, PageFacturation } from "./pages/Facturation";
import { PageFacture, PageNouvelleFacture } from "./pages/Facture";
import { PageParametresCabinet, PageParametresFacturation } from "./pages/ParametresFacturation";
import { PageParametresPatients } from "./pages/ParametresPatients";
import { PageEffacement } from "./patients/Effacement";
import { PageFusion } from "./patients/Fusion";
import {
  ALERTE_SAUVEGARDE_JOURS,
  joursDepuis,
  PageJournal,
  PageParametresImportExport,
  PageParametresSauvegardes,
  PageParametresSecurite,
} from "./pages/ParametresSauvegardes";
import { PageModeles } from "./pages/Modeles";
import { NouveauPatient } from "./pages/NouveauPatient";
import { PageParametres } from "./pages/Parametres";
import { PageCorbeille, PageSeances } from "./pages/Seances";
import { PageStatistiques } from "./pages/Statistiques";
import { PagePatients } from "./pages/Patients";
import { FournisseurTrames } from "./trames/contexte";

// L'éditeur de trames est lourd : il n'est chargé qu'à l'ouverture de l'écran, pour un démarrage rapide.
const PageTrames = lazy(() => import("./pages/Trames").then((module) => ({ default: module.PageTrames })));
const PageSeance = lazy(() => import("./pages/Seance").then((module) => ({ default: module.PageSeance })));

const TITRES: Record<Exclude<Ecran, "accueil">, string> = {
  patients: "Patients",
  seances: "Séances",
  facturation: "Facturation",
  statistiques: "Statistiques",
  trames: "Trames",
  parametres: "Paramètres",
};

/** Choisi une seule fois : dans l'application, le vrai cœur ; dans un navigateur, la démonstration. */
const COEUR = coeurParDefaut();

type Phase =
  | { type: "chargement" }
  | { type: "erreur"; message: string }
  | { type: "premier_demarrage" }
  | { type: "mot_de_passe" }
  | { type: "cle_de_secours"; origine: "mot_de_passe_oublie" | "autre_poste" }
  /** `version` change après une restauration : tout l'écran est relu. */
  | { type: "ouvert"; cabinet: IdentiteCabinet; version: number };

export function App({ coeur = COEUR }: { coeur?: Coeur }) {
  const [phase, setPhase] = useState<Phase>({ type: "chargement" });

  useEffect(() => {
    coeur.etatDemarrage().then(
      (etat) => {
        if (etat.etat === "ouvert") setPhase({ type: "ouvert", cabinet: etat.cabinet, version: 0 });
        else if (etat.etat === "premier_demarrage") setPhase({ type: "premier_demarrage" });
        else if (etat.etat === "mot_de_passe_requis") setPhase({ type: "mot_de_passe" });
        else setPhase({ type: "cle_de_secours", origine: "autre_poste" });
      },
      (e: Error) => setPhase({ type: "erreur", message: e.message }),
    );
  }, [coeur]);

  const ouvrir = (cabinet: IdentiteCabinet, destination = "#/accueil") => {
    window.location.hash = destination;
    setPhase({ type: "ouvert", cabinet, version: 0 });
  };

  switch (phase.type) {
    case "chargement":
      return (
        <div className="ecran-centre" role="status">
          Ouverture du cabinet…
        </div>
      );
    case "erreur":
      return (
        <div className="ecran-centre">
          <main className="carte-centrale">
            <h1>Le cabinet ne s’ouvre pas</h1>
            <p className="alerte" role="alert">
              {phase.message}
            </p>
            <p className="discret-centre">Vos données n’ont pas été modifiées. Fermez Osteosphere et relancez-le.</p>
          </main>
        </div>
      );
    case "premier_demarrage":
      return <PremierDemarrage coeur={coeur} surOuverture={ouvrir} />;
    case "mot_de_passe":
      return (
        <Verrouillage
          coeur={coeur}
          surOuverture={ouvrir}
          utiliserCle={() => setPhase({ type: "cle_de_secours", origine: "mot_de_passe_oublie" })}
        />
      );
    case "cle_de_secours":
      return (
        <SaisieCleDeSecours
          coeur={coeur}
          surOuverture={ouvrir}
          origine={phase.origine}
          retour={phase.origine === "mot_de_passe_oublie" ? () => setPhase({ type: "mot_de_passe" }) : undefined}
        />
      );
    case "ouvert":
      return (
        <CabinetOuvert
          key={phase.version}
          cabinet={phase.cabinet}
          coeur={coeur}
          surRestauration={(cabinet) => {
            window.location.hash = "#/accueil";
            setPhase({ type: "ouvert", cabinet, version: phase.version + 1 });
          }}
          surVerrouillage={() => setPhase({ type: "mot_de_passe" })}
        />
      );
  }
}

function EcranPatients({ coeur, segments }: { coeur: Coeur; segments: string[] }) {
  const [, id, suite, autre] = segments;
  if (id === "nouveau") return <NouveauPatient key={suite ?? ""} coeur={coeur} depuisRecherche={suite} />;
  if (id && suite === "fusion") return <PageFusion key={`${id}-${autre ?? ""}`} coeur={coeur} id={id} autreId={autre} />;
  if (id && suite === "effacement") return <PageEffacement key={id} coeur={coeur} id={id} />;
  if (id) return <DossierPatient coeur={coeur} id={id} onglet={ongletDepuis(suite)} />;
  return <PagePatients coeur={coeur} />;
}

function EcranFacturation({ coeur, segments }: { coeur: Coeur; segments: string[] }) {
  const [, page, id, mode] = segments;
  if (page === "facture" && id) return <PageFacture key={`${id}-${mode ?? ""}`} coeur={coeur} id={id} mode={mode} />;
  if (page === "nouvelle") return <PageNouvelleFacture coeur={coeur} />;
  return <PageFacturation coeur={coeur} onglet={ongletFacturation(page)} />;
}

function EcranParametres({
  coeur,
  segments,
  surRestauration,
  surVerrouillage,
}: {
  coeur: Coeur;
  segments: string[];
  surRestauration: (cabinet: IdentiteCabinet) => void;
  surVerrouillage: () => void;
}) {
  switch (segments[1]) {
    case "sauvegardes":
      return <PageParametresSauvegardes coeur={coeur} surRestauration={surRestauration} />;
    case "securite":
      return <PageParametresSecurite coeur={coeur} surVerrouillage={surVerrouillage} />;
    case "import":
      return <PageParametresImportExport coeur={coeur} />;
    case "journal":
      return <PageJournal coeur={coeur} />;
    case "modeles":
      return <PageModeles coeur={coeur} />;
    case "cabinet":
      return <PageParametresCabinet coeur={coeur} />;
    case "facturation":
      return <PageParametresFacturation coeur={coeur} />;
    case "patients":
      return <PageParametresPatients coeur={coeur} />;
    default:
      return <PageParametres />;
  }
}

/** Nombre de séances à facturer, pour la barre latérale : relu à chaque changement d'écran. */
function useSeancesAFacturer(coeur: Coeur, adresse: string): number {
  const [nombre, setNombre] = useState(0);
  const [version, setVersion] = useState(0);
  useEffect(() => surFacturation(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    coeur.seancesAFacturer().then(
      (s) => setNombre(s.filter((x) => !x.facture).length),
      () => undefined,
    );
  }, [coeur, adresse, version]);
  return nombre;
}

/** État des sauvegardes pour la barre latérale : relu à chaque changement d'écran. */
function useEtatSauvegarde(coeur: Coeur, adresse: string): { texte: string; alerte: boolean } | null {
  const [etat, setEtat] = useState<{ texte: string; alerte: boolean } | null>(null);
  useEffect(() => {
    coeur.etatDesSauvegardes().then(
      (e) => {
        if (!e.derniere) return setEtat({ texte: "Aucune sauvegarde pour l’instant", alerte: true });
        const jours = joursDepuis(e.derniere.le);
        const d = new Date(e.derniere.le * 1000);
        const heure = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const texte =
          jours <= 0 && d.toDateString() === new Date().toDateString()
            ? `Sauvegarde du jour à ${heure}`
            : jours < 1
              ? `Sauvegarde d’hier à ${heure}`
              : `Dernière sauvegarde il y a ${jours} jour${jours > 1 ? "s" : ""}`;
        setEtat({ texte: e.erreur ? "Sauvegarde automatique en échec" : texte, alerte: Boolean(e.erreur) || jours > ALERTE_SAUVEGARDE_JOURS });
      },
      () => setEtat(null),
    );
  }, [coeur, adresse]);
  return etat;
}

function CabinetOuvert({
  cabinet,
  coeur,
  surRestauration,
  surVerrouillage,
}: {
  cabinet: IdentiteCabinet;
  coeur: Coeur;
  surRestauration: (cabinet: IdentiteCabinet) => void;
  surVerrouillage: () => void;
}) {
  const { ecran, segments } = useAdresse();
  const aFacturer = useSeancesAFacturer(coeur, segments.join("/"));
  const sauvegarde = useEtatSauvegarde(coeur, segments.join("/"));
  useEffect(() => {
    // Ctrl+L : verrouiller, quand un mot de passe est activé.
    const touche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        coeur.verrouiller().then(surVerrouillage, () => undefined);
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [coeur, surVerrouillage]);
  return (
    <FournisseurTrames coeur={coeur}>
      <div className="coque">
        <BarreLaterale courant={ecran} seancesAFacturer={aFacturer} donneesReelles={coeur.reel} sauvegarde={sauvegarde} />
        <div className="contenu">
          {ecran === "accueil" ? (
            <Accueil coeur={coeur} cabinet={cabinet} />
          ) : ecran === "patients" ? (
            <EcranPatients coeur={coeur} segments={segments} />
          ) : ecran === "seances" ? (
            segments[1] === "corbeille" ? (
              <PageCorbeille coeur={coeur} />
            ) : segments[1] ? (
              <Suspense fallback={<p className="page discret">Ouverture de la séance…</p>}>
                <PageSeance key={segments[1]} coeur={coeur} id={segments[1]} />
              </Suspense>
            ) : (
              <PageSeances coeur={coeur} />
            )
          ) : ecran === "parametres" ? (
            <EcranParametres coeur={coeur} segments={segments} surRestauration={surRestauration} surVerrouillage={surVerrouillage} />
          ) : ecran === "facturation" ? (
            <EcranFacturation coeur={coeur} segments={segments} />
          ) : ecran === "statistiques" ? (
            <PageStatistiques coeur={coeur} />
          ) : ecran === "trames" ? (
            <Suspense fallback={<p className="page discret">Chargement des trames…</p>}>
              <PageTrames coeur={coeur} />
            </Suspense>
          ) : (
            <EcranAVenir titre={TITRES[ecran]} />
          )}
        </div>
      </div>
    </FournisseurTrames>
  );
}
