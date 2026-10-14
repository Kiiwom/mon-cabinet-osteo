-- Groupes de patients, colorés, utilisables comme filtres : une famille, un club, une entreprise…
-- Un patient peut appartenir à plusieurs groupes.
CREATE TABLE groupes (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  couleur TEXT NOT NULL DEFAULT 'bleu',
  cree_le INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX groupes_par_nom ON groupes (nom COLLATE NOCASE);

CREATE TABLE patients_groupes (
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  groupe_id TEXT NOT NULL REFERENCES groupes (id) ON DELETE CASCADE,
  PRIMARY KEY (patient_id, groupe_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX patients_par_groupe ON patients_groupes (groupe_id);
