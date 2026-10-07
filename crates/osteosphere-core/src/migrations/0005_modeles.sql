-- Modèles de consultation et leurs versions : une séance garde la version avec laquelle
-- elle a été écrite ; modifier un modèle ne change pas le passé.
CREATE TABLE modeles (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  age_min INTEGER,
  age_max INTEGER,
  par_defaut INTEGER NOT NULL DEFAULT 0 CHECK (par_defaut IN (0, 1)),
  actif INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
  origine TEXT NOT NULL CHECK (origine IN ('fourni', 'praticien')),
  ordre INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL
) STRICT;

CREATE TABLE versions_modeles (
  modele_id TEXT NOT NULL REFERENCES modeles (id),
  version INTEGER NOT NULL,
  definition TEXT NOT NULL,
  cree_le INTEGER NOT NULL,
  PRIMARY KEY (modele_id, version)
) STRICT;
