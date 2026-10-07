# Osteosphere

Logiciel libre et gratuit de gestion de cabinet pour ostéopathes, installé sur l'ordinateur du praticien : patients, séances, trames de prise de notes, facturation, recettes et statistiques. Les fonctions dont tous les ostéopathes n'ont pas besoin (agenda, dépenses, schéma corporel, Biokinergie…) sont des modules à activer.

> **Prototype, phase 2 sur 6.** Ne pas l'utiliser avec de vraies données de patients. « Osteosphere » est un nom provisoire, à confirmer avant la V1.

## Contenu du dépôt

| Dossier | Rôle |
| --- | --- |
| `src/` | Interface en React et TypeScript, d'après les maquettes validées |
| `src-tauri/` | Application de bureau Tauri 2 (Windows d'abord, macOS et Linux ensuite) |
| `crates/osteosphere-core/` | Cœur en Rust, sans interface : ouverture du cabinet, base chiffrée, clé de secours, mot de passe facultatif, numérotation des factures |
| `crates/osteosphere-documents/` | Documents PDF (factures) mis en page par Typst, polices Figtree embarquées |
| `crates/osteosphere-session/` | Protection de la clé par la session Windows (DPAPI) |

## Principes

- Les données restent sur le poste, dans une base SQLite chiffrée par SQLCipher. Aucune connexion sortante sans action du praticien, aucun traceur.
- Une clé de secours imprimable est remise au premier démarrage ; elle seule rouvre les sauvegardes sur un autre poste.
- Le mot de passe à l'ouverture est facultatif et désactivé par défaut. Sans lui, la clé de la base est protégée par la session Windows (DPAPI) : le logiciel s'ouvre directement et l'écran est protégé par le verrouillage de Windows. Sous macOS et Linux, cette protection reste à écrire.
- Les factures suivent une numérotation continue et chronologique ; une facture émise ne se modifie pas, elle se corrige par un avoir.
- Tests, captures, rapports de problème et pièces jointes publiques n'utilisent que des exemples fictifs.

## Développer

Prérequis : [Node.js](https://nodejs.org) 22.22 ou plus récent, [Rust](https://rustup.rs) 1.90 ou plus récent, et les [prérequis Tauri](https://v2.tauri.app/start/prerequisites/) du système (WebView2 est déjà présent sous Windows 10 et 11).

```sh
npm install
npm run tauri dev               # l'application dans sa fenêtre
npm run dev                     # l'interface seule, dans un navigateur
npm test                        # tests de l'interface
cargo test -p osteosphere-core -p osteosphere-documents -p osteosphere-session  # tests du cœur
npm run tauri build             # installateur pour le système courant
```

Le cabinet est rangé dans `%LOCALAPPDATA%\fr.pierre-besnier.osteosphere\cabinet`. Pour un essai sans toucher à ce dossier, la variable `OSTEOSPHERE_DOSSIER` désigne un autre emplacement.

Sous Windows, l'installateur ne demande pas de droits administrateur. La première compilation est longue : SQLCipher et OpenSSL sont compilés avec le logiciel, sans rien à installer à côté.

## Feuille de route

1. Conception : maquettes des quatorze écrans, **terminée le 6 octobre 2026**.
2. Prototype : fenêtre Tauri, base chiffrée, trame interactive, facture PDF, **terminé le 7 octobre 2026, en attente de validation des choix techniques**.
3. Socle clinique : patients, antécédents, frise de vie, séances, modèles et trames.
4. Facturation et recettes : factures, avoirs, moyens de paiement, journal et export.
5. Statistiques, sauvegardes et import depuis MonCabinetLibéral.
6. Essai réel au cabinet sur une copie des données, puis V1.

## Version 0.4

L'ancienne application Python (version 0.4.0, nommée « Mon Cabinet d'Ostéo ») reste dans l'historique du dépôt, au commit `9e26078`. Ses règles de numérotation et d'import servent de référence à la nouvelle base.

## Licence

Osteosphere est distribué sous licence [GPL-3.0](LICENSE), version 3 ou ultérieure : toute version modifiée et redistribuée doit rester libre. La police Figtree est distribuée sous licence SIL Open Font License 1.1 ([texte](crates/osteosphere-documents/polices/OFL.txt)).

Osteosphere n'est affilié à aucun autre logiciel. Les noms d'autres logiciels n'apparaissent que pour décrire la compatibilité, par exemple l'import de leurs exports.
