import json

from holocron.assets import images as image_assets
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
