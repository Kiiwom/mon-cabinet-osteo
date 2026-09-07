# Mon Cabinet d’Ostéo

Logiciel libre et gratuit de gestion de cabinet pour ostéopathes. L’application fonctionne sur l’ordinateur du praticien, dans un navigateur, avec une base SQLite locale.

**Sources actuelles : version 0.4.0.** L’installateur Windows et l’archive déjà disponibles dans [Distribution](Distribution/README.md) correspondent à la version d’essai **0.2.0**. Ils ne contiennent pas les évolutions 0.3.0 et 0.4.0.

## Télécharger l’essai Windows 0.2.0

- [Installateur Windows x64](https://github.com/Kiiwom/mon-cabinet-osteo/raw/refs/heads/main/Distribution/Installateur/MonCabinetOsteo-0.2.0-essai-Setup-x64.exe)
- [Guide d’installation](Distribution/Installateur/GUIDE-INSTALLATION.md)
- [Archive source 0.2.0](https://github.com/Kiiwom/mon-cabinet-osteo/raw/refs/heads/main/Distribution/Sources/MonCabinetOsteo-0.2.0-sources.zip)
- [Empreintes SHA-256 des téléchargements](Distribution/SHA256SUMS.txt)

## Démarrer depuis les sources

Installer Python 3.12 ou ultérieur, puis cloner ou télécharger ce dépôt. Depuis son dossier, sous Windows :

```powershell
python -m venv .venv
& ./.venv/Scripts/python.exe -m pip install -r requirements.txt
& ./.venv/Scripts/python.exe lancer.py --demo
```

La démonstration ouvre <http://127.0.0.1:8766> avec des dossiers fictifs. Pour ouvrir un cabinet séparé :

```powershell
& ./.venv/Scripts/python.exe lancer.py
```

Le cabinet s’ouvre sur <http://127.0.0.1:8765>. Après installation des dépendances, les fichiers `Ouvrir mon cabinet.cmd` et `Ouvrir la demonstration.cmd` utilisent l’environnement `.venv` s’il existe, sinon le Python disponible dans le PATH.

Sur macOS ou Linux, utiliser `.venv/bin/python` à la place de `.venv/Scripts/python.exe`.

## Fonctions disponibles

- Dossiers patients, recherche et archives.
- Motif de consultation, anamnèse, notes et antécédents partagés, champs personnalisés et sauvegarde automatique.
- Interrupteur **Facturer**, brouillons, numérotation annuelle, paiements et factures PDF.
- Correction des factures locales avec avoir et document de remplacement.
- Documents joints localement, comptes rendus PDF et sauvegardes chiffrées.
- Import d’un export MonCabinetLibéral : dossiers, notes, antécédents et historique comptable ; affichage des consultations sans rattachement.
- Corrections des règlements et documents importés, exclusions réversibles, historique des modifications et export des règlements retenus.

L’email de facture est préparé sous forme de fichier `.eml` avec son PDF ; son envoi passe par la messagerie de l’utilisateur. Les statistiques mensuelles de recettes locales restent distinctes du journal des règlements historiques importés. L’agenda et la fusion de dossiers restent à développer.

## Comptabilité importée

Dans **Facturation**, ouvrir un document pour modifier ses règlements, ou utiliser le journal **Règlements retenus** avec la recherche et les filtres.

**Modifier** permet de corriger le montant, la date de paiement, la date d’encaissement, le moyen et le commentaire. La case **Comptabiliser ce règlement** détermine sa prise en compte. **Supprimer** l’exclut des totaux et de l’export corrigé ; **Rétablir** annule cette exclusion. Les modifications d’une facture portent sur son destinataire, sa date, son montant et son reste à régler. Son numéro historique reste conservé.

Les soldes des factures servent de référence distincte des règlements retenus. Par défaut, les paiements des factures actives sont comptés ; ceux des factures annulées, les écritures Avoir et les opérations sans facture sont écartés. L’utilisateur peut modifier ce choix. Les écarts restent visibles pour rapprochement. Le fichier source d’origine est conservé séparément des corrections locales.

## Données locales et sauvegardes

Le code est livré sans base préremplie de cabinet. Les tests créent leurs exemples fictifs dans des dossiers temporaires.

Sous Windows, les bases se trouvent dans `%LOCALAPPDATA%\MonCabinetOsteo` et `%LOCALAPPDATA%\MonCabinetOsteoDemo`. Sur les autres systèmes, l’emplacement par défaut est `~/.local/share/MonCabinetOsteo` et son équivalent de démonstration. Les chemins exacts sont affichés dans **Paramètres**.

**Paramètres → Sauvegarde chiffrée** produit un fichier `.mco`. La restauration en ligne de commande s’effectue avec `app/restore.py` vers un dossier vide ; consulter `python app/restore.py --help`. Les corrections comptables font partie de la sauvegarde.

Le serveur écoute uniquement sur l’interface locale. Aucune connexion au service d’origine n’est nécessaire pour utiliser le cabinet ou travailler sur un export déjà téléchargé.

## Développement

```powershell
& ./.venv/Scripts/python.exe -m unittest discover -s tests -v
```

Organisation du dépôt :

| Chemin | Rôle |
|---|---|
| `app/server.py` | Serveur HTTP local et routes |
| `app/storage.py` | Base SQLite, facturation et sauvegardes |
| `app/import_mcl.py` | Import initial des dossiers et sources |
| `app/accounting_mcl.py` | Historique comptable et corrections locales |
| `app/pdf_documents.py` | Factures et comptes rendus PDF |
| `app/web/` | Interface HTML, CSS et JavaScript |
| `tests/` | Tests automatisés avec données fictives |
| `lancer.py` | Lancement depuis les sources |
| `Distribution/Construction/` | Outils de construction Windows |

Voir [les changements](CHANGELOG.md) et [les instructions de construction](Distribution/Construction/README.md). La construction d’un nouvel installateur est distincte de la publication des sources.

## Licence et contributions

Le code original est distribué sous [licence MIT](LICENSE). Les composants tiers conservent leurs [licences](Distribution/Licences/DEPENDANCES.md). L’application est en développement et fournie en l’état.

Les contributions et signalements sont bienvenus via les issues et pull requests. Utiliser uniquement des exemples fictifs dans les tests, captures, rapports de problème et pièces jointes publiques.
