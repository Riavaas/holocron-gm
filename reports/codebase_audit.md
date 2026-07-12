# Holocron GM Codebase Audit

Updated: 2026-07-12

## Baseline

- Branch: `main`
- Python tests before audit: 56 passing
- Python tests after first correction batches: 62 passing
- JavaScript syntax: clean under `node --check`
- Local API, GM route, and player route: HTTP 200
- SW5e item catalog: 2,425 locally cached entries across 28 categories
- Bestiary: 225 structured creatures with CR/type filters and detail sheets

## Reference Repositories

The requested repositories were cloned outside the project checkout:

- `C:/Users/Amn/Desktop/holocron-gm-references/StarWars5e.Site`
- `C:/Users/Amn/Desktop/holocron-gm-references/StarWars5e.Core`

Useful reference areas include the equipment, enhanced-item, monster, power, species,
class, background, character advancement, and character engine models. Neither
repository declares a license in its repository metadata or checkout. Holocron uses
the public SW5e API and independently implemented data adapters; code is not copied
from those repositories.

## Corrected Findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Player display became completely black when the chosen character had no deployed vision token. | Fog and lighting now fall back to a visible map while enemy tokens remain hidden. |
| High | Compendium displayed escaped Markdown as one unreadable paragraph. | Search excerpts recover headings/lists, render through a safe Markdown formatter, and collapse table indexes. |
| High | Dice viewport clipped the die and all meshes had blank faces. | Canvas increased to 250px, framing corrected, face labels generated, and final result overlaid. |
| High | Tokens were always snapped to grid. | Added persistent free-grid toggle and shared snapping helper for drops and drags. |
| High | Battlemap had no pan tool or context actions. | Added hand tool plus fit, fill, center, grid, and focus actions on right-click. |
| High | Bestiary rendered a long list permanently in the encounter sidebar. | Moved it to a non-modal filtered asset window with type/CR filters and creature sheets. |
| High | Character inventory had no real item database. | Added a local SW5e catalog cache and searchable 2,425-item inventory browser. |
| Medium | Some creatures displayed values such as `CR CR 3`. | Challenge rating prefixes are normalized at catalog load time. |
| Medium | Loot used only a few hard-coded strings. | Loot now samples real SW5e equipment/enhanced items according to target CR. |
| Medium | Atmosphere generation covered only four scene types. | Expanded to twelve scenes and eight tones. |
| Medium | Soundboard contained four thin oscillator effects. | Added shared audio mixing, master volume, stop control, layered noise/tones, and eight cues. |
| Medium | NPCs had decorative portraits but no reusable mechanics. | NPCs now prefer mapped art, inherit a bestiary combat profile/actions, and can be deployed. |

## Verified Workflows

- GM and player pages run simultaneously in separate browser tabs.
- Player character selection, resources, credits, and inventory synchronize.
- GM map changes publish to the player display without reload.
- Player display shows the map before a player token is deployed and preserves token secrecy.
- Grid can be hidden and restored.
- Hand panning changes the map transform.
- Bestiary type filtering and creature detail sheets work.
- Item search returns filtered catalog results (`medpac`: 12 matches during QA).
- Dice roll result and numbered 3D faces remain visible without clipping.

## Remaining Audit Work

- Split the 135KB `holocron/web/app.js` into map, encounter, character, compendium,
  toolkit, campaign, and player-sync modules.
- Add automated browser tests for map transforms, token snapping, campaign restore,
  player vision, dialogs, and character inventory.
- Replace the legacy placeholder mannequin with a compact sheet/equipment layout.
- Implement the full SW5e character creation and level-up rules: species, background,
  class, archetype, powers, maneuvers, feats, and prerequisites.
- Expand creature action parsing from names into exact attack/save/damage profiles.
- Audit campaign migration/versioning before changing persisted character schemas.
- Resolve the Starlette `httpx` deprecation warning.
- Review the two handoff documents after active work is consolidated; do not delete
  them until unique operational information is migrated.
- Review external resources individually for license, reliability, and integration type.

## Cleanup Notes

- No tracked `__pycache__`, `.pyc`, `.pytest_cache`, log, or generated database files were found.
- `data/sw5e_cache/` is intentionally ignored because it is reproducible from the public API.
- Existing QA reports remain useful regression evidence and should not be removed.
