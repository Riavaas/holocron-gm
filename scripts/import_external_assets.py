from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from holocron.assets.external import EXTERNAL_MANIFEST_PATH, EXTERNAL_SOURCES_PATH, load_external_sources
from holocron.core.paths import ASSETS_DIR, DATA_DIR, PROJECT_ROOT

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
DOWNLOAD_DIR = DATA_DIR / "external_downloads"
EXTERNAL_ASSET_DIR = ASSETS_DIR / "external"


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "asset"


def selected_sources(source_ids: list[str]) -> list[dict[str, object]]:
    sources = load_external_sources()
    if not source_ids:
        return sources
    wanted = set(source_ids)
    matches = [source for source in sources if source.get("id") in wanted]
    missing = wanted - {str(source.get("id")) for source in matches}
    if missing:
        raise SystemExit("Unknown source id(s): " + ", ".join(sorted(missing)))
    return matches


def request_headers() -> dict[str, str]:
    return {"User-Agent": "Mozilla/5.0 holocron-gm-external-assets/0.1"}


def check_url(url: str) -> dict[str, object]:
    request = urllib.request.Request(url, method="HEAD", headers=request_headers())
    with urllib.request.urlopen(request, timeout=30) as response:
        return {
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "content_length": response.headers.get("Content-Length"),
        }


def download(source: dict[str, object], force: bool) -> Path:
    url = str(source.get("download_url") or "")
    if not url:
        raise SystemExit(f"{source.get('id')} has no download_url")
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{source['id']}.zip"
    output = DOWNLOAD_DIR / filename
    if output.exists() and not force:
        return output
    request = urllib.request.Request(url, headers=request_headers())
    with urllib.request.urlopen(request, timeout=120) as response, output.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    return output


def safe_zip_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = []
    for member in archive.infolist():
        path = Path(member.filename)
        if member.is_dir() or path.is_absolute() or ".." in path.parts:
            continue
        if path.suffix.lower() in IMAGE_SUFFIXES:
            members.append(member)
    return members


def analyze_zip(path: Path) -> dict[str, object]:
    with zipfile.ZipFile(path) as archive:
        image_members = safe_zip_members(archive)
        return {
            "file": str(path.relative_to(PROJECT_ROOT)),
            "bytes": path.stat().st_size,
            "images": len(image_members),
            "suffixes": sorted({Path(member.filename).suffix.lower() for member in image_members}),
            "sample": [member.filename for member in image_members[:10]],
        }


def existing_manifest() -> list[dict[str, object]]:
    if not EXTERNAL_MANIFEST_PATH.exists():
        return []
    return json.loads(EXTERNAL_MANIFEST_PATH.read_text(encoding="utf-8")).get("assets", [])


def extract_zip(source: dict[str, object], zip_path: Path, force: bool) -> list[dict[str, object]]:
    source_id = str(source["id"])
    target_root = EXTERNAL_ASSET_DIR / source_id
    target_root.mkdir(parents=True, exist_ok=True)
    assets = []
    with zipfile.ZipFile(zip_path) as archive:
        for index, member in enumerate(safe_zip_members(archive), start=1):
            original_name = Path(member.filename).name
            suffix = Path(original_name).suffix.lower()
            stem = slugify(Path(original_name).stem)
            filename = f"{index:04d}-{stem}{suffix}"
            target = target_root / filename
            if force or not target.exists():
                with archive.open(member) as input_file, target.open("wb") as output_file:
                    shutil.copyfileobj(input_file, output_file)
            digest = hashlib.sha1(target.read_bytes()).hexdigest()[:16]
            relative_path = target.relative_to(ASSETS_DIR).as_posix()
            assets.append(
                {
                    "id": f"{source_id}-{index:04d}",
                    "source_id": source_id,
                    "asset_type": source.get("asset_type", "external"),
                    "name": Path(original_name).stem,
                    "author": source.get("author"),
                    "source_url": source.get("source_url"),
                    "attribution_note": source.get("attribution_note"),
                    "path": relative_path,
                    "url": f"/assets/{relative_path}",
                    "sha1": digest,
                }
            )
    return assets


def write_manifest(imported_assets: list[dict[str, object]]) -> None:
    by_key = {
        (asset.get("source_id"), asset.get("path")): asset
        for asset in existing_manifest()
    }
    for asset in imported_assets:
        by_key[(asset.get("source_id"), asset.get("path"))] = asset
    EXTERNAL_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_catalog": str(EXTERNAL_SOURCES_PATH.relative_to(PROJECT_ROOT)),
        "assets": sorted(by_key.values(), key=lambda item: (str(item.get("source_id")), str(item.get("path")))),
    }
    EXTERNAL_MANIFEST_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Check, download, analyze, and extract curated external asset packs.")
    parser.add_argument("--source", action="append", default=[], help="Source id to process. Repeat for several.")
    parser.add_argument("--list", action="store_true", help="List curated external sources.")
    parser.add_argument("--check", action="store_true", help="HEAD-check downloadable source URLs.")
    parser.add_argument("--download", action="store_true", help="Download zip packs into data/external_downloads.")
    parser.add_argument("--analyze", action="store_true", help="Analyze downloaded zip contents.")
    parser.add_argument("--extract", action="store_true", help="Extract image files into Assets/external and update manifest.")
    parser.add_argument("--force", action="store_true", help="Overwrite downloaded/extracted files.")
    args = parser.parse_args()

    sources = selected_sources(args.source)
    if args.list:
        for source in sources:
            print(f"{source['id']}: {source['title']} ({source.get('asset_type')})")

    imported: list[dict[str, object]] = []
    for source in sources:
        if source.get("kind") != "zip_pack":
            if args.check:
                print(json.dumps({"id": source["id"], "kind": source.get("kind"), "status": "catalog_only"}))
            continue
        if args.check:
            try:
                print(json.dumps({"id": source["id"], **check_url(str(source["download_url"]))}))
            except Exception as error:
                print(json.dumps({"id": source["id"], "error": str(error)}))
        zip_path = DOWNLOAD_DIR / f"{source['id']}.zip"
        if args.download or args.extract:
            zip_path = download(source, args.force)
            print(json.dumps({"id": source["id"], "downloaded": str(zip_path.relative_to(PROJECT_ROOT)), "bytes": zip_path.stat().st_size}))
        if args.analyze and zip_path.exists():
            print(json.dumps({"id": source["id"], **analyze_zip(zip_path)}))
        if args.extract:
            assets = extract_zip(source, zip_path, args.force)
            imported.extend(assets)
            print(json.dumps({"id": source["id"], "extracted_images": len(assets)}))

    if imported:
        write_manifest(imported)
        print(f"DONE: external_assets={len(imported)} manifest={EXTERNAL_MANIFEST_PATH}")


if __name__ == "__main__":
    main()
