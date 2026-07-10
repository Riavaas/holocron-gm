from __future__ import annotations

import re
from functools import lru_cache
from typing import Iterable

from holocron.assets.external import load_external_manifest

CAMEL_BOUNDARY = re.compile(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
DIGIT_PATTERN = re.compile(r"\d")
STOP_WORDS = {
    "adult",
    "adolescent",
    "ancient",
    "battle",
    "class",
    "elite",
    "greater",
    "heavy",
    "huge",
    "large",
    "lesser",
    "medium",
    "series",
    "small",
    "the",
    "young",
}
ALIASES = {
    "destroyer droid": {"droideka"},
    "dwarf spider droid": {"dwarfspiderdroid", "spiderdroid"},
    "b1 battle droid": {"b1droid"},
    "b1 x battle droid": {"b1droid"},
    "b2 super battle droid": {"b2droid", "b2superbattledroid"},
    "b2 ha super battle droid": {"b2hadroid"},
    "bx commando droid": {"bxcommandodroid"},
    "pistoeka sabotage droid": {"buzzdroid"},
    "tusken raider": {"tuskenraider"},
}


def _spaced(value: object) -> str:
    return CAMEL_BOUNDARY.sub(" ", str(value or "")).replace("_", " ").replace("-", " ")


def name_tokens(value: object) -> list[str]:
    return TOKEN_PATTERN.findall(_spaced(value).lower())


def compact_name(value: object, *, drop_stop_words: bool = False) -> str:
    tokens = name_tokens(value)
    if drop_stop_words:
        tokens = [token for token in tokens if token not in STOP_WORDS]
    return "".join(tokens)


def meaningful_tokens(value: object) -> set[str]:
    return {token for token in name_tokens(value) if token not in STOP_WORDS}


def _candidate_aliases(name: object) -> set[str]:
    spaced = " ".join(name_tokens(name))
    aliases = set(ALIASES.get(spaced, set()))
    aliases.add(compact_name(name))
    aliases.add(compact_name(name, drop_stop_words=True))
    return {alias for alias in aliases if alias}


@lru_cache(maxsize=1)
def token_assets() -> tuple[dict[str, object], ...]:
    return tuple(asset for asset in load_external_manifest() if asset.get("asset_type") == "tokens")


def score_token_match(creature: dict[str, object], asset: dict[str, object]) -> tuple[int, str]:
    creature_name = str(creature.get("name") or creature.get("creature_name") or "")
    asset_name = str(asset.get("name") or "")
    creature_aliases = _candidate_aliases(creature_name)
    creature_tokens = meaningful_tokens(creature_name)
    asset_compact = compact_name(asset_name)
    asset_compact_loose = compact_name(asset_name, drop_stop_words=True)

    if asset_compact in creature_aliases or asset_compact_loose in creature_aliases:
        return 100, "name"

    partial_aliases = {alias for alias in creature_aliases if len(alias) >= 8 and len(creature_tokens) >= 2}
    asset_has_unshared_digits = bool(DIGIT_PATTERN.search(asset_compact)) and not bool(DIGIT_PATTERN.search(compact_name(creature_name)))
    if not asset_has_unshared_digits and any(
        alias and (alias in asset_compact or asset_compact in alias) for alias in partial_aliases
    ):
        return 86, "partial-name"

    asset_tokens = meaningful_tokens(asset_name)
    if not creature_tokens or not asset_tokens:
        return 0, "none"

    overlap = creature_tokens & asset_tokens
    if not overlap:
        return 0, "none"

    score = int(65 * (len(overlap) / len(creature_tokens)))
    if creature.get("type") == "droid" and "droid" in asset_tokens:
        score += 10
    return min(score, 82), "token-overlap"


def best_token_for_creature(
    creature: dict[str, object],
    assets: Iterable[dict[str, object]] | None = None,
    *,
    minimum_score: int = 72,
) -> dict[str, object] | None:
    candidates = assets if assets is not None else token_assets()
    best: tuple[int, str, dict[str, object]] | None = None
    for asset in candidates:
        if asset.get("asset_type") != "tokens":
            continue
        score, reason = score_token_match(creature, asset)
        if best is None or score > best[0]:
            best = (score, reason, asset)

    if best is None or best[0] < minimum_score:
        return None

    score, reason, asset = best
    return {
        **asset,
        "match_score": score,
        "match_reason": reason,
    }
