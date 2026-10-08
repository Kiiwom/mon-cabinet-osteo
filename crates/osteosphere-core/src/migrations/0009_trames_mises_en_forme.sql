-- Trames mises en forme : le document de l'éditeur (titres, listes, gras…) à côté du texte brut, qui
-- garde la syntaxe des choix et des blancs pour la recherche et la vérification.
ALTER TABLE trames ADD COLUMN contenu TEXT;
