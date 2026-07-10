from fastapi.testclient import TestClient

from holocron.api.main import app
from holocron.assets import images as image_assets
from holocron.ingest.pipeline import ingest_books


def test_api_health():
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_dashboard_is_served():
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "Holocron GM" in response.text
    assert "/static/app.js" in response.text


def test_dashboard_static_assets_are_served():
    client = TestClient(app)

    response = client.get("/static/app.js")

    assert response.status_code == 200
    assert "measurementResult" in response.text


def test_pdf_image_manifest_api(tmp_path, monkeypatch):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        """{
  "images": [
    {
      "id": "scum-and-villainy-p135-01",
      "book": "Scum and Villainy",
      "book_slug": "scum-and-villainy",
      "source_file": "SW5e - Scum and Villainy - 20191105.pdf",
      "page": 135,
      "area": 120000,
      "path": "pdf_images/scum-and-villainy/scum-and-villainy-p135-01.jpg",
      "url": "/assets/pdf_images/scum-and-villainy/scum-and-villainy-p135-01.jpg"
    }
  ]
}
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(image_assets, "MANIFEST_PATH", manifest)
    image_assets._load_manifest_cached.cache_clear()
    client = TestClient(app)

    response = client.get("/api/assets/images", params={"book": "scum-and-villainy", "page": 135})
    summary = client.get("/api/assets/images/summary")

    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == "scum-and-villainy-p135-01"
    assert summary.json()["books"]["scum-and-villainy"] == 1


def test_external_asset_catalog_api(tmp_path, monkeypatch):
    sources = tmp_path / "external_sources.json"
    manifest = tmp_path / "external_manifest.json"
    sources.write_text(
        """{
  "sources": [
    {
      "id": "test-pack",
      "kind": "zip_pack",
      "asset_type": "tokens",
      "title": "Test Pack",
      "author": "Creator",
      "source_url": "https://example.test/source"
    }
  ]
}
""",
        encoding="utf-8",
    )
    manifest.write_text(
        """{
  "assets": [
    {
      "id": "test-pack-0001",
      "source_id": "test-pack",
      "asset_type": "tokens",
      "name": "Clone Trooper",
      "author": "Creator",
      "path": "external/test-pack/0001-clone-trooper.png",
      "url": "/assets/external/test-pack/0001-clone-trooper.png"
    }
  ]
}
""",
        encoding="utf-8",
    )
    from holocron.assets import external as external_assets

    monkeypatch.setattr(external_assets, "EXTERNAL_SOURCES_PATH", sources)
    monkeypatch.setattr(external_assets, "EXTERNAL_MANIFEST_PATH", manifest)
    external_assets._load_json_cached.cache_clear()
    client = TestClient(app)

    source_response = client.get("/api/assets/external-sources")
    asset_response = client.get("/api/assets/external", params={"asset_type": "tokens", "q": "clone"})
    summary_response = client.get("/api/assets/external/summary")

    assert source_response.status_code == 200
    assert source_response.json()["items"][0]["author"] == "Creator"
    assert asset_response.status_code == 200
    assert asset_response.json()["items"][0]["name"] == "Clone Trooper"
    assert summary_response.json()["assets"] == 1


def test_compendium_creatures_can_be_filtered():
    client = TestClient(app)

    response = client.get("/api/compendium/creatures", params={"q": "droid", "type": "droid"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] > 0
    assert all(item["type"] == "droid" for item in body["items"])
    assert {"name", "cr", "hp", "ac", "actions"} <= body["items"][0].keys()


def test_compendium_creature_detail_and_missing():
    client = TestClient(app)
    catalog = client.get("/api/compendium/creatures", params={"limit": 1}).json()
    slug = catalog["items"][0]["slug"]

    response = client.get(f"/api/compendium/creatures/{slug}")

    assert response.status_code == 200
    assert response.json()["slug"] == slug
    assert client.get("/api/compendium/creatures/not-real").status_code == 404


def test_books_library_and_inline_reader(tmp_path, monkeypatch):
    books = tmp_path / "Books"
    books.mkdir()
    pdf = books / "SW5e - Test Book - 20260101.pdf"
    pdf.write_bytes(b"%PDF-1.4 test")
    monkeypatch.setattr("holocron.api.routes.books.BOOKS_DIR", books)
    client = TestClient(app)

    library = client.get("/api/books")
    reader = client.get("/api/books/file/SW5e%20-%20Test%20Book%20-%2020260101.pdf")

    assert library.status_code == 200
    assert library.json()["items"][0]["title"] == "Test Book"
    assert reader.status_code == 200
    assert reader.headers["content-type"] == "application/pdf"
    assert reader.headers["content-disposition"].startswith("inline")


def test_books_reader_rejects_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr("holocron.api.routes.books.BOOKS_DIR", tmp_path)
    client = TestClient(app)

    assert client.get("/api/books/file/not-found.pdf").status_code == 404


def test_assistant_status_and_missing_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client = TestClient(app)

    status = client.get("/api/assistant/status")
    response = client.post("/api/assistant/chat", json={"message": "Create a handout", "context": {}})

    assert status.status_code == 200
    assert status.json()["configured"] is False
    assert response.status_code == 503


def test_shared_session_state_and_player_view():
    client = TestClient(app)

    updated = client.put("/api/session/state", json={"state": {"round": 3}})
    shared = client.get("/api/session/state")
    player = client.get("/player")

    assert updated.status_code == 200
    assert shared.json()["state"]["round"] == 3
    assert player.status_code == 200
    assert "Holocron GM" in player.text


def test_campaign_full_save_export_and_import(tmp_path, monkeypatch):
    campaign_dir = tmp_path / "campaigns"
    monkeypatch.setattr("holocron.api.routes.campaigns.CAMPAIGNS_DIR", campaign_dir)
    client = TestClient(app)

    created = client.post("/api/campaigns", json={"name": "KOTOR", "state": {"round": 2}})
    campaign_id = created.json()["id"]
    updated = client.put(
        f"/api/campaigns/{campaign_id}",
        json={"name": "KOTOR Updated", "state": {"round": 4, "notes": [{"title": "Dantooine"}]}},
    )
    map_response = client.put(
        f"/api/campaigns/{campaign_id}/map",
        content=b"\x89PNG\r\ncampaign-map",
        headers={"Content-Type": "image/png"},
    )
    exported = client.get(f"/api/campaigns/{campaign_id}/export")
    imported = client.post("/api/campaigns/actions/import", json=exported.json())

    assert created.status_code == 201
    assert updated.json()["state"]["round"] == 4
    assert map_response.status_code == 200
    assert client.get(f"/api/campaigns/{campaign_id}/map").content.startswith(b"\x89PNG")
    assert exported.json()["format"] == "holocron-campaign-v1"
    assert exported.json()["map"]["base64"]
    assert imported.status_code == 201
    assert imported.json()["state"]["notes"][0]["title"] == "Dantooine"
    assert client.get("/api/campaigns").json()["total"] == 2


def test_campaign_rejects_invalid_map_and_export(tmp_path, monkeypatch):
    monkeypatch.setattr("holocron.api.routes.campaigns.CAMPAIGNS_DIR", tmp_path / "campaigns")
    client = TestClient(app)
    campaign_id = client.post("/api/campaigns", json={"name": "Test", "state": {}}).json()["id"]

    invalid_map = client.put(
        f"/api/campaigns/{campaign_id}/map",
        content=b"not-an-image",
        headers={"Content-Type": "text/plain"},
    )
    invalid_import = client.post(
        "/api/campaigns/actions/import",
        json={"format": "unknown", "campaign": {}, "map": None},
    )

    assert invalid_map.status_code == 415
    assert invalid_import.status_code == 400


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
