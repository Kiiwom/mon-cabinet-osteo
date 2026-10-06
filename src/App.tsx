import { BarreLaterale } from "./composants/BarreLaterale";
import { useEcranCourant, type Ecran } from "./lib/navigation";
import { Accueil } from "./pages/Accueil";
import { EcranAVenir } from "./pages/EcranAVenir";

const TITRES: Record<Exclude<Ecran, "accueil">, string> = {
  patients: "Patients",
  seances: "Séances",
  facturation: "Facturation",
  statistiques: "Statistiques",
  trames: "Trames",
  parametres: "Paramètres",
};

export function App() {
  const ecran = useEcranCourant();
  return (
    <div className="coque">
      <BarreLaterale courant={ecran} seancesAFacturer={0} />
      <div className="contenu">{ecran === "accueil" ? <Accueil /> : <EcranAVenir titre={TITRES[ecran]} />}</div>
    </div>
  );
}
