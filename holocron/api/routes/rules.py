from fastapi import APIRouter, HTTPException, Query

from holocron.models.schemas import AskRequest, AskResponse, SearchResult
from holocron.search.answer import answer_question
from holocron.search.fts import get_chunk, search_chunks

router = APIRouter()


@router.get("/search", response_model=list[SearchResult])
def search(q: str = Query(..., min_length=1), limit: int = Query(10, ge=1, le=50)):
    return search_chunks(q, limit)


@router.get("/chunk/{chunk_id}")
def chunk(chunk_id: str) -> dict[str, object]:
    row = get_chunk(chunk_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return row


@router.post("/ask", response_model=AskResponse)
def ask(payload: AskRequest) -> AskResponse:
    return answer_question(payload.question, payload.limit)

