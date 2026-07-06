# Claude Handoff

## Architecture

Holocron GM is a local-first Python/FastAPI app.

Source files live in `Books/`. Ingestion extracts text, chunks it, and stores metadata in SQLite at `data/holocron.sqlite`.

Search uses SQLite FTS5 over chunk content, source title, and section title.

`Compendium/` contains concise markdown summaries, rule cards, indexes, and page citations. It is for navigation and UI support, not a replacement for the source PDFs.

Player Handbook chapters 7-9 are available as compendium markdown for UI and Claude navigation: Using Ability Scores, Adventuring, and Combat.

Conditions, Force/Tech Casting, and Equipment overview pages are also available as compendium markdown with rule cards and page citations.

Force power cards and Tech power cards are available under `Compendium/player-handbook/powers/`. Each card includes power metadata for future UI filters: level, casting time, range, duration, concentration, save, attack roll, damage types, and conditions.

Maneuver cards are available under `Compendium/player-handbook/maneuvers/`. Each card includes maneuver metadata for future UI and combat tracker filters: maneuver type, activation, range, duration, save, attack roll, damage types, conditions, resource cost, and prerequisites.

Metadata QA exists at:

- `scripts/qa_power_cards.py`, which writes `reports/power_cards_qa.md`.
- `scripts/qa_maneuver_cards.py`, which writes `reports/maneuver_cards_qa.md`.

Some cards can carry `needs_review`; use the cited source page and `/api/rules/search` before answering.

## API

- `GET /health`
- `POST /api/ingest`
- `GET /api/sources`
- `GET /api/rules/search?q=...&limit=10`
- `GET /api/rules/chunk/{chunk_id}`
- `POST /api/rules/ask`

## UI Usage

For rules Q&A:

1. Call `/api/rules/search`.
2. Show excerpts with source filename, page range, section, and knowledge type.
3. Fetch full chunk via `/api/rules/chunk/{chunk_id}` when needed.
4. For LLM answers, include only retrieved chunks as context.
5. Always display citations for rules.
6. If no result exists, say the source is absent and keep GM suggestions separate.

Claude should not read or summarize whole PDFs directly. Use `/api/rules/search` and cite source/page/chunk. Compendium markdown can help navigation and frontend display, but rules answers still need source/page citations.

## Future Features

- Campaign dashboard
- Map upload
- Tokens
- Combat tracker
- Loot
- NPCs
- Player view
