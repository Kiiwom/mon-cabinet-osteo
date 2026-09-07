"""Restoration into a new directory; never overwrites an existing cabinet."""
import argparse
import getpass
from pathlib import Path
from storage import Store, Problem

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Restaurer une sauvegarde dans un NOUVEAU dossier local.")
    parser.add_argument("backup", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    if "onedrive" in str(args.destination.resolve()).lower():
        parser.error("Choisissez un dossier hors de OneDrive.")
    if args.destination.exists() and any(args.destination.iterdir()):
        parser.error("Le dossier de destination doit être vide ou inexistant.")
    try:
        result = Store(args.destination).restore_backup(args.backup.read_bytes(), getpass.getpass("Phrase de sauvegarde : "))
        print(f"Restauration terminée : {result['patients']} patients, {result['consultations']} consultations.")
        print("Dossier :", args.destination.resolve())
    except (Problem, OSError) as error:
        parser.exit(1, str(error)+"\n")
