"""Windows entry point; application data always live outside the installation."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "app"))
from server import make_server, VERSION


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--serve", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    port = args.port if args.port is not None else (8766 if args.demo else 8765)
    directory = (args.data_dir or Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share"))) /
                 ("MonCabinetOsteoDemo" if args.demo else "MonCabinetOsteo")).resolve()
    if "onedrive" in str(directory).lower():
        raise RuntimeError("Choisissez un dossier de données hors de OneDrive.")
    if not 1 <= port <= 65535:
        raise RuntimeError("Le port doit être compris entre 1 et 65535.")
    url = f"http://127.0.0.1:{port}"

    def available():
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=1) as response:
                health = json.load(response)
            if health.get("app") != "mon-cabinet-osteo" or health.get("demo") != args.demo:
                raise RuntimeError("Ce port est occupé par une autre application ou un autre mode.")
            if health.get("version") != VERSION:
                raise RuntimeError("Une autre version est déjà ouverte. Fermez son serveur ou redémarrez Windows.")
            with urllib.request.urlopen(url + "/api/bootstrap", timeout=1) as response:
                current = json.load(response)
            if Path(current.get("data_dir", "")).resolve() != directory:
                raise RuntimeError("Un autre cabinet utilise ce port. Choisissez un autre port.")
            return True
        except (OSError, ValueError):
            return False

    if args.serve:
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / "application.log").open("a", encoding="utf-8") as log:
            sys.stdout = sys.stderr = log
            server = make_server(directory, port, args.demo)
            try:
                server.serve_forever()
            finally:
                server.server_close()
        return
    if not available():
        directory.mkdir(parents=True, exist_ok=True)
        command = [sys.executable]
        if not getattr(sys, "frozen", False):
            command.append(str(Path(__file__).resolve()))
        command += ["--serve", "--data-dir", str(directory), "--port", str(port)]
        if args.demo:
            command.append("--demo")
        with (directory / "application.log").open("ab") as log:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        (directory / "server.pid").write_text(str(process.pid), encoding="ascii")
        for _ in range(100):
            if available():
                break
            if process.poll() is not None:
                raise RuntimeError("Démarrage impossible. Consultez " + str(directory / "application.log"))
            time.sleep(.2)
        else:
            raise RuntimeError("Le démarrage prend trop de temps. Consultez " + str(directory / "application.log"))
    if not args.no_browser:
        webbrowser.open(url)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if os.name == "nt" and "--no-browser" not in sys.argv and "--serve" not in sys.argv:
            ctypes.windll.user32.MessageBoxW(None, str(error), "Mon Cabinet d’Ostéo", 0x10)
        elif sys.stderr:
            print(str(error), file=sys.stderr)
        sys.exit(1)
