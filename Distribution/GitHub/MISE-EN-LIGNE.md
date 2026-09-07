# Mise en ligne et suite de la publication

Le dépôt public [Kiiwom/mon-cabinet-osteo](https://github.com/Kiiwom/mon-cabinet-osteo) existe. Le dossier Distribution est ajouté à la demande de l’auteur, avec l’installateur d’essai, l’archive source, les licences, les guides et les brouillons Facebook. Le README initial du dépôt est conservé.

## Ajouter ensuite le code applicatif

Cette étape est réservée à un autre échange, conformément au choix de l’auteur. Partir du dépôt existant et préserver son dossier Distribution. Ajouter les fichiers applicatifs lisibles, les tests, la licence MIT à la racine et les instructions de développement. Les sources de l’essai 0.2.0 figurent déjà dans `Sources/MonCabinetOsteo-0.2.0-sources.zip` ; elles représentent un instantané, pas nécessairement les développements ultérieurs.

Sélectionner les fichiers à publier : ne pas ajouter les bases AppData, sauvegardes, exports de cabinet, captures de travail ou paramètres privés. Ne pas recréer le dépôt et ne pas remplacer son historique.

## Après validation personnelle

1. Reconstruire la distribution depuis les sources définitives et exécuter les vérifications nécessaires. Si le logiciel a changé, employer un nouveau numéro de version et recalculer les empreintes.
2. Créer un tag correspondant exactement aux sources du paquet. Préparer une release GitHub en brouillon, marquée préversion si le logiciel reste en essai.
3. Joindre l’installateur, l’archive source, `SHA256SUMS.txt` et le guide. Adapter `NOTES-DE-VERSION.md` au périmètre et aux vérifications réellement atteints, puis publier la release lorsqu’elle est prête.
4. Mettre à jour `LIENS.md` et les liens des brouillons Facebook si les téléchargements passent du dossier Distribution aux pièces jointes d’une release.
5. Publier l’annonce Facebook seulement après les essais personnels. Aucune validation finale n’est présumée par la mise en ligne du dossier.

Pour contribuer lorsque les fichiers applicatifs sont en place : créer un fork, travailler sur une branche, exécuter les tests et proposer une pull request. Utiliser exclusivement des données fictives dans les issues, captures et tests partagés.
