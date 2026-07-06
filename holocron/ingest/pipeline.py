from pathlib import Path
import hashlib

from holocron.core.config import settings
from holocron.core.paths import BOOKS_DIR
from holocron.db.database import get_connection
from holocron.ingest.chunker import chunk_units
from holocron.ingest.markdown_reader import read_markdown
from holocron.ingest.pdf_reader import read_pdf


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def document_id_for(path: Path, digest: str) -> str:
    return hashlib.sha256(f"{path.name}:{digest}".encode("utf-8")).hexdigest()


def discover_books(books_dir: Path = BOOKS_DIR) -> list[Path]:
    if not books_dir.exists():
        return []
    return sorted(
        path
        for path in books_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".pdf", ".md", ".markdown"}
    )


def _upsert_document(conn, *, doc_id: str, title: str, path: Path, file_type: str, digest: str) -> None:
    conn.execute(
        """
        INSERT INTO documents (id, title, filename, path, file_type, content_hash)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,
            filename=excluded.filename,
            path=excluded.path,
            file_type=excluded.file_type,
            content_hash=excluded.content_hash,
            updated_at=CURRENT_TIMESTAMP
        """,
        (doc_id, title, path.name, str(path), file_type, digest),
    )


def _replace_chunks(conn, *, doc_id: str, title: str, filename: str, chunks, knowledge_type: str) -> None:
    conn.execute("DELETE FROM chunks_fts WHERE document_id = ?", (doc_id,))
    conn.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
    for chunk in chunks:
        chunk_id = hashlib.sha256(f"{doc_id}:{chunk.chunk_index}:{chunk.content_hash}".encode("utf-8")).hexdigest()
        conn.execute(
            """
            INSERT INTO chunks (
                id, document_id, source_title, source_filename, page_start, page_end,
                section_title, chunk_index, content, content_hash, knowledge_type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                chunk_id,
                doc_id,
                title,
                filename,
                chunk.page_start,
                chunk.page_end,
                chunk.section_title,
                chunk.chunk_index,
                chunk.content,
                chunk.content_hash,
                knowledge_type,
            ),
        )
        conn.execute(
            """
            INSERT INTO chunks_fts (content, source_title, section_title, chunk_id, document_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (chunk.content, title, chunk.section_title or "", chunk_id, doc_id),
        )


def ingest_books(books_dir: Path = BOOKS_DIR) -> dict[str, object]:
    books_dir.mkdir(parents=True, exist_ok=True)
    seen = skipped = ingested = 0
    weak_pages: dict[str, list[int]] = {}

    with get_connection() as conn:
        for path in discover_books(books_dir):
            seen += 1
            digest = file_hash(path)
            doc_id = document_id_for(path, digest)
            existing = conn.execute(
                "SELECT id FROM documents WHERE path = ? AND content_hash = ?",
                (str(path), digest),
            ).fetchone()
            if existing:
                skipped += 1
                continue

            if path.suffix.lower() == ".pdf":
                parsed = read_pdf(path)
                title = parsed.title
                knowledge_type = settings.default_pdf_knowledge_type
                units = parsed.units
                if parsed.weak_pages:
                    weak_pages[path.name] = parsed.weak_pages
                file_type = "pdf"
            else:
                parsed = read_markdown(path)
                title = parsed.title
                knowledge_type = parsed.knowledge_type
                units = parsed.units
                file_type = "markdown"

            chunks = chunk_units(
                units,
                max_words=settings.max_chunk_words,
                overlap_words=settings.chunk_overlap_words,
            )
            _upsert_document(conn, doc_id=doc_id, title=title, path=path, file_type=file_type, digest=digest)
            _replace_chunks(conn, doc_id=doc_id, title=title, filename=path.name, chunks=chunks, knowledge_type=knowledge_type)
            ingested += 1

    return {"seen": seen, "ingested": ingested, "skipped": skipped, "weak_pages": weak_pages}

