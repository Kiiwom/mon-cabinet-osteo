-- Schéma initial du prototype. Les tables cliniques complètes arrivent en phase 3.

CREATE TABLE parametres (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
) STRICT;

CREATE TABLE patients (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  naissance TEXT,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL
) STRICT;

-- Journal des modifications : chaque création, modification et suppression est datée.
CREATE TABLE journal (
  id INTEGER PRIMARY KEY,
  le TEXT NOT NULL,
  action TEXT NOT NULL,
  entite TEXT NOT NULL,
  avant TEXT,
  apres TEXT
) STRICT;
