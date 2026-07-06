from pathlib import Path


def test_books_pdfs_are_ignored():
    gitignore = Path(".gitignore").read_text(encoding="utf-8")

    assert "Books/*.pdf" in gitignore
    assert "Books/**/*.pdf" in gitignore
    assert "data/*.sqlite" in gitignore

