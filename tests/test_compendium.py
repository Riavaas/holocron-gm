from pathlib import Path

from holocron.ingest.pipeline import ingest_books
from holocron.search.answer import answer_question
from holocron.search.fts import search_chunks


REQUIRED_KEYS = [
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
]

POWER_KEYS = [
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


def test_compendium_markdown_exists_and_has_frontmatter():
    required_files = [
        Path("Compendium/player-handbook/toc.md"),
        Path("Compendium/player-handbook/index.md"),
        Path("Compendium/player-handbook/chapters/00-introduction/index.md"),
        Path("Compendium/player-handbook/chapters/00-introduction/how-to-play.md"),
        Path("Compendium/player-handbook/rules-cards/advantage-and-disadvantage.md"),
        Path("Compendium/player-handbook/rules-cards/the-d20.md"),
        Path("Compendium/player-handbook/rules-cards/specific-beats-general.md"),
        Path("Compendium/player-handbook/chapters/07-using-ability-scores/index.md"),
        Path("Compendium/player-handbook/chapters/08-adventuring/index.md"),
        Path("Compendium/player-handbook/chapters/09-combat/index.md"),
        Path("Compendium/player-handbook/rules-cards/initiative.md"),
        Path("Compendium/player-handbook/rules-cards/saving-throws.md"),
        Path("Compendium/player-handbook/rules-cards/short-rest.md"),
        Path("Compendium/player-handbook/rules-cards/cover.md"),
        Path("Compendium/player-handbook/rules-cards/death-saving-throws.md"),
        Path("Compendium/player-handbook/conditions/stunned.md"),
        Path("Compendium/player-handbook/conditions/restrained.md"),
        Path("Compendium/player-handbook/rules-cards/concentration.md"),
        Path("Compendium/player-handbook/rules-cards/forcecasting.md"),
        Path("Compendium/player-handbook/rules-cards/techcasting.md"),
        Path("Compendium/player-handbook/equipment/explosives.md"),
        Path("Compendium/player-handbook/rules-cards/weapon-properties.md"),
        Path("Compendium/player-handbook/powers/force/force-push-pull.md"),
        Path("Compendium/player-handbook/powers/force/saber-reflect.md"),
        Path("Compendium/player-handbook/powers/tech/target-lock.md"),
        Path("Compendium/player-handbook/powers/tech/repair-droid.md"),
    ]

    for path in required_files:
        text = path.read_text(encoding="utf-8")
        assert text.startswith("---\n")
        for key in REQUIRED_KEYS:
            assert key in text.split("---", 2)[1]

    power_files = [
        Path("Compendium/player-handbook/powers/force/force-push-pull.md"),
        Path("Compendium/player-handbook/powers/force/saber-reflect.md"),
        Path("Compendium/player-handbook/powers/tech/target-lock.md"),
        Path("Compendium/player-handbook/powers/tech/repair-droid.md"),
    ]
    for path in power_files:
        frontmatter = path.read_text(encoding="utf-8").split("---", 2)[1]
        for key in POWER_KEYS:
            assert key in frontmatter


def test_compendium_ingestion_and_search(tmp_path, monkeypatch):
    db_path = tmp_path / "holocron.sqlite"
    books = tmp_path / "Books"
    compendium = tmp_path / "Compendium"
    books.mkdir()
    (compendium / "player-handbook" / "rules-cards").mkdir(parents=True)
    (compendium / "player-handbook" / "maneuvers").mkdir(parents=True)
    cards = {
        "initiative.md": ("Initiative", "Combat", "The Order of Combat", 221, "Initiative determines combat turn order."),
        "saving-throws.md": ("Saving Throws", "Using Ability Scores", "Saving Throws", 214, "Saving throws resist danger and harmful effects."),
        "short-rest.md": ("Short Rest", "Adventuring", "Short Rest", 219, "A short rest is a limited recovery break."),
        "cover.md": ("Cover", "Combat", "Cover", 226, "Cover protects targets when obstacles block attacks."),
        "concentration.md": ("Concentration", "Force and Tech Casting", "Concentration", 232, "Concentration maintains a force power or tech power over time."),
        "forcecasting.md": ("Forcecasting", "Force and Tech Casting", "Forcecasting", 231, "Forcecasting uses Force powers."),
        "techcasting.md": ("Techcasting", "Force and Tech Casting", "Techcasting", 231, "Techcasting uses tech powers."),
        "explosives.md": ("Explosives", "Equipment", "Explosives", 177, "Explosives include grenades and mines."),
        "weapon-properties.md": ("Weapon Properties", "Equipment", "Weapon Properties", 171, "Weapon properties change weapon handling."),
        "restrained.md": ("Restrained", "Appendix A: Conditions", "Restrained", 312, "Restrained restricts movement and defenses."),
        "stunned.md": ("Stunned", "Appendix A: Conditions", "Stunned", 312, "Stunned prevents normal actions and reactions."),
        "force-push-pull.md": ("Force Push/Pull", "11-force-powers", "Force Push/Pull", 248, "Force Push/Pull moves creatures or objects with a Strength save."),
        "saber-reflect.md": ("Saber Reflect", "11-force-powers", "Saber Reflect", 262, "Saber Reflect reacts to ranged damage."),
        "target-lock.md": ("Target Lock", "12-tech-powers", "Target Lock", 299, "Target Lock marks a target for weapon pressure."),
        "repair-droid.md": ("Repair Droid", "12-tech-powers", "Repair Droid", 292, "Repair Droid restores hit points to a droid or construct."),
    }
    for filename, (title, chapter, section, page, body) in cards.items():
        (compendium / "player-handbook" / "rules-cards" / filename).write_text(
            f"""---
title: "{title}"
source: "SW5e Player's Handbook"
source_file: "SW5e - Player's Handbook-avec compression.pdf"
knowledge_type: "sw5e_compendium"
category: "core_rule"
chapter: "{chapter}"
section: "{section}"
page_start: {page}
page_end: {page}
tags: ["test"]
status: "draft"
verbatim_risk: "low"
---

# {title}

{body}
""",
            encoding="utf-8",
        )
    (compendium / "player-handbook" / "rules-cards" / "advantage-and-disadvantage.md").write_text(
        """---
title: "Advantage and Disadvantage"
source: "SW5e Player's Handbook"
source_file: "SW5e - Player's Handbook-avec compression.pdf"
knowledge_type: "sw5e_compendium"
category: "core_rule"
chapter: "Introduction"
section: "Advantage and Disadvantage"
page_start: 9
page_end: 9
tags: ["advantage", "disadvantage"]
status: "draft"
verbatim_risk: "low"
---

# Advantage and Disadvantage

Advantage uses the higher d20. Disadvantage uses the lower d20.
""",
        encoding="utf-8",
    )
    (compendium / "player-handbook" / "maneuvers" / "charging-attack.md").write_text(
        """---
title: "Charging Attack"
source: "SW5e Player's Handbook"
source_file: "SW5e - Player's Handbook-avec compression.pdf"
knowledge_type: "sw5e_compendium"
category: "maneuver"
chapter: "13-maneuvers"
section: "Charging Attack"
page_start: 304
page_end: 304
tags: ["maneuver", "physical", "prone"]
status: "draft"
verbatim_risk: "low"
---

# Charging Attack

A physical maneuver that spends a superiority die after a charge and can knock a target prone on a Strength save.
""",
        encoding="utf-8",
    )
    monkeypatch.setattr("holocron.db.database.DB_PATH", db_path)
    monkeypatch.setattr("holocron.ingest.pipeline.BOOKS_DIR", books)
    monkeypatch.setattr("holocron.ingest.pipeline.COMPENDIUM_DIR", compendium)

    result = ingest_books()
    results = search_chunks("advantage disadvantage", 5)
    answer = answer_question("cover", 3)

    assert result["seen"] == 17
    assert results
    assert results[0]["knowledge_type"] == "sw5e_compendium"
    assert results[0]["source_title"] == "Advantage and Disadvantage"
    assert results[0]["page_start"] == 9
    assert results[0]["page_end"] == 9
    assert search_chunks("initiative", 5)
    assert search_chunks('"saving throws"', 5)
    assert search_chunks('"short rest"', 5)
    assert search_chunks("cover", 5)
    assert search_chunks("stunned", 5)
    assert search_chunks("restrained", 5)
    assert search_chunks("concentration", 5)
    assert search_chunks("forcecasting", 5)
    assert search_chunks("techcasting", 5)
    assert search_chunks("explosives", 5)
    assert search_chunks('"weapon properties"', 5)
    assert search_chunks('"force push pull"', 5)
    assert search_chunks('"saber reflect"', 5)
    assert search_chunks('"target lock"', 5)
    assert search_chunks('"repair droid"', 5)
    assert search_chunks('"charging attack"', 5)
    assert search_chunks("maneuver prone", 5)
    assert search_chunks("concentration force power", 5)
    assert answer.found is True
    assert answer.citations
    assert answer.citations[0].source_filename.endswith(".md")
