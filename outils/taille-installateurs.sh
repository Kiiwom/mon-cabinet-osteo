#!/bin/sh
# Vérifie que chaque installateur pèse moins de 30 Mo (cahier des charges, section 9) et note les
# tailles dans le résumé de l'intégration continue.
set -e
LIMITE=30000000
echo "| Installateur | Taille |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "| --- | --- |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
trop=0
for fichier in "$@"; do
  taille=$(wc -c < "$fichier" | tr -d ' ')
  ligne="| $(basename "$fichier") | $(awk "BEGIN { printf \"%.1f Mo\", $taille / 1000000 }") |"
  echo "$ligne"
  echo "$ligne" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  if [ "$taille" -ge "$LIMITE" ]; then
    echo "::error::$(basename "$fichier") dépasse 30 Mo"
    trop=1
  fi
done
exit $trop
