from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANEUVER_ROOT = PROJECT_ROOT / "Compendium" / "player-handbook" / "maneuvers"
REPORT_PATH = PROJECT_ROOT / "reports" / "maneuver_cards_qa.md"

REQUIRED_FIELDS = [
    "title",
    "source",
    "source_file",
    "knowledge_type",
    "category",
    "chapter",
    "section",
    "page_start",
    "page_end",
    "tags",
    "status",
    "verbatim_risk",
    "maneuver_type",
    "activation",
    "range",
    "duration",
    "save",
    "attack_roll",
    "damage_types",
    "conditions_inflicted",
    "resource_cost",
    "prerequisites",
]

SAVE_TYPES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]
DAMAGE_TYPES = ["acid", "cold", "energy", "fire", "force", "ion", "kinetic", "lightning", "necrotic", "poison", "psychic", "sonic", "true"]
CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "slowed", "stunned", "unconscious", "weakened"]
LIST_FIELDS = {"tags", "damage_types", "conditions_inflicted"}


def parse_scalar(value: str):
    value = value.strip()
    if value in {"true", "false"}:
        return value == "true"
    if value.startswith("[") and value.endswith("]"):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return []
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    try:
        return int(value)
    except ValueError:
        return value


def parse_card(path: Path) -> tuple[dict[str, object], str, list[str]]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    if not text.startswith("---\n"):
        return {}, text, ["frontmatter missing"]
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text, ["frontmatter malformed"]
    meta: dict[str, object] = {}
    for line in parts[1].splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            errors.append(f"frontmatter line malformed: {line}")
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = parse_scalar(value)
    return meta, parts[2].lstrip(), errors


def card_paths() -> list[Path]:
    if not MANEUVER_ROOT.exists():
        return []
    return sorted(path for path in MANEUVER_ROOT.glob("*.md") if path.name != "index.md")


def slugify(value: str) -> str:
    value = value.lower().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def detect_saves(text: str) -> list[str]:
    return sorted({save for save in SAVE_TYPES if re.search(rf"\b{save} saving throw\b", text, re.I)})


def detect_damage_types(text: str) -> list[str]:
    return sorted({damage for damage in DAMAGE_TYPES if re.search(rf"\b{damage} damage\b", text, re.I)})


def detect_conditions(text: str) -> list[str]:
    return sorted({condition for condition in CONDITIONS if re.search(rf"\b{condition}\b", text, re.I)})


def detect_attack_roll(text: str) -> bool:
    return bool(re.search(r"\battack roll\b|\bweapon attack\b|\bmelee attack\b|\branged attack\b", text, re.I))


def scrub_metadata_lines(text: str) -> str:
    ignored_prefixes = (
        "* Attack Roll:",
        "* Attack interaction:",
    )
    return "\n".join(line for line in text.splitlines() if not line.strip().startswith(ignored_prefixes))


def find_links(path: Path, text: str) -> list[Path]:
    links = []
    for target in re.findall(r"\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)", text):
        if "://" in target or target.startswith("#"):
            continue
        links.append((path.parent / target).resolve())
    return links


def render_report(*, count: int, warnings: dict[str, list[str]], severe: list[str], needs_review: list[str]) -> str:
    warning_total = sum(len(items) for items in warnings.values())
    lines = [
        "# Maneuver Cards QA",
        "",
        "## Summary",
        "",
        f"* Maneuver cards: {count}",
        f"* Warnings: {warning_total}",
        f"* Severe errors: {len(severe)}",
        f"* Needs review tags: {len(needs_review)}",
        "",
        "## Severe Errors",
        "",
    ]
    lines.extend(f"* {item}" for item in severe) if severe else lines.append("None.")
    lines += ["", "## Warnings", ""]
    if warnings:
        for key in sorted(warnings):
            lines.append(f"### {key}")
            lines.extend(f"* {item}" for item in warnings[key])
            lines.append("")
    else:
        lines.append("None.")
        lines.append("")
    lines += ["## Needs Review", ""]
    lines.extend(f"* {item}" for item in needs_review) if needs_review else lines.append("None.")
    return "\n".join(lines).rstrip() + "\n"


def analyze() -> tuple[str, int]:
    paths = card_paths()
    severe: list[str] = []
    warnings: dict[str, list[str]] = defaultdict(list)
    cards: list[tuple[Path, dict[str, object], str]] = []

    for path in paths:
        meta, body, errors = parse_card(path)
        if errors:
            severe.extend(f"{path}: {error}" for error in errors)
        for key in ("title", "source", "page_start", "page_end"):
            if meta.get(key) in (None, "", 0):
                severe.append(f"{path}: missing {key}")
        for field in REQUIRED_FIELDS:
            if field not in meta:
                warnings["missing_required_fields"].append(f"{path}: {field}")
        for field in LIST_FIELDS:
            if field in meta and not isinstance(meta[field], list):
                warnings["list_field_not_list"].append(f"{path}: {field}")
        if meta.get("category") != "maneuver":
            warnings["invalid_category"].append(str(path))
        if meta.get("maneuver_type") not in {"general", "mental", "physical"}:
            warnings["invalid_maneuver_type"].append(str(path))
        if not meta.get("activation"):
            warnings["without_activation"].append(str(path))

        text = scrub_metadata_lines(body)
        detected_saves = detect_saves(text)
        if detected_saves and not meta.get("save"):
            warnings["save_detected_but_empty"].append(f"{path}: {', '.join(detected_saves)}")
        detected_damage = detect_damage_types(text)
        if detected_damage and not meta.get("damage_types"):
            warnings["damage_text_but_damage_types_empty"].append(f"{path}: {', '.join(detected_damage)}")
        detected_conditions = detect_conditions(text)
        if detected_conditions and not meta.get("conditions_inflicted"):
            warnings["condition_text_but_conditions_empty"].append(f"{path}: {', '.join(detected_conditions)}")
        if detect_attack_roll(text) and meta.get("attack_roll") is False:
            warnings["attack_roll_detected_but_false"].append(str(path))
        cards.append((path, meta, body))

    slugs = [path.stem for path, _, _ in cards]
    for slug, count in Counter(slugs).items():
        if count > 1:
            severe.append(f"duplicate slug: {slug}")
    for path, meta, _ in cards:
        if path.stem != slugify(str(meta.get("title", ""))):
            warnings["bad_filenames"].append(str(path))

    index_paths = [
        MANEUVER_ROOT / "index.md",
        PROJECT_ROOT / "Compendium" / "player-handbook" / "chapters" / "13-maneuvers" / "index.md",
    ]
    for path in index_paths:
        if not path.exists():
            severe.append(f"missing index: {path}")
            continue
        for target in find_links(path, path.read_text(encoding="utf-8")):
            if not target.exists():
                warnings["broken_index_links"].append(f"{path}: {target}")

    needs_review = [str(path) for path, meta, _ in cards if "needs_review" in (meta.get("tags") or [])]
    report = render_report(count=len(cards), warnings=warnings, severe=severe, needs_review=needs_review)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"DONE: maneuvers={len(cards)} warnings={sum(len(v) for v in warnings.values())} severe={len(severe)} report={REPORT_PATH}")
    return report, 1 if severe else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="QA Player Handbook maneuver cards.")
    parser.parse_args()
    _, code = analyze()
    sys.exit(code)


if __name__ == "__main__":
    main()
