import { Suspense, lazy, useEffect, useState } from "react";

import { BarreLaterale } from "./composants/BarreLaterale";
import { SaisieCleDeSecours, Verrouillage } from "./demarrage/EcransOuverture";
import { PremierDemarrage } from "./demarrage/PremierDemarrage";
import { coeurParDefaut, type Coeur, type IdentiteCabinet } from "./lib/coeur";
import { useAdresse, type Ecran } from "./lib/navigation";
import { Accueil } from "./pages/Accueil";
import { DossierPatient, ongletDepuis } from "./pages/Dossier";
import { EcranAVenir } from "./pages/EcranAVenir";
import { PageFacturation } from "./pages/Facturation";
import { PageModeles } from "./pages/Modeles";
import { NouveauPatient } from "./pages/NouveauPatient";
import { PageParametres } from "./pages/Parametres";
import { PagePatients } from "./pages/Patients";

// L'éditeur de trames est lourd : il n'est chargé qu'à l'ouverture de l'écran, pour un démarrage rapide.
const PageTrames = lazy(() => import("./pages/Trames").then((module) => ({ default: module.PageTrames })));

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

function CabinetOuvert({ cabinet, coeur }: { cabinet: IdentiteCabinet; coeur: Coeur }) {
  const { ecran, segments } = useAdresse();
  return (
    <div className="coque">
      <BarreLaterale courant={ecran} seancesAFacturer={0} donneesReelles={coeur.reel} />
      <div className="contenu">
        {ecran === "accueil" ? (
          <Accueil cabinet={cabinet} />
        ) : ecran === "patients" ? (
          <EcranPatients coeur={coeur} segments={segments} />
        ) : ecran === "parametres" ? (
          segments[1] === "modeles" ? <PageModeles coeur={coeur} /> : <PageParametres />
        ) : ecran === "facturation" ? (
          <PageFacturation coeur={coeur} />
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
