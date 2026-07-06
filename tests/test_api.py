from fastapi.testclient import TestClient

from holocron.api.main import app
from holocron.ingest.pipeline import ingest_books


def test_api_health():
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_search_and_chunk(tmp_path, monkeypatch):
    db_path = tmp_path / "holocron.sqlite"
    books = tmp_path / "Books"
    books.mkdir()
    (books / "ships.md").write_text("---\ntitle: Starships\n---\n# Hyperdrive\nHyperdrive enables hyperspace travel.", encoding="utf-8")
    monkeypatch.setattr("holocron.db.database.DB_PATH", db_path)
    monkeypatch.setattr("holocron.ingest.pipeline.BOOKS_DIR", books)

    ingest_books(books)
    client = TestClient(app)
    response = client.get("/api/rules/search", params={"q": "Hyperdrive"})

    assert response.status_code == 200
    body = response.json()
    assert body
    assert body[0]["chunk_id"]

    chunk_response = client.get(f"/api/rules/chunk/{body[0]['chunk_id']}")
    assert chunk_response.status_code == 200


def test_api_ask_absent(tmp_path, monkeypatch):
    db_path = tmp_path / "holocron.sqlite"
    monkeypatch.setattr("holocron.db.database.DB_PATH", db_path)
    client = TestClient(app)

    response = client.post("/api/rules/ask", json={"question": "unknown rule", "limit": 3})

    assert response.status_code == 200
    assert response.json()["found"] is False

