from dataclasses import dataclass
import re

from holocron.ingest.chunker import TextUnit, clean_text

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


@dataclass(frozen=True)
class MarkdownDocument:
    title: str
    knowledge_type: str
    units: list[TextUnit]
    metadata: dict[str, object]


def _parse_scalar(value: str) -> object:
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [item.strip().strip('"').strip("'") for item in inner.split(",")]
    return value.strip("'")


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    metadata: dict[str, object] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = _parse_scalar(value)
    return metadata, text[match.end() :]


def read_markdown(path) -> MarkdownDocument:
    raw = path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(raw)
    title = str(metadata.get("title") or path.stem)
    knowledge_type = str(metadata.get("knowledge_type") or "campaign_lore")
    return MarkdownDocument(
        title=title,
        knowledge_type=knowledge_type,
        units=[TextUnit(text=clean_text(body), section_title=title)],
        metadata=metadata,
    )

