"""Fabrique src/donnees/codes-postaux.tsv : chaque code postal et ses communes.

Sources, sous Licence Ouverte / Open Licence (Etalab) :
- communes et communes déléguées, noms officiels avec accents : API Découpage administratif
  (https://geo.api.gouv.fr/communes?fields=nom,code,codesPostaux&format=json et
  https://geo.api.gouv.fr/communes_associees_deleguees?format=json) ;
- correspondance codes postaux et communes : base officielle des codes postaux de La Poste
  (https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw).

Usage : python3 outils/codes_postaux.py communes.json deleguees.json hexasmal.csv src/donnees/codes-postaux.tsv

Une ligne par code postal : le code, puis ses communes séparées par des tabulations, les
communes déléguées en dernier sous la forme « Ancienne|Commune nouvelle ».
"""

import csv
import json
import sys
import unicodedata
from collections import defaultdict


def plier(nom: str) -> str:
    sans_accents = unicodedata.normalize("NFD", nom).encode("ascii", "ignore").decode()
    mots = sans_accents.upper().replace("-", " ").replace("'", " ").split()
    abreviations = {"SAINT": "ST", "SAINTE": "STE"}
    return " ".join(abreviations.get(m, m) for m in mots)


def titre(nom: str) -> str:
    """Nom de La Poste en majuscules sans accents, faute de mieux : « LE MONT DORE » → « Le Mont Dore »."""
    petits = {"DE", "DU", "DES", "LA", "LE", "LES", "EN", "SUR", "SOUS", "ET", "AUX", "AU"}
    mots = nom.split()
    return " ".join(m.capitalize() if i == 0 or m not in petits else m.lower() for i, m in enumerate(mots))


def main(communes_json: str, deleguees_json: str, hexasmal_csv: str, sortie: str) -> None:
    communes = {c["code"]: c for c in json.load(open(communes_json, encoding="utf-8"))}
    deleguees = defaultdict(dict)
    for d in json.load(open(deleguees_json, encoding="utf-8")):
        deleguees[d["chefLieu"]][plier(d["nom"])] = d["nom"]

    par_code = defaultdict(set)
    anciennes = defaultdict(set)
    for c in communes.values():
        for cp in c.get("codesPostaux", []):
            par_code[cp].add(c["nom"])
    with open(hexasmal_csv, encoding="latin-1") as f:
        lignes = csv.reader(f, delimiter=";")
        next(lignes)
        for insee, nom, cp, _acheminement, ligne5 in lignes:
            commune = communes.get(insee)
            if commune is None:
                # Arrondissements de Paris, Lyon, Marseille : déjà couverts par leur commune.
                if insee[:2] in ("75", "69", "13") and len(par_code[cp]) > 0:
                    continue
                par_code[cp].add(titre(nom))
                continue
            par_code[cp].add(commune["nom"])
            ancienne = deleguees.get(insee, {}).get(plier(ligne5)) if ligne5.strip() else None
            if ancienne and ancienne != commune["nom"]:
                anciennes[cp].add(f"{ancienne}|{commune['nom']}")

    def cle(nom: str) -> str:
        return unicodedata.normalize("NFD", nom).encode("ascii", "ignore").decode().lower().replace("-", " ")

    with open(sortie, "w", encoding="utf-8", newline="\n") as f:
        for cp in sorted(par_code):
            if not (len(cp) == 5 and cp.isdigit()):
                continue
            noms = sorted(par_code[cp], key=cle)
            noms += sorted(anciennes[cp] - set(noms), key=cle)
            f.write("\t".join([cp, *noms]) + "\n")


if __name__ == "__main__":
    main(*sys.argv[1:5])
