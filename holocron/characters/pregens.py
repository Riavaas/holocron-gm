from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
from zipfile import ZipFile

PREGEN_PATTERNS = (
    "SW5e Pre Gens*.zip",
    "PHB Pre Gens*.zip",
)
LEVEL_RE = re.compile(r"Level\s+(?P<level>\d+)\s+(?P<label>.+)\.pdf$", re.IGNORECASE)


def _candidate_archives(downloads_dir: Path | None = None) -> list[Path]:
    root = downloads_dir or Path.home() / "Downloads"
    archives: list[Path] = []
    for pattern in PREGEN_PATTERNS:
        archives.extend(root.glob(pattern))
    return sorted(set(archives), key=lambda path: path.name.lower())


def _parts_from_label(label: str) -> dict[str, object]:
    bits = label.split(" - ", 1)
    core = bits[0].split()
    subclass = bits[1].strip() if len(bits) > 1 else ""
    species = core[0] if core else "Unknown"
    character_class = core[1] if len(core) > 1 else "Unknown"
    return {"species": species, "class": character_class, "subclass": subclass}


def list_pregens(downloads_dir: Path | None = None) -> list[dict[str, object]]:
    grouped: dict[str, dict[str, object]] = {}
    for archive in _candidate_archives(downloads_dir):
        with ZipFile(archive) as zip_file:
            for name in zip_file.namelist():
                if not name.lower().endswith(".pdf"):
                    continue
                match = LEVEL_RE.search(Path(name).name)
                if not match:
                    continue
                folder = Path(name).parent.name or match.group("label")
                key = f"{archive.name}:{folder}"
                entry = grouped.setdefault(
                    key,
                    {
                        "id": re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-"),
                        "name": folder,
                        "archive": archive.name,
                        "levels": [],
                    },
                )
                label = match.group("label").strip()
                entry.update(_parts_from_label(label))
                entry["levels"].append(
                    {
                        "level": int(match.group("level")),
                        "label": label,
                        "path": name,
                    }
                )
    pregens = []
    for entry in grouped.values():
        entry["levels"] = sorted(entry["levels"], key=lambda item: item["level"])
        entry["max_level"] = entry["levels"][-1]["level"] if entry["levels"] else 1
        pregens.append(entry)
    return sorted(pregens, key=lambda item: str(item["name"]).lower())
