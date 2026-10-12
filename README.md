# Osteosphere

Logiciel libre et gratuit de gestion de cabinet pour ostéopathes, installé sur l'ordinateur du praticien : patients, séances, trames de prise de notes, facturation, recettes et statistiques. Les fonctions dont tous les ostéopathes n'ont pas besoin (agenda, dépenses, schéma corporel, Biokinergie…) sont des modules à activer.

> **Version 0.8, phase 5 sur 6, prête pour l'essai au cabinet.** L'essai se fait sur une copie des données, en gardant l'ancien logiciel à portée de main. « Osteosphere » est un nom provisoire, à confirmer avant la V1.

## Contenu du dépôt

| Dossier | Rôle |
| --- | --- |
| `src/` | Interface en React et TypeScript, d'après les maquettes validées |
| `src-tauri/` | Application de bureau Tauri 2 (Windows et Linux, macOS ensuite) |
| `crates/osteosphere-core/` | Cœur en Rust, sans interface : ouverture du cabinet, base chiffrée, clé de secours, mot de passe facultatif, patients, antécédents, modèles de consultation, séances, trames, facturation, sauvegardes, statistiques, export, imports MonCabinetLibéral, LibreOsteo et tableur |
| `crates/osteosphere-core/examples/` | Base fictive d'un gros cabinet (10 000 patients, 50 000 séances) et mesure des temps de réponse |
| `crates/osteosphere-documents/` | Documents PDF (factures) mis en page par Typst, polices Figtree embarquées |
| `crates/osteosphere-session/` | Protection de la clé par la session : DPAPI sous Windows, trousseau de la session sous Linux |
| `crates/osteosphere-courriel/` | Email d'une facture avec le PDF joint, par la messagerie de l'ordinateur |
| `src/donnees/` | Codes postaux et communes de France, pour la complétion des adresses |
| `outils/` | Scripts qui fabriquent ces données à partir des sources officielles, et contrôle de la taille des installateurs |
| `catalogue/trames/` | Trames partagées par les praticiens, à importer dans Osteosphere ; le format y est décrit |

## Principes

- Les données restent sur le poste, dans une base SQLite chiffrée par SQLCipher. Aucune connexion sortante sans action du praticien, aucun traceur.
- Une clé de secours imprimable est remise au premier démarrage ; elle seule rouvre les sauvegardes sur un autre poste.
- Le mot de passe à l'ouverture est facultatif et désactivé par défaut. Sans lui, la clé de la base est protégée par la session de l'ordinateur : DPAPI sous Windows, trousseau de la session sous Linux (GNOME, KDE). Le logiciel s'ouvre directement et l'écran est protégé par le verrouillage du système. Sous macOS, cette protection reste à écrire.
- Avec le mot de passe, le cabinet se verrouille après un temps sans activité réglable ou par Ctrl + L : la séance en cours est enregistrée, puis la base est fermée. Un code court facultatif, de 4 à 6 chiffres, la rouvre pendant la journée ; au lancement du logiciel ou après cinq codes faux, le mot de passe est redemandé.
- Les factures suivent une numérotation continue et chronologique, commune aux factures et aux avoirs ; un brouillon n'a pas de numéro. Une facture émise ne se modifie pas : elle se corrige par un avoir et une facture rectificative, ou s'annule par un avoir. Les remboursements sont des règlements négatifs, jamais plus que ce qui a été réglé.
- Les sauvegardes sont chiffrées, et ne se rouvrent qu'avec la clé de secours ; elles se font à la fermeture, à intervalle régulier, chaque jour ou chaque semaine, seulement si quelque chose a changé. Restaurer met les données en place de côté, sans rien effacer.
- L'import depuis MonCabinetLibéral lit d'abord l'export sans rien écrire, sauvegarde le cabinet juste avant d'importer, garde les numéros de facture d'origine et ne recopie jamais deux fois la même donnée.
- Les mêmes règles valent pour LibreOsteo (patients, séances et documents joints, depuis l'archive de sa base ; ses factures restent dans LibreOsteo) et pour une liste de patients en tableur (CSV, Excel .xlsx ou LibreOffice .ods), dont chaque colonne est rapprochée d'un champ de la fiche, au choix du praticien.
- Les mises à jour ne sont recherchées qu'à la demande du praticien (Paramètres › Version et mises à jour). Une nouvelle version n'est installée que si elle porte la signature d'Osteosphere, après l'enregistrement de la saisie en cours et une sauvegarde complète ; les données ne sont pas touchées.
- L'export complet (CSV et JSON) et le journal des modifications restent consultables à tout moment ; chaque dossier a son historique.
- À la demande du patient, son dossier s'exporte en PDF ou s'efface pour de bon, historique compris ; les factures émises restent, comme la loi le demande, et un nouvel import ne fait pas revenir le dossier.
- Tests, captures, rapports de problème et pièces jointes publiques n'utilisent que des exemples fictifs.

## Installer le prototype

Chaque version poussée sur le dépôt produit ses paquets dans [l'intégration continue](https://github.com/Kiiwom/mon-cabinet-osteo/actions) : « osteosphere-windows » et « osteosphere-linux », en bas de la page d'une exécution réussie.

- **Windows 10 et 11** : lancer l'installateur `.exe`. Il ne demande pas de droits administrateur.
- **Ubuntu 24.04 et suivantes** : `sudo apt install ./Osteosphere_0.8.0_amd64.deb`, puis lancer Osteosphere depuis les applications. L'ouverture directe utilise le trousseau de la session (« Mots de passe et clés »), présent d'office sous GNOME et KDE.

Une fois installé, Osteosphere se met à jour depuis Paramètres › Version et mises à jour, à partir des versions publiées sur la [page des versions](https://github.com/Kiiwom/mon-cabinet-osteo/releases).

## Exigences mesurées

Mesures du 12 octobre 2026, sur la base fictive d'un gros cabinet : 10 000 patients et 50 000 séances sur dix ans, facturées et réglées (332 Mo chiffrés). Version optimisée, sous Linux, dans une machine virtuelle sans carte graphique : un poste réel fait au moins aussi bien.

| Exigence du cahier des charges | Cible | Mesure |
| --- | --- | --- |
| Démarrage jusqu'à l'accueil | moins de 3 s | 1,1 s jusqu'à l'écran du mot de passe, puis 0,2 à 0,6 s jusqu'à l'accueil complet |
| Recherche pendant la frappe | moins de 0,2 s | 50 à 115 ms par lettre, fautes de frappe comprises |
| Ouverture d'un dossier | moins de 1 s | 0,1 à 0,4 s |
| Volume sans ralentissement visible | 10 000 patients, 50 000 séances | liste des patients 0,45 s, statistiques de l'année 0,3 s, facturation du mois 0,2 s, séances de la semaine 0,04 s |
| Sauvegarde | aucune saisie perdue | le cabinet reste utilisable pendant la copie : il n'est retenu que 0,5 ms |
| Contrastes | WCAG 2.2 niveau AA | aucun défaut relevé par axe-core sur 26 écrans, en clair, en sombre et avec chaque couleur d'accent ; un test protège les couleurs du thème |
| Installateur | moins de 30 Mo | paquet Linux de 26,4 Mo ; la taille de chaque installateur est contrôlée à chaque compilation par l'intégration continue |

Pour refaire les mesures du cœur :

```sh
cargo run --release -p osteosphere-core --example base_fictive -- creer /tmp/cabinet-fictif
cargo run --release -p osteosphere-core --example base_fictive -- mesurer /tmp/cabinet-fictif
```

Le cabinet fictif s'ouvre aussi dans l'application, avec `OSTEOSPHERE_DOSSIER=/tmp/cabinet-fictif` et le mot de passe « mot de passe fictif ».

## Développer

Prérequis : [Node.js](https://nodejs.org) 22.22 ou plus récent, [Rust](https://rustup.rs) 1.90 ou plus récent, et les [prérequis Tauri](https://v2.tauri.app/start/prerequisites/) du système (WebView2 est déjà présent sous Windows 10 et 11).

```sh
npm install
npm run tauri dev               # l'application dans sa fenêtre
npm run dev                     # l'interface seule, dans un navigateur
npm test                        # tests de l'interface
cargo test -p osteosphere-core -p osteosphere-documents -p osteosphere-session -p osteosphere-courriel  # tests du cœur
npm run tauri build             # installateur pour le système courant
```

Le cabinet est rangé dans `%LOCALAPPDATA%\fr.pierre-besnier.osteosphere\cabinet` sous Windows et dans `~/.local/share/fr.pierre-besnier.osteosphere/cabinet` sous Linux. Pour un essai sans toucher à ce dossier, la variable `OSTEOSPHERE_DOSSIER` désigne un autre emplacement.

La première compilation est longue : SQLCipher et OpenSSL sont compilés avec le logiciel, sans rien à installer à côté. Sous Linux, les tests de `osteosphere-session` s'adressent au trousseau de la session : ils passent dans une session de bureau ordinaire ; ailleurs, les lancer dans `dbus-run-session` avec `gnome-keyring-daemon --unlock`, comme l'intégration continue.

## Publier une version

1. Monter le numéro de version dans `Cargo.toml`, `package.json` et `src-tauri/tauri.conf.json`.
2. Dans l'onglet Actions du dépôt, lancer « Publication d'une version » (bouton Run workflow).
3. Relire le brouillon créé sur la page des versions, puis le publier : les praticiens le trouvent alors dans Paramètres › Version et mises à jour.

Les installateurs sont signés pour la mise à jour en un clic. La clé privée de signature et son mot de passe sont deux secrets du dépôt, `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (Settings › Secrets and variables › Actions) ; la clé publique est dans `src-tauri/tauri.conf.json`. Une copie de la clé privée est à garder hors ligne : sans elle, les praticiens devraient réinstaller le logiciel à la main pour passer à une clé nouvelle.

## Feuille de route

1. Conception : maquettes des quatorze écrans, **terminée le 6 octobre 2026**.
2. Prototype : fenêtre Tauri, base chiffrée, trame interactive, facture PDF, version Linux, **validé le 7 octobre 2026**.
3. Socle clinique : patients, antécédents, frise de vie, séances, modèles et trames, **terminé le 7 octobre 2026**.
4. Facturation et recettes : fin de séance, factures et avoirs PDF, règlements, recettes, impayés, prestations, **terminée le 7 octobre 2026**.
5. Statistiques, sauvegardes chiffrées et restauration, sécurité, export complet, journal, import depuis MonCabinetLibéral, accueil personnalisable, **terminée le 7 octobre 2026**. Compléments du cahier des charges en neuf lots, jusqu'à la version 0.8 du 12 octobre 2026 : imports LibreOsteo et tableur, apparence, verrouillage automatique, exigences mesurées sur 10 000 patients, contrastes, mises à jour signées. **En attente de l'essai.**
6. Essai réel au cabinet sur une copie des données, puis V1.

## Version 0.4

L'ancienne application Python (version 0.4.0, nommée « Mon Cabinet d'Ostéo ») reste dans l'historique du dépôt, au commit `9e26078`. Ses règles de numérotation et d'import servent de référence à la nouvelle base.

## Licence

Osteosphere est distribué sous licence [GPL-3.0](LICENSE), version 3 ou ultérieure : toute version modifiée et redistribuée doit rester libre. La police Figtree est distribuée sous licence SIL Open Font License 1.1 ([texte](crates/osteosphere-documents/polices/OFL.txt)).

Les codes postaux et les noms des communes proviennent de la [base officielle des codes postaux](https://datanova.laposte.fr/datasets/laposte-hexasmal) de La Poste et de l'[API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif), sous [Licence Ouverte](https://www.etalab.gouv.fr/licence-ouverte-open-licence) ; `outils/codes_postaux.py` les met à jour.

Osteosphere n'est affilié à aucun autre logiciel. Les noms d'autres logiciels n'apparaissent que pour décrire la compatibilité, par exemple l'import de leurs exports.
