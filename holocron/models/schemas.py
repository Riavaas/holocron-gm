from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    chunk_id: str
    score: float | None = None
    source_title: str
    source_filename: str
    page_start: int | None = None
    page_end: int | None = None
    section_title: str | None = None
    excerpt: str
    knowledge_type: str


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    limit: int = Field(8, ge=1, le=50)


class Citation(BaseModel):
    source_title: str
    source_filename: str
    page_start: int | None = None
    page_end: int | None = None
    section_title: str | None = None
    chunk_id: str


class AskResponse(BaseModel):
    answer: str
    found: bool
    citations: list[Citation]
    used_chunks: list[dict[str, object]]

