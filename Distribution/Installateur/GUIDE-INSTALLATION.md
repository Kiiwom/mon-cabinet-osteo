# Installer Mon Cabinet d’Ostéo

Version d’essai 0.2.0 — Windows 10/11 64 bits x64. Construction et essais réalisés sur le poste de préparation ; la compatibilité sur un autre ordinateur reste à valider. Python et les dépendances sont inclus. Un navigateur local est nécessaire. Aucun abonnement n’est requis.

1. Ouvrir `MonCabinetOsteo-0.2.0-essai-Setup-x64.exe`.
2. Lire la notice de version d’essai et la licence, puis suivre l’assistant en français.
3. Dans le menu Démarrer, ouvrir **Démonstration — dossiers fictifs** pour les premiers essais.
4. Ouvrir **Mon Cabinet d’Ostéo** pour le cabinet. Sur un nouveau poste, il est vide ; sur un poste déjà utilisé, les données existantes sont réutilisées.
5. Renseigner les coordonnées professionnelles et les paramètres avant de préparer des documents.

L’application s’installe dans `%LOCALAPPDATA%\Programs\MonCabinetOsteo`, pour le compte Windows courant. Un raccourci de bureau est proposé en option. L’installation ne nécessite pas de droits administrateur.

## Ouverture et données

- Cabinet : `http://127.0.0.1:8765`, données dans `%LOCALAPPDATA%\MonCabinetOsteo`.
- Démonstration : `http://127.0.0.1:8766`, données dans `%LOCALAPPDATA%\MonCabinetOsteoDemo`.
- Le navigateur se connecte uniquement au serveur local. Fermer l’onglet laisse ce serveur actif jusqu’à sa fermeture ou au redémarrage de Windows.
- Pour fermer le serveur avant remplacement des fichiers, terminer le processus `MonCabinetOsteo.exe` dans le Gestionnaire des tâches après avoir vérifié la fin des enregistrements, ou redémarrer Windows.
- Une version différente déjà ouverte peut empêcher le démarrage : fermer son serveur puis relancer le raccourci.

Le dossier d’installation et l’archive source ne contiennent aucune base de cabinet. La désinstallation depuis les paramètres Windows conserve les données dans AppData. Sauvegarder avant une mise à jour ; la conservation des données ne dispense pas de sauvegarde.

## Sauvegarde et restauration

Dans Paramètres, produire une sauvegarde chiffrée `.mco` et conserver sa phrase de passe séparément.

L’outil de restauration autonome est installé dans `Restauration\RestaurerCabinet.exe`. Il s’utilise dans PowerShell, vers un **nouveau dossier vide hors de OneDrive** :

```powershell
& "$env:LOCALAPPDATA\Programs\MonCabinetOsteo\Restauration\RestaurerCabinet.exe" 'D:\Sauvegardes\cabinet.mco' "$env:LOCALAPPDATA\MonCabinetOsteoRestaure"
& "$env:LOCALAPPDATA\Programs\MonCabinetOsteo\MonCabinetOsteo.exe" --data-dir "$env:LOCALAPPDATA\MonCabinetOsteoRestaure" --port 8767
```

La phrase est demandée sans l’afficher. Vérifier le cabinet restauré dans le navigateur avant toute décision de remplacement. La restauration n’écrase pas un cabinet existant.

## Intégrité et signature

L’installateur n’est pas signé avec un certificat éditeur ; Windows peut donc afficher un avertissement. Vérifier la provenance du fichier et son empreinte avec le fichier `SHA256SUMS.txt` publié par l’auteur :

```powershell
Get-FileHash .\MonCabinetOsteo-0.2.0-essai-Setup-x64.exe -Algorithm SHA256
```

Une empreinte correspondante vérifie l’identité du fichier comparé, pas sa qualité ni une certification de sécurité.
