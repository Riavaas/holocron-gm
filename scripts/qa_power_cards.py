from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
POWER_ROOT = PROJECT_ROOT / "Compendium" / "player-handbook" / "powers"
REPORT_PATH = PROJECT_ROOT / "reports" / "power_cards_qa.md"

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
    "power_type",
    "level",
    "casting_time",
    "range",
    "duration",
    "concentration",
    "save",
    "attack_roll",
    "damage_types",
    "conditions_inflicted",
    "classes_or_archetypes",
]

SAVE_TYPES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]
DAMAGE_TYPES = ["acid", "cold", "energy", "fire", "force", "ion", "kinetic", "lightning", "necrotic", "poison", "psychic", "sonic"]
CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]
BOOL_FIELDS = {"concentration", "attack_roll"}
LIST_FIELDS = {"tags", "damage_types", "conditions_inflicted", "classes_or_archetypes"}


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


def dump_scalar(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return json.dumps(value)
    if isinstance(value, int):
        return str(value)
    return '"' + str(value).replace('"', '\\"') + '"'


def parse_card(path: Path) -> tuple[dict[str, object], str, list[str]]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    if not text.startswith("---\n"):
        return {}, text, ["frontmatter missing"]
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text, ["frontmatter malformed"]
    raw = parts[1]
    body = parts[2].lstrip()
    meta: dict[str, object] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            errors.append(f"frontmatter line malformed: {line}")
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = parse_scalar(value)
    return meta, body, errors


def write_card(path: Path, meta: dict[str, object], body: str) -> None:
    lines = ["---"]
    for field in REQUIRED_FIELDS:
        if field in meta:
            lines.append(f"{field}: {dump_scalar(meta[field])}")
    for key in meta:
        if key not in REQUIRED_FIELDS:
            lines.append(f"{key}: {dump_scalar(meta[key])}")
    lines.append("---")
    path.write_text("\n".join(lines) + "\n\n" + body.rstrip() + "\n", encoding="utf-8")


def card_paths() -> list[Path]:
    paths: list[Path] = []
    for kind in ("force", "tech"):
        paths.extend(path for path in (POWER_ROOT / kind).glob("*.md") if path.name != "index.md")
    return sorted(paths)


def detect_saves(text: str) -> list[str]:
    return sorted({save for save in SAVE_TYPES if re.search(rf"\b{save} saving throw\b", text, re.I)})


def detect_damage_types(text: str) -> list[str]:
    return sorted({damage for damage in DAMAGE_TYPES if re.search(rf"\b{damage} damage\b", text, re.I)})


def detect_conditions(text: str) -> list[str]:
    return sorted(
        {
            condition
            for condition in CONDITIONS
            if re.search(rf"\b(?:becomes?|is|are|falls?|fall|knocked) {condition}\b|\b{condition} condition\b", text, re.I)
        }
    )


def detect_attack_roll(text: str) -> bool:
    return bool(re.search(r"\bpower attack\b|\bmake (?:a|an) (?:ranged|melee) .*attack\b|\battack roll\b", text, re.I))


def scrub_metadata_lines(text: str) -> str:
    ignored_prefixes = (
        "* Attack Roll:",
        "* Attack roll:",
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


def add_needs_review(meta: dict[str, object]) -> None:
    tags = meta.get("tags")
    if not isinstance(tags, list):
        tags = []
    if "needs_review" not in tags:
        tags.append("needs_review")
    meta["tags"] = tags


def analyze(fix: bool = False) -> tuple[str, int]:
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
        expected_type = path.parent.name
        if meta.get("power_type") != expected_type:
            warnings["invalid_power_type"].append(str(path))
        expected_category = f"{expected_type}_power"
        if meta.get("category") != expected_category:
            warnings["invalid_category"].append(str(path))
        if not meta.get("level"):
            warnings["without_level"].append(str(path))
        if not meta.get("casting_time"):
            warnings["without_casting_time"].append(str(path))
        if not meta.get("range"):
            warnings["without_range"].append(str(path))
        if not meta.get("duration"):
            warnings["without_duration"].append(str(path))

        text = scrub_metadata_lines(body)
        duration = str(meta.get("duration", ""))
        concentration = bool(meta.get("concentration"))
        detected_concentration = "concentration" in duration.lower()
        if concentration != duration.lower().startswith("concentration"):
            warnings["concentration_incoherent"].append(str(path))
            if fix:
                meta["concentration"] = duration.lower().startswith("concentration")

        detected_saves = detect_saves(text)
        current_save = str(meta.get("save", ""))
        if detected_saves and not current_save:
            warnings["save_detected_but_empty"].append(f"{path}: {', '.join(detected_saves)}")
            if fix:
                meta["save"] = ", ".join(detected_saves)
        if detect_attack_roll(text) and meta.get("attack_roll") is False:
            warnings["attack_roll_detected_but_false"].append(str(path))
            if fix:
                meta["attack_roll"] = True
        detected_damage = detect_damage_types(text)
        current_damage = meta.get("damage_types")
        if detected_damage and not current_damage:
            warnings["damage_text_but_damage_types_empty"].append(f"{path}: {', '.join(detected_damage)}")
            if fix:
                meta["damage_types"] = detected_damage
        detected_conditions = detect_conditions(text)
        current_conditions = meta.get("conditions_inflicted")
        if detected_conditions and not current_conditions:
            warnings["condition_text_but_conditions_empty"].append(f"{path}: {', '.join(detected_conditions)}")
            if fix:
                meta["conditions_inflicted"] = detected_conditions
        if detected_concentration and not concentration:
            add_needs_review(meta)
        if fix:
            write_card(path, meta, body)
        cards.append((path, meta, body))

    slugs = [path.stem for path, _, _ in cards]
    for slug, count in Counter(slugs).items():
        if count > 1:
            severe.append(f"duplicate slug: {slug}")
    titles = [str(meta.get("title", "")) for _, meta, _ in cards]
    duplicate_titles = [title for title, count in Counter(titles).items() if title and count > 1]
    bad_filenames = [str(path) for path, meta, _ in cards if path.stem != slugify(str(meta.get("title", "")))]
    missing_pages = [str(path) for path, meta, _ in cards if meta.get("page_start") in (None, "", 0) or meta.get("page_end") in (None, "", 0)]
    needs_review = [str(path) for path, meta, _ in cards if "needs_review" in (meta.get("tags") or [])]

    broken_links = []
    markdown_paths = list((PROJECT_ROOT / "Compendium" / "player-handbook").rglob("*.md"))
    for path in markdown_paths:
        for target in find_links(path, path.read_text(encoding="utf-8")):
            if not target.exists():
                broken_links.append(f"{path}: {target}")

    if broken_links:
        warnings["broken_links"].extend(broken_links)
    if bad_filenames:
        warnings["bad_filenames"].extend(bad_filenames)
    if missing_pages:
        warnings["missing_pages"].extend(missing_pages)

    force_count = sum(1 for path, _, _ in cards if path.parent.name == "force")
    tech_count = sum(1 for path, _, _ in cards if path.parent.name == "tech")
    report = render_report(
        force_count=force_count,
        tech_count=tech_count,
        needs_review=needs_review,
        duplicate_titles=duplicate_titles,
        warnings=warnings,
        severe=severe,
        fixed=fix,
    )
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"DONE: force={force_count} tech={tech_count} warnings={sum(len(v) for v in warnings.values())} severe={len(severe)} report={REPORT_PATH}")
    return report, 1 if severe else 0


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower().replace("/", " ").replace("'", "")).strip("-")


def section(title: str, items: list[str], limit: int = 60) -> str:
    lines = [f"## {title}", "", f"Count: {len(items)}", ""]
    if items:
        lines.extend(f"* `{item}`" for item in items[:limit])
        if len(items) > limit:
            lines.append(f"* ... {len(items) - limit} more")
    else:
        lines.append("* None")
    return "\n".join(lines)


def render_report(*, force_count: int, tech_count: int, needs_review: list[str], duplicate_titles: list[str], warnings: dict[str, list[str]], severe: list[str], fixed: bool) -> str:
    parts = [
        "# Power Cards QA",
        "",
        "## Summary",
        "",
        f"* Force powers: {force_count}",
        f"* Tech powers: {tech_count}",
        f"* Total powers: {force_count + tech_count}",
        f"* Fix mode: {str(fixed).lower()}",
        f"* Severe structural errors: {len(severe)}",
        "",
        section("Cards With `needs_review`", needs_review),
        section("Cards Without Level", warnings.get("without_level", [])),
        section("Cards Without Casting Time", warnings.get("without_casting_time", [])),
        section("Cards Without Range", warnings.get("without_range", [])),
        section("Cards Without Duration", warnings.get("without_duration", [])),
        section("Concentration Incoherent", warnings.get("concentration_incoherent", [])),
        section("Save Detected But Field Empty", warnings.get("save_detected_but_empty", [])),
        section("Attack Roll Detected But False", warnings.get("attack_roll_detected_but_false", [])),
        section("Damage Text But `damage_types` Empty", warnings.get("damage_text_but_damage_types_empty", [])),
        section("Condition Text But `conditions_inflicted` Empty", warnings.get("condition_text_but_conditions_empty", [])),
        section("Duplicate Titles", duplicate_titles),
        section("Bad Filenames", warnings.get("bad_filenames", [])),
        section("Broken Links In Indexes", warnings.get("broken_links", [])),
        section("Frontmatter Invalid Or Missing Fields", warnings.get("missing_required_fields", [])),
        section("Missing Or Zero Pages", warnings.get("missing_pages", [])),
        section("Severe Structural Errors", severe),
    ]
    return "\n\n".join(parts) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="QA Player Handbook power cards.")
    parser.add_argument("--fix", action="store_true", help="Apply safe metadata fixes.")
    args = parser.parse_args()
    _, code = analyze(fix=args.fix)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
