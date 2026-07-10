from __future__ import annotations

import hashlib
import re
from pathlib import Path

from holocron.core.paths import ASSETS_DIR

RESOURCE_BACKLOG_PATH = ASSETS_DIR / "external_resource_backlog.md"
LINK_PATTERN = re.compile(r"<(https?://[^>]+)>")


def _split_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _resource_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def load_resource_backlog(path: Path | None = None) -> dict[str, object]:
    backlog_path = path or RESOURCE_BACKLOG_PATH
    if not backlog_path.exists():
        return {"features": [], "items": [], "total": 0, "statuses": {}, "categories": {}}

    features: list[dict[str, str]] = []
    items: list[dict[str, str]] = []
    current_section = ""
    lines = backlog_path.read_text(encoding="utf-8").splitlines()
    for line in lines:
        if line.startswith("## "):
            current_section = line.removeprefix("## ").strip()
            continue
        if not line.startswith("|") or "---" in line:
            continue

        cells = _split_row(line)
        if current_section == "Feature Requests" and len(cells) >= 3 and cells[0] != "Item":
            features.append(
                {
                    "id": _resource_id(cells[0]),
                    "item": cells[0],
                    "desired_use": cells[1],
                    "status": cells[2],
                }
            )
            continue

        if len(cells) < 4 or cells[0] == "Resource":
            continue
        match = LINK_PATTERN.search(cells[1])
        if not match:
            continue
        item = {
            "id": _resource_id(match.group(1)),
            "category": current_section,
            "resource": cells[0],
            "url": match.group(1),
            "intended_use": cells[2],
            "status": cells[3],
        }
        items.append(item)

    statuses: dict[str, int] = {}
    categories: dict[str, int] = {}
    for item in items:
        statuses[item["status"]] = statuses.get(item["status"], 0) + 1
        categories[item["category"]] = categories.get(item["category"], 0) + 1

    return {
        "features": features,
        "items": items,
        "total": len(items),
        "statuses": statuses,
        "categories": categories,
    }
