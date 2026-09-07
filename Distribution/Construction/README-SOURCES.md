# Mon Cabinet d’Ostéo

Logiciel local de gestion de cabinet pour ostéopathes : dossiers patients, notes de consultation, factures PDF, règlements, documents et sauvegardes chiffrées.

**Version d’essai 0.2.0 pour Windows x64.** Commencez par la démonstration avec ses dossiers fictifs. Cette version reste en cours de validation et l’installateur n’est pas signé.

## Télécharger

- [Installateur Windows x64](https://github.com/Kiiwom/mon-cabinet-osteo/raw/refs/heads/main/Distribution/Installateur/MonCabinetOsteo-0.2.0-essai-Setup-x64.exe)
- [Guide d’installation et de restauration](https://github.com/Kiiwom/mon-cabinet-osteo/blob/main/Distribution/Installateur/GUIDE-INSTALLATION.md)
- [Code source de la version 0.2.0](https://github.com/Kiiwom/mon-cabinet-osteo/raw/refs/heads/main/Distribution/Sources/MonCabinetOsteo-0.2.0-sources.zip)
- [Empreintes SHA-256](https://github.com/Kiiwom/mon-cabinet-osteo/blob/main/Distribution/SHA256SUMS.txt)

L’installateur inclut Python et ses dépendances. L’interface s’ouvre dans votre navigateur et communique avec un serveur sur votre ordinateur. Les données sont conservées dans AppData ; la démonstration utilise un dossier distinct.

## Utiliser les sources

Extraire l’archive source, installer Python 3.12 x64, puis lancer les commandes suivantes depuis le dossier extrait :

```powershell
python -m venv .venv
& ./.venv/Scripts/python.exe -m pip install -r requirements.txt
& ./.venv/Scripts/python.exe lancer.py --demo
& ./.venv/Scripts/python.exe -m unittest discover -s tests -v
```

Les instructions de reconstruction de l’installateur se trouvent dans `Distribution/Construction/README.md`. Les sources de l’application sont disponibles dans l’archive ; leur ajout directement au dépôt est à venir.

## Licence et contributions

Le code original est sous [licence MIT](https://github.com/Kiiwom/mon-cabinet-osteo/blob/main/LICENSE). Vous pouvez l’utiliser, le copier, le modifier et le redistribuer en conservant les notices. Les [licences des dépendances](https://github.com/Kiiwom/mon-cabinet-osteo/tree/main/Distribution/Licences) sont également fournies.

Pour signaler un problème, ouvrir une [issue](https://github.com/Kiiwom/mon-cabinet-osteo/issues) avec la version utilisée et les étapes de reproduction. Utiliser uniquement des exemples fictifs, sans données de patients.
