# Books

Put local source material here:

- SW5e PDFs
- campaign lore markdown files
- house rules
- GM notes

PDF files in this folder are expected to be versioned through Git LFS.

After cloning on a new machine:

```bash
git lfs install
git lfs pull
python3 scripts/ingest_books.py
```

The SQLite database is still local and ignored; rebuild it with ingestion after pulling LFS files.

Markdown files can use optional frontmatter:

```yaml
---
title: "Dantooine Jedi Enclave"
knowledge_type: "campaign_lore"
tags: ["planet", "jedi", "kotor"]
visibility: "gm_only"
---
```
