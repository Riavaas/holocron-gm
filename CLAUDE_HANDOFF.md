# Claude Handoff

## Architecture

Holocron GM is a local-first Python/FastAPI app.

Source files live in `Books/`. Ingestion extracts text, chunks it, and stores metadata in SQLite at `data/holocron.sqlite`.

Search uses SQLite FTS5 over chunk content, source title, and section title.

`Compendium/` contains concise markdown summaries, rule cards, indexes, and page citations. It is for navigation and UI support, not a replacement for the source PDFs.

Player Handbook chapters 7-9 are available as compendium markdown for UI and Claude navigation: Using Ability Scores, Adventuring, and Combat.

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

Claude should not read or summarize whole PDFs directly. Use indexed API results first. Compendium markdown can help navigation and frontend display, but rules answers still need source/page citations.

## Future Features

- Campaign dashboard
- Map upload
- Tokens
- Combat tracker
- Loot
- NPCs
- Player view
