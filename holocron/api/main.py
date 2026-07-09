from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from holocron.api.routes import assistant, books, compendium, ingest, rules, session, sources
from holocron.core.paths import PROJECT_ROOT

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


@app.get("/player", include_in_schema=False)
def player_view() -> FileResponse:
    return FileResponse(Path(WEB_DIR) / "index.html")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/", include_in_schema=False)
def dashboard() -> FileResponse:
    return FileResponse(Path(WEB_DIR) / "index.html")
