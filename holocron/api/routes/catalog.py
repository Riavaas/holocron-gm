import random

from fastapi import APIRouter, HTTPException, Query

from holocron.catalog.items import filter_items, load_item_catalog, refresh_item_catalog

router = APIRouter()


def _catalog_or_503():
    try:
        return load_item_catalog()
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=503, detail="SW5e item catalog unavailable") from error


@router.get("/items/loot")
def loot_items(
    cr: int = Query(1, ge=0, le=30),
    count: int = Query(4, ge=1, le=12),
    extra_category: str | None = None,
    max_rarity: str | None = None,
    seed: int | None = None,
) -> dict[str, object]:
    catalog = _catalog_or_503()
    budget = max(250, 300 + cr * 850)
    candidates = [
        item
        for item in catalog
        if item.get("kind") == "equipment" and int(item.get("cost") or 0) <= budget
    ]
    if cr >= 4:
        candidates.extend(item for item in catalog if item.get("kind") == "enhanced")
    rng = random.Random(seed)
    selected = rng.sample(candidates, min(count, len(candidates))) if candidates else []
    if extra_category:
        rarity_order = ["Unenhanced", "Standard", "Premium", "Prototype", "Advanced", "Legendary", "Artifact"]
        max_index = rarity_order.index(max_rarity) if max_rarity in rarity_order else len(rarity_order) - 1
        extra_pool = [
            item for item in catalog
            if extra_category.lower() in str(item.get("category") or item.get("kind") or "").lower()
            and rarity_order.index(str(item.get("rarity") or "Unenhanced")) <= max_index
            if str(item.get("rarity") or "Unenhanced") in rarity_order
        ]
        if extra_pool:
            selected.append(rng.choice(extra_pool))
    credits = rng.randrange(max(50, 100 + cr * 100), max(100, 400 + cr * 400), 10)
    return {"items": selected, "credits": credits, "budget": budget}


@router.get("/items/shopkeeper")
def shopkeeper_items(
    settlement: str = "town",
    allegiance: str = "neutral",
    wealth: str = "modest",
    seed: int | None = None,
) -> dict[str, object]:
    catalog = _catalog_or_503()
    size_counts = {"outpost": 8, "village": 12, "town": 20, "city": 32, "metropolis": 48}
    wealth_caps = {"poor": 500, "modest": 3000, "wealthy": 18000, "black-market": 60000}
    allowed = [
        item for item in catalog
        if int(item.get("cost") or 0) <= wealth_caps.get(wealth, 3000)
        or item.get("kind") == "enhanced" and wealth in {"wealthy", "black-market"}
    ]
    allegiance_terms = {
        "empire": ("armor", "weapon", "blaster", "trooper", "military"),
        "republic": ("med", "tool", "shield", "armor", "commlink"),
        "outlaws": ("weapon", "poison", "explosive", "stealth", "security"),
        "poor": ("gear", "tool", "kit", "ration", "clothes"),
    }
    terms = allegiance_terms.get(allegiance, ())
    if terms:
        preferred = [
            item for item in allowed
            if any(term in f"{item.get('name')} {item.get('category')} {item.get('description')}".lower() for term in terms)
        ]
        if preferred:
            allowed = preferred
    rng = random.Random(seed)
    count = size_counts.get(settlement, 20)
    wares = rng.sample(allowed, min(count, len(allowed))) if allowed else []
    shop_names = {
        "empire": "Quartermaster Annex",
        "republic": "Relief Depot",
        "outlaws": "Back-Room Exchange",
        "poor": "Scrap Counter",
        "neutral": "Dockside Provisions",
    }
    return {
        "name": shop_names.get(allegiance, "Dockside Provisions"),
        "settlement": settlement,
        "allegiance": allegiance,
        "wealth": wealth,
        "wares": wares,
    }


@router.get("/items")
def items(
    q: str = "",
    category: str | None = None,
    kind: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=200),
) -> dict[str, object]:
    catalog = _catalog_or_503()
    matches = filter_items(catalog, q, category, kind)
    return {
        "items": matches[offset : offset + limit],
        "total": len(matches),
        "offset": offset,
        "categories": sorted({str(item.get("category")) for item in catalog if item.get("category")}),
    }


@router.post("/items/actions/refresh")
def refresh_items() -> dict[str, object]:
    try:
        catalog = refresh_item_catalog()
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=503, detail="SW5e item catalog refresh failed") from error
    return {"total": len(catalog), "status": "refreshed"}
