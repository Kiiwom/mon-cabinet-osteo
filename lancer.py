"""Double-click entry point: start or reopen this computer's cabinet."""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--demo", action="store_true")
parser.add_argument("--no-browser", action="store_true")
args = parser.parse_args()
port = 8766 if args.demo else 8765
url = f"http://127.0.0.1:{port}"
directory = Path(os.environ.get("LOCALAPPDATA", str(Path.home()/".local"/"share")))/("MonCabinetOsteoDemo" if args.demo else "MonCabinetOsteo")

def available():
    try:
        with urllib.request.urlopen(url+"/api/health", timeout=1) as response:
            data=json.load(response)
        if data.get("app")!="mon-cabinet-osteo" or data.get("demo")!=args.demo:
            raise RuntimeError("Ce port est occupé par une autre application.")
        return True
    except (OSError, ValueError):
        return False

if not available():
    directory.mkdir(parents=True, exist_ok=True)
    command=[sys.executable, str(ROOT/"app"/"server.py"), "--data-dir", str(directory), "--port", str(port)]
    if args.demo: command.append("--demo")
    with (directory/"application.log").open("ab") as log:
        process=subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log, stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
    (directory/"server.pid").write_text(str(process.pid))
    for _ in range(50):
        if available(): break
        if process.poll() is not None: raise RuntimeError("Le cabinet n’a pas démarré. Consultez "+str(directory/"application.log"))
        time.sleep(.2)
    else: raise RuntimeError("Le démarrage prend trop de temps. Relancez le raccourci.")
print("Cabinet disponible : "+url)
print("Données locales : "+str(directory))
if not args.no_browser: webbrowser.open(url)
