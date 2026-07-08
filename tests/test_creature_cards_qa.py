import subprocess
import sys
from pathlib import Path

from scripts.build_scum_creatures import (
    is_statblock_start,
    join_continued_fields,
    named_entry,
    parse_creature,
    title_case,
)


EXPECTED_CREATURE_COUNT = 225


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


def test_statblock_start_rejects_prose_that_begins_with_a_size():
    lines = [
        (50, "FAMBAAS"),
        (50, "Large non-sentient amphibians native to Naboo and Onderon, biologists surmise that both"),
        (50, "the fambaas and falumpasets may share an origin."),
        (50, "MONSTERS"),
    ]

    assert is_statblock_start(lines, 1) is False


def test_challenge_field_does_not_absorb_trait_text():
    block = join_continued_fields(
        [
            "Languages",
            "Challenge 13",
            "Circuitry. The construct has disadvantage on saving throws.",
        ]
    )

    assert block == [
        "Languages",
        "Challenge 13",
        "Circuitry. The construct has disadvantage on saving throws.",
    ]


def test_misspelled_gargantuan_size_is_normalized():
    lines = [
        (66, "AT-TE"),
        (66, "Garagantuan construct, unaligned"),
        (66, "Armor Class 18"),
        (66, "Hit Points 248"),
        (66, "Speed 40 ft."),
        (66, "Challenge 18 (20,000 XP)"),
    ]

    creature = parse_creature(lines, 1, len(lines))

    assert creature.name == "AT-TE"
    assert creature.size == "Gargantuan"
    assert creature.challenge_rating == "18"


def test_source_field_aliases_are_parsed():
    lines = [
        (135, "JK-13 SECURITY DROID"),
        (135, "Large droid, unaligned"),
        (135, "Armor Class 18"),
        (135, "Hit Points 150"),
        (135, "Speed 30 ft."),
        (135, "Saves Str +10, Con +7"),
        (135, "Damage Resistance energy from unenhanced"),
        (135, "sources"),
        (135, "Challenge 9 (5,000 XP)"),
    ]

    creature = parse_creature(lines, 1, len(lines))

    assert creature.saving_throws == ["Str +10", "Con +7"]
    assert creature.damage_resistances == ["energy from unenhanced sources"]


def test_named_entry_accepts_attack_without_period():
    assert named_entry("Gaffi Stick Melee Weapon Attack: +4 to hit") == "Gaffi Stick"
    assert named_entry("Agressive As a bonus action, the tusken can move") == "Agressive"
    assert named_entry("Multiattack The sloth makes two fist attacks") == "Multiattack"
    assert named_entry("It confers no benefit to droids or constructs.") == ""


def test_droid_model_acronyms_preserve_source_casing():
    assert title_case("3PO SERIES PROTOCOL DROID") == "3PO Series Protocol Droid"
    assert title_case("JK-13 SECURITY DROID") == "JK-13 Security Droid"
    assert title_case("ID9 SEEKER DROID") == "ID9 Seeker Droid"


def test_qa_creature_cards_script_runs():
    result = subprocess.run([sys.executable, "scripts/qa_creature_cards.py"], check=False, capture_output=True, text=True)

    assert result.returncode == 0
    assert f"creatures={EXPECTED_CREATURE_COUNT}" in result.stdout
    assert Path("reports/creature_cards_qa.md").exists()


def test_all_creature_cards_have_required_frontmatter_fields():
    cards = creature_cards()

    assert len(cards) == EXPECTED_CREATURE_COUNT
    for path in cards:
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        for field in REQUIRED_CREATURE_FIELDS:
            assert field in frontmatter, f"{path} missing {field}"


def test_all_creature_cards_have_named_actions():
    for path in creature_cards():
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        actions = next(line for line in frontmatter.splitlines() if line.startswith("actions:"))
        assert actions != "actions: []", f"{path} has no parsed actions"


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
        Path("Compendium/scum-and-villainy/creatures/beasts/energy-spider.md"),
        Path("Compendium/scum-and-villainy/creatures/beasts/katarn.md"),
    ]

    for path in samples:
        text = path.read_text(encoding="utf-8")
        assert "SW5e Scum and Villainy" in text
        assert "Pages:" in text
        assert "page_start:" in text
        assert "page_end:" in text
