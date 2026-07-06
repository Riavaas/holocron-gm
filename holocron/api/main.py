from fastapi import FastAPI

from holocron.api.routes import ingest, rules, sources

app = FastAPI(title="Holocron GM", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(ingest.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(rules.router, prefix="/api/rules")

