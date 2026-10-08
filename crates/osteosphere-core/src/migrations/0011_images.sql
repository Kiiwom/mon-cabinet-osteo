-- Logo et signature imprimés sur les factures et les comptes rendus.
CREATE TABLE images (
  cle TEXT PRIMARY KEY CHECK (cle IN ('logo', 'signature')),
  type_mime TEXT NOT NULL,
  contenu BLOB NOT NULL,
  modifiee_le INTEGER NOT NULL
) STRICT;
