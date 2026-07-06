import subprocess
import sys
from pathlib import Path


REQUIRED_POWER_FIELDS = [
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
    "power_type:",
    "level:",
    "casting_time:",
    "range:",
    "duration:",
    "concentration:",
    "save:",
    "attack_roll:",
    "damage_types:",
    "conditions_inflicted:",
    "classes_or_archetypes:",
]


def power_cards() -> list[Path]:
    cards = []
    for folder in ["force", "tech"]:
        cards.extend(path for path in Path("Compendium/player-handbook/powers", folder).glob("*.md") if path.name != "index.md")
    return sorted(cards)


def test_qa_power_cards_script_runs():
    result = subprocess.run([sys.executable, "scripts/qa_power_cards.py"], check=False, capture_output=True, text=True)

    assert result.returncode == 0
    assert "force=200 tech=200" in result.stdout
    assert Path("reports/power_cards_qa.md").exists()


def test_all_power_cards_have_required_frontmatter_fields():
    cards = power_cards()

    assert len(cards) == 400
    for path in cards:
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        for field in REQUIRED_POWER_FIELDS:
            assert field in frontmatter, f"{path} missing {field}"


def test_power_cards_have_valid_types_and_categories():
    for path in power_cards():
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        expected_type = path.parent.name
        assert f'power_type: "{expected_type}"' in frontmatter
        assert f'category: "{expected_type}_power"' in frontmatter


def test_power_cards_have_no_duplicate_slugs():
    slugs = [path.stem for path in power_cards()]

    assert len(slugs) == len(set(slugs))


def test_power_indexes_link_to_existing_files():
    roots = [
        Path("Compendium/player-handbook/powers/index.md"),
        Path("Compendium/player-handbook/powers/force/index.md"),
        Path("Compendium/player-handbook/powers/tech/index.md"),
        Path("Compendium/player-handbook/chapters/11-force-powers/index.md"),
        Path("Compendium/player-handbook/chapters/12-tech-powers/index.md"),
    ]

    for path in roots:
        text = path.read_text(encoding="utf-8")
        for link in [part.split(")", 1)[0] for part in text.split("](")[1:]]:
            if link.startswith("#") or "://" in link:
                continue
            assert (path.parent / link).resolve().exists(), f"{path} -> {link}"
