import random

from fastapi import APIRouter, HTTPException, Query

from holocron.catalog.items import filter_items, load_item_catalog, refresh_item_catalog

router = APIRouter()
RARITY_ORDER = ["Unenhanced", "Standard", "Premium", "Prototype", "Advanced", "Legendary", "Artifact"]


def _catalog_or_503():
    try:
        return load_item_catalog()
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=503, detail="SW5e item catalog unavailable") from error


def _category_needle(value: str | None) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _rarity_index(value: object) -> int:
    rarity = str(value or "Unenhanced")
    return RARITY_ORDER.index(rarity) if rarity in RARITY_ORDER else 0


def _rarity_cap_for_cr(cr: int) -> str:
    if cr >= 25:
        return "Artifact"
    if cr >= 19:
        return "Legendary"
    if cr >= 13:
        return "Advanced"
    if cr >= 8:
        return "Prototype"
    return "Premium"


def _loot_summary(items: list[dict[str, object]]) -> dict[str, object]:
    by_rarity: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for item in items:
        rarity = str(item.get("rarity") or "Unenhanced")
        category = str(item.get("category") or item.get("kind") or "Misc")
        by_rarity[rarity] = by_rarity.get(rarity, 0) + 1
        by_category[category] = by_category.get(category, 0) + 1
    return {
        "count": len(items),
        "rarities": sorted(by_rarity.items(), key=lambda item: (_rarity_index(item[0]), item[0])),
        "categories": sorted(by_category.items(), key=lambda item: (-item[1], item[0])),
    }


@router.get("/items/loot")
def loot_items(
    cr: int = Query(1, ge=0, le=30),
    count: int = Query(4, ge=1, le=12),
    extra_category: list[str] | None = Query(None),
    max_rarity: list[str] | None = Query(None),
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
        cap_index = _rarity_index(_rarity_cap_for_cr(cr))
        candidates.extend(item for item in catalog if item.get("kind") == "enhanced" and _rarity_index(item.get("rarity")) <= cap_index)
    rng = random.Random(seed)
    selected = rng.sample(candidates, min(count, len(candidates))) if candidates else []
    extra_categories = extra_category or []
    rarity_caps = max_rarity or []
    for index, category in enumerate(extra_categories):
        cap = rarity_caps[index] if index < len(rarity_caps) else (rarity_caps[-1] if rarity_caps else None)
        max_index = _rarity_index(cap) if cap in RARITY_ORDER else len(RARITY_ORDER) - 1
        needle = _category_needle(category)
        extra_pool = [
            item for item in catalog
            if needle in _category_needle(f"{item.get('category')} {item.get('kind')} {item.get('subcategory')}")
            and _rarity_index(item.get("rarity")) <= max_index
        ]
        if extra_pool:
            selected.append(rng.choice(extra_pool))
    credits = rng.randrange(max(50, 100 + cr * 100), max(100, 400 + cr * 400), 10)
    return {"items": selected, "credits": credits, "budget": budget, "summary": _loot_summary(selected)}


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
    price_modifiers = {
        "poor": .75,
        "modest": 1.0,
        "wealthy": 1.15,
        "black-market": 1.45,
    }
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
    departments: dict[str, int] = {}
    for item in wares:
        category = str(item.get("category") or item.get("kind") or "Misc")
        departments[category] = departments.get(category, 0) + 1
    shop_names = {
        "empire": "Quartermaster Annex",
        "republic": "Relief Depot",
        "outlaws": "Back-Room Exchange",
        "poor": "Scrap Counter",
        "neutral": "Dockside Provisions",
    }
    pitch_templates = {
        "empire": "Clean ledgers, serialized gear, and a clerk who notices forged permits.",
        "republic": "Relief crates, field repairs, and a preference for buyers with a cause.",
        "outlaws": "No questions, no refunds, and a quiet surcharge for anything traceable.",
        "poor": "Salvaged shelves, barter welcome, and every working component already has a story.",
        "neutral": "Practical wares for travelers who need to leave before docking fees climb.",
    }
    policies = {
        "empire": "Restricted wares require papers; suspicious purchases are logged.",
        "republic": "Discounts are possible for relief work, medical aid, or anti-slaver operations.",
        "outlaws": "Rare goods move fast; names are optional, favors are not.",
        "poor": "Barter beats credits, and damaged gear may be repairable with time.",
        "neutral": "Bulk purchases are welcome, but docking delays change prices by the hour.",
    }
    adjusted_wares = []
    price_modifier = price_modifiers.get(wealth, 1.0)
    for item in wares:
        priced = dict(item)
        if priced.get("kind") == "equipment":
            priced["shop_cost"] = max(1, round(int(priced.get("cost") or 0) * price_modifier))
        adjusted_wares.append(priced)
    departments_detail: dict[str, list[dict[str, object]]] = {}
    for item in adjusted_wares:
        category = str(item.get("category") or item.get("kind") or "Misc")
        departments_detail.setdefault(category, []).append(item)
    for entries in departments_detail.values():
        entries.sort(key=lambda item: (str(item.get("rarity") or "Unenhanced"), str(item.get("name") or "")))
    rare_stock = sorted(
        [item for item in adjusted_wares if _rarity_index(item.get("rarity")) >= _rarity_index("Prototype")],
        key=lambda item: (_rarity_index(item.get("rarity")), int(item.get("shop_cost") or item.get("cost") or 0)),
        reverse=True,
    )[:5]
    return {
        "name": shop_names.get(allegiance, "Dockside Provisions"),
        "settlement": settlement,
        "allegiance": allegiance,
        "wealth": wealth,
        "price_modifier": price_modifier,
        "pitch": pitch_templates.get(allegiance, pitch_templates["neutral"]),
        "policy": policies.get(allegiance, policies["neutral"]),
        "departments": sorted(departments.items(), key=lambda item: (-item[1], item[0])),
        "department_wares": [
            {"category": category, "items": items}
            for category, items in sorted(departments_detail.items(), key=lambda item: (-len(item[1]), item[0]))
        ],
        "rare_stock": rare_stock,
        "wares": adjusted_wares,
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
