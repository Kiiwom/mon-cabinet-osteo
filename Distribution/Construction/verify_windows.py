"""Exercise the actual installer and binary using isolated fictitious data."""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, timeout=120,
                          creationflags=subprocess.CREATE_NO_WINDOW, **kwargs)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("installer", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="cabinet-distribution-") as temporary:
        root = Path(temporary)
        installed = root / "Logiciel installé"
        local = root / "Local"
        env = {**os.environ, "LOCALAPPDATA": str(local)}
        data = local / "MonCabinetOsteoDemo"
        run([args.installer.resolve(), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-",
             "/NOICONS", "/TASKS=", f"/DIR={installed}", f"/LOG={root / 'install.log'}"])
        exe = installed / "MonCabinetOsteo.exe"
        assert exe.is_file() and (installed / "LICENSE").is_file()
        assert (installed / "Restauration/RestaurerCabinet.exe").is_file()
        assert not list(installed.rglob("*.sqlite3"))
        print("OK : installation silencieuse dans un chemin avec espaces et accent, licence et outil de restauration présents.", flush=True)
        port = free_port()
        url = f"http://127.0.0.1:{port}"
        server_pid = None
        try:
            run([exe, "--demo", "--no-browser", "--port", port], env=env)
            server_pid = int((data / "server.pid").read_text())
            def request(path, body=None, headers=None):
                req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
                                             headers=headers or {})
                return urllib.request.urlopen(req, timeout=10)
            health = json.load(request("/api/health"))
            assert health["app"] == "mon-cabinet-osteo" and health["demo"] is True
            page = request("/").read().decode()
            assert "__TOKEN__" not in page
            token = re.search(r'name="cabinet-token" content="([^"]+)"', page)[1]
            for asset in ["/app.js", "/style.css", "/icon.svg"]:
                assert len(request(asset).read()) > 100
            headers = {"Content-Type": "application/json", "X-Cabinet-Token": token}
            patient = json.load(request("/api/patients"))[0]
            consult = json.load(request("/api/patients/" + patient["id"]))["consultations"][0]
            inv = json.load(request("/api/invoices", {"consultation_id": consult["id"]}, headers))
            inv = json.load(request("/api/invoices/" + inv["id"] + "/issue", {"method": "CB"}, headers))
            assert request("/api/invoices/" + inv["id"] + "/pdf").read().startswith(b"%PDF")
            backup = request("/api/backup", {"password": "phrase fictive test distribution 2026"}, headers).read()
            assert len(backup) > 100
            assert json.load(request("/api/bootstrap"))["data_dir"] == str(data.resolve())
            run([exe, "--demo", "--no-browser", "--port", port], env=env)
            assert int((data / "server.pid").read_text()) == server_pid
            wrong = subprocess.run([str(exe), "--no-browser", "--port", str(port)], env=env,
                                   creationflags=subprocess.CREATE_NO_WINDOW, timeout=30)
            assert wrong.returncode != 0
            run([installed / "Restauration/RestaurerCabinet.exe", "--help"], capture_output=True)
            print("OK : exe autonome, démonstration, ressources web, facture PDF, sauvegarde chiffrée, réouverture et refus du mauvais mode.", flush=True)
        finally:
            if server_pid is None and (data / "server.pid").exists():
                server_pid = int((data / "server.pid").read_text())
            if server_pid:
                run(["taskkill", "/PID", server_pid, "/T", "/F"], capture_output=True)
                time.sleep(1)
            run([installed / "unins000.exe", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
            # Inno's uninstaller delegates deletion to a temporary child process.
            for _ in range(50):
                if not exe.exists():
                    break
                time.sleep(.2)
        assert (data / "cabinet.sqlite3").exists()
        assert not exe.exists()
        print("OK : désinstallation, données fictives conservées. Aucun cabinet réel utilisé.", flush=True)


if __name__ == "__main__":
    main()
