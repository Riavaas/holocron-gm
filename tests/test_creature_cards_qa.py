import subprocess
import sys
from pathlib import Path


REQUIRED_CREATURE_FIELDS = [
    "title:",
    "source:",
    "source_file:",
    "knowledge_type:",
    "category:",
    "book:",
    "section:",
    "page_start:",
    "page_end:",
    "tags:",
    "status:",
    "verbatim_risk:",
    "creature_name:",
    "creature_type:",
    "size:",
    "alignment:",
    "challenge_rating:",
    "xp:",
    "armor_class:",
    "hit_points:",
    "speed:",
    "abilities:",
    "saving_throws:",
    "skills:",
    "damage_vulnerabilities:",
    "damage_resistances:",
    "damage_immunities:",
    "condition_immunities:",
    "senses:",
    "languages:",
    "traits:",
    "actions:",
    "reactions:",
    "legendary_actions:",
    "lair_actions:",
    "regional_effects:",
    "environment:",
    "faction:",
    "role:",
]


def creature_cards() -> list[Path]:
    return sorted(path for path in Path("Compendium/scum-and-villainy/creatures").rglob("*.md") if path.name != "index.md")


def test_qa_creature_cards_script_runs():
    result = subprocess.run([sys.executable, "scripts/qa_creature_cards.py"], check=False, capture_output=True, text=True)

    assert result.returncode == 0
    assert "creatures=30" in result.stdout
    assert Path("reports/creature_cards_qa.md").exists()


def test_all_creature_cards_have_required_frontmatter_fields():
    cards = creature_cards()

    assert len(cards) == 30
    for path in cards:
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        for field in REQUIRED_CREATURE_FIELDS:
            assert field in frontmatter, f"{path} missing {field}"


def test_creature_cards_have_no_duplicate_slugs():
    slugs = [path.stem for path in creature_cards()]

    assert len(slugs) == len(set(slugs))


def test_creature_index_links_exist():
    roots = [
        Path("Compendium/scum-and-villainy/index.md"),
        Path("Compendium/scum-and-villainy/creatures/index.md"),
        Path("Compendium/scum-and-villainy/indexes/creature-index.md"),
        Path("Compendium/scum-and-villainy/indexes/cr-index.md"),
        Path("Compendium/scum-and-villainy/indexes/type-index.md"),
        Path("Compendium/scum-and-villainy/indexes/page-index.md"),
        Path("Compendium/scum-and-villainy/statblocks/index.md"),
        Path("Compendium/scum-and-villainy/statblocks/by-cr.md"),
        Path("Compendium/scum-and-villainy/statblocks/by-type.md"),
    ]

    for path in roots:
        text = path.read_text(encoding="utf-8")
        for link in [part.split(")", 1)[0] for part in text.split("](")[1:]]:
            if link.startswith("#") or "://" in link:
                continue
            target = link.split("#", 1)[0]
            assert (path.parent / target).resolve().exists(), f"{path} -> {link}"


def test_sample_creature_cards_have_citations():
    samples = [
        Path("Compendium/scum-and-villainy/creatures/droids/hk-47-assassin-droid.md"),
        Path("Compendium/scum-and-villainy/creatures/droids/ig-88-assassin-droid.md"),
        Path("Compendium/scum-and-villainy/creatures/beasts/acklay-adult.md"),
        Path("Compendium/scum-and-villainy/creatures/droids/r2-series-astromech-droid.md"),
    ]

    for path in samples:
        text = path.read_text(encoding="utf-8")
        assert "SW5e Scum and Villainy" in text
        assert "Pages:" in text
        assert "page_start:" in text
        assert "page_end:" in text
