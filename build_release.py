# SPDX-License-Identifier: GPL-3.0-only
# Modified/adapted 2026-11-16; see THIRD_PARTY_NOTICES.txt.
"""Build and stage a source-inclusive Windows delivery; never copy user runs."""
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
import shutil
import subprocess
import sys
import uuid
import hashlib
import json

ROOT = Path(__file__).resolve().parent
SOURCE_FILES = sorted({p.name for pattern in ("*.py", "*.js", "*.html", "*.css", "*.bat") for p in ROOT.glob(pattern)} | {
    "README.md", "REPLAY_NOTES.md", "replay-model.json", "LICENSE",
    "THIRD_PARTY_NOTICES.txt", "requirements-build.txt", "sim-ui.spec", "sim-ui.ico",
})


def stage(destination, executable):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for name in SOURCE_FILES:
        shutil.copy2(ROOT / name, destination / name)
    for name in ("engine", "settings", "licenses", "testdata", "source-dependencies", "manual"):
        shutil.copytree(ROOT / name, destination / name,
                        ignore=shutil.ignore_patterns("__pycache__", "*.o", "*.obj"))
    network = destination / "settings/simulations/Network"
    shutil.copy2(network / "scenarios.defaults", network / "scenarios.ini")
    for generated in (network / "scenarios").glob("scenario-*.json"):
        generated.unlink()
    shutil.copy2(executable, destination / "sim-ui.exe")
    (destination / "data").mkdir()
    shutil.copy2(ROOT / "data/earth.png", destination / "data/earth.png")
    return destination


def main():
    env = ROOT / "build/release-env"
    python = env / "Scripts/python.exe"
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(env)], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check",
                    "-r", str(ROOT / "requirements-build.txt")], check=True)
    if '--use-built-engine' in sys.argv:
        info=json.loads((ROOT/'engine/build-info.json').read_text())
        actual={p.relative_to(ROOT/'engine').as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'engine').rglob('*') if p.is_file() and p.suffix in ('.h','.cpp','.cc')}
        if info['sources']!=actual or info['sha256']!=hashlib.sha256((ROOT/'engine/engine.exe').read_bytes()).hexdigest():raise ValueError('Native source/build mismatch')
    else:subprocess.run([str(python), str(ROOT / "engine/build.py")], check=True)
    binaries = ROOT / "dist/binaries"
    subprocess.run([str(python), "-m", "PyInstaller", "--noconfirm", "--clean",
                    "--distpath", str(binaries), "--workpath", str(ROOT / "build/release-pyinstaller"),
                    str(ROOT / "sim-ui.spec")], check=True, cwd=ROOT)
    name = "LEO-Network-Simulator-1.0.0-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    delivery = stage(ROOT / "dist" / name, binaries / "sim-ui.exe")
    from research import evidence
    record=evidence(ROOT)
    reports=([record['report']] if record['status']=='passed' else [])+[item['report'] for item in record['workloads']]
    for relative in reports:
        source=Path(relative).parent
        shutil.copytree(ROOT/source,delivery/source,dirs_exist_ok=True)
    import server
    with patch.object(server, "BASE_DIR", str(delivery)), patch.object(server, "LEO_DIR", str(delivery / "settings")), patch.object(server, "INI_PATH", str(delivery / "settings" / server.ENTRY)):
        server.run_simulation("Dijkstra132")
    archive = shutil.make_archive(str(delivery), "zip", delivery.parent, delivery.name)
    print("DELIVERY:", delivery)
    print("ARCHIVE:", archive)


if __name__ == "__main__":
    main()
