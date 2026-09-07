# Vérifications du paquet Windows

Préparation vérifiée le 7 septembre 2026 sur Windows 10 x64 (10.0.19045), Python 3.12.14. Application : 0.2.0 ; diffusion préparée sous le nom `0.2.0-essai`.

## Résultats constatés

- **17 tests automatisés réussis** : dossiers, consultations, facturation, concurrence, numérotation et corrections, formulaires, PDF et email préparé, sauvegarde/restauration et altération, contrôles HTTP et import sur données fictives. Commande : `python -m unittest discover -s tests -v` dans l’environnement de construction.
- Installateur généré avec PyInstaller 6.22.2 et Inno Setup 6.7.3. Le compilateur téléchargé avait une signature Authenticode valide, éditeur Pyrsys B.V. Cette signature ne s’applique pas au logiciel produit.
- **Installation réelle et désinstallation silencieuses réussies**, dans un dossier temporaire avec espaces et accent. L’exécutable, le fichier MIT, les notices tierces et l’outil de restauration sont installés. Aucune base SQLite n’est livrée dans le dossier d’installation.
- **Application compilée exécutée directement**, sans appel à un Python externe : démonstration fictive et serveur local sur un port de test, HTML, JavaScript, CSS et icône disponibles.
- Création et émission d’une facture fictive, téléchargement d’un PDF valide et génération d’une sauvegarde chiffrée depuis l’exécutable installé.
- Réouverture du même cabinet sans second serveur et refus de réutiliser le port d’une démonstration pour un cabinet ordinaire.
- Démarrage de l’outil de restauration compilé avec `--help`. La restauration fonctionnelle est couverte par les tests Python ; la saisie interactive d’une phrase dans cet outil compilé reste à essayer manuellement.
- Après arrêt du serveur de test et désinstallation, la base fictive reste présente hors du dossier d’installation. Le dossier temporaire est ensuite nettoyé. Aucun cabinet réel n’a été utilisé.

Le script `Construction/verify_windows.py` permet de reproduire les vérifications de l’installateur avec des données temporaires. Il installe puis désinstalle le paquet sur le compte Windows courant ; à exécuter sur un poste d’essai, sans installation du logiciel à conserver.

## Portée et prochaines étapes

Les essais ci-dessus sont techniques et automatisés. L’assistant d’installation graphique et le parcours complet sur un autre ordinateur Windows 10/11 restent à vérifier par l’auteur. Ils ne remplacent pas sa validation de l’usage quotidien, des documents, de la migration de son cabinet ou de la messagerie.

L’installateur produit est **non signé**. Aucune certification tierce du logiciel, audit de sécurité ou validation réglementaire n’a été obtenu. Les fichiers de licence accordent les droits décrits, sans constituer de telles certifications.

Lors des vérifications initiales, le dépôt et les téléchargements n’étaient pas encore publiés. **Mise à jour : l’auteur a depuis créé le dépôt public Kiiwom/mon-cabinet-osteo et demandé l’ajout du dossier Distribution.** Les fichiers applicatifs à la racine seront ajoutés séparément. Aucune release GitHub ni publication Facebook n’est créée à cette étape. Les annonces de disponibilité restent des brouillons à utiliser après les essais personnels.

L’archive source est construite avec une liste de fichiers autorisés. Les bases du cabinet, sauvegardes, captures, inventaires privés et réglages locaux sont exclus. Les versions des dépendances figurent dans `Construction/requirements-build.txt`. Les empreintes de l’installateur et de l’archive sont dans `SHA256SUMS.txt`.
