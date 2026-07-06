# Holocron GM

Holocron GM is a local-first Game Master rules encyclopedia for a Star Wars 5e / SW5e campaign in the Knights of the Old Republic era.

It reads local files from `Books/`, extracts searchable chunks, stores them in SQLite, and exposes a FastAPI API with source citations.

`Compendium/` contains structured markdown summaries and rule cards derived from local books. It is safe to commit because it is concise, cited, and not a verbatim copy.

## Why PDFs Are Not Committed

SW5e books and campaign source material stay on your machine. Git ignores PDFs under `Books/` and local databases under `data/`.

Commit only project code, docs, and safe markdown notes.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Add Books

Put files in `Books/`:

- `.pdf` SW5e books
- `.md` campaign lore
- `.md` house rules
- `.md` GM notes

Markdown can include frontmatter:

```yaml
---
title: "Dantooine Jedi Enclave"
knowledge_type: "campaign_lore"
tags: ["planet", "jedi", "kotor"]
visibility: "gm_only"
---
```

Default knowledge types:

- PDF: `sw5e_rules`
- Markdown: `campaign_lore`

## Build Compendium

Build the Player Handbook table of contents and starter compendium pages:

```bash
python3 scripts/build_compendium.py --book player-handbook
```

Useful options:

```bash
python3 scripts/build_compendium.py --book player-handbook --toc-only
python3 scripts/build_compendium.py --book player-handbook --chapter 7
python3 scripts/build_compendium.py --book player-handbook --dry-run
```

Difference:

- `Books/`: local source PDFs and notes. PDFs are ignored and not committed.
- `Compendium/`: concise markdown summaries, rule cards, indexes, citations, and navigation.

## Index Books

```bash
python scripts/ingest_books.py
```

This indexes both `Books/` and `Compendium/`.

SQLite database:

```text
data/holocron.sqlite
```

## Run API

```bash
uvicorn holocron.api.main:app --reload
```

Or:

```bash
python scripts/dev_server.py
```

## Search

```bash
curl "http://127.0.0.1:8000/api/rules/search?q=advantage&limit=10"
```

Ask without an LLM:

```bash
curl -X POST "http://127.0.0.1:8000/api/rules/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"How does advantage work?","limit":8}'
```

## Endpoints

- `GET /health`
- `POST /api/ingest`
- `GET /api/sources`
- `GET /api/rules/search?q=...&limit=10`
- `GET /api/rules/chunk/{chunk_id}`
- `POST /api/rules/ask`

## Reset DB

```bash
rm -f data/holocron.sqlite
python scripts/ingest_books.py
```

## Continue With Claude

Claude or another LLM should call `/api/rules/search` first, then answer only from returned chunks. Rules answers must include citations. If no source is found, say the rule is absent and keep GM suggestions clearly separate.

Workflow:

1. Codex builds or updates concise compendium markdown.
2. Run ingestion to index PDFs, notes, and compendium pages.
3. Claude uses `/api/rules/search` and cited chunks instead of reading whole PDFs.

## Known Limits

- No OCR yet for scanned PDFs.
- Extractive `/ask` only; no LLM required.
- PDF section detection is basic.
- Interactive maps, tokens, combat tracker, NPCs, and loot are future modules.

## Tests

```bash
pytest
```
