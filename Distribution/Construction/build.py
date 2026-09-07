"""Build an offline Windows installer and a curated source archive.

Run with a dedicated virtual environment; see README.md in this directory.
"""
import argparse
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "Distribution"
BUILD = ROOT / ".build-distribution"
VERSION = re.search(r'^VERSION = "([^"]+)"', (ROOT / "app/server.py").read_text("utf-8"), re.M)[1]
PACKAGES = ["reportlab", "cryptography", "pillow", "charset-normalizer", "cffi", "pycparser", "pyinstaller"]


def run(*args):
    subprocess.run([str(a) for a in args], cwd=ROOT, check=True)


def notices(compiler):
    directory = DIST / "Licences"
    directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "LICENSE", directory / "LICENSE.txt")
    rows = ["# Composants de la distribution", "", f"Python {platform.python_version()} ({platform.machine()}).",
            "", "Notices copiées depuis les distributions réellement installées pour cette construction.",
            "PyInstaller est l’outil de construction ; sa licence comporte une exception pour les exécutables produits.",
            "Les mentions incluses par cryptography et Pillow couvrent aussi leurs bibliothèques embarquées.",
            "", "| Composant | Version | Notices |", "|---|---|---|"]
    for name in PACKAGES:
        package = metadata.distribution(name)
        target = directory / "Tiers" / name
        count = 0
        for f in package.files or []:
            if not any(word in str(f).lower() for word in ("license", "copying", "notice", "copyright")):
                continue
            source = Path(package.locate_file(f))
            if not source.is_file() or source.suffix in {".py", ".pyc", ".exe"}:
                continue
            # Preserve package-relative topology but never trust ../ from wheel metadata.
            safe_parts = [part for part in f.parts if part not in {"..", "."}]
            destination = target.joinpath(*safe_parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            count += 1
        if not count:
            raise RuntimeError("Aucune notice trouvée pour " + name)
        rows.append(f"| {name} | {package.version} | Tiers/{name}/ ({count} fichiers) |")
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if not python_license.exists():
        raise RuntimeError("Licence Python absente : " + str(python_license))
    python_target = directory / "Tiers/Python"
    python_target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(python_license, python_target / "LICENSE.txt")
    inno_target = directory / "Tiers/InnoSetup"
    inno_target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(compiler.parent / "License.txt", inno_target / "LICENSE.txt")
    rows += ["", "Autres notices : `Tiers/Python/LICENSE.txt`, `Tiers/InnoSetup/LICENSE.txt`.",
             "SQLite est fourni avec Python et relève du domaine public : https://www.sqlite.org/copyright.html",
             "OpenSSL 3.5.8 (Python) et 4.0.2 (cryptography) : licence Apache 2.0 dans Tiers/OpenSSL/.",
             "Les notices complémentaires Python sont dans Tiers/Python/INCORPORATED-SOFTWARE.rst.",
             "Arial est utilisée uniquement si elle est déjà installée dans Windows ; elle n’est pas redistribuée ici.", ""]
    (directory / "DEPENDANCES.md").write_text("\n".join(rows), encoding="utf-8")


def archive_sources():
    # Explicit allowlist: never include captures, local data, inventories or private settings.
    selected = [ROOT / f for f in ["LICENSE", "README.md", "requirements.txt", ".gitignore", "lancer.py",
                                 "Ouvrir mon cabinet.cmd", "Ouvrir la demonstration.cmd"]]
    for folder, suffixes in [(ROOT / "app", {".py", ".html", ".css", ".js", ".svg", ".ico"}),
                             (ROOT / "tests", {".py"}),
                             (DIST / "Construction", {".py", ".md", ".txt", ".iss"}),
                             (DIST / "Licences", None)]:
        selected.extend(p for p in folder.rglob("*") if p.is_file() and "__pycache__" not in p.parts
                        and (suffixes is None or p.suffix in suffixes))
    selected += [DIST / "README.md", DIST / "Installateur/GUIDE-INSTALLATION.md",
                 DIST / "Installateur/AVANT-INSTALLATION.txt"]
    selected = sorted(set(selected))
    source_dir = DIST / "Sources"
    source_dir.mkdir(parents=True, exist_ok=True)
    archive = source_dir / f"MonCabinetOsteo-{VERSION}-sources.zip"
    def public_content(path):
        if path == ROOT / "README.md":
            return (DIST / "Construction/README-SOURCES.md").read_bytes()
        return path.read_bytes()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for path in selected:
            output.writestr(path.relative_to(ROOT).as_posix(), public_content(path))
    manifest = [{"path": p.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(public_content(p)).hexdigest()}
                for p in selected]
    (source_dir / "MANIFESTE.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    installer = DIST / "Installateur" / f"MonCabinetOsteo-{VERSION}-essai-Setup-x64.exe"
    if not installer.exists():
        raise RuntimeError("Installateur absent")
    hashes = [f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(DIST).as_posix()}" for p in [installer, archive]]
    (DIST / "SHA256SUMS.txt").write_text("\n".join(hashes) + "\n", encoding="ascii")
    print("Distribution :", installer, archive, sep="\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--iscc", type=Path)
    parser.add_argument("--archive-only", action="store_true")
    args = parser.parse_args()
    if args.archive_only:
        archive_sources()
        return
    if os.name != "nt":
        parser.error("Construire l’installateur Windows depuis Windows x64.")
    compiler = (args.iscc or BUILD / "tools/InnoSetup/ISCC.exe").resolve()
    if not compiler.is_file():
        parser.error("Indiquer le chemin de ISCC.exe avec --iscc.")
    BUILD.mkdir(exist_ok=True)
    os.environ["PYINSTALLER_CONFIG_DIR"] = str(BUILD / "pyinstaller-cache")
    notices(compiler)
    bundle = BUILD / ("dist-" + uuid.uuid4().hex[:12])
    common = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--noupx", "--log-level", "WARN",
              "--onedir", "--distpath", bundle, "--workpath", BUILD / "work", "--specpath", BUILD,
              "--paths", ROOT / "app", "--icon", ROOT / "app/cabinet.ico"]
    run(*common, "--name", "MonCabinetOsteo", "--windowed", "--add-data", str(ROOT / "app/web") + ":web",
        "--collect-data", "reportlab", DIST / "Construction/windows_launcher.py")
    run(*common, "--name", "RestaurerCabinet", "--console", ROOT / "app/restore.py")
    run(compiler, "/Q", "/DAppVersion=" + VERSION, "/DProjectRoot=" + str(ROOT),
        "/DBundleRoot=" + str(bundle), DIST / "Construction/installer.iss")
    archive_sources()


if __name__ == "__main__":
    main()
