from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "holocron.sqlite"


def has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def run(command: list[str]) -> int:
    print("$ " + " ".join(command))
    return subprocess.run(command, cwd=PROJECT_ROOT, check=False).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap a fresh local Holocron GM clone.")
    parser.add_argument("--force-ingest", action="store_true", help="Run ingestion even when the SQLite DB exists.")
    parser.add_argument("--skip-ingest", action="store_true", help="Skip ingestion and only print next steps.")
    args = parser.parse_args()

    exit_code = 0
    version = sys.version_info
    if version >= (3, 11):
        print(f"OK python {version.major}.{version.minor}.{version.micro}")
    else:
        print(f"NEED Python 3.11+; current is {version.major}.{version.minor}.{version.micro}")
        exit_code = 1

    if run(["git", "lfs", "version"]) == 0:
        print("OK git lfs installed")
    else:
        print("NEED: Install Git LFS. macOS: brew install git-lfs && git lfs install")
        exit_code = 1

    if (PROJECT_ROOT / "Books").exists():
        print("OK Books folder found")
    else:
        print("NEED Books folder missing")
        exit_code = 1

    if (PROJECT_ROOT / "Assets").exists():
        print("OK Assets folder found")
    else:
        (PROJECT_ROOT / "Assets").mkdir(parents=True, exist_ok=True)
        print("OK Assets folder created")

    missing_modules = [name for name in ["fastapi", "fitz", "pydantic", "uvicorn"] if not has_module(name)]
    if missing_modules:
        print("NEED dependencies: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt")
        print("Missing modules: " + ", ".join(missing_modules))
        exit_code = 1

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("OK data folder ready")

    check_code = run([sys.executable, "scripts/check_assets_ready.py"])
    if check_code != 0:
        exit_code = 1

    should_ingest = args.force_ingest or (not DB_PATH.exists() and not args.skip_ingest)
    if should_ingest and not missing_modules:
        ingest_code = run([sys.executable, "scripts/ingest_books.py"])
        if ingest_code != 0:
            exit_code = ingest_code
    elif not DB_PATH.exists():
        print("NEED ingest later: python3 scripts/ingest_books.py")
    else:
        print("OK database found")

    print("NEXT: python3 scripts/dev_server.py")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
