from __future__ import annotations

import ast
import re
from functools import lru_cache
from pathlib import Path

from holocron.assets import external as external_assets
from holocron.assets import images as image_assets
from holocron.assets.images import images_for_source, primary_image_for_source
from holocron.assets.tokens import best_token_for_creature
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


def _path_modified_ns(path: Path) -> int:
    return path.stat().st_mtime_ns if path.exists() else 0


def _creature_signature(root: Path) -> tuple[int, int, int, int]:
    if not root.exists():
        return (
            0,
            0,
            _path_modified_ns(external_assets.EXTERNAL_MANIFEST_PATH),
            _path_modified_ns(image_assets.MANIFEST_PATH),
        )
    markdown_files = list(root.rglob("*.md"))
    latest_creature_mtime = max((_path_modified_ns(path) for path in markdown_files), default=0)
    return (
        len(markdown_files),
        latest_creature_mtime,
        _path_modified_ns(external_assets.EXTERNAL_MANIFEST_PATH),
        _path_modified_ns(image_assets.MANIFEST_PATH),
    )


@lru_cache(maxsize=8)
def _load_creatures_cached(root_key: str, signature: tuple[int, int, int, int]) -> tuple[dict[str, object], ...]:
    del signature
    root = Path(root_key)
    creatures: list[dict[str, object]] = []
    if not root.exists():
        return ()

    for path in root.rglob("*.md"):
        data = _frontmatter(path)
        if not data.get("creature_name"):
            continue
        source_file = data.get("source_file")
        page_start = data.get("page_start")
        primary_image = primary_image_for_source(source_file, page_start)
        image_matches = images_for_source(source_file, page_start)
        stat_block = {
            "size": data.get("size", "Medium"),
            "type": data.get("creature_type", "unknown"),
            "alignment": data.get("alignment", ""),
            "challenge_rating": str(data.get("challenge_rating", "0")),
            "xp": data.get("xp", ""),
            "armor_class": data.get("armor_class", ""),
            "hit_points": data.get("hit_points", ""),
            "speed": data.get("speed", ""),
            "abilities": data.get("abilities", {}),
            "saving_throws": data.get("saving_throws", []),
            "skills": data.get("skills", []),
            "damage_vulnerabilities": data.get("damage_vulnerabilities", []),
            "damage_resistances": data.get("damage_resistances", []),
            "damage_immunities": data.get("damage_immunities", []),
            "condition_immunities": data.get("condition_immunities", []),
            "senses": data.get("senses", []),
            "languages": data.get("languages", []),
            "traits": data.get("traits", []),
            "actions": data.get("actions", []),
            "reactions": data.get("reactions", []),
            "legendary_actions": data.get("legendary_actions", []),
            "lair_actions": data.get("lair_actions", []),
            "regional_effects": data.get("regional_effects", []),
            "source_file": source_file,
            "page": page_start,
        }
        creature = {
            "slug": path.relative_to(root).with_suffix("").as_posix(),
            "name": data["creature_name"],
            "type": data.get("creature_type", "unknown"),
            "size": data.get("size", "Medium"),
            "alignment": data.get("alignment", ""),
            "cr": str(data.get("challenge_rating", "0")),
            "xp": data.get("xp", ""),
            "ac": _first_integer(data.get("armor_class"), 10),
            "hp": _first_integer(data.get("hit_points"), 1),
            "speed": data.get("speed", ""),
            "abilities": data.get("abilities", {}),
            "saving_throws": data.get("saving_throws", []),
            "skills": data.get("skills", []),
            "damage_vulnerabilities": data.get("damage_vulnerabilities", []),
            "damage_resistances": data.get("damage_resistances", []),
            "damage_immunities": data.get("damage_immunities", []),
            "condition_immunities": data.get("condition_immunities", []),
            "senses": data.get("senses", []),
            "languages": data.get("languages", []),
            "traits": data.get("traits", []),
            "factions": data.get("faction", []),
            "environments": data.get("environment", []),
            "roles": data.get("role", []),
            "actions": data.get("actions", []),
            "reactions": data.get("reactions", []),
            "legendary_actions": data.get("legendary_actions", []),
            "stat_block": stat_block,
            "source": data.get("source", ""),
            "source_file": source_file,
            "page": page_start,
        }
        if primary_image:
            creature["primary_image"] = primary_image
            creature["images"] = image_matches
        matched_token = best_token_for_creature(creature)
        if matched_token:
            creature["matched_token"] = matched_token
            creature["asset_match"] = {
                "kind": "external_token",
                "score": matched_token["match_score"],
                "reason": matched_token["match_reason"],
                "source_id": matched_token.get("source_id"),
            }
        creatures.append(creature)
    return tuple(sorted(creatures, key=lambda creature: str(creature["name"]).lower()))


def load_creatures(root: Path = CREATURES_DIR) -> list[dict[str, object]]:
    root_path = root.resolve()
    return list(_load_creatures_cached(str(root_path), _creature_signature(root_path)))


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
