from dataclasses import dataclass

from holocron.ingest.chunker import TextUnit, clean_text


@dataclass(frozen=True)
class PdfDocument:
    title: str
    units: list[TextUnit]
    weak_pages: list[int]


def read_pdf(path) -> PdfDocument:
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required to ingest PDF files. Install requirements.txt.") from exc

    doc = fitz.open(path)
    units: list[TextUnit] = []
    weak_pages: list[int] = []
    title = doc.metadata.get("title") or path.stem
    for index, page in enumerate(doc, start=1):
        text = clean_text(page.get_text("text"))
        if len(text.split()) < 20:
            weak_pages.append(index)
        if text:
            units.append(TextUnit(text=text, page_start=index, page_end=index))
    doc.close()
    return PdfDocument(title=title, units=units, weak_pages=weak_pages)

