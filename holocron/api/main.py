from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from holocron.api.routes import assets, assistant, books, campaigns, catalog, characters, compendium, ingest, media, rules, session, sources
from holocron.core.paths import ASSETS_DIR, PROJECT_ROOT

app = FastAPI(title="Holocron GM", version="0.1.0")
WEB_DIR = PROJECT_ROOT / "holocron" / "web"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(ingest.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(rules.router, prefix="/api/rules")
app.include_router(compendium.router, prefix="/api/compendium")
app.include_router(books.router, prefix="/api/books")
app.include_router(assistant.router, prefix="/api/assistant")
app.include_router(session.router, prefix="/api/session")
app.include_router(campaigns.router, prefix="/api/campaigns")
app.include_router(assets.router, prefix="/api/assets")
app.include_router(catalog.router, prefix="/api/catalog")
app.include_router(media.router, prefix="/api/media")
app.include_router(characters.router, prefix="/api/characters")


@app.get("/player", include_in_schema=False)
def player_view() -> FileResponse:
    return FileResponse(Path(WEB_DIR) / "index.html")


app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/", include_in_schema=False)
def dashboard() -> FileResponse:
    return FileResponse(Path(WEB_DIR) / "index.html")
