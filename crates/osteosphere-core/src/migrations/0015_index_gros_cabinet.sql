-- Index pour un gros cabinet (10 000 patients, 50 000 séances) : ils portent toutes les colonnes que
-- lisent la liste des patients, les séances à facturer, les paiements en attente et les statistiques.
-- Ces requêtes n'ont plus à lire et déchiffrer chaque séance ou chaque facture de la base.
DROP INDEX seances_par_patient;
CREATE INDEX seances_par_patient ON seances (patient_id, debut, supprimee_le);
DROP INDEX seances_par_date;
CREATE INDEX seances_par_date ON seances (debut, supprimee_le, facturation);
CREATE INDEX seances_a_facturer ON seances (facturation, importee, supprimee_le, id);

CREATE INDEX factures_par_seance ON factures (seance_id, nature, etat);
CREATE INDEX factures_par_etat ON factures (etat, nature, id, total_centimes);
DROP INDEX reglements_par_facture;
CREATE INDEX reglements_par_facture ON reglements (facture_id, montant_centimes);
