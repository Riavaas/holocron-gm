# Codex Handoff

## State

Initial Holocron GM rules encyclopedia is implemented.

## Done

- Project structure created.
- `Books/` and `data/` placeholders added.
- `.gitignore` protects PDFs, local DBs, env files, caches, and build folders.
- SQLite schema with `documents`, `chunks`, `chunks_fts`, and `search_logs`.
- Markdown ingestion with optional frontmatter.
- PDF ingestion with PyMuPDF and weak-page reporting.
- Chunking with source/page/section metadata.
- FastAPI endpoints for health, ingestion, sources, search, chunks, and extractive ask.
- Tests for chunking, markdown ingestion, search, API, no-result behavior, citations, and gitignore.
- Player Handbook compendium builder added.
- Starter `Compendium/player-handbook` generated with TOC, chapter stubs, intro summaries, rule cards, and indexes.
- Player Handbook chapters 7-9 expanded with summarized section pages, GM rulings, rule cards, and indexes.
- Player Handbook conditions, Force/Tech casting, and equipment overview added with rule cards and lookup indexes.
- Player Handbook Force and Tech power cards generated with metadata for future UI lookup.
- Player Handbook Chapter 13 maneuver cards generated with metadata for future UI/combat tracker lookup.
- Scum and Villainy creature/statblock compendium started with 30 generated creature cards and encounter indexes.
- QA tooling available for power and maneuver cards.
- Creature metadata QA exists for future encounter builder work.
- Ingestion now indexes both `Books/` and `Compendium/`.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/ingest_books.py
uvicorn holocron.api.main:app --reload
```

Build compendium:

```bash
python3 scripts/build_compendium.py --book player-handbook
python3 scripts/build_compendium.py --book player-handbook --chapter 13 --section maneuvers --maneuvers
python3 scripts/build_compendium.py --book scum-and-villainy --creatures --limit 30
```

## Tests

```bash
pytest
```

## Next Work

- Improve PDF section detection.
- Review maneuver card metadata quality, then expand selected equipment tables without copying full text.
- Expand Scum and Villainy creature extraction beyond the starter 30 cards.
- Add OCR option for scanned pages.
- Add campaign note CRUD.
- Add UI GM dashboard.
- Add map upload and token layers.
- Add combat tracker, NPCs, loot, and player view.
