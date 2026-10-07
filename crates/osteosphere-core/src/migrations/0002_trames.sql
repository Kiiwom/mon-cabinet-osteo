-- Trames : textes réutilisables appelés par un code court pendant la saisie.
CREATE TABLE trames (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  titre TEXT NOT NULL,
  categorie TEXT NOT NULL DEFAULT '',
  modele TEXT NOT NULL,
  origine TEXT NOT NULL CHECK (origine IN ('depart', 'praticien')),
  utilisations INTEGER NOT NULL DEFAULT 0,
  modifiee_le INTEGER NOT NULL
) STRICT;
