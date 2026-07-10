from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from holocron.core.paths import ASSETS_DIR

EXTERNAL_SOURCES_PATH = ASSETS_DIR / "external_sources.json"
EXTERNAL_MANIFEST_PATH = ASSETS_DIR / "external" / "manifest.json"


@lru_cache(maxsize=4)
def _load_json_cached(path_key: str, modified_ns: int) -> dict[str, object]:
    path = Path(path_key)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_external_sources(path: Path | None = None) -> list[dict[str, object]]:
    source_path = path or EXTERNAL_SOURCES_PATH
    if not source_path.exists():
        return []
    payload = _load_json_cached(str(source_path.resolve()), source_path.stat().st_mtime_ns)
    return list(payload.get("sources", []))


def load_external_manifest(path: Path | None = None) -> list[dict[str, object]]:
    manifest_path = path or EXTERNAL_MANIFEST_PATH
    if not manifest_path.exists():
        return []
    payload = _load_json_cached(str(manifest_path.resolve()), manifest_path.stat().st_mtime_ns)
    return list(payload.get("assets", []))


def external_summary() -> dict[str, object]:
    sources = load_external_sources()
    assets = load_external_manifest()
    by_type: dict[str, int] = {}
    for asset in assets:
        key = str(asset.get("asset_type") or "unknown")
        by_type[key] = by_type.get(key, 0) + 1
    return {
        "sources": len(sources),
        "assets": len(assets),
        "asset_types": by_type,
    }
