from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BOOKS_DIR = PROJECT_ROOT / "Books"
COMPENDIUM_ROOT = PROJECT_ROOT / "Compendium" / "scum-and-villainy"
SOURCE = "SW5e Scum and Villainy"
SOURCE_FILE = "SW5e - Scum and Villainy - 20191105.pdf"
BOOK_KEY = "scum-and-villainy"
SIZE_PATTERN = r"Tiny|Small|Medium|Large|Huge|Gargantuan|Garagantuan"
DEFAULT_CREATURE_LIMIT = 225

REQUIRED_DIRS = [
    "creatures",
    "creatures/abeloth",
    "creatures/droids",
    "creatures/beasts",
    "creatures/humanoids",
    "creatures/plants",
    "creatures/vehicles-or-special",
    "creatures/unknown",
    "statblocks",
    "encounter-tools",
    "indexes",
]


@dataclass
class Creature:
    name: str
    page: int
    size: str
    creature_type: str
    alignment: str
    armor_class: str = ""
    hit_points: str = ""
    speed: str = ""
    abilities: dict[str, str] | None = None
    saving_throws: list[str] | None = None
    skills: list[str] | None = None
    damage_vulnerabilities: list[str] | None = None
    damage_resistances: list[str] | None = None
    damage_immunities: list[str] | None = None
    condition_immunities: list[str] | None = None
    senses: list[str] | None = None
    languages: list[str] | None = None
    challenge_rating: str = ""
    xp: str = ""
    traits: list[str] | None = None
    actions: list[str] | None = None
    reactions: list[str] | None = None
    legendary_actions: list[str] | None = None
    lair_actions: list[str] | None = None
    regional_effects: list[str] | None = None


def find_pdf() -> Path:
    exact = BOOKS_DIR / SOURCE_FILE
    if exact.exists():
        return exact
    matches = sorted(BOOKS_DIR.glob("*Scum*Villainy*.pdf"))
    if not matches:
        raise FileNotFoundError("Scum and Villainy PDF not found in Books/.")
    return matches[0]


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    return value.replace("—", "-").strip()


def slugify(value: str) -> str:
    value = value.lower().replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def title_case(value: str) -> str:
    small = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "or", "the", "to", "with"}
    words = value.lower().split()
    fixed = []
    for index, word in enumerate(words):
        if index and word in small:
            fixed.append(word)
        else:
            fixed.append("-".join(part.capitalize() for part in word.split("-")))
    title = " ".join(fixed).replace("Droid", "Droid")
    vehicle_acronyms = {
        "3po": "3PO",
        "At-At": "AT-AT",
        "At-Rt": "AT-RT",
        "At-St": "AT-ST",
        "At-Te": "AT-TE",
        "Aat": "AAT",
        "Drk-1": "DRK-1",
        "Gh-7": "GH-7",
        "Id9": "ID9",
        "Jk-13": "JK-13",
        "Lom": "LOM",
    }
    for rendered, acronym in vehicle_acronyms.items():
        title = re.sub(rf"\b{re.escape(rendered)}\b", acronym, title, flags=re.I)
    title = re.sub(r"\(aat\)", "(AAT)", title, flags=re.I)
    acronyms = ["HK", "IG", "BT", "BB", "C1", "R2", "B1", "B2", "BX", "DSD1", "TX"]
    for acronym in acronyms:
        title = re.sub(rf"\b{acronym.title()}\b", acronym, title)
    return title


def list_from_field(value: str) -> list[str]:
    if not value or value in {"-", "—"}:
        return []
    value = value.replace(" and ", ", ")
    return [part.strip(" .") for part in value.split(",") if part.strip(" .")]


def extract_lines(pdf_path: Path, start_page: int = 7, end_page: int = 192) -> list[tuple[int, str]]:
    if fitz is None:
        raise RuntimeError("PyMuPDF is required.")
    doc = fitz.open(pdf_path)
    lines: list[tuple[int, str]] = []
    for page_number in range(start_page, min(end_page, doc.page_count) + 1):
        for raw in doc[page_number - 1].get_text().splitlines():
            line = normalize_text(raw)
            if line:
                lines.append((page_number, line))
    return lines


def is_size_line(line: str) -> bool:
    return bool(re.match(rf"^({SIZE_PATTERN})\s+[A-Za-z -]+,\s*.+$", line))


def is_upper_heading(line: str) -> bool:
    return bool(re.match(r"^[A-Z0-9][A-Z0-9\- ,'()/]+$", line))


def statblock_starts(lines: list[tuple[int, str]]) -> list[int]:
    starts = []
    for index, (_, line) in enumerate(lines):
        if is_statblock_start(lines, index):
            starts.append(index)
    return starts


def is_statblock_start(lines: list[tuple[int, str]], index: int) -> bool:
    if not is_size_line(lines[index][1]):
        return False
    if not name_before(lines, index):
        return False
    lookahead = [line for _, line in lines[index + 1:index + 10]]
    return (
        any(line.startswith("Armor Class") for line in lookahead)
        and any(line.startswith("Hit Points") for line in lookahead)
        and any(line.startswith("Speed") for line in lookahead)
    )


def name_before(lines: list[tuple[int, str]], index: int) -> str:
    parts: list[str] = []
    cursor = index - 1
    while cursor >= 0 and len(parts) < 3:
        line = lines[cursor][1]
        if line in {"MONSTERS", "ACTIONS", "REACTIONS", "LEGENDARY ACTIONS"} or line.isdigit():
            break
        if is_upper_heading(line):
            parts.append(line)
        elif parts:
            break
        cursor -= 1
    return title_case(" ".join(reversed(parts)))


def join_continued_fields(block: list[str]) -> list[str]:
    result: list[str] = []
    continuable_prefixes = (
        "Armor Class",
        "Hit Points",
        "Speed",
        "Saving Throws",
        "Saves",
        "Skills",
        "Skill",
        "Damage Vulnerabilities",
        "Damage Vulnerability",
        "Damage vulnerabilities",
        "Damage Resistances",
        "Damage Resistance",
        "Damage Immunities",
        "Condition Immunities",
        "Senses",
        "Languages",
    )
    field_prefixes = continuable_prefixes + ("Challenge",)
    for line in block:
        if (
            result
            and not line.startswith(field_prefixes)
            and result[-1].startswith(continuable_prefixes)
            and not re.match(r"^(STR|DEX|CON|INT|WIS|CHA|ACTIONS|REACTIONS|LEGENDARY ACTIONS)$", line)
        ):
            result[-1] += " " + line
        else:
            result.append(line)
    return result


def field_value(block: list[str], label: str) -> str:
    for line in block:
        if line.lower().startswith(label.lower()):
            return line[len(label):].strip()
    return ""


def field_value_any(block: list[str], labels: tuple[str, ...]) -> str:
    for label in labels:
        value = field_value(block, label)
        if value:
            return value.lstrip("* ")
    return ""


def named_entry(line: str) -> str:
    # A real feature heading is followed by its rules text. Wrapped prose often
    # ends with a period and must not become a synthetic feature name.
    match = re.match(r"^([A-Z][A-Za-z0-9 '\-()/]+?)\.\s+\S", line)
    if not match:
        match = re.match(
            r"^([A-Z][A-Za-z0-9 '\-()/]+?)\s+"
            r"(?=(?:Melee|Ranged) (?:Weapon|Force|Tech) Attack\b|As an? (?:action|bonus action|reaction)\b|The \w+ makes\b)",
            line,
        )
    if not match:
        return ""
    candidate = match.group(1).strip()
    if re.search(r"^(?:DC \d+|The )|\bsaving throw\b|\buntil\b|\bor be\b", candidate, flags=re.I):
        return ""
    return candidate


def parse_names_between(block: list[str], start_label: str, end_labels: set[str]) -> list[str]:
    names: list[str] = []
    active = False
    for line in block:
        if line == start_label:
            active = True
            continue
        if active and line in end_labels:
            break
        if active and is_upper_heading(line) and line not in {"ACTIONS", "REACTIONS", "LEGENDARY ACTIONS"}:
            break
        if not active:
            continue
        name = named_entry(line)
        if name and name not in names:
            names.append(name)
    return names


def parse_traits(block: list[str]) -> list[str]:
    traits: list[str] = []
    in_traits = False
    for line in block:
        if line.startswith("Challenge "):
            in_traits = True
            continue
        if line in {"ACTIONS", "REACTIONS", "LEGENDARY ACTIONS"}:
            break
        if in_traits and is_upper_heading(line):
            break
        if not in_traits:
            continue
        name = named_entry(line)
        if name and name not in traits:
            traits.append(name)
    return traits


def parse_creature(lines: list[tuple[int, str]], start: int, end: int) -> Creature:
    page, size_line = lines[start]
    name = name_before(lines, start)
    match = re.match(rf"^({SIZE_PATTERN})\s+([A-Za-z -]+),\s*(.+)$", size_line)
    size = match.group(1) if match else ""
    if size == "Garagantuan":
        size = "Gargantuan"
    creature_type = (match.group(2) if match else "").lower()
    alignment = match.group(3) if match else ""
    block = join_continued_fields([line for _, line in lines[start + 1:end]])
    abilities = {"str": "", "dex": "", "con": "", "int": "", "wis": "", "cha": ""}
    for index, line in enumerate(block):
        if line == "CHA" and index + 6 < len(block):
            values = block[index + 1:index + 7]
            abilities = dict(zip(["str", "dex", "con", "int", "wis", "cha"], values))
            break
    challenge = field_value(block, "Challenge")
    cr = challenge
    xp = ""
    cr_match = re.match(r"([^()]+)(?:\(([^)]+)\))?", challenge)
    if cr_match:
        cr = cr_match.group(1).strip()
        xp = cr_match.group(2).replace(" XP", "").strip() if cr_match.group(2) else ""
    return Creature(
        name=name,
        page=page,
        size=size,
        creature_type=creature_type,
        alignment=alignment,
        armor_class=field_value(block, "Armor Class"),
        hit_points=field_value(block, "Hit Points"),
        speed=field_value(block, "Speed"),
        abilities=abilities,
        saving_throws=list_from_field(field_value_any(block, ("Saving Throws", "Saves"))),
        skills=list_from_field(field_value(block, "Skills") or field_value(block, "Skill")),
        damage_vulnerabilities=list_from_field(
            field_value_any(block, ("Damage Vulnerabilities", "Damage vulnerabilities", "Damage Vulnerability"))
        ),
        damage_resistances=list_from_field(field_value_any(block, ("Damage Resistances", "Damage Resistance"))),
        damage_immunities=list_from_field(field_value(block, "Damage Immunities")),
        condition_immunities=list_from_field(field_value(block, "Condition Immunities")),
        senses=list_from_field(field_value(block, "Senses")),
        languages=list_from_field(field_value(block, "Languages")),
        challenge_rating=cr,
        xp=xp,
        traits=parse_traits(block),
        actions=parse_names_between(block, "ACTIONS", {"REACTIONS", "LEGENDARY ACTIONS"}),
        reactions=parse_names_between(block, "REACTIONS", {"LEGENDARY ACTIONS"}),
        legendary_actions=parse_names_between(block, "LEGENDARY ACTIONS", set()),
        lair_actions=[],
        regional_effects=[],
    )


def extract_creatures(limit: int | None = None) -> list[Creature]:
    lines = extract_lines(find_pdf())
    starts = statblock_starts(lines)
    creatures: list[Creature] = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        creature = parse_creature(lines, start, end)
        if creature.name:
            creatures.append(creature)
        if limit is not None and len(creatures) >= limit:
            break
    return creatures


def frontmatter(meta: dict[str, object]) -> str:
    lines = ["---"]
    for key, value in meta.items():
        if isinstance(value, bool):
            rendered = "true" if value else "false"
        elif isinstance(value, (list, dict)):
            rendered = json.dumps(value)
        elif isinstance(value, int):
            rendered = str(value)
        else:
            rendered = json.dumps(str(value))
        lines.append(f"{key}: {rendered}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def folder_for(creature: Creature) -> Path:
    name = creature.name.lower()
    ctype = creature.creature_type.lower()
    if "abeloth" in name:
        return COMPENDIUM_ROOT / "creatures" / "abeloth"
    if "droid" in ctype or "droid" in name:
        return COMPENDIUM_ROOT / "creatures" / "droids"
    if "beast" in ctype:
        return COMPENDIUM_ROOT / "creatures" / "beasts"
    if "plant" in ctype:
        return COMPENDIUM_ROOT / "creatures" / "plants"
    if "humanoid" in ctype:
        return COMPENDIUM_ROOT / "creatures" / "humanoids"
    if any(token in ctype for token in ("construct", "vehicle")):
        return COMPENDIUM_ROOT / "creatures" / "vehicles-or-special"
    return COMPENDIUM_ROOT / "creatures" / "unknown"


def environment_for(creature: Creature) -> list[str]:
    name = creature.name.lower()
    if any(token in name for token in ("bantha", "anooba")):
        return ["desert"]
    if "aiwha" in name:
        return ["aquatic", "aerial"]
    if "acklay" in name:
        return ["jungle", "arena"]
    if "droid" in creature.creature_type or "droid" in name:
        return ["urban", "military", "starship"]
    if "plant" in creature.creature_type:
        return ["wilderness"]
    return []


def faction_for(creature: Creature) -> list[str]:
    name = creature.name.lower()
    if any(token in name for token in ("b1", "b2", "bx", "destroyer", "dwarf spider")):
        return ["Separatist"]
    if any(token in name for token in ("hk-47", "ig-", "bt-1")):
        return ["independent"]
    if "abeloth" in name:
        return ["unknown"]
    return ["unknown"]


def role_for(creature: Creature) -> list[str]:
    name = creature.name.lower()
    roles: list[str] = []
    if any(token in name for token in ("assassin", "commando")):
        roles.append("skirmisher")
    if any(token in name for token in ("adult", "hydra", "destroyer", "acklay", "bantha")):
        roles.append("brute")
    if creature.legendary_actions:
        roles.append("legendary")
    if "droid" in creature.creature_type or "droid" in name:
        roles.append("ranged")
    return roles or ["combatant"]


def tags_for(creature: Creature, folder: Path) -> list[str]:
    tags = ["creature", "statblock", slugify(creature.name), f"cr-{slugify(creature.challenge_rating)}"]
    tags.append(slugify(creature.creature_type))
    tags.extend(slugify(item) for item in role_for(creature))
    if folder.name != "unknown":
        tags.append(folder.name)
    required = [creature.challenge_rating, creature.armor_class, creature.hit_points, creature.creature_type]
    if any(not item for item in required):
        tags.append("needs_review")
    return sorted({tag for tag in tags if tag})


def card_content(creature: Creature) -> str:
    folder = folder_for(creature)
    env = environment_for(creature)
    faction = faction_for(creature)
    role = role_for(creature)
    tags = tags_for(creature, folder)
    abilities = creature.abilities or {"str": "", "dex": "", "con": "", "int": "", "wis": "", "cha": ""}
    meta = {
        "title": creature.name,
        "source": SOURCE,
        "source_file": SOURCE_FILE,
        "knowledge_type": "sw5e_compendium",
        "category": "creature_statblock",
        "book": BOOK_KEY,
        "section": creature.name,
        "page_start": creature.page,
        "page_end": creature.page,
        "tags": tags,
        "status": "draft",
        "verbatim_risk": "low",
        "creature_name": creature.name,
        "creature_type": creature.creature_type,
        "size": creature.size,
        "alignment": creature.alignment,
        "challenge_rating": creature.challenge_rating,
        "xp": creature.xp,
        "armor_class": creature.armor_class,
        "hit_points": creature.hit_points,
        "speed": creature.speed,
        "abilities": abilities,
        "saving_throws": creature.saving_throws or [],
        "skills": creature.skills or [],
        "damage_vulnerabilities": creature.damage_vulnerabilities or [],
        "damage_resistances": creature.damage_resistances or [],
        "damage_immunities": creature.damage_immunities or [],
        "condition_immunities": creature.condition_immunities or [],
        "senses": creature.senses or [],
        "languages": creature.languages or [],
        "traits": creature.traits or [],
        "actions": creature.actions or [],
        "reactions": creature.reactions or [],
        "legendary_actions": creature.legendary_actions or [],
        "lair_actions": creature.lair_actions or [],
        "regional_effects": creature.regional_effects or [],
        "environment": env,
        "faction": faction,
        "role": role,
    }
    trait_text = ", ".join(creature.traits or []) or "None detected."
    action_text = ", ".join(creature.actions or []) or "None detected."
    reaction_text = ", ".join(creature.reactions or []) or "None detected."
    legendary_text = ", ".join(creature.legendary_actions or []) or "None detected."
    xp_text = creature.xp or "not listed"
    body = f"""# {creature.name}

## Source

* Book: {SOURCE}
* Pages: {creature.page}-{creature.page}
* Original section: {creature.name}

## Quick Identity

* Type: {creature.size} {creature.creature_type}, {creature.alignment}
* Role: {', '.join(role)}
* Main danger: {action_text}
* Star Wars context: use as a {', '.join(faction)} threat or encounter piece when that faction/context fits.

## Stat Summary

* Size / Type / Alignment: {creature.size} {creature.creature_type}, {creature.alignment}
* CR / XP: {creature.challenge_rating} / {xp_text}
* AC: {creature.armor_class}
* HP: {creature.hit_points}
* Speed: {creature.speed}
* Key abilities: STR {abilities.get('str', '')}, DEX {abilities.get('dex', '')}, CON {abilities.get('con', '')}, INT {abilities.get('int', '')}, WIS {abilities.get('wis', '')}, CHA {abilities.get('cha', '')}
* Saves: {', '.join(creature.saving_throws or []) or 'none detected'}
* Skills: {', '.join(creature.skills or []) or 'none detected'}
* Senses: {', '.join(creature.senses or []) or 'none detected'}
* Languages: {', '.join(creature.languages or []) or 'none detected'}

## Defenses

* Vulnerabilities: {', '.join(creature.damage_vulnerabilities or []) or 'none detected'}
* Resistances: {', '.join(creature.damage_resistances or []) or 'none detected'}
* Immunities: {', '.join(creature.damage_immunities or []) or 'none detected'}
* Condition Immunities: {', '.join(creature.condition_immunities or []) or 'none detected'}

## Traits

{trait_text}

## Actions

{action_text}

## Reactions

{reaction_text}

## Legendary / Lair / Regional

* Legendary actions: {legendary_text}
* Lair actions: {', '.join(creature.lair_actions or []) or 'none detected'}
* Regional effects: {', '.join(creature.regional_effects or []) or 'none detected'}

## GM Use

* Use this creature when its CR, faction, and environment fit the scene.
* Combat role: {', '.join(role)}.
* Danger level: CR {creature.challenge_rating}; verify exact mechanics on the cited source page.
* Run fast by tracking AC, HP, major defenses, and named actions first.

## Tactics

* Opener: choose the strongest listed action that fits range and positioning.
* Preferred targets: vulnerable or isolated characters if the role is skirmisher; frontline characters if the role is brute.
* Movement: use listed speed and terrain to pressure the party.
* Retreat/morale: droids follow mission logic; beasts retreat if badly hurt unless cornered.
* Synergies: pair with same faction/type allies from the indexes.

## Encounter Hooks

* Put the creature in a scene that highlights its role: {', '.join(role)}.
* Tie its arrival to faction pressure: {', '.join(faction)}.
* Use the environment tags as encounter dressing: {', '.join(env) or 'flexible'}.

## Loot / Rewards

GM suggestion, not official statblock data: salvage, trophies, local intel, or faction clues appropriate to the creature.

## Combat Tracker Hooks

* HP: {creature.hit_points}
* AC: {creature.armor_class}
* Initiative notes: use DEX {abilities.get('dex', '')}.
* Conditions to apply: check traits/actions on source page.
* Recharges: check named actions on source page.
* Legendary actions: {legendary_text}
* Lair action timing: none detected unless source page says otherwise.

## Related

* [Creature Index](../../indexes/creature-index.md)
* [CR Index](../../indexes/cr-index.md)
* [Type Index](../../indexes/type-index.md)
* [GM Cheatsheet](../../indexes/gm-cheatsheet.md)

## Search Tags

`{'`, `'.join(tags)}`
"""
    return frontmatter(meta) + body


def build_structure(dry_run: bool = False) -> None:
    dirs = [COMPENDIUM_ROOT] + [COMPENDIUM_ROOT / path for path in REQUIRED_DIRS]
    for directory in dirs:
        if dry_run:
            print(f"DRY-RUN mkdir {directory}")
        else:
            directory.mkdir(parents=True, exist_ok=True)


def write_file(path: Path, content: str, *, force: bool = False, dry_run: bool = False) -> None:
    if dry_run:
        print(f"DRY-RUN write {path}")
        return
    if path.exists() and not force:
        print(f"SKIP existing {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def build_toc(force: bool = False, dry_run: bool = False) -> None:
    content = frontmatter(
        {
            "title": "Scum and Villainy Table of Contents",
            "source": SOURCE,
            "source_file": SOURCE_FILE,
            "knowledge_type": "sw5e_compendium",
            "category": "toc",
            "book": BOOK_KEY,
            "section": "Table of Contents",
            "page_start": 4,
            "page_end": 196,
            "tags": ["toc", "scum-and-villainy", "creatures"],
            "status": "draft",
            "verbatim_risk": "low",
        }
    ) + """# Scum and Villainy Table of Contents

## Source

* Book: SW5e Scum and Villainy
* File: SW5e - Scum and Villainy - 20191105.pdf

## Navigation

* Pages 7-192: creature, NPC, droid, beast, monster, and encounter statblocks.
* Pages 193-196: sorted appendix indexes by name and challenge rating.

## Compendium Sections

* [Book Index](index.md)
* [Creature Index](indexes/creature-index.md)
* [CR Index](indexes/cr-index.md)
* [Type Index](indexes/type-index.md)
* [GM Cheatsheet](indexes/gm-cheatsheet.md)
"""
    write_file(COMPENDIUM_ROOT / "toc.md", content, force=force, dry_run=dry_run)


def build_base_pages(creatures: list[Creature], force: bool = False, dry_run: bool = False) -> None:
    index = frontmatter(
        {
            "title": "Scum and Villainy Compendium",
            "source": SOURCE,
            "source_file": SOURCE_FILE,
            "knowledge_type": "sw5e_compendium",
            "category": "book_index",
            "book": BOOK_KEY,
            "section": "Index",
            "page_start": 0,
            "page_end": 0,
            "tags": ["scum-and-villainy", "creatures", "statblocks"],
            "status": "draft",
            "verbatim_risk": "low",
        }
    ) + """# Scum and Villainy Compendium

Compact, cited creature/statblock lookup for GM search, encounter building, and future combat tracker UI.

## Start Here

* [Table of Contents](toc.md)
* [Creatures](creatures/index.md)
* [Statblocks](statblocks/index.md)
* [Encounter Tools](encounter-tools/gm-cheatsheet.md)
* [Indexes](indexes/creature-index.md)
"""
    write_file(COMPENDIUM_ROOT / "index.md", index, force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "creatures" / "index.md", render_creature_index(creatures, relative_prefix="../"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "statblocks" / "index.md", render_statblock_index(creatures), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "statblocks" / "by-cr.md", render_group_index(creatures, "challenge_rating", "Statblocks By CR"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "statblocks" / "by-type.md", render_group_index(creatures, "creature_type", "Statblocks By Type"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "statblocks" / "by-environment.md", render_group_list_index(creatures, environment_for, "Statblocks By Environment"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "statblocks" / "by-role.md", render_group_list_index(creatures, role_for, "Statblocks By Role"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "encounter-tools" / "gm-cheatsheet.md", render_gm_cheatsheet(), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "encounter-tools" / "encounter-builder-notes.md", render_tool_page("Encounter Builder Notes"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "encounter-tools" / "enemy-tactics.md", render_tool_page("Enemy Tactics"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "encounter-tools" / "loot-hooks.md", render_tool_page("Loot Hooks"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "indexes" / "creature-index.md", render_creature_index(creatures, relative_prefix="../"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "indexes" / "cr-index.md", render_group_index(creatures, "challenge_rating", "CR Index", relative_prefix="../"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "indexes" / "type-index.md", render_group_index(creatures, "creature_type", "Type Index", relative_prefix="../"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "indexes" / "faction-index.md", render_group_list_index(creatures, faction_for, "Faction Index", relative_prefix="../"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "indexes" / "page-index.md", render_page_index(creatures, relative_prefix="../"), force=force, dry_run=dry_run)
    write_file(COMPENDIUM_ROOT / "indexes" / "gm-cheatsheet.md", render_gm_cheatsheet(), force=force, dry_run=dry_run)


def creature_link(creature: Creature, relative_prefix: str = "") -> str:
    path = folder_for(creature).relative_to(COMPENDIUM_ROOT) / f"{slugify(creature.name)}.md"
    return f"[{creature.name}]({relative_prefix}{path.as_posix()})"


def page_frontmatter(title: str, category: str, tags: list[str]) -> str:
    return frontmatter(
        {
            "title": title,
            "source": SOURCE,
            "source_file": SOURCE_FILE,
            "knowledge_type": "sw5e_compendium",
            "category": category,
            "book": BOOK_KEY,
            "section": title,
            "page_start": 0,
            "page_end": 0,
            "tags": tags,
            "status": "draft",
            "verbatim_risk": "low",
        }
    )


def render_creature_index(creatures: list[Creature], relative_prefix: str = "") -> str:
    lines = [page_frontmatter("Creature Index", "creature_index", ["creature", "index"]), "# Creature Index", "", "| Creature | CR | Type | Pages | Tags |", "|---|---:|---|---:|---|"]
    for creature in sorted(creatures, key=lambda item: item.name):
        tags = ", ".join(f"`{tag}`" for tag in tags_for(creature, folder_for(creature))[:6])
        lines.append(f"| {creature_link(creature, relative_prefix)} | {creature.challenge_rating} | {creature.creature_type} | {creature.page} | {tags} |")
    return "\n".join(lines)


def render_statblock_index(creatures: list[Creature]) -> str:
    lines = [page_frontmatter("Statblocks Index", "statblock_index", ["statblock", "index"]), "# Statblocks Index", "", "* [By CR](by-cr.md)", "* [By Type](by-type.md)", "* [By Environment](by-environment.md)", "* [By Role](by-role.md)", "", "## Loaded Cards", ""]
    lines.extend(f"* {creature_link(creature, '../')}: CR {creature.challenge_rating}, {creature.creature_type}" for creature in sorted(creatures, key=lambda item: item.name))
    return "\n".join(lines)


def render_group_index(creatures: list[Creature], attr: str, title: str, relative_prefix: str = "../") -> str:
    groups: dict[str, list[Creature]] = defaultdict(list)
    for creature in creatures:
        groups[getattr(creature, attr) or "unknown"].append(creature)
    lines = [page_frontmatter(title, "statblock_index", ["statblock", "index"]), f"# {title}", ""]
    for key in sorted(groups, key=str):
        lines += [f"## {key}", ""]
        lines.extend(f"* {creature_link(creature, relative_prefix)}" for creature in sorted(groups[key], key=lambda item: item.name))
        lines.append("")
    return "\n".join(lines)


def render_group_list_index(creatures: list[Creature], getter, title: str, relative_prefix: str = "../") -> str:
    groups: dict[str, list[Creature]] = defaultdict(list)
    for creature in creatures:
        values = getter(creature) or ["unknown"]
        for value in values:
            groups[value].append(creature)
    lines = [page_frontmatter(title, "statblock_index", ["statblock", "index"]), f"# {title}", ""]
    for key in sorted(groups, key=str):
        lines += [f"## {key}", ""]
        lines.extend(f"* {creature_link(creature, relative_prefix)}" for creature in sorted(groups[key], key=lambda item: item.name))
        lines.append("")
    return "\n".join(lines)


def render_page_index(creatures: list[Creature], relative_prefix: str = "../") -> str:
    lines = [page_frontmatter("Page Index", "page_index", ["pages", "index"]), "# Page Index", "", "| Pages | Creature | Tags |", "|---:|---|---|"]
    for creature in sorted(creatures, key=lambda item: (item.page, item.name)):
        tags = ", ".join(f"`{tag}`" for tag in tags_for(creature, folder_for(creature))[:5])
        lines.append(f"| {creature.page} | {creature_link(creature, relative_prefix)} | {tags} |")
    return "\n".join(lines)


def render_gm_cheatsheet() -> str:
    return page_frontmatter("Scum and Villainy GM Cheatsheet", "gm_cheatsheet", ["gm", "encounters", "creatures"]) + """# Scum and Villainy GM Cheatsheet

## Quick Enemy Lookup

1. Search by creature name first.
2. If building an encounter, filter by CR, type, faction, or role index.
3. Open the card and confirm AC, HP, speed, defenses, traits, actions, reactions, and legendary options.
4. Use the cited source page for exact statblock text.

## Picking Enemies

* Use CR as a starting point, then adjust for action economy and terrain.
* Mix roles: one brute or elite plus lower-CR support usually runs faster than many unique statblocks.
* Prefer creatures with a clear Star Wars context for the current location or faction.

## Droid Reminder

* Droids commonly have ion vulnerability and poison/necrotic/psychic resistance.
* Track Circuitry-like weaknesses when lightning or ion damage appears.

## Beast Reminder

* Beasts usually play best with terrain, pack behavior, charge lines, or ambushes.
* Morale matters: hungry, trained, cornered, or territorial beasts behave differently.

## Legendary Reminder

* Track legendary resistance separately from legendary actions.
* Spend legendary actions at the end of another creature's turn.

## Manual Scaling

* Small bump: add allies, better terrain, or objective pressure.
* Medium bump: increase HP or add one reusable mobility/control option.
* Large bump: use a higher-CR creature from the same type/faction instead.

## Combat Tracker

Track AC, HP, initiative, speed, defenses, recharge actions, reactions, legendary actions, conditions inflicted, and morale/retreat trigger.
"""


def render_tool_page(title: str) -> str:
    slug = slugify(title)
    return page_frontmatter(title, "encounter_tool", ["encounter", slug]) + f"""# {title}

Use the creature cards and indexes as compact GM lookup. Official statblock data belongs in the cited card fields; tactics, hooks, and loot notes are GM suggestions.
"""


def build_creatures(limit: int | None = None, force: bool = False, dry_run: bool = False) -> list[Creature]:
    creatures = extract_creatures(limit=limit)
    for creature in creatures:
        path = folder_for(creature) / f"{slugify(creature.name)}.md"
        write_file(path, card_content(creature), force=force, dry_run=dry_run)
    return creatures


def build(limit: int | None = None, creatures: bool = False, toc_only: bool = False, force: bool = False, dry_run: bool = False) -> None:
    build_structure(dry_run=dry_run)
    selected_limit = limit or DEFAULT_CREATURE_LIMIT
    selected = extract_creatures(limit=selected_limit)
    build_toc(force=force, dry_run=dry_run)
    if toc_only:
        print({"book": BOOK_KEY, "toc": True, "creatures": 0, "force": force, "dry_run": dry_run})
        return
    if creatures:
        selected = build_creatures(limit=selected_limit, force=force, dry_run=dry_run)
    build_base_pages(selected, force=force, dry_run=dry_run)
    print({"book": BOOK_KEY, "creatures": len(selected), "force": force, "dry_run": dry_run})


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Scum and Villainy creature compendium cards.")
    parser.add_argument("--creatures", action="store_true")
    parser.add_argument("--toc-only", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    build(limit=args.limit, creatures=args.creatures, toc_only=args.toc_only, force=args.force, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
