-- Reprise depuis un autre logiciel : chaque enregistrement importé garde le lien vers sa ligne
-- d'origine, pour qu'un second import ne recopie rien. Les séances importées ne sont jamais
-- proposées « à facturer » : leur facturation a eu lieu dans l'ancien logiciel.
CREATE TABLE liens_import (
  source TEXT NOT NULL,
  nature TEXT NOT NULL,
  cle TEXT NOT NULL,
  id TEXT NOT NULL,
  importe_le INTEGER NOT NULL,
  PRIMARY KEY (source, nature, cle)
) STRICT;

ALTER TABLE seances ADD COLUMN importee INTEGER NOT NULL DEFAULT 0 CHECK (importee IN (0, 1));
