from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from holocron.core.paths import ASSETS_DIR, BOOKS_DIR


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "book"


def book_title(pdf_path: Path) -> str:
    title = pdf_path.stem
    title = re.sub(r"^SW5e\s*-\s*", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*-\s*\d{8}$", "", title)
    return title


def shrink_pixmap(pixmap: fitz.Pixmap, max_edge: int) -> fitz.Pixmap:
    if pixmap.alpha or pixmap.n > 3:
        pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
    while max(pixmap.width, pixmap.height) > max_edge:
        pixmap.shrink(1)
    return pixmap


def extract_book(
    pdf_path: Path,
    output_root: Path,
    *,
    min_width: int,
    min_height: int,
    max_edge: int,
    quality: int,
    force: bool,
) -> list[dict[str, object]]:
    doc = fitz.open(pdf_path)
    title = book_title(pdf_path)
    book_slug = slugify(title)
    book_dir = output_root / book_slug
    book_dir.mkdir(parents=True, exist_ok=True)
    images: list[dict[str, object]] = []

    seen: set[tuple[int, int]] = set()
    for page_index in range(len(doc)):
        page_number = page_index + 1
        image_number = 0
        for raw in doc[page_index].get_images(full=True):
            xref = raw[0]
            width = int(raw[2] or 0)
            height = int(raw[3] or 0)
            if width < min_width or height < min_height:
                continue
            key = (page_number, xref)
            if key in seen:
                continue
            seen.add(key)
            image_number += 1

            pixmap = shrink_pixmap(fitz.Pixmap(doc, xref), max_edge)
            image_id = f"{book_slug}-p{page_number:03d}-{image_number:02d}"
            filename = f"{image_id}.jpg"
            output_path = book_dir / filename
            if force or not output_path.exists():
                output_path.write_bytes(pixmap.tobytes("jpeg", jpg_quality=quality))
            digest = hashlib.sha1(output_path.read_bytes()).hexdigest()[:16]
            relative_path = output_path.relative_to(ASSETS_DIR).as_posix()
            images.append(
                {
                    "id": image_id,
                    "book": title,
                    "book_slug": book_slug,
                    "source_file": pdf_path.name,
                    "page": page_number,
                    "image_index": image_number,
                    "width": width,
                    "height": height,
                    "output_width": pixmap.width,
                    "output_height": pixmap.height,
                    "area": width * height,
                    "sha1": digest,
                    "path": relative_path,
                    "url": f"/assets/{relative_path}",
                }
            )
    return images


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract web-ready image assets from local SW5e PDFs.")
    parser.add_argument("--book", action="append", help="Substring of PDF filename to extract. Can be repeated.")
    parser.add_argument("--min-width", type=int, default=320)
    parser.add_argument("--min-height", type=int, default=240)
    parser.add_argument("--max-edge", type=int, default=900)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--output", type=Path, default=ASSETS_DIR / "pdf_images")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    filters = [item.lower() for item in args.book or []]
    pdfs = sorted(BOOKS_DIR.glob("*.pdf"))
    if filters:
        pdfs = [pdf for pdf in pdfs if any(match in pdf.name.lower() for match in filters)]
    if not pdfs:
        raise SystemExit("No matching PDFs found.")

    args.output.mkdir(parents=True, exist_ok=True)
    images: list[dict[str, object]] = []
    for pdf in pdfs:
        images.extend(
            extract_book(
                pdf,
                args.output,
                min_width=args.min_width,
                min_height=args.min_height,
                max_edge=args.max_edge,
                quality=args.quality,
                force=args.force,
            )
        )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "local PDFs",
        "settings": {
            "min_width": args.min_width,
            "min_height": args.min_height,
            "max_edge": args.max_edge,
            "quality": args.quality,
        },
        "images": sorted(images, key=lambda item: (str(item["book_slug"]), int(item["page"]), int(item["image_index"]))),
    }
    manifest_path = args.output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"DONE: books={len(pdfs)} images={len(images)} manifest={manifest_path}")


if __name__ == "__main__":
    main()
