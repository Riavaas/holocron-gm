import json

from holocron.catalog import items as item_catalog
from holocron.compendium.creatures import _normalize_challenge_rating


def test_refresh_item_catalog_normalizes_remote_items(tmp_path, monkeypatch):
    remote = {
        "equipment": [
            {
                "name": "Test Blaster",
                "equipmentCategory": "Weapon",
                "cost": 500,
                "weight": "3.5",
                "damageNumberOfDice": 1,
                "damageDieType": 8,
                "damageType": "Energy",
                "properties": ["reload 8"],
                "contentSource": "PHB",
            }
        ],
        "enhanceditem": [
            {
                "name": "Prototype Test Blaster",
                "type": "Weapon",
                "text": "Enhanced test item.",
                "searchableRarity": "Prototype",
                "contentSource": "WH",
            }
        ],
    }
    monkeypatch.setattr(item_catalog, "_remote_json", lambda endpoint: remote[endpoint])
    cache = tmp_path / "items.json"

    items = item_catalog.refresh_item_catalog(cache)

    assert len(items) == 2
    assert next(item for item in items if item["kind"] == "equipment")["damage"] == "1d8"
    assert next(item for item in items if item["kind"] == "enhanced")["rarity"] == "Prototype"
    assert len(json.loads(cache.read_text(encoding="utf-8"))["items"]) == 2


def test_filter_items_matches_category_and_description():
    items = (
        {"name": "Medpac", "category": "Medical", "description": "Restores health", "kind": "equipment"},
        {"name": "Blaster", "category": "Weapon", "description": "Energy weapon", "kind": "equipment"},
    )

    assert item_catalog.filter_items(items, "health", "Medical") == [items[0]]


def test_challenge_rating_prefix_is_normalized():
    assert _normalize_challenge_rating("CR 3") == "3"
    assert _normalize_challenge_rating("Challenge Rating: 1/2") == "1/2"
