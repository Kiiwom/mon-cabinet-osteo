-- Antécédents du patient, rangés par catégorie et rubrique, datés ou non.
-- Dates partielles admises : « 2009 », « 2009-03 » ou « 2009-03-14 ».
CREATE TABLE antecedents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  categorie TEXT NOT NULL,
  rubrique TEXT NOT NULL,
  precision TEXT NOT NULL DEFAULT '',
  debut TEXT,
  fin TEXT,
  en_cours INTEGER NOT NULL DEFAULT 0 CHECK (en_cours IN (0, 1)),
  couleur TEXT NOT NULL DEFAULT '',
  important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
  cree_le INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL
) STRICT;

CREATE INDEX antecedents_par_patient ON antecedents (patient_id);

ALTER TABLE patients ADD COLUMN remarques_antecedents TEXT NOT NULL DEFAULT '';
