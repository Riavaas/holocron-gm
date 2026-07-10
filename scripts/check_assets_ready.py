from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BOOKS_DIR = PROJECT_ROOT / "Books"
ASSETS_DIR = PROJECT_ROOT / "Assets"
DB_PATH = PROJECT_ROOT / "data" / "holocron.sqlite"
PDF_IMAGE_MANIFEST = ASSETS_DIR / "pdf_images" / "manifest.json"
EXTERNAL_ASSET_MANIFEST = ASSETS_DIR / "external" / "manifest.json"

EXPECTED_PDFS = [
    "SW5e - Player's Handbook-avec compression.pdf",
    "SW5e - Scum and Villainy - 20191105.pdf",
    "SW5e - Starships of the Galaxy - 20210316.pdf",
    "SW5e - Wretched Hives - 20220419.pdf",
]

ASSET_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}


def is_lfs_installed() -> bool:
    if shutil.which("git") is None:
        return False
    result = subprocess.run(["git", "lfs", "version"], cwd=PROJECT_ROOT, capture_output=True, text=True, check=False)
    return result.returncode == 0


def is_lfs_pointer(path: Path) -> bool:
    try:
        sample = path.read_bytes()[:128]
    except OSError:
        return False
    return sample.startswith(b"version https://git-lfs.github.com/spec/v1")


def looks_like_pdf(path: Path) -> bool:
    try:
        return path.read_bytes()[:4] == b"%PDF"
    except OSError:
        return False


def main() -> int:
    exit_code = 0
    lfs_ok = is_lfs_installed()
    if lfs_ok:
        print("OK git lfs installed")
    else:
        print("NEED: Install Git LFS. macOS: brew install git-lfs && git lfs install")
        exit_code = 1

    missing_books = []
    pointer_books = []
    invalid_books = []
    for filename in EXPECTED_PDFS:
        path = BOOKS_DIR / filename
        if not path.exists():
            missing_books.append(filename)
            continue
        if is_lfs_pointer(path):
            pointer_books.append(filename)
        elif not looks_like_pdf(path):
            invalid_books.append(filename)

    if not missing_books and not pointer_books and not invalid_books:
        print(f"OK books found ({len(EXPECTED_PDFS)})")
    else:
        exit_code = 1
        if missing_books:
            print("NEED books missing: " + ", ".join(missing_books))
        if pointer_books:
            print("NEED git lfs pull for books: " + ", ".join(pointer_books))
        if invalid_books:
            print("NEED check non-PDF book files: " + ", ".join(invalid_books))

    if ASSETS_DIR.exists():
        print("OK assets folder found")
    else:
        print("NEED assets folder missing: mkdir -p Assets")
        exit_code = 1

    pointer_assets = [str(path.relative_to(PROJECT_ROOT)) for path in ASSETS_DIR.rglob("*") if path.is_file() and path.suffix.lower() in ASSET_SUFFIXES and is_lfs_pointer(path)]
    if pointer_assets:
        print("NEED git lfs pull for assets: " + ", ".join(pointer_assets[:10]))
        exit_code = 1

    if PDF_IMAGE_MANIFEST.exists():
        try:
            payload = json.loads(PDF_IMAGE_MANIFEST.read_text(encoding="utf-8"))
            print(f"OK PDF image manifest found ({len(payload.get('images', []))} images)")
        except json.JSONDecodeError:
            print(f"NEED rebuild invalid PDF image manifest: {PDF_IMAGE_MANIFEST.relative_to(PROJECT_ROOT)}")
            exit_code = 1
    else:
        print("NEED PDF image manifest: python3 scripts/extract_pdf_images.py --force")
        exit_code = 1

    if EXTERNAL_ASSET_MANIFEST.exists():
        try:
            payload = json.loads(EXTERNAL_ASSET_MANIFEST.read_text(encoding="utf-8"))
            print(f"OK external asset manifest found ({len(payload.get('assets', []))} assets)")
        except json.JSONDecodeError:
            print(f"NEED rebuild invalid external asset manifest: {EXTERNAL_ASSET_MANIFEST.relative_to(PROJECT_ROOT)}")
            exit_code = 1
    else:
        print("INFO external asset manifest missing; run scripts/import_external_assets.py --extract to import curated packs")

    if DB_PATH.exists():
        print(f"OK database found: {DB_PATH.relative_to(PROJECT_ROOT)}")
    else:
        print("NEED ingest: python3 scripts/ingest_books.py")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
