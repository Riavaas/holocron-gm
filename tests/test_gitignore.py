from pathlib import Path


def test_books_and_assets_use_lfs_while_local_state_is_ignored():
    gitignore = Path(".gitignore").read_text(encoding="utf-8")
    gitattributes = Path(".gitattributes").read_text(encoding="utf-8")

    assert "Books/**/*.pdf filter=lfs" in gitattributes
    assert "Assets/**/*.png filter=lfs" in gitattributes
    assert "Books/*.pdf" not in gitignore
    assert "Books/**/*.pdf" not in gitignore
    assert "data/*.sqlite" in gitignore
    assert ".env" in gitignore
