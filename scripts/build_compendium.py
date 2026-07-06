from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BOOKS_DIR = PROJECT_ROOT / "Books"
COMPENDIUM_DIR = PROJECT_ROOT / "Compendium"
SOURCE = "SW5e Player's Handbook"
SOURCE_FILE = "SW5e - Player's Handbook-avec compression.pdf"
BOOK_KEY = "player-handbook"
FORCE_WRITE = False


CHAPTERS = [
    ("00-introduction", "Introduction", "7", "10"),
    ("01-step-by-step-characters", "Step-by-Step Characters", "11", "16"),
    ("02-species", "Species", "17", "48"),
    ("03-classes", "Classes", "49", "142"),
    ("04-backgrounds", "Personality and Backgrounds", "143", "166"),
    ("05-equipment", "Equipment", "167", "184"),
    ("06-customization-options", "Customization Options", "185", "206"),
    ("07-using-ability-scores", "Using Ability Scores", "207", "214"),
    ("08-adventuring", "Adventuring", "215", "220"),
    ("09-combat", "Combat", "221", "230"),
    ("10-force-and-tech-casting", "Force and Tech Casting", "231", "234"),
    ("11-force-powers", "Force Powers", "235", "268"),
    ("12-tech-powers", "Tech Powers", "269", "302"),
    ("13-maneuvers", "Maneuvers", "303", "310"),
    ("appendices", "Appendices", "311", "318"),
]


STARTER_DOCS = {
    "chapters/00-introduction/index.md": {
        "title": "Introduction",
        "category": "chapter",
        "chapter": "Introduction",
        "section": "Introduction",
        "page_start": 7,
        "page_end": 10,
        "tags": ["core", "gm", "campaign", "how-to-play"],
        "body": """# Introduction

## Source

* Book: SW5e Player's Handbook
* Pages: 7-10
* Original section: Introduction

## Summary

The introduction frames SW5e as a Star Wars adaptation of the 5e tabletop loop: the GM describes the situation, players declare actions, dice resolve uncertainty, and the GM narrates consequences. It also places the rules comfortably in eras such as Knights of the Old Republic, where Force-users can be common enough for party play.

## Key Rules

* The GM is both lead storyteller and rules referee.
* Players describe intent; the GM decides whether the result is automatic, uncertain, or impossible.
* Dice are used when the outcome matters and uncertainty is meaningful.
* The book separates character creation, core play rules, casting, powers, maneuvers, and appendices.

## GM Use

Use this section when onboarding new players, setting table expectations, or reminding the group that rulings serve the shared fiction. It is also useful when deciding whether a declared action needs a roll.

## Related

* [How to Play](how-to-play.md)
* [The d20](../../rules-cards/the-d20.md)
* [Advantage and Disadvantage](../../rules-cards/advantage-and-disadvantage.md)

## Search Tags

`introduction`, `gm`, `table-flow`, `star-wars`, `kotor`
""",
    },
    "chapters/00-introduction/how-to-play.md": {
        "title": "How to Play",
        "category": "core_rule",
        "chapter": "Introduction",
        "section": "How to Play",
        "page_start": 8,
        "page_end": 8,
        "tags": ["play-loop", "gm", "players", "actions"],
        "body": """# How to Play

## Source

* Book: SW5e Player's Handbook
* Pages: 8-8
* Original section: How to Play

## Summary

Play follows a repeating conversation. The GM presents the scene, the players say what their characters try to do, and the GM resolves and narrates the result. Combat adds stricter turns, but the same loop still drives the table.

## Key Rules

* Start with the GM describing location, threats, exits, objects, and obvious choices.
* Players state actions and intent; they do not need formal turns outside structured scenes.
* The GM resolves simple actions directly and calls for rolls when uncertainty matters.
* The result of one action creates the next decision point.

## GM Use

Use this as the default session rhythm. When players stall, restate the situation and ask for intent. When multiple players act at once, collect declarations first, then resolve in the order that best fits the fiction.

## Related

* [Introduction](index.md)
* [The d20](../../rules-cards/the-d20.md)

## Search Tags

`how-to-play`, `play-loop`, `gm`, `player-actions`
""",
    },
    "rules-cards/the-d20.md": {
        "title": "The d20",
        "category": "core_rule",
        "chapter": "Introduction",
        "section": "The d20",
        "page_start": 9,
        "page_end": 9,
        "tags": ["d20", "ability-checks", "attack-rolls", "saving-throws", "dc", "ac"],
        "body": """# The d20

## Quick Rule

When an action has an uncertain outcome, roll a d20, add the relevant modifier, apply bonuses or penalties, and compare the total to a target number.

## When Used

* Ability checks
* Attack rolls
* Saving throws

## Key Rules

* Ability checks and saving throws compare against a Difficulty Class.
* Attack rolls compare against Armor Class.
* Meeting or exceeding the target succeeds.
* The GM usually sets target numbers and announces outcomes.

## GM Notes

Ask for a roll only when failure would be interesting or consequential. Before the roll, identify the action type, ability, proficiency if any, and target if the players should know it.

## Source

SW5e Player's Handbook, page 9.
""",
    },
    "rules-cards/advantage-and-disadvantage.md": {
        "title": "Advantage and Disadvantage",
        "category": "core_rule",
        "chapter": "Introduction",
        "section": "Advantage and Disadvantage",
        "page_start": 9,
        "page_end": 9,
        "tags": ["d20", "advantage", "disadvantage", "checks", "attacks", "saves"],
        "body": """# Advantage and Disadvantage

## Quick Rule

Roll two d20s for the same check, attack, or save. Advantage uses the higher result. Disadvantage uses the lower result.

## When Used

Use this when circumstances, traits, powers, positioning, help, or hindrances significantly affect a d20 roll.

## GM Notes

Apply it as a fast table tool for meaningful situational pressure. Avoid stacking multiple sources into extra dice unless a later rule explicitly says otherwise.

## Source

SW5e Player's Handbook, page 9.
""",
    },
    "rules-cards/specific-beats-general.md": {
        "title": "Specific Beats General",
        "category": "core_rule",
        "chapter": "Introduction",
        "section": "Specific Beats General",
        "page_start": 9,
        "page_end": 9,
        "tags": ["rules-precedence", "exceptions", "features", "powers", "traits"],
        "body": """# Specific Beats General

## Quick Rule

When a specific rule conflicts with a general rule, follow the specific rule.

## When Used

Use this for traits, class features, powers, items, monster abilities, and other exceptions that change the normal procedure.

## GM Notes

This is the primary conflict-resolution rule for edge cases. First identify the baseline rule, then identify whether a narrower feature or power explicitly modifies it.

## Source

SW5e Player's Handbook, page 9.
""",
    },
}


@dataclass(frozen=True)
class TocEntry:
    level: int
    title: str
    page: int


def find_pdf() -> Path:
    exact = BOOKS_DIR / SOURCE_FILE
    if exact.exists():
        return exact
    matches = sorted(BOOKS_DIR.glob("*Player*Handbook*.pdf"))
    if not matches:
        raise FileNotFoundError("Player Handbook PDF not found in Books/.")
    return matches[0]


def slugify(value: str) -> str:
    value = value.lower().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def frontmatter(*, title: str, category: str, chapter: str, section: str, page_start: int, page_end: int, tags: list[str], status: str = "draft") -> str:
    tag_text = "[" + ", ".join(f'"{tag}"' for tag in tags) + "]"
    return f"""---
title: "{title}"
source: "{SOURCE}"
source_file: "{SOURCE_FILE}"
knowledge_type: "sw5e_compendium"
category: "{category}"
chapter: "{chapter}"
section: "{section}"
page_start: {page_start}
page_end: {page_end}
tags: {tag_text}
status: "{status}"
verbatim_risk: "low"
---

"""


def write_md(path: Path, meta: dict, body: str, dry_run: bool) -> None:
    content = frontmatter(**meta) + body.rstrip() + "\n"
    if dry_run:
        print(f"DRY-RUN write {path}")
        return
    if path.exists() and not FORCE_WRITE:
        print(f"SKIP existing {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def read_toc(pdf_path: Path) -> list[TocEntry]:
    if fitz is None:
        raise RuntimeError("PyMuPDF is required. Install requirements.txt.")
    doc = fitz.open(pdf_path)
    try:
        return [TocEntry(level, title.title(), page) for level, title, page in doc.get_toc()]
    finally:
        doc.close()


def create_structure(root: Path, dry_run: bool) -> None:
    dirs = [
        root,
        root / BOOK_KEY,
        root / BOOK_KEY / "chapters",
        root / BOOK_KEY / "rules-cards",
        root / BOOK_KEY / "tables",
        root / BOOK_KEY / "powers",
        root / BOOK_KEY / "maneuvers",
        root / BOOK_KEY / "equipment",
        root / BOOK_KEY / "casting",
        root / BOOK_KEY / "conditions",
        root / BOOK_KEY / "species",
        root / BOOK_KEY / "classes",
        root / BOOK_KEY / "indexes",
    ]
    dirs.extend(root / BOOK_KEY / "chapters" / folder for folder, _, _, _ in CHAPTERS)
    for folder in dirs:
        if dry_run:
            print(f"DRY-RUN mkdir {folder}")
        else:
            folder.mkdir(parents=True, exist_ok=True)


def build_compendium_readme(root: Path, dry_run: bool) -> None:
    meta = {
        "title": "Compendium",
        "category": "overview",
        "chapter": "Compendium",
        "section": "README",
        "page_start": 0,
        "page_end": 0,
        "tags": ["compendium", "navigation"],
    }
    body = """# Compendium

This folder contains structured markdown summaries derived from local source books. It is not a replacement for the books and does not copy them verbatim.

## Rules

* Keep entries concise.
* Cite source file and page range.
* Prefer summaries, rule cards, tables, and GM-facing notes.
* Do not commit PDFs, raw extraction dumps, OCR output, or full copied chapters.

## Books

* [SW5e Player's Handbook](player-handbook/index.md)
"""
    write_md(root / "README.md", meta, body, dry_run)


def build_toc(book_root: Path, toc: list[TocEntry], dry_run: bool) -> None:
    lines = [
        "# Table of Contents",
        "",
        "## Source",
        "",
        f"* Book: {SOURCE}",
        f"* File: {SOURCE_FILE}",
        "",
        "## Entries",
        "",
    ]
    for entry in toc:
        indent = "  " * (entry.level - 1)
        lines.append(f"{indent}* {entry.title} - p. {entry.page}")
    meta = {
        "title": "Player Handbook Table of Contents",
        "category": "toc",
        "chapter": "All",
        "section": "Table of Contents",
        "page_start": 3,
        "page_end": 315,
        "tags": ["toc", "navigation", "player-handbook"],
        "status": "reviewed",
    }
    write_md(book_root / "toc.md", meta, "\n".join(lines), dry_run)


def build_book_index(book_root: Path, dry_run: bool) -> None:
    chapter_lines = [f"* [{title}](chapters/{folder}/index.md) - pages {start}-{end}" for folder, title, start, end in CHAPTERS]
    body = """# SW5e Player's Handbook Compendium

## Source

* Book: SW5e Player's Handbook
* File: SW5e - Player's Handbook-avec compression.pdf

## Purpose

This compendium provides concise GM-facing navigation, summaries, rule cards, and citations. It is not a verbatim copy of the book.

## Chapters

""" + "\n".join(chapter_lines) + """

## Fast Rules

* [The d20](rules-cards/the-d20.md)
* [Advantage and Disadvantage](rules-cards/advantage-and-disadvantage.md)
* [Specific Beats General](rules-cards/specific-beats-general.md)

## Indexes

* [Rules Index](indexes/rules-index.md)
* [Terms Index](indexes/terms-index.md)
* [Page Index](indexes/page-index.md)
* [GM Cheatsheet](indexes/gm-cheatsheet.md)
"""
    meta = {
        "title": "SW5e Player's Handbook Compendium",
        "category": "book_index",
        "chapter": "All",
        "section": "Index",
        "page_start": 0,
        "page_end": 0,
        "tags": ["player-handbook", "index", "navigation"],
        "status": "reviewed",
    }
    write_md(book_root / "index.md", meta, body, dry_run)


def build_chapter_placeholders(book_root: Path, dry_run: bool, only_chapter: int | None = None) -> None:
    for index, (folder, title, start, end) in enumerate(CHAPTERS):
        if only_chapter is not None and index != only_chapter:
            continue
        path = book_root / "chapters" / folder / "index.md"
        if path.exists() and folder == "00-introduction":
            continue
        body = f"""# {title}

## Source

* Book: SW5e Player's Handbook
* Pages: {start}-{end}
* Original section: {title}

## Summary

Draft navigation stub. This chapter is identified from the PDF table of contents and is ready for section-level compendium work.

## Key Rules

* To be summarized from source pages during review.

## GM Use

Use this page as the chapter landing point for future rule cards, tables, and section summaries.

## Related

* [Book Index](../../index.md)
* [Table of Contents](../../toc.md)

## Search Tags

`{slugify(title)}`, `player-handbook`
"""
        meta = {
            "title": title,
            "category": "chapter",
            "chapter": title,
            "section": title,
            "page_start": int(start),
            "page_end": int(end),
            "tags": [slugify(title), "player-handbook"],
        }
        write_md(path, meta, body, dry_run)


def build_indexes(book_root: Path, dry_run: bool) -> None:
    index_docs = {
        "rules-index.md": ("Rules Index", "rules_index", ["rules", "index"], """# Rules Index

## Core Rules

* [The d20](../rules-cards/the-d20.md)
* [Advantage and Disadvantage](../rules-cards/advantage-and-disadvantage.md)
* [Specific Beats General](../rules-cards/specific-beats-general.md)

## Source

SW5e Player's Handbook. Page references are stored in each linked rule card.
"""),
        "terms-index.md": ("Terms Index", "terms_index", ["terms", "index"], """# Terms Index

## Terms

* Armor Class
* Difficulty Class
* Ability Check
* Attack Roll
* Saving Throw
* Advantage
* Disadvantage

## Source

SW5e Player's Handbook, starter index from Introduction pages 7-10.
"""),
        "page-index.md": ("Page Index", "page_index", ["pages", "index"], """# Page Index

## Starter Pages

* p. 7-10: [Introduction](../chapters/00-introduction/index.md)
* p. 8: [How to Play](../chapters/00-introduction/how-to-play.md)
* p. 9: [The d20](../rules-cards/the-d20.md)
* p. 9: [Advantage and Disadvantage](../rules-cards/advantage-and-disadvantage.md)
* p. 9: [Specific Beats General](../rules-cards/specific-beats-general.md)
"""),
        "gm-cheatsheet.md": ("GM Cheatsheet", "gm_cheatsheet", ["gm", "cheatsheet"], """# GM Cheatsheet

## Session Loop

1. Describe the situation.
2. Ask players what they do.
3. Resolve automatic actions directly.
4. Use d20 rolls for meaningful uncertainty.
5. Narrate consequences and present the next decision.

## Fast Calls

* Use [The d20](../rules-cards/the-d20.md) for uncertain checks, attacks, and saves.
* Use [Advantage and Disadvantage](../rules-cards/advantage-and-disadvantage.md) for strong favorable or unfavorable circumstances.
* Use [Specific Beats General](../rules-cards/specific-beats-general.md) when a feature, power, trait, or item conflicts with a baseline rule.
"""),
    }
    for filename, (title, category, tags, body) in index_docs.items():
        meta = {
            "title": title,
            "category": category,
            "chapter": "All",
            "section": title,
            "page_start": 0,
            "page_end": 0,
            "tags": tags,
        }
        write_md(book_root / "indexes" / filename, meta, body, dry_run)


def build_starter_docs(book_root: Path, dry_run: bool) -> None:
    for relative, doc in STARTER_DOCS.items():
        meta = {key: doc[key] for key in ["title", "category", "chapter", "section", "page_start", "page_end", "tags"]}
        write_md(book_root / relative, meta, doc["body"], dry_run)


def build(args: argparse.Namespace) -> None:
    global FORCE_WRITE
    FORCE_WRITE = args.force
    if args.book != BOOK_KEY:
        raise ValueError("Only --book player-handbook is supported.")
    pdf_path = find_pdf()
    toc = read_toc(pdf_path)
    book_root = COMPENDIUM_DIR / BOOK_KEY
    create_structure(COMPENDIUM_DIR, args.dry_run)
    build_compendium_readme(COMPENDIUM_DIR, args.dry_run)
    build_toc(book_root, toc, args.dry_run)
    build_book_index(book_root, args.dry_run)
    if not args.toc_only:
        build_chapter_placeholders(book_root, args.dry_run, args.chapter)
        if args.chapter in (None, 0):
            build_starter_docs(book_root, args.dry_run)
        build_indexes(book_root, args.dry_run)
    print(
        {
            "book": args.book,
            "toc_entries": len(toc),
            "pdf": str(pdf_path),
            "dry_run": args.dry_run,
            "force": args.force,
            "appendix": args.appendix,
            "section": args.section,
            "powers": args.powers,
            "maneuvers": args.maneuvers,
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build structured markdown compendium files.")
    parser.add_argument("--book", default=BOOK_KEY)
    parser.add_argument("--toc-only", action="store_true")
    parser.add_argument("--chapter", type=int, default=None)
    parser.add_argument("--appendix", default=None)
    parser.add_argument("--section", default=None)
    parser.add_argument("--powers", choices=["force", "tech"], default=None)
    parser.add_argument("--maneuvers", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    build(parser.parse_args())


if __name__ == "__main__":
    main()
