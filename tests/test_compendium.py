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
    ]

    for path in required_files:
        text = path.read_text(encoding="utf-8")
        assert text.startswith("---\n")
        for key in REQUIRED_KEYS:
            assert key in text.split("---", 2)[1]


def test_compendium_ingestion_and_search(tmp_path, monkeypatch):
    db_path = tmp_path / "holocron.sqlite"
    books = tmp_path / "Books"
    compendium = tmp_path / "Compendium"
    books.mkdir()
    (compendium / "player-handbook" / "rules-cards").mkdir(parents=True)
    cards = {
        "initiative.md": ("Initiative", "Combat", "The Order of Combat", 221, "Initiative determines combat turn order."),
        "saving-throws.md": ("Saving Throws", "Using Ability Scores", "Saving Throws", 214, "Saving throws resist danger and harmful effects."),
        "short-rest.md": ("Short Rest", "Adventuring", "Short Rest", 219, "A short rest is a limited recovery break."),
        "cover.md": ("Cover", "Combat", "Cover", 226, "Cover protects targets when obstacles block attacks."),
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
    monkeypatch.setattr("holocron.db.database.DB_PATH", db_path)
    monkeypatch.setattr("holocron.ingest.pipeline.BOOKS_DIR", books)
    monkeypatch.setattr("holocron.ingest.pipeline.COMPENDIUM_DIR", compendium)

    result = ingest_books()
    results = search_chunks("advantage disadvantage", 5)
    answer = answer_question("cover", 3)

    assert result["seen"] == 5
    assert results
    assert results[0]["knowledge_type"] == "sw5e_compendium"
    assert results[0]["source_title"] == "Advantage and Disadvantage"
    assert results[0]["page_start"] == 9
    assert results[0]["page_end"] == 9
    assert search_chunks("initiative", 5)
    assert search_chunks('"saving throws"', 5)
    assert search_chunks('"short rest"', 5)
    assert search_chunks("cover", 5)
    assert answer.found is True
    assert answer.citations
    assert answer.citations[0].source_filename.endswith(".md")
