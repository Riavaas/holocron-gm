from fastapi import APIRouter, Query

from holocron.assets.external import external_summary, load_external_manifest, load_external_sources
from holocron.assets.images import filter_images, load_image_manifest

router = APIRouter()


@router.get("/images")
def images(
    book: str | None = None,
    source_file: str | None = None,
    page: int | None = None,
    q: str = "",
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, object]:
    matches = filter_images(book=book, source_file=source_file, page=page, q=q, limit=None)
    return {"items": matches[:limit], "total": len(matches)}


@router.get("/images/summary")
def image_summary() -> dict[str, object]:
    manifest = load_image_manifest()
    by_book: dict[str, int] = {}
    for image in manifest:
        key = str(image.get("book_slug") or image.get("book") or "unknown")
        by_book[key] = by_book.get(key, 0) + 1
    return {"total": len(manifest), "books": by_book}


@router.get("/external-sources")
def external_sources() -> dict[str, object]:
    sources = load_external_sources()
    return {"items": sources, "total": len(sources)}


@router.get("/external")
def external_assets(
    asset_type: str | None = None,
    source_id: str | None = None,
    q: str = "",
    limit: int = Query(100, ge=1, le=1000),
) -> dict[str, object]:
    query = q.strip().lower()
    matches = []
    for asset in load_external_manifest():
        if asset_type and asset.get("asset_type") != asset_type:
            continue
        if source_id and asset.get("source_id") != source_id:
            continue
        haystack = " ".join(str(asset.get(key, "")) for key in ("name", "source_id", "author", "path")).lower()
        if query and query not in haystack:
            continue
        matches.append(asset)
    return {"items": matches[:limit], "total": len(matches)}


@router.get("/external/summary")
def external_assets_summary() -> dict[str, object]:
    return external_summary()
