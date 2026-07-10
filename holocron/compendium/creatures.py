from __future__ import annotations

import ast
import re
from pathlib import Path

from holocron.assets.images import images_for_source, primary_image_for_source
from holocron.core.paths import COMPENDIUM_DIR

CREATURES_DIR = COMPENDIUM_DIR / "scum-and-villainy" / "creatures"
FRONTMATTER_PATTERN = re.compile(r"\A---\n(.*?)\n---", re.DOTALL)
INTEGER_PATTERN = re.compile(r"\d+")


def _parse_value(value: str) -> object:
    value = value.strip()
    if value.startswith(("[", "{", '"', "'")):
        try:
            return ast.literal_eval(value)
        except (SyntaxError, ValueError):
            pass
    return value


def _frontmatter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER_PATTERN.match(text)
    if match is None:
        return {}

    values: dict[str, object] = {}
    for line in match.group(1).splitlines():
        key, separator, value = line.partition(":")
        if separator:
            values[key.strip()] = _parse_value(value)
    return values


def _first_integer(value: object, default: int = 0) -> int:
    match = INTEGER_PATTERN.search(str(value))
    return int(match.group()) if match else default


def load_creatures(root: Path = CREATURES_DIR) -> list[dict[str, object]]:
    creatures: list[dict[str, object]] = []
    if not root.exists():
        return creatures

    for path in root.rglob("*.md"):
        data = _frontmatter(path)
        if not data.get("creature_name"):
            continue
        source_file = data.get("source_file")
        page_start = data.get("page_start")
        primary_image = primary_image_for_source(source_file, page_start)
        image_matches = images_for_source(source_file, page_start)
        creature = {
            "slug": path.relative_to(root).with_suffix("").as_posix(),
            "name": data["creature_name"],
            "type": data.get("creature_type", "unknown"),
            "size": data.get("size", "Medium"),
            "cr": str(data.get("challenge_rating", "0")),
            "ac": _first_integer(data.get("armor_class"), 10),
            "hp": _first_integer(data.get("hit_points"), 1),
            "speed": data.get("speed", ""),
            "factions": data.get("faction", []),
            "environments": data.get("environment", []),
            "roles": data.get("role", []),
            "actions": data.get("actions", []),
            "source": data.get("source", ""),
            "source_file": source_file,
            "page": page_start,
        }
        if primary_image:
            creature["primary_image"] = primary_image
            creature["images"] = image_matches
        creatures.append(creature)
    return sorted(creatures, key=lambda creature: str(creature["name"]).lower())


def filter_creatures(
    creatures: list[dict[str, object]],
    query: str = "",
    challenge_rating: str | None = None,
    creature_type: str | None = None,
) -> list[dict[str, object]]:
    query = query.strip().lower()
    matches = []
    for creature in creatures:
        searchable = " ".join(
            str(value)
            for key, value in creature.items()
            if key in {"name", "type", "factions", "environments", "roles"}
        ).lower()
        if query and query not in searchable:
            continue
        if challenge_rating is not None and creature["cr"] != challenge_rating:
            continue
        if creature_type is not None and creature["type"] != creature_type:
            continue
        matches.append(creature)
    return matches
