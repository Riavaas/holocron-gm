from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from holocron.core.paths import BOOKS_DIR

router = APIRouter()


def _book_title(path: Path) -> str:
    title = path.stem.removeprefix("SW5e - ")
    parts = title.rsplit(" - ", 1)
    if len(parts) == 2 and parts[1].isdigit():
        title = parts[0]
    return title.replace("-avec compression", "").strip()


def _pdf_files() -> list[Path]:
    if not BOOKS_DIR.exists():
        return []
    return sorted(
        (path for path in BOOKS_DIR.rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"),
        key=lambda path: _book_title(path).lower(),
    )


@router.get("")
def books() -> dict[str, object]:
    items = []
    for path in _pdf_files():
        relative = path.relative_to(BOOKS_DIR)
        items.append(
            {
                "id": relative.as_posix(),
                "title": _book_title(path),
                "filename": path.name,
                "size_bytes": path.stat().st_size,
                "url": f"/api/books/file/{quote(relative.as_posix())}",
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/file/{book_path:path}")
def book_file(book_path: str) -> FileResponse:
    root = BOOKS_DIR.resolve()
    path = (BOOKS_DIR / book_path).resolve()
    if root not in path.parents or not path.is_file() or path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=404, detail="Book not found")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{path.name}"',
            "Cache-Control": "private, max-age=3600",
        },
    )
