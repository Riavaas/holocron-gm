from holocron.models.schemas import AskResponse, Citation
from holocron.search.fts import search_chunks


NOT_FOUND = "Non trouvé dans les sources indexées. Proposition GM temporaire: à définir manuellement."


def answer_question(question: str, limit: int = 8) -> AskResponse:
    chunks = search_chunks(question, limit)
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
    answer = "Contenu trouvé dans les sources indexées:\n\n" + "\n\n".join(f"- {excerpt}" for excerpt in excerpts)
    return AskResponse(answer=answer, found=True, citations=citations, used_chunks=chunks)

