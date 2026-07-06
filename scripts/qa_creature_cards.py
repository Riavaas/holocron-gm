from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CREATURE_ROOT = PROJECT_ROOT / "Compendium" / "scum-and-villainy" / "creatures"
INDEX_ROOT = PROJECT_ROOT / "Compendium" / "scum-and-villainy"
REPORT_PATH = PROJECT_ROOT / "reports" / "creature_cards_qa.md"

REQUIRED_FIELDS = [
    "title",
    "source",
    "source_file",
    "knowledge_type",
    "category",
    "book",
    "section",
    "page_start",
    "page_end",
    "tags",
    "status",
    "verbatim_risk",
    "creature_name",
    "creature_type",
    "size",
    "alignment",
    "challenge_rating",
    "xp",
    "armor_class",
    "hit_points",
    "speed",
    "abilities",
    "saving_throws",
    "skills",
    "damage_vulnerabilities",
    "damage_resistances",
    "damage_immunities",
    "condition_immunities",
    "senses",
    "languages",
    "traits",
    "actions",
    "reactions",
    "legendary_actions",
    "lair_actions",
    "regional_effects",
    "environment",
    "faction",
    "role",
]


def parse_scalar(value: str):
    value = value.strip()
    if value in {"true", "false"}:
        return value == "true"
    if value.startswith("[") or value.startswith("{"):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return [] if value.startswith("[") else {}
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
    if not CREATURE_ROOT.exists():
        return []
    return sorted(path for path in CREATURE_ROOT.rglob("*.md") if path.name != "index.md")


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
        "# Creature Cards QA",
        "",
        "## Summary",
        "",
        f"* Creature cards: {count}",
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
        if meta.get("category") != "creature_statblock":
            warnings["invalid_category"].append(str(path))
        if not meta.get("challenge_rating"):
            warnings["missing_cr"].append(str(path))
        if not meta.get("armor_class"):
            warnings["missing_ac"].append(str(path))
        if not meta.get("hit_points"):
            warnings["missing_hp"].append(str(path))
        if not meta.get("creature_type"):
            warnings["missing_creature_type"].append(str(path))
        cards.append((path, meta, body))

    slugs = [path.stem for path, _, _ in cards]
    for slug, count in Counter(slugs).items():
        if count > 1:
            severe.append(f"duplicate slug: {slug}")
    names = [str(meta.get("creature_name") or meta.get("title") or "") for _, meta, _ in cards]
    for name, count in Counter(names).items():
        if name and count > 1:
            warnings["duplicate_creature_names"].append(name)

    index_paths = list((INDEX_ROOT / "indexes").glob("*.md"))
    index_paths += [
        INDEX_ROOT / "index.md",
        INDEX_ROOT / "toc.md",
        INDEX_ROOT / "creatures" / "index.md",
        INDEX_ROOT / "statblocks" / "index.md",
        INDEX_ROOT / "statblocks" / "by-cr.md",
        INDEX_ROOT / "statblocks" / "by-type.md",
        INDEX_ROOT / "statblocks" / "by-environment.md",
        INDEX_ROOT / "statblocks" / "by-role.md",
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
    print(f"DONE: creatures={len(cards)} warnings={sum(len(v) for v in warnings.values())} severe={len(severe)} report={REPORT_PATH}")
    return report, 1 if severe else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="QA Scum and Villainy creature cards.")
    parser.parse_args()
    _, code = analyze()
    sys.exit(code)


if __name__ == "__main__":
    main()
