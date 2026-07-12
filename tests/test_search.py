from holocron.db.database import get_connection
from holocron.ingest.pipeline import ingest_books
from holocron.search.answer import answer_question
from holocron.search.fts import _excerpt, search_chunks


def test_search_and_answer_have_citations(tmp_path, monkeypatch):
    db_path = tmp_path / "holocron.sqlite"
    books = tmp_path / "Books"
    books.mkdir()
    (books / "combat.md").write_text(
        "---\ntitle: Combat Rules\nknowledge_type: sw5e_rules\n---\n# Advantage\nAdvantage rolls two d20 dice.",
        encoding="utf-8",
    )
    monkeypatch.setattr("holocron.db.database.DB_PATH", db_path)
    monkeypatch.setattr("holocron.ingest.pipeline.BOOKS_DIR", books)

    ingest_books(books)
    results = search_chunks("Advantage", 5)
    answer = answer_question("Advantage", 5)
    natural_answer = answer_question("How does advantage work?", 5)

    assert results
    assert results[0]["source_title"] == "Combat Rules"
    assert answer.found is True
    assert answer.citations
    assert natural_answer.found is True
    assert natural_answer.citations


def test_search_no_result(tmp_path, monkeypatch):
    db_path = tmp_path / "holocron.sqlite"
    monkeypatch.setattr("holocron.db.database.DB_PATH", db_path)

    with get_connection():
        pass

    assert search_chunks("missingterm", 5) == []
    assert answer_question("missingterm").found is False


def test_excerpt_restores_compendium_structure():
    excerpt = _excerpt("# Combat ## Summary Combat rules. ## Key Rules * Roll initiative. * Take a turn.")

    assert "## Summary\nCombat rules." in excerpt
    assert "\n* Roll initiative." in excerpt
