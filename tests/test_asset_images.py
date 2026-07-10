import json

from holocron.assets import external as external_assets
from holocron.assets import images as image_assets
from holocron.assets.tokens import token_assets
from holocron.compendium.creatures import load_creatures


def write_manifest(path):
    path.write_text(
        json.dumps(
            {
                "images": [
                    {
                        "id": "scum-and-villainy-p135-01",
                        "book": "Scum and Villainy",
                        "book_slug": "scum-and-villainy",
                        "source_file": "SW5e - Scum and Villainy - 20191105.pdf",
                        "page": 135,
                        "area": 120000,
                        "path": "pdf_images/scum-and-villainy/scum-and-villainy-p135-01.jpg",
                        "url": "/assets/pdf_images/scum-and-villainy/scum-and-villainy-p135-01.jpg",
                    },
                    {
                        "id": "scum-and-villainy-p010-01",
                        "book": "Scum and Villainy",
                        "book_slug": "scum-and-villainy",
                        "source_file": "SW5e - Scum and Villainy - 20191105.pdf",
                        "page": 10,
                        "area": 80000,
                        "path": "pdf_images/scum-and-villainy/scum-and-villainy-p010-01.jpg",
                        "url": "/assets/pdf_images/scum-and-villainy/scum-and-villainy-p010-01.jpg",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )


def test_image_manifest_filters_by_source_and_page(tmp_path, monkeypatch):
    manifest = tmp_path / "manifest.json"
    write_manifest(manifest)
    monkeypatch.setattr(image_assets, "MANIFEST_PATH", manifest)
    image_assets._load_manifest_cached.cache_clear()

    matches = image_assets.filter_images(source_file="SW5e - Scum and Villainy - 20191105.pdf", page=135)

    assert len(matches) == 1
    assert matches[0]["id"] == "scum-and-villainy-p135-01"


def test_creature_catalog_includes_pdf_image_metadata(tmp_path, monkeypatch):
    manifest = tmp_path / "manifest.json"
    write_manifest(manifest)
    monkeypatch.setattr(image_assets, "MANIFEST_PATH", manifest)
    image_assets._load_manifest_cached.cache_clear()
    creatures = tmp_path / "creatures" / "droids"
    creatures.mkdir(parents=True)
    (creatures / "jk-13-security-droid.md").write_text(
        """---
creature_name: "JK-13 Security Droid"
creature_type: "droid"
challenge_rating: "10"
armor_class: "17"
hit_points: "150"
speed: "30 ft."
source: "SW5e Scum and Villainy"
source_file: "SW5e - Scum and Villainy - 20191105.pdf"
page_start: 135
actions: ["Multiattack"]
---

# JK-13 Security Droid
""",
        encoding="utf-8",
    )

    catalog = load_creatures(tmp_path / "creatures")

    assert catalog[0]["primary_image"]["url"].endswith("scum-and-villainy-p135-01.jpg")
    assert catalog[0]["images"]


def test_creature_catalog_includes_matched_token_and_stat_block(tmp_path, monkeypatch):
    manifest = tmp_path / "external_manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "assets": [
                    {
                        "id": "b1",
                        "asset_type": "tokens",
                        "name": "B1Droid",
                        "url": "/assets/external/test-pack/b1.png",
                        "source_id": "test-pack",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(external_assets, "EXTERNAL_MANIFEST_PATH", manifest)
    external_assets._load_json_cached.cache_clear()
    token_assets.cache_clear()

    creatures = tmp_path / "creatures" / "droids"
    creatures.mkdir(parents=True)
    (creatures / "b1-battle-droid.md").write_text(
        """---
creature_name: "B1 Battle Droid"
creature_type: "droid"
size: "Medium"
alignment: "unaligned"
challenge_rating: "1/8"
xp: "25"
armor_class: "14 (armor plating)"
hit_points: "7 (2d8-2)"
speed: "30 ft."
abilities: {"str": "9 (-1)", "dex": "14 (+2)", "con": "9 (-1)", "int": "13 (+1)", "wis": "10 (+0)", "cha": "7 (-2)"}
senses: ["darkvision 60 ft", "passive Perception 10"]
languages: ["Binary", "Galactic Basic"]
traits: ["Battle Droid Swarm", "Circuitry"]
actions: ["Blaster Rifle", "Stock Strike"]
damage_vulnerabilities: ["ion"]
damage_resistances: ["necrotic"]
condition_immunities: ["poison", "disease"]
source_file: "SW5e - Scum and Villainy - 20191105.pdf"
page_start: 21
---

# B1 Battle Droid
""",
        encoding="utf-8",
    )

    catalog = load_creatures(tmp_path / "creatures")

    assert catalog[0]["matched_token"]["url"].endswith("/b1.png")
    assert catalog[0]["asset_match"]["reason"] == "name"
    assert catalog[0]["stat_block"]["abilities"]["dex"] == "14 (+2)"
    assert catalog[0]["stat_block"]["traits"] == ["Battle Droid Swarm", "Circuitry"]
