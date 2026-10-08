-- Pièces jointes : PDF, images et documents rattachés à un dossier, et au besoin à une séance. Le
-- contenu est rangé dans la base, donc chiffré et compris dans les sauvegardes.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  seance_id TEXT REFERENCES seances(id) ON DELETE SET NULL,
  nom TEXT NOT NULL,
  type_mime TEXT NOT NULL,
  taille INTEGER NOT NULL,
  contenu BLOB NOT NULL,
  ajoute_le INTEGER NOT NULL,
  supprime_le INTEGER
) STRICT;

CREATE INDEX documents_par_patient ON documents (patient_id);
CREATE INDEX documents_par_seance ON documents (seance_id);
