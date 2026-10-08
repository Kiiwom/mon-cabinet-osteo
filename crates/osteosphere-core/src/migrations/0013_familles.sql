-- Liens familiaux entre dossiers : chaque lien est inscrit dans les deux sens. `lien` dit ce que
-- le proche est pour le patient : son parent, son enfant, son conjoint, son frère ou sa sœur.
CREATE TABLE liens_familiaux (
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  proche_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  lien TEXT NOT NULL CHECK (lien IN ('parent', 'enfant', 'conjoint', 'fratrie')),
  PRIMARY KEY (patient_id, proche_id),
  CHECK (patient_id <> proche_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX liens_par_proche ON liens_familiaux (proche_id);

-- Le proche qui reçoit les factures du patient (un parent pour son enfant), sinon le patient.
ALTER TABLE patients ADD COLUMN factures_a TEXT REFERENCES patients (id) ON DELETE SET NULL;
