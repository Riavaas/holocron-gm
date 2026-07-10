# Codex Handoff

## State

Initial Holocron GM rules encyclopedia is implemented.

## Done

- Project structure created.
- `Books/`, `Assets/`, and `data/` placeholders added.
- Git LFS expected for Books PDFs and Assets images.
- `.gitignore` protects local DBs, env files, caches, and build folders.
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
- Scum and Villainy creature/statblock compendium expanded to all 225 detected creature cards and encounter indexes.
- Local PDF art extracted to `Assets/pdf_images/` with a manifest; Scum and Villainy bestiary images link automatically by source file/page.
- Curated external asset sources cataloged in `Assets/external_sources.json`, including `r/Star_Wars_Maps` and Kualan Clone Wars token packs.
- Kualan token packs can be checked/downloaded/analyzed/extracted with `scripts/import_external_assets.py`; extracted tokens are served through `/api/assets/external`.
- QA tooling available for power and maneuver cards.
- Creature metadata QA exists for future encounter builder work.
- Ingestion now indexes both `Books/` and `Compendium/`.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
git lfs pull
python3 scripts/check_assets_ready.py
python3 scripts/ingest_books.py
uvicorn holocron.api.main:app --reload
```

Fresh clone note: run `git lfs install` and `git lfs pull` before ingestion. The SQLite DB is not committed and must be rebuilt locally.

Build compendium:

```bash
python3 scripts/build_compendium.py --book player-handbook
python3 scripts/build_compendium.py --book player-handbook --chapter 13 --section maneuvers --maneuvers
python3 scripts/build_compendium.py --book scum-and-villainy --creatures
python3 scripts/extract_pdf_images.py --force
python3 scripts/import_external_assets.py --list --check
python3 scripts/import_external_assets.py --extract
```

## Tests

```bash
pytest
```

## Next Work

- Improve PDF section detection.
- Review maneuver card metadata quality, then expand selected equipment tables without copying full text.
- Continue improving creature metadata heuristics, especially environment, faction, and combat role.
- Improve image-to-creature matching beyond page-level mapping when a page contains multiple figures.
- Add richer map discovery/import from individual `r/Star_Wars_Maps` posts while preserving per-post author attribution.
- Add OCR option for scanned pages.
- Add campaign note CRUD.
- Add UI GM dashboard.
- Add map upload and token layers.
- Add combat tracker, NPCs, loot, and player view.
