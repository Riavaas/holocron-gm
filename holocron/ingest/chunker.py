from dataclasses import dataclass
import hashlib
import re


@dataclass(frozen=True)
class TextUnit:
    text: str
    page_start: int | None = None
    page_end: int | None = None
    section_title: str | None = None


@dataclass(frozen=True)
class Chunk:
    content: str
    page_start: int | None
    page_end: int | None
    section_title: str | None
    chunk_index: int
    content_hash: str


SECTION_RE = re.compile(r"^(#{1,6}\s+.+|[A-Z][A-Z0-9 '\-:]{5,})$")


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def detect_section(line: str) -> str | None:
    stripped = line.strip()
    if stripped.startswith("#"):
        return stripped.lstrip("#").strip()
    if SECTION_RE.match(stripped) and len(stripped.split()) <= 12:
        return stripped.title()
    return None


def chunk_units(units: list[TextUnit], max_words: int = 1200, overlap_words: int = 120) -> list[Chunk]:
    chunks: list[Chunk] = []
    current_words: list[str] = []
    page_start: int | None = None
    page_end: int | None = None
    section_title: str | None = None

    def flush() -> None:
        nonlocal current_words, page_start, page_end, section_title
        if not current_words:
            return
        content = " ".join(current_words).strip()
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        chunks.append(
            Chunk(
                content=content,
                page_start=page_start,
                page_end=page_end,
                section_title=section_title,
                chunk_index=len(chunks),
                content_hash=digest,
            )
        )
        current_words = current_words[-overlap_words:] if overlap_words > 0 else []
        page_start = page_end if current_words else None

    for unit in units:
        text = clean_text(unit.text)
        if not text:
            continue
        for line in text.splitlines():
            detected = detect_section(line)
            if detected:
                section_title = detected
            words = line.split()
            if not words:
                continue
            if page_start is None:
                page_start = unit.page_start
            page_end = unit.page_end
            while words:
                remaining = max_words - len(current_words)
                if remaining <= 0:
                    flush()
                    if page_start is None:
                        page_start = unit.page_start
                    page_end = unit.page_end
                    remaining = max_words - len(current_words)
                current_words.extend(words[:remaining])
                words = words[remaining:]
                if len(current_words) >= max_words:
                    flush()
                    if page_start is None and words:
                        page_start = unit.page_start
                    page_end = unit.page_end

    flush()
    return chunks
