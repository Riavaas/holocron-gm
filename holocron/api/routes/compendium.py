from fastapi import APIRouter, HTTPException, Query

from holocron.compendium.creatures import filter_creatures, load_creatures

router = APIRouter()


@router.get("/creatures")
def creatures(
    q: str = "",
    cr: str | None = None,
    creature_type: str | None = Query(None, alias="type"),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, object]:
    catalog = load_creatures()
    matches = filter_creatures(catalog, q, cr, creature_type)
    return {
        "items": matches[:limit],
        "total": len(matches),
        "filters": {
            "challenge_ratings": sorted(
                {str(item["cr"]) for item in catalog},
                key=lambda value: float(value.replace("/", ".")) if value.replace("/", ".").replace(".", "", 1).isdigit() else 999,
            ),
            "types": sorted({str(item["type"]) for item in catalog}),
        },
    }


@router.get("/creatures/{slug:path}")
def creature(slug: str) -> dict[str, object]:
    match = next((item for item in load_creatures() if item["slug"] == slug), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Creature not found")
    return match
