from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from holocron.core.paths import ASSETS_DIR

MANIFEST_PATH = ASSETS_DIR / "pdf_images" / "manifest.json"


@lru_cache(maxsize=4)
def _load_manifest_cached(manifest_key: str, modified_ns: int) -> tuple[dict[str, object], ...]:
    manifest_path = Path(manifest_key)
    if not manifest_path.exists():
        return ()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    return tuple(payload.get("images", []))


def load_image_manifest(manifest_path: Path | None = None) -> list[dict[str, object]]:
    path = manifest_path or MANIFEST_PATH
    if not path.exists():
        return []
    return list(_load_manifest_cached(str(path.resolve()), path.stat().st_mtime_ns))


def filter_images(
    *,
    book: str | None = None,
    source_file: str | None = None,
    page: int | str | None = None,
    q: str = "",
    limit: int | None = 100,
) -> list[dict[str, object]]:
    query = q.strip().lower()
    page_text = str(page) if page is not None else None
    matches = []
    for image in load_image_manifest():
        if book and str(image.get("book_slug")) != book and str(image.get("book")) != book:
            continue
        if source_file and str(image.get("source_file")) != source_file:
            continue
        if page_text and str(image.get("page")) != page_text:
            continue
        haystack = " ".join(
            str(image.get(key, "")) for key in ("book", "source_file", "page", "id", "path")
        ).lower()
        if query and query not in haystack:
            continue
        matches.append(image)
    matches = sorted(matches, key=lambda item: int(item.get("area", 0)), reverse=True)
    return matches if limit is None else matches[:limit]


def images_for_source(source_file: object, page: object, limit: int = 4) -> list[dict[str, object]]:
    if not source_file or page is None:
        return []
    return filter_images(source_file=str(source_file), page=str(page), limit=limit)


def primary_image_for_source(source_file: object, page: object) -> dict[str, object] | None:
    matches = images_for_source(source_file, page, limit=1)
    return matches[0] if matches else None
