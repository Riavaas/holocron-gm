from fastapi import APIRouter

from holocron.ingest.pipeline import ingest_books

router = APIRouter()


@router.post("/ingest")
def ingest() -> dict[str, object]:
    return ingest_books()

