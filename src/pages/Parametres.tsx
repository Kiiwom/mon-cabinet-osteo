import { adresse } from "../lib/navigation";

const RUBRIQUES: { titre: string; detail: string; lien: string }[] = [
  { titre: "Cabinet et mentions légales", detail: "Identité, mentions, logo, signature : l’en-tête et le pied de vos documents.", lien: adresse("parametres", "cabinet") },
  { titre: "Prestations et numérotation", detail: "Vos actes, leurs tarifs, le numéro de vos factures, l’email d’envoi.", lien: adresse("parametres", "facturation") },
  { titre: "Modèles de consultation", detail: "Les champs proposés à chaque séance, selon le patient.", lien: adresse("parametres", "modeles") },
  { titre: "Statuts et groupes", detail: "Le statut des patients et les groupes colorés qui filtrent la liste.", lien: adresse("parametres", "patients") },
  { titre: "Trames", detail: "Textes réutilisables appelés par un code pendant la saisie.", lien: adresse("trames") },
  { titre: "Saisie et dossier", detail: "Fin des mots proposée pendant la frappe, séances du dossier regroupées par année.", lien: adresse("parametres", "saisie") },
  { titre: "Sauvegardes", detail: "Fréquence, dossier, sauvegarde à la demande, restauration.", lien: adresse("parametres", "sauvegardes") },
  { titre: "Sécurité et mot de passe", detail: "Mot de passe facultatif, verrouillage, clé de secours.", lien: adresse("parametres", "securite") },
  { titre: "Apparence", detail: "Thème clair ou sombre, couleur d’accent, taille du texte, écran tactile.", lien: adresse("parametres", "apparence") },
  { titre: "Import et export", detail: "Reprise depuis MonCabinetLibéral, export complet.", lien: adresse("parametres", "import") },
  { titre: "Journal des modifications", detail: "Chaque création, modification et suppression, datée.", lien: adresse("parametres", "journal") },
  { titre: "Modules", detail: "Agenda, dépenses, schéma corporel, Biokinergie… : prévus après la version 1.", lien: adresse("parametres", "modules") },
];

/** Entrée des paramètres : une carte par rubrique. */
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
            <a href={r.lien} className="carte rubrique-parametre">
              <strong>{r.titre}</strong>
              <span className="discret">{r.detail}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
