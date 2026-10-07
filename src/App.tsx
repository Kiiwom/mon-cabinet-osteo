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
import { PageModeles } from "./pages/Modeles";
import { NouveauPatient } from "./pages/NouveauPatient";
import { PageParametres } from "./pages/Parametres";
import { PageCorbeille, PageSeances } from "./pages/Seances";
import { PagePatients } from "./pages/Patients";

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
  | { type: "ouvert"; cabinet: IdentiteCabinet };

export function App({ coeur = COEUR }: { coeur?: Coeur }) {
  const [phase, setPhase] = useState<Phase>({ type: "chargement" });

  useEffect(() => {
    coeur.etatDemarrage().then(
      (etat) => {
        if (etat.etat === "ouvert") setPhase({ type: "ouvert", cabinet: etat.cabinet });
        else if (etat.etat === "premier_demarrage") setPhase({ type: "premier_demarrage" });
        else if (etat.etat === "mot_de_passe_requis") setPhase({ type: "mot_de_passe" });
        else setPhase({ type: "cle_de_secours", origine: "autre_poste" });
      },
      (e: Error) => setPhase({ type: "erreur", message: e.message }),
    );
  }, [coeur]);

  const ouvrir = (cabinet: IdentiteCabinet) => {
    window.location.hash = "#/accueil";
    setPhase({ type: "ouvert", cabinet });
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
      return <CabinetOuvert cabinet={phase.cabinet} coeur={coeur} />;
  }
}

function EcranPatients({ coeur, segments }: { coeur: Coeur; segments: string[] }) {
  const [, id, suite] = segments;
  if (id === "nouveau") return <NouveauPatient key={suite ?? ""} coeur={coeur} depuisRecherche={suite} />;
  if (id) return <DossierPatient coeur={coeur} id={id} onglet={ongletDepuis(suite)} />;
  return <PagePatients coeur={coeur} />;
}

function EcranFacturation({ coeur, segments }: { coeur: Coeur; segments: string[] }) {
  const [, page, id, mode] = segments;
  if (page === "facture" && id) return <PageFacture key={`${id}-${mode ?? ""}`} coeur={coeur} id={id} mode={mode} />;
  if (page === "nouvelle") return <PageNouvelleFacture coeur={coeur} />;
  return <PageFacturation coeur={coeur} onglet={ongletFacturation(page)} />;
}

function EcranParametres({ coeur, segments }: { coeur: Coeur; segments: string[] }) {
  switch (segments[1]) {
    case "modeles":
      return <PageModeles coeur={coeur} />;
    case "cabinet":
      return <PageParametresCabinet coeur={coeur} />;
    case "facturation":
      return <PageParametresFacturation coeur={coeur} />;
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

function CabinetOuvert({ cabinet, coeur }: { cabinet: IdentiteCabinet; coeur: Coeur }) {
  const { ecran, segments } = useAdresse();
  const aFacturer = useSeancesAFacturer(coeur, segments.join("/"));
  return (
    <div className="coque">
      <BarreLaterale courant={ecran} seancesAFacturer={aFacturer} donneesReelles={coeur.reel} />
      <div className="contenu">
        {ecran === "accueil" ? (
          <Accueil cabinet={cabinet} />
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
          <EcranParametres coeur={coeur} segments={segments} />
        ) : ecran === "facturation" ? (
          <EcranFacturation coeur={coeur} segments={segments} />
        ) : ecran === "trames" ? (
          <Suspense fallback={<p className="page discret">Chargement des trames…</p>}>
            <PageTrames coeur={coeur} />
          </Suspense>
        ) : (
          <EcranAVenir titre={TITRES[ecran]} />
        )}
      </div>
    </div>
  );
}
