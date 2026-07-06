import sqlite3

from holocron.db.database import get_connection


def _excerpt(content: str, max_chars: int = 420) -> str:
    text = " ".join(content.split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "..."


def _safe_match_query(query: str) -> str:
    if '"' in query:
        return query
    if any(char in query for char in "-:/"):
        return '"' + query.replace('"', '""') + '"'
    return query


def search_chunks(query: str, limit: int = 10) -> list[dict[str, object]]:
    with get_connection() as conn:
        sql = """
        SELECT
            chunks.id AS chunk_id,
            bm25(chunks_fts) AS score,
            chunks.source_title,
            chunks.source_filename,
            chunks.page_start,
            chunks.page_end,
            chunks.section_title,
            chunks.content,
            chunks.knowledge_type
        FROM chunks_fts
        JOIN chunks ON chunks.id = chunks_fts.chunk_id
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts)
        LIMIT ?
        """
        match_query = _safe_match_query(query)
        try:
            rows = conn.execute(sql, (match_query, limit)).fetchall()
        except sqlite3.OperationalError:
            rows = conn.execute(sql, ('"' + query.replace('"', '""') + '"', limit)).fetchall()
        results = [
            {
                "chunk_id": row["chunk_id"],
                "score": row["score"],
                "source_title": row["source_title"],
                "source_filename": row["source_filename"],
                "page_start": row["page_start"],
                "page_end": row["page_end"],
                "section_title": row["section_title"],
                "excerpt": _excerpt(row["content"]),
                "knowledge_type": row["knowledge_type"],
            }
            for row in rows
        ]
        conn.execute(
            "INSERT INTO search_logs (query, result_count) VALUES (?, ?)",
            (query, len(results)),
        )
    return results


def get_chunk(chunk_id: str) -> dict[str, object] | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id AS chunk_id, document_id, source_title, source_filename, page_start, page_end,
                   section_title, chunk_index, content, content_hash, knowledge_type, created_at
            FROM chunks
            WHERE id = ?
            """,
            (chunk_id,),
        ).fetchone()
    return dict(row) if row else None
