from fastapi import APIRouter

from holocron.db.database import get_connection

router = APIRouter()


@router.get("/sources")
def sources() -> list[dict[str, object]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, title, filename, path, file_type, content_hash, created_at, updated_at
            FROM documents
            ORDER BY title
            """
        ).fetchall()
    return [dict(row) for row in rows]

