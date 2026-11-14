"""Build check and local web server for the game. Run through the Makefile."""
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / ".build"
PID_FILE = BUILD / "server.pid"
LOG_FILE = BUILD / "server.log"
HOST = "127.0.0.1"


def listening(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, port)) == 0


def build():
    """The game is one HTML file, so building means checking that its script parses."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    match = re.search(r"<script>(.*?)</script>", html, re.S)
    if not match:
        sys.exit("build failed: no <script> block in index.html")
    BUILD.mkdir(exist_ok=True)
    js = BUILD / "game.js"
    js.write_text(match.group(1), encoding="utf-8")
    node = shutil.which("node")
    if not node:
        print("build: node not found, skipped the syntax check")
        return
    if subprocess.run([node, "--check", str(js)]).returncode != 0:
        sys.exit("build failed: syntax error in index.html script")
    print("build: index.html script parses")


def start(port):
    url = f"http://{HOST}:{port}/"
    if listening(port):
        print(f"already running at {url}" if PID_FILE.exists() else f"port {port} is in use by another program")
        sys.exit(0 if PID_FILE.exists() else 1)
    BUILD.mkdir(exist_ok=True)
    detach = (
        {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
        if os.name == "nt"
        else {"start_new_session": True}
    )
    with open(LOG_FILE, "w") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port), "--bind", HOST, "--directory", str(ROOT)],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, **detach,
        )
    PID_FILE.write_text(str(proc.pid))
    for _ in range(50):
        if listening(port):
            print(f"started at {url}")
            return
        time.sleep(0.1)
    sys.exit(f"server did not come up, see {LOG_FILE}")


def stop(port):
    if not PID_FILE.exists():
        print(f"not started by make, but port {port} is in use" if listening(port) else "not running")
        return
    try:
        os.kill(int(PID_FILE.read_text()), signal.SIGTERM)
    except (OSError, ValueError):
        pass
    PID_FILE.unlink()
    print("stopped")


def status(port):
    print(f"running at http://{HOST}:{port}/" if listening(port) else "not running")


if __name__ == "__main__":
    command, port = sys.argv[1], int(sys.argv[2])
    {"build": lambda p: build(), "start": start, "stop": stop, "status": status}[command](port)
