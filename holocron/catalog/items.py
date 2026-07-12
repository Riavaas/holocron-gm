from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import re
from typing import Any
from urllib.request import Request, urlopen

from holocron.core.paths import DATA_DIR

SW5E_API_BASE = "https://sw5eapi.azurewebsites.net/api"
CACHE_PATH = DATA_DIR / "sw5e_cache" / "items.json"
REMOTE_ENDPOINTS = ("equipment", "enhanceditem")


def _remote_json(endpoint: str) -> list[dict[str, Any]]:
    request = Request(
        f"{SW5E_API_BASE}/{endpoint}",
        headers={"Accept": "application/json", "User-Agent": "Holocron-GM/0.1"},
    )
    with urlopen(request, timeout=25) as response:
        payload: object = json.loads(response.read().decode("utf-8"))
    # The legacy equipment endpoint returns a JSON string containing JSON.
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, list):
        raise ValueError(f"Unexpected SW5e payload for {endpoint}")
    return [item for item in payload if isinstance(item, dict)]


def _stable_id(kind: str, item: dict[str, Any]) -> str:
    name = str(item.get("name") or "item").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
    source = str(item.get("contentSource") or "unknown").lower()
    return f"{kind}:{source}:{slug}"


def _number(value: object, default: float = 0) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def _normalize_equipment(item: dict[str, Any]) -> dict[str, Any]:
    die_count = int(_number(item.get("damageNumberOfDice")))
    die_type = int(_number(item.get("damageDieType")))
    damage = f"{die_count}d{die_type}" if die_count and die_type else ""
    return {
        "id": _stable_id("equipment", item),
        "kind": "equipment",
        "name": str(item.get("name") or "Unnamed equipment"),
        "category": str(item.get("equipmentCategory") or "Gear"),
        "description": str(item.get("description") or ""),
        "cost": int(_number(item.get("cost"))),
        "weight": _number(item.get("weight")),
        "source": str(item.get("contentSource") or "SW5e"),
        "content_type": str(item.get("contentType") or "Core"),
        "damage": damage,
        "damage_type": str(item.get("damageType") or ""),
        "weapon_classification": str(item.get("weaponClassification") or ""),
        "armor_classification": str(item.get("armorClassification") or ""),
        "armor_class": str(item.get("ac") or ""),
        "properties": item.get("properties") or [],
    }


def _normalize_enhanced(item: dict[str, Any]) -> dict[str, Any]:
    rarities = item.get("rarityOptions") or []
    rarity = item.get("searchableRarity") or (rarities[0] if rarities else "Enhanced")
    return {
        "id": _stable_id("enhanced", item),
        "kind": "enhanced",
        "name": str(item.get("name") or "Unnamed enhanced item"),
        "category": str(item.get("type") or "Enhanced Item"),
        "subcategory": str(item.get("subtype") or ""),
        "description": str(item.get("text") or ""),
        "cost": 0,
        "weight": 0,
        "source": str(item.get("contentSource") or "SW5e"),
        "content_type": str(item.get("contentType") or "Core"),
        "rarity": str(rarity),
        "rarity_options": rarities,
        "requires_attunement": bool(item.get("requiresAttunement")),
        "value": str(item.get("valueText") or ""),
        "properties": [],
    }


def refresh_item_catalog(cache_path: Path = CACHE_PATH) -> list[dict[str, Any]]:
    equipment = [_normalize_equipment(item) for item in _remote_json("equipment")]
    enhanced = [_normalize_enhanced(item) for item in _remote_json("enhanceditem")]
    items = sorted(equipment + enhanced, key=lambda item: str(item["name"]).lower())
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"items": items}, ensure_ascii=True), encoding="utf-8")
    load_item_catalog.cache_clear()
    return items


@lru_cache(maxsize=2)
def load_item_catalog(cache_path: Path = CACHE_PATH) -> tuple[dict[str, Any], ...]:
    if not cache_path.exists():
        return tuple(refresh_item_catalog(cache_path))
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    items = payload.get("items", []) if isinstance(payload, dict) else []
    return tuple(item for item in items if isinstance(item, dict))


def filter_items(
    items: tuple[dict[str, Any], ...] | list[dict[str, Any]],
    query: str = "",
    category: str | None = None,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    needle = query.strip().lower()
    matches: list[dict[str, Any]] = []
    for item in items:
        if kind and item.get("kind") != kind:
            continue
        if category and item.get("category") != category:
            continue
        searchable = " ".join(
            str(item.get(key) or "")
            for key in ("name", "category", "subcategory", "description", "properties", "rarity")
        ).lower()
        if needle and needle not in searchable:
            continue
        matches.append(item)
    return matches
