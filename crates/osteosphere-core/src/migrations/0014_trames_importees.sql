-- Trames importées d'un fichier d'échange : une troisième origine. SQLite ne modifie pas une
-- contrainte : la table est recopiée.
CREATE TABLE trames_nouvelles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  titre TEXT NOT NULL,
  categorie TEXT NOT NULL DEFAULT '',
  modele TEXT NOT NULL,
  origine TEXT NOT NULL CHECK (origine IN ('depart', 'praticien', 'importee')),
  utilisations INTEGER NOT NULL DEFAULT 0,
  modifiee_le INTEGER NOT NULL,
  contenu TEXT
) STRICT;
INSERT INTO trames_nouvelles (id, code, titre, categorie, modele, origine, utilisations, modifiee_le, contenu)
  SELECT id, code, titre, categorie, modele, origine, utilisations, modifiee_le, contenu FROM trames;
DROP TABLE trames;
ALTER TABLE trames_nouvelles RENAME TO trames;
