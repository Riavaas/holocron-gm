# Desktop QA - 2026-07-14

Scope: browser-based product QA from the GM/user perspective after the SW5e UI polish work.

## Resolutions Tested

- 1024 x 768
- 1280 x 720
- 1366 x 768
- 1440 x 900
- 1920 x 1080

## Views Tested

- Battlemap
- Compendium
- Characters
- Quests
- Toolkit
- Sound & Ambiance

## Findings Fixed

- Global horizontal overflow appeared at 1024, 1366, and 1440 px because the top navigation, campaign controls, player view button, window controls, and AI button could not shrink. The topbar tabs now scroll internally instead of widening the entire app.
- The Characters view overflowed around 1280 px because the three-column layout and character header had fixed minimum widths. Character columns, the header, and notes now use shrinkable tracks.
- Compendium cards could become too small at common desktop widths. Rule cards now target a larger useful width and keep more rendered content visible.
- Equipment cards now use the same responsive card sizing strategy as rules cards.
- Battlemap tools could be inaccessible when the window layout restored with the left panel hidden. A floating quick tool dock now keeps Select, Hand, Measure, Wall, Ping, Note, Door, and Eraser available on the map.

## Browser Smoke Results

- Battlemap toolbar actions: grid, fill, fit, and focus buttons responded.
- Battlemap tool dock: Hand, Wall, Eraser, and Select changed active tool and canvas cursor correctly.
- Compendium combat search: returned 30 card results.
- Compendium equipment mode: rendered 48 equipment cards and showed filters.
- Characters: loaded character picker, template paper doll, and header without page overflow.
- Toolkit: NPC, loot, and shopkeeper generators rendered content.
- Sound & Ambiance: playlist, ambient presets, and Realm of Darkness sound links rendered.
- Quests: quest tree and quest file windows rendered without page overflow.

## Responsive Result

After fixes, all tested view/resolution combinations reported `documentElement.scrollWidth == documentElement.clientWidth`; no global horizontal page overflow remained.

Compendium combat card widths after fixes:

- 1024 px viewport: about 595 px
- 1280 px viewport: about 349 px
- 1366 px viewport: about 392 px
- 1440 px viewport: about 429 px
- 1920 px viewport: about 328 px

## Remaining Watch Items

- This pass focused on modern desktop resolutions, not tablet or phone layouts.
- Deep visual QA with imported custom maps and long user-generated quest documents should be repeated once representative campaign data is loaded.
