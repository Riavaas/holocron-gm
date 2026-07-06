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
- Ingestion now indexes both `Books/` and `Compendium/`.

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/ingest_books.py
uvicorn holocron.api.main:app --reload
```

Build compendium:

```bash
python3 scripts/build_compendium.py --book player-handbook
```

## Tests

```bash
pytest
```

## Next Work

- Improve PDF section detection.
- Expand Player Handbook compendium into Equipment, Conditions, Force/Tech Casting, then powers without copying full text.
- Add OCR option for scanned pages.
- Add campaign note CRUD.
- Add UI GM dashboard.
- Add map upload and token layers.
- Add combat tracker, NPCs, loot, and player view.
