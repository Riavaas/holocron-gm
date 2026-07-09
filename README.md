# Holocron GM

Holocron GM is a local-first Game Master rules encyclopedia for a Star Wars 5e / SW5e campaign in the Knights of the Old Republic era.

It reads local files from `Books/`, extracts searchable chunks, stores them in SQLite, and exposes a FastAPI API with source citations.

`Compendium/` contains structured markdown summaries and rule cards derived from local books. It is safe to commit because it is concise, cited, and not a verbatim copy.

Current coverage includes Player Handbook starter Introduction material, core session rules from chapters 7-9, conditions, Force/Tech casting, equipment overview pages, individual Force/Tech power cards, Chapter 13 maneuver cards, and a starter Scum and Villainy creature/statblock compendium.

## Portable Books And Assets

This private repo is set up for Git LFS so source PDFs and visual assets can move between machines.

Git LFS tracks:

- `Books/**/*.pdf`
- common image formats under `Assets/`

The SQLite database is still local and ignored. Rebuild it with ingestion after cloning or pulling new books.

## Fresh Clone Setup

```bash
git clone https://github.com/Riavaas/holocron-gm.git
cd holocron-gm
git lfs install
git lfs pull
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/bootstrap_local.py
python3 scripts/dev_server.py
```

Check local readiness:

```bash
python3 scripts/check_assets_ready.py
```

## Setup

```bash
python3 -m venv .venv
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
python3 scripts/build_compendium.py --book player-handbook --chapter 13 --section maneuvers --maneuvers
python3 scripts/build_compendium.py --book scum-and-villainy --toc-only
python3 scripts/build_compendium.py --book scum-and-villainy --creatures --limit 20
python3 scripts/build_compendium.py --book player-handbook --dry-run
```

Difference:

- `Books/`: source PDFs and notes. PDFs are portable through Git LFS.
- `Assets/`: images, portraits, maps, and tokens. Images are portable through Git LFS.
- `Compendium/`: concise markdown summaries, rule cards, indexes, citations, and navigation.

## Index Books

```bash
python3 scripts/ingest_books.py
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
python3 scripts/dev_server.py
```

Open `http://127.0.0.1:8000` for the GM dashboard. The **Books** workspace
lists local PDFs and opens them in the integrated browser PDF reader.

Open `http://127.0.0.1:8000/player` on the player display. The GM dashboard
synchronizes map and encounter state through the local server.

Optional OpenAI assistant:

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-5.4-mini"
python3 scripts/dev_server.py
```

The API key stays server-side. Without it, the assistant falls back to the
local cited rules index.

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
- `GET /api/books`
- `GET /api/books/file/{book_path}`
- `GET /api/assistant/status`
- `POST /api/assistant/chat`
- `GET|PUT /api/session/state`
- `GET /api/rules/search?q=...&limit=10`
- `GET /api/rules/chunk/{chunk_id}`
- `POST /api/rules/ask`

## Reset DB

```bash
rm -f data/holocron.sqlite
python3 scripts/ingest_books.py
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

## Power Cards QA

Run metadata and link QA for Player Handbook Force/Tech power cards:

```bash
python3 scripts/qa_power_cards.py
```

Safe metadata repair pass:

```bash
python3 scripts/qa_power_cards.py --fix
```

## Maneuver Cards QA

Run metadata and link QA for Player Handbook maneuver cards:

```bash
python3 scripts/qa_maneuver_cards.py
```

## Creature Cards QA

Run metadata and link QA for Scum and Villainy creature cards:

```bash
python3 scripts/qa_creature_cards.py
```
