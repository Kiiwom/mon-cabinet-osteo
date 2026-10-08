import { adresse } from "../lib/navigation";

const RUBRIQUES: { titre: string; detail: string; lien?: string }[] = [
  { titre: "Cabinet et mentions légales", detail: "Identité, mentions, logo, signature : l’en-tête et le pied de vos documents.", lien: adresse("parametres", "cabinet") },
  { titre: "Prestations et numérotation", detail: "Vos actes, leurs tarifs, le numéro de vos factures, l’email d’envoi.", lien: adresse("parametres", "facturation") },
  { titre: "Modèles de consultation", detail: "Les champs proposés à chaque séance, selon le patient.", lien: adresse("parametres", "modeles") },
  { titre: "Trames", detail: "Textes réutilisables appelés par un code pendant la saisie.", lien: adresse("trames") },
  { titre: "Sauvegardes", detail: "Fréquence, dossier, sauvegarde à la demande, restauration.", lien: adresse("parametres", "sauvegardes") },
  { titre: "Sécurité et mot de passe", detail: "Mot de passe facultatif, verrouillage, clé de secours.", lien: adresse("parametres", "securite") },
  { titre: "Import et export", detail: "Reprise depuis MonCabinetLibéral, export complet.", lien: adresse("parametres", "import") },
  { titre: "Journal des modifications", detail: "Chaque création, modification et suppression, datée.", lien: adresse("parametres", "journal") },
  { titre: "Modules", detail: "Agenda, dépenses, schéma corporel, Biokinergie…" },
];

/** Entrée des paramètres : les rubriques prêtes sont des liens, les autres arrivent avec les phases suivantes. */
export function PageParametres() {
  return (
    <main className="page">
      <div>
        <h1 className="page-titre">Paramètres</h1>
        <p className="page-sous-titre">Réglages du cabinet et de la saisie</p>
      </div>
      <ul className="rubriques-parametres">
        {RUBRIQUES.map((r) => (
          <li key={r.titre}>
            {r.lien ? (
              <a href={r.lien} className="carte rubrique-parametre">
                <strong>{r.titre}</strong>
                <span className="discret">{r.detail}</span>
              </a>
            ) : (
              <div className="carte rubrique-parametre" data-a-venir="true">
                <strong>{r.titre}</strong>
                <span className="discret">{r.detail}</span>
                <span className="etiquette">à venir</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
