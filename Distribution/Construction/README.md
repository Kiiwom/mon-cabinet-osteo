# Reconstruire sous Windows x64

Python 3.12 x64 et Inno Setup 6.7.3 ont servi à cette préparation. Installer Inno Setup depuis https://jrsoftware.org/isdl.php et vérifier la signature de son installateur. Le produit généré n’est pas signé automatiquement.

Depuis la racine des sources, créer un environnement dédié, puis utiliser les versions exactes conservées dans `requirements-build.txt` :

```powershell
python -m venv .build-distribution/venv
& ./.build-distribution/venv/Scripts/python.exe -m pip install -r Distribution/Construction/requirements-build.txt
& ./.build-distribution/venv/Scripts/python.exe -m unittest discover -s tests -v
& ./.build-distribution/venv/Scripts/python.exe Distribution/Construction/build.py --iscc 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
```

Adapter le chemin de `ISCC.exe` à votre installation. Le script compile l’application et l’outil de restauration, collecte les notices des dépendances, génère l’installateur, sélectionne les sources et calcule les SHA-256. Une connexion est nécessaire pour installer les dépendances de construction, mais pas pour utiliser le logiciel installé.

Les sources sont sélectionnées par une liste autorisée dans `build.py`. La base AppData, les sauvegardes, captures, réglages Obsidian, outils téléchargés et inventaires de travail ne sont pas incorporés. `Sources/MANIFESTE.json` contient la liste des fichiers et leurs empreintes.

Le lanceur Windows est distinct de `lancer.py`, qui conserve son rôle de lancement depuis les sources. Il accepte aussi `--demo`, `--no-browser`, `--data-dir` et `--port` pour les vérifications dans un dossier isolé. Ne pas utiliser les données réelles pour les tests.

Après une modification des sources, relancer la construction complète et les vérifications nécessaires. `--archive-only` sert uniquement à actualiser la documentation du paquet après les vérifications ; il ne reconstruit pas l’exécutable. Un environnement et des versions figés facilitent la reconstruction, sans garantir des binaires identiques octet pour octet.
