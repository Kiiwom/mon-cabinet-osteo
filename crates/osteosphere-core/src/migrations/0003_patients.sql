-- Dossiers patients complets : identité, coordonnées, profil, situations particulières,
-- remarques, notes importantes, statut, consentement et archives.
-- La table du prototype n'a jamais reçu de dossier ; elle est reprise par sécurité.
CREATE TABLE patients_complets (
  id TEXT PRIMARY KEY,
  sexe TEXT NOT NULL DEFAULT '' CHECK (sexe IN ('', 'F', 'M')),
  nom TEXT NOT NULL,
  nom_naissance TEXT NOT NULL DEFAULT '',
  prenom TEXT NOT NULL,
  naissance TEXT,
  adresse TEXT NOT NULL DEFAULT '',
  complement_adresse TEXT NOT NULL DEFAULT '',
  code_postal TEXT NOT NULL DEFAULT '',
  ville TEXT NOT NULL DEFAULT '',
  pays TEXT NOT NULL DEFAULT '',
  portable TEXT NOT NULL DEFAULT '',
  fixe TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  profession TEXT NOT NULL DEFAULT '',
  retraite INTEGER NOT NULL DEFAULT 0 CHECK (retraite IN (0, 1)),
  situation_familiale TEXT NOT NULL DEFAULT '',
  enfants INTEGER CHECK (enfants IS NULL OR enfants >= 0),
  lateralite TEXT NOT NULL DEFAULT '' CHECK (lateralite IN ('', 'droitier', 'gaucher', 'ambidextre')),
  activites TEXT NOT NULL DEFAULT '',
  medecin_traitant TEXT NOT NULL DEFAULT '',
  autres_therapeutes TEXT NOT NULL DEFAULT '',
  mobilite_reduite INTEGER NOT NULL DEFAULT 0 CHECK (mobilite_reduite IN (0, 1)),
  decede INTEGER NOT NULL DEFAULT 0 CHECK (decede IN (0, 1)),
  statut TEXT NOT NULL DEFAULT '',
  notes_importantes TEXT NOT NULL DEFAULT '',
  remarques TEXT NOT NULL DEFAULT '',
  consentement_le TEXT,
  archive_le INTEGER,
  cree_le INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL
) STRICT;

INSERT INTO patients_complets (id, nom, prenom, naissance, cree_le, modifie_le)
  SELECT id, nom, prenom, naissance, 0, 0 FROM patients;
DROP TABLE patients;
ALTER TABLE patients_complets RENAME TO patients;
CREATE INDEX patients_par_nom ON patients (nom, prenom);
