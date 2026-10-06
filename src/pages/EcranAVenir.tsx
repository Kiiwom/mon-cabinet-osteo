const PHASES: Record<string, string> = {
  Patients: "phase 3, socle clinique",
  Séances: "phase 3, socle clinique",
  Trames: "phase 2 pour la trame interactive, phase 3 pour la bibliothèque",
  Facturation: "phase 4, facturation et recettes",
  Statistiques: "phase 5",
  Paramètres: "phases 3 à 5, au fil des fonctions",
};

export function EcranAVenir({ titre }: { titre: string }) {
  return (
    <main className="page">
      <h1 className="page-titre">{titre}</h1>
      <section className="carte">
        <p>Cet écran suit la maquette validée ; il arrive en {PHASES[titre] ?? "phase ultérieure"}.</p>
      </section>
    </main>
  );
}
