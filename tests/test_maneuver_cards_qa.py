import subprocess
import sys
from pathlib import Path


REQUIRED_MANEUVER_FIELDS = [
    "title:",
    "source:",
    "source_file:",
    "knowledge_type:",
    "category:",
    "chapter:",
    "section:",
    "page_start:",
    "page_end:",
    "tags:",
    "status:",
    "verbatim_risk:",
    "maneuver_type:",
    "activation:",
    "range:",
    "duration:",
    "save:",
    "attack_roll:",
    "damage_types:",
    "conditions_inflicted:",
    "resource_cost:",
    "prerequisites:",
]


def maneuver_cards() -> list[Path]:
    return sorted(path for path in Path("Compendium/player-handbook/maneuvers").glob("*.md") if path.name != "index.md")


def test_qa_maneuver_cards_script_runs():
    result = subprocess.run([sys.executable, "scripts/qa_maneuver_cards.py"], check=False, capture_output=True, text=True)

    assert result.returncode == 0
    assert "maneuvers=100" in result.stdout
    assert Path("reports/maneuver_cards_qa.md").exists()


def test_all_maneuver_cards_have_required_frontmatter_fields():
    cards = maneuver_cards()

    assert len(cards) == 100
    for path in cards:
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        for field in REQUIRED_MANEUVER_FIELDS:
            assert field in frontmatter, f"{path} missing {field}"


def test_maneuver_cards_have_valid_category():
    for path in maneuver_cards():
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        assert 'category: "maneuver"' in frontmatter


def test_maneuver_cards_have_no_duplicate_slugs():
    slugs = [path.stem for path in maneuver_cards()]

    assert len(slugs) == len(set(slugs))


def test_maneuver_index_links_exist():
    roots = [
        Path("Compendium/player-handbook/maneuvers/index.md"),
        Path("Compendium/player-handbook/chapters/13-maneuvers/index.md"),
    ]

    for path in roots:
        text = path.read_text(encoding="utf-8")
        for link in [part.split(")", 1)[0] for part in text.split("](")[1:]]:
            if link.startswith("#") or "://" in link:
                continue
            target = link.split("#", 1)[0]
            assert (path.parent / target).resolve().exists(), f"{path} -> {link}"


def test_sample_maneuver_cards_have_citations():
    for filename in ["charging-attack.md", "rally.md", "weak-point-strike.md"]:
        path = Path("Compendium/player-handbook/maneuvers") / filename
        text = path.read_text(encoding="utf-8")

        assert "SW5e Player's Handbook" in text
        assert "Pages:" in text
        assert "page_start:" in text
        assert "page_end:" in text
