-- Facturation : prestations, factures et avoirs, règlements.
-- Une facture naît brouillon, sans numéro. Émise, elle reçoit le numéro suivant et ne change plus :
-- une correction passe par un avoir et une facture rectificative. Factures et avoirs partagent
-- la même numérotation, continue et chronologique ; les numéros de l'historique importé sont réservés.
CREATE TABLE prestations (
  id TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  libelle_imprime TEXT NOT NULL DEFAULT '',
  tarif_centimes INTEGER NOT NULL CHECK (tarif_centimes >= 0),
  couleur TEXT NOT NULL DEFAULT '',
  rang INTEGER NOT NULL DEFAULT 0,
  par_defaut INTEGER NOT NULL DEFAULT 0 CHECK (par_defaut IN (0, 1)),
  archivee INTEGER NOT NULL DEFAULT 0 CHECK (archivee IN (0, 1)),
  cree_le INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL
) STRICT;

CREATE TABLE factures (
  id TEXT PRIMARY KEY,
  nature TEXT NOT NULL CHECK (nature IN ('facture', 'avoir')),
  etat TEXT NOT NULL CHECK (etat IN ('brouillon', 'emise', 'annulee')),
  numero TEXT UNIQUE,
  annee INTEGER,
  sequence INTEGER,
  date_emission TEXT,
  patient_id TEXT REFERENCES patients (id),
  seance_id TEXT REFERENCES seances (id),
  date_seance TEXT,
  -- Destinataire, lignes et identité du cabinet au jour de l'émission : objets JSON.
  destinataire TEXT NOT NULL DEFAULT '{}',
  lignes TEXT NOT NULL DEFAULT '[]',
  total_centimes INTEGER NOT NULL DEFAULT 0,
  commentaire_imprime TEXT NOT NULL DEFAULT '',
  commentaire_interne TEXT NOT NULL DEFAULT '',
  -- Avoir : la facture qu'il annule. Facture rectificative : la facture qu'elle remplace.
  origine_id TEXT REFERENCES factures (id),
  praticien TEXT,
  importee INTEGER NOT NULL DEFAULT 0 CHECK (importee IN (0, 1)),
  cree_le INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL,
  CHECK ((etat = 'brouillon') = (numero IS NULL))
) STRICT;

CREATE INDEX factures_par_date ON factures (date_emission);
CREATE INDEX factures_par_patient ON factures (patient_id);
CREATE INDEX factures_par_compteur ON factures (annee, sequence);
CREATE INDEX factures_par_origine ON factures (origine_id);
-- Une seule facture en cours (brouillon ou émise) par séance.
CREATE UNIQUE INDEX une_facture_par_seance ON factures (seance_id)
  WHERE nature = 'facture' AND etat IN ('brouillon', 'emise');

-- Règlements : le montant est négatif pour un remboursement.
CREATE TABLE reglements (
  id TEXT PRIMARY KEY,
  facture_id TEXT NOT NULL REFERENCES factures (id),
  moyen TEXT NOT NULL CHECK (moyen IN ('especes', 'cheque', 'carte', 'virement', 'autre')),
  montant_centimes INTEGER NOT NULL CHECK (montant_centimes <> 0),
  encaisse_le TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  payeur TEXT NOT NULL DEFAULT '',
  commentaire TEXT NOT NULL DEFAULT '',
  importe INTEGER NOT NULL DEFAULT 0 CHECK (importe IN (0, 1)),
  cree_le INTEGER NOT NULL,
  modifie_le INTEGER NOT NULL
) STRICT;

CREATE INDEX reglements_par_date ON reglements (encaisse_le);
CREATE INDEX reglements_par_facture ON reglements (facture_id);
