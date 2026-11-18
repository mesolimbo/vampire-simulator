"""Build check and local web server for the game. Run through the Makefile."""
import functools
import http.server
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "docs"   # the published site: GitHub Pages serves this folder
BUILD = ROOT / ".build"
PID_FILE = BUILD / "server.pid"
LOG_FILE = BUILD / "server.log"
HOST = "127.0.0.1"
DIST = ROOT / "dist"
ZIP_NAME = "graveyard-shifts.zip"
# Site files the game never loads: the 3D asset preview, the GitHub Pages marker and the music's generation notes.
ZIP_SKIP = {"scene3d.html", ".nojekyll", "assets/audio/music/bgm_loop.json"}
# itch.io's limits for an HTML game, unpacked.
ITCH_MAX_FILES, ITCH_MAX_BYTES, ITCH_MAX_FILE_BYTES = 1000, 500 * 1024 * 1024, 200 * 1024 * 1024


def listening(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, port)) == 0


def build():
    """The game is plain script files, so building means checking that each one parses."""
    node = shutil.which("node")
    if not node:
        print("build: node not found, skipped the syntax check")
        return
    BUILD.mkdir(exist_ok=True)
    for name in ["sim.js", "render2d.js", "ui.js", "audio.js", "menu.js", "main.js", "assets/hud/hud.js"]:
        if subprocess.run([node, "--check", str(SITE / name)]).returncode != 0:
            sys.exit(f"build failed: syntax error in {name}")
    # The 3D renderer is an ES module; node checks it as one only under the .mjs extension.
    module = BUILD / "render3d.mjs"
    module.write_text((SITE / "render3d.js").read_text(encoding="utf-8"), encoding="utf-8")
    if subprocess.run([node, "--check", str(module)]).returncode != 0:
        sys.exit("build failed: syntax error in render3d.js")
    print("build: every script parses")


def package():
    """Zip the site for an itch.io HTML upload: index.html at the top of the archive, everything it loads beside it."""
    build()
    files = sorted(p for p in SITE.rglob("*") if p.is_file() and p.relative_to(SITE).as_posix() not in ZIP_SKIP)
    total = sum(p.stat().st_size for p in files)
    too_big = [p.relative_to(SITE).as_posix() for p in files if p.stat().st_size > ITCH_MAX_FILE_BYTES]
    if len(files) > ITCH_MAX_FILES or total > ITCH_MAX_BYTES or too_big:
        sys.exit(f"zip: over itch.io's limits ({len(files)} files, {total / 1e6:.0f} MB, too large: {too_big or 'none'})")
    DIST.mkdir(exist_ok=True)
    out = DIST / ZIP_NAME
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            # Already-compressed media gains nothing from deflate.
            kind = zipfile.ZIP_STORED if p.suffix.lower() in {".mp3", ".jpg", ".png", ".glb", ".webp"} else zipfile.ZIP_DEFLATED
            z.write(p, p.relative_to(SITE).as_posix(), compress_type=kind)
    print(f"zip: {out.relative_to(ROOT)}, {len(files)} files, {total / 1e6:.0f} MB unpacked, {out.stat().st_size / 1e6:.0f} MB zipped")


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
            [sys.executable, str(Path(__file__).resolve()), "serve", str(port)],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, **detach,
        )
    PID_FILE.write_text(str(proc.pid))
    for _ in range(50):
        if listening(port):
            print(f"started at {url}")
            return
        time.sleep(0.1)
    sys.exit(f"server did not come up, see {LOG_FILE}")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Serve files with caching off, so a reload always shows the latest edit."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(port):
    handler = functools.partial(NoCacheHandler, directory=str(SITE))
    http.server.ThreadingHTTPServer((HOST, port), handler).serve_forever()


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
    {"build": lambda p: build(), "zip": lambda p: package(), "start": start, "stop": stop, "status": status, "serve": serve}[command](port)
