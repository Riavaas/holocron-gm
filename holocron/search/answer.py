import re

from holocron.models.schemas import AskResponse, Citation
from holocron.search.fts import search_chunks


NOT_FOUND = "Not found in indexed sources. Temporary GM ruling required."
STOP_WORDS = {
    "a", "an", "and", "are", "can", "does", "for", "from", "how", "in", "is", "it",
    "of", "on", "or", "the", "to", "what", "when", "where", "which", "with", "work",
}


def _keyword_query(question: str) -> str:
    terms = [
        term.lower()
        for term in re.findall(r"[A-Za-z0-9-]+", question)
        if len(term) > 2 and term.lower() not in STOP_WORDS
    ]
    return " OR ".join(f'"{term}"' for term in dict.fromkeys(terms))


def answer_question(question: str, limit: int = 8) -> AskResponse:
    chunks = search_chunks(question, limit)
    if not chunks:
        keyword_query = _keyword_query(question)
        if keyword_query and keyword_query != question:
            chunks = search_chunks(keyword_query, limit)
    if not chunks:
        return AskResponse(answer=NOT_FOUND, found=False, citations=[], used_chunks=[])

    citations = [
        Citation(
            source_title=str(chunk["source_title"]),
            source_filename=str(chunk["source_filename"]),
            page_start=chunk["page_start"],
            page_end=chunk["page_end"],
            section_title=chunk["section_title"],
            chunk_id=str(chunk["chunk_id"]),
        )
        for chunk in chunks
    ]
    excerpts = [str(chunk["excerpt"]) for chunk in chunks[:3]]
    answer = "Found in indexed sources:\n\n" + "\n\n".join(f"- {excerpt}" for excerpt in excerpts)
    return AskResponse(answer=answer, found=True, citations=citations, used_chunks=chunks)
