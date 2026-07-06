from holocron.ingest.markdown_reader import read_markdown
from holocron.ingest.pipeline import ingest_books


def test_markdown_frontmatter(tmp_path):
    path = tmp_path / "dantooine.md"
    path.write_text(
        '---\ntitle: "Dantooine Jedi Enclave"\nknowledge_type: "campaign_lore"\n---\n# Enclave\nAncient Jedi site.',
        encoding="utf-8",
    )

    doc = read_markdown(path)

    assert doc.title == "Dantooine Jedi Enclave"
    assert doc.knowledge_type == "campaign_lore"
    assert "Ancient Jedi site" in doc.units[0].text


def test_ingest_markdown(tmp_path, monkeypatch):
    db_path = tmp_path / "holocron.sqlite"
    books = tmp_path / "Books"
    books.mkdir()
    (books / "rules.md").write_text("---\ntitle: Force Powers\nknowledge_type: house_rule\n---\n# Push\nMove a target.", encoding="utf-8")

    monkeypatch.setattr("holocron.db.database.DB_PATH", db_path)
    monkeypatch.setattr("holocron.ingest.pipeline.BOOKS_DIR", books)

    result = ingest_books(books)

    assert result["seen"] == 1
    assert result["ingested"] == 1

