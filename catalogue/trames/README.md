# Catalogue de trames partagées

Des trames écrites par des praticiens, prêtes à importer dans Osteosphere : **Trames › Importer…**,
puis le fichier `.json` choisi. Avant d’importer, Osteosphere montre chaque trame du fichier et dit
si elle est nouvelle, déjà là, ou si son code est pris par une autre de vos trames. Dans ce dernier
cas, vous choisissez de garder la vôtre, de la remplacer ou d’ajouter celle du fichier sous un
autre code (`lomb-2`).

| Fichier | Contenu |
| --- | --- |
| [bibliotheque-de-depart.json](bibliotheque-de-depart.json) | Les trames installées avec Osteosphere : anamnèse, examen, tests, traitement, conseils |

## Partager vos trames

1. Dans Osteosphere, **Trames › Exporter** : le fichier part dans Documents › Osteosphere › Exports.
   Une recherche en cours n’exporte que les trames affichées.
2. Relisez-le : une trame ne doit contenir **aucune donnée de patient**. Les variables
   `{{prénom}}`, `{{nom}}`, `{{âge}}` et `{{date}}` se remplissent à l’insertion, elles ne
   contiennent rien dans le fichier.
3. Proposez-le dans ce dossier par une demande de fusion (pull request), avec un nom qui dit son
   contenu : `pediatrie.json`, `sport.json`…

## Format

Un fichier JSON, lisible et modifiable dans un éditeur de texte :

```json
{
  "format": "osteosphere.trames",
  "version": 1,
  "trames": [
    {
      "code": "lomb",
      "titre": "Douleur lombaire",
      "categorie": "Anamnèse",
      "modele": "Douleur lombaire {droite | gauche | bilatérale}, depuis [durée].",
      "contenu": null
    }
  ]
}
```

- `code` : lettres sans accent, chiffres ou tirets, 20 au plus ; il s’appelle par `@code` ou `/code`.
- `modele` : le texte, avec `{a | b}` choix unique, `{+ a | b}` choix multiple, `[indication]` blanc
  à compléter, `{{prénom}}` variable ; `\{`, `\}`, `\[`, `\]`, `\|` et `\\` écrivent ces caractères.
- `contenu` : le texte mis en forme (gras, titres, listes) tel que l’éditeur l’enregistre, ou `null`.
