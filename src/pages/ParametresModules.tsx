import { useId } from "react";

import { adresse } from "../lib/navigation";
import { FAMILLES, MODULES_PREVUS, nomDuModule } from "../lib/modules";

/** Paramètres › Modules : ce qui viendra s'ajouter au socle, rangé par famille. */
export function PageParametresModules() {
  const id = useId();
  return (
    <main className="page">
      <nav className="fil" aria-label="Fil d’Ariane">
        <a href={adresse("parametres")}>Paramètres</a> <span aria-hidden="true">›</span> Modules
      </nav>
      <div className="entete-page">
        <div>
          <h1 className="page-titre">Modules</h1>
          <p className="page-sous-titre">
            Le socle (patients, séances, facturation, statistiques, sauvegardes) est toujours présent. Les modules s’y ajoutent, chacun selon votre pratique.
          </p>
        </div>
      </div>
      <p className="info">
        Aucun module n’est encore disponible&nbsp;: les {MODULES_PREVUS.length} ci-dessous arriveront après la version&nbsp;1, dans l’ordre fixé par les retours des premiers
        utilisateurs. Chacun s’activera ici. Désactiver un module masquera ses écrans et ses champs sans effacer ses données&nbsp;: elles réapparaîtront s’il est réactivé.
      </p>
      {FAMILLES.map((famille) => (
        <section key={famille.id} className="pile" aria-labelledby={`${id}-${famille.id}`}>
          <h2 id={`${id}-${famille.id}`}>{famille.nom}</h2>
          <ul className="grille-modules">
            {MODULES_PREVUS.filter((m) => m.famille === famille.id).map((m) => (
              <li key={m.id} className="carte carte-module">
                <div className="carte-module-haut">
                  <strong>{m.nom}</strong>
                  <span className="etiquette">prévu</span>
                </div>
                <p>{m.description}</p>
                <p className="discret">Ajoutera&nbsp;: {m.ajoute.charAt(0).toLowerCase() + m.ajoute.slice(1)}.</p>
                {(m.exige || m.internet) && (
                  <ul className="contraintes-module">
                    {m.exige && <li>Nécessite le module {nomDuModule(m.exige)}</li>}
                    {m.internet && <li>Connexion internet, seulement pour l’envoi</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="carte pile" aria-labelledby={`${id}-communaute`}>
        <h2 id={`${id}-communaute`}>Modules de la communauté</h2>
        <p className="discret">
          Un module écrit par un autre ostéopathe est relu avant d’être intégré au logiciel, puis livré avec une mise à jour, comme le reste. Avant de
          l’activer, Osteosphere affichera ce qu’il peut lire et modifier dans vos données.
        </p>
      </section>
    </main>
  );
}
