-- Séances : écrites avec une version précise d'un modèle de consultation.
-- Les valeurs des champs sont un objet JSON, clé du champ → valeur.
-- Une séance supprimée part 30 jours à la corbeille avant d'être effacée.
CREATE TABLE seances (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id),
  debut TEXT NOT NULL,
  modele_id TEXT NOT NULL REFERENCES modeles (id),
  modele_version INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'suivi' CHECK (type IN ('premiere', 'suivi', 'urgence')),
  titre TEXT NOT NULL DEFAULT '',
  importante INTEGER NOT NULL DEFAULT 0 CHECK (importante IN (0, 1)),
  valeurs TEXT NOT NULL DEFAULT '{}',
  facturation TEXT NOT NULL DEFAULT 'a_facturer' CHECK (facturation IN ('a_facturer', 'gratuit')),
  commentaire_gratuit TEXT NOT NULL DEFAULT '',
  supprimee_le INTEGER,
  cree_le INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL,
  FOREIGN KEY (modele_id, modele_version) REFERENCES versions_modeles (modele_id, version)
) STRICT;

CREATE INDEX seances_par_patient ON seances (patient_id, debut);
CREATE INDEX seances_par_date ON seances (debut);
