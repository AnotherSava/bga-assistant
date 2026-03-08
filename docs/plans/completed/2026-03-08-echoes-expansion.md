# Add Echoes of the Past Expansion Support

## Overview

Add support for the "Echoes of the Past" expansion, introducing the echoes card set with echo effect mechanics. Includes asset extraction, set number realignment with BGA protocol, updated initial deal logic (1 base + 1 echoes when expansion is active), and echo effect icon rendering.

## Context

- Files involved:
  - Modify: `assets/bga/innovation/card_info.json` — renumber sets to match BGA type IDs
  - Modify: `src/models/types.ts` — add `ECHOES` to `CardSet`, update utilities
  - Modify: `src/engine/process_log.ts` — add echoes to `SET_MAP`, remove from unsupported
  - Modify: `src/engine/game_state.ts` — echoes-aware initial deal, expansion detection
  - Modify: `src/render/summary.ts` — echo effect icon, echoes unknown card color
  - Modify: `src/render/config.ts` — add echoes as 3rd toggle variant
  - Modify: `src/sidepanel/sidepanel.ts` — handle 3-way set toggle
  - Modify: `src/sidepanel/sidepanel.css` — echoes facedown color, lighter cities color, echo icon style
  - Create: asset extraction script (revived from git history) for echoes card images and hex icons
  - Create: echo effect placeholder icon SVG
- Related patterns: existing base/cities card rendering, hex icon extraction, `SET_MAP` translation
- Dependencies: Pillow (Python, for asset extraction only — not a runtime dependency)

## Development Approach

- Testing approach: regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Set number realignment**: BGA protocol uses type IDs `"0"` (base), `"2"` (cities), `"3"` (echoes). The internal `CardSet` enum and `card_info.json` currently disagree with BGA. Renumber both to match BGA: BASE=0, CITIES=2, ECHOES=3. Figures (future expansion) moved to set 1 (probable BGA type ID).

**Expansion detection**: Scan `myHand` card names against the card database before `initGame()`. If any starting card belongs to the echoes set, the game uses the echoes expansion. For spectator mode without hand data, detect from the presence of echoes transfers in the game log.

**Echo effect icons**: Echoes cards use base card layout but some icon positions contain `"echo"` — a text-based ability. Render a small echo-wave placeholder SVG in the icon cell. The full echo text is visible in the card face image tooltip (same as base cards).

**`hexnote` icon**: 4 purple echoes cards (Bell, Flute, Piano, Saxophone) have a `"hexnote"` icon — a unique hex icon (musical note) used for a special win condition. Extract from the echoes hex sprite sheet and render like regular hex icons.

**Facedown colors**: Echoes unknown cards use a light blue tint (check BGA for exact hex). Cities unknown cards should also be made lighter (check BGA for exact hex).

## Implementation Steps

### Task 1: Renumber card_info.json and update type system

**Files:**
- Modify: `assets/bga/innovation/card_info.json`
- Modify: `src/models/types.ts`
- Modify: `src/engine/process_log.ts`
- Modify: `src/__tests__/process_log.test.ts`

- [x] Update `card_info.json` set numbers: cities 3→2, echoes 1→3, figures 2→1
- [x] Update `CardSet` enum: `BASE=0, CITIES=2, ECHOES=3`
- [x] Update `cardSetLabel()` and `cardSetFromLabel()` to handle all three sets
- [x] Update `CardDatabase` constructor filter to accept `CardSet.ECHOES` (set 3)
- [x] Update `SET_MAP`: add `"3": "echoes"`, change `"2": "cities"` (already correct)
- [x] Remove `"3"` from `UNSUPPORTED_EXPANSION_NAMES`
- [x] Update all tests referencing `CardSet.CITIES` value (was 3, now 2)
- [x] Run project test suite — must pass before task 2

### Task 2: Download echoes assets

**Files:**
- Create: asset extraction script (recover from git history, extend for echoes)
- Create: `assets/bga/innovation/cards/` — echoes card face images
- Create: `assets/bga/innovation/icons/` — echoes hex icons and hexnote icons

- [x] Recover `download_assets.py` from git history (`git show 7f017cf^:src/bga_tracker/innovation/download_assets.py`)
- [x] Adapt script to download echoes hex sprite sheet (`hexagon_icons_echoes.png`) from BGA GitHub
- [x] Extract echoes hex icons (105 cards) and hexnote icons (4 cards) from sprite sheet
- [x] Download echoes card face images from `misc/cards/Print_EchoesCards_front/` (map 112 files to 105 cards)
- [x] Create echo effect placeholder SVG icon (echo-wave/ripple design)
- [x] Verify all assets are present and correctly named
- [x] No automated tests for this task (asset extraction is a one-time operation)

### Task 3: Expansion detection and initial deal

**Files:**
- Modify: `src/engine/process_log.ts`
- Modify: `src/engine/game_state.ts`
- Modify: `src/__tests__/game_state.test.ts`

- [x] Add `expansions` field to `GameLog` type (e.g., `{ echoes: boolean }`)
- [x] In `processRawLog`, detect echoes: scan `myHand` card names against card database for echoes cards, and/or check if any transfer has cardSet `"echoes"`
- [x] Update `GameState.initGame()` to accept expansion info
- [x] When echoes is active: create echoes decks, deal 1 base age-1 + 1 echoes age-1 per player (instead of 2 base)
- [x] Update `resolveHand()` if needed to handle mixed-set starting hands
- [x] Write tests for echoes-mode initial deal (deck setup, hand composition)
- [x] Write tests for expansion detection from hand cards and from transfers
- [x] Run project test suite — must pass before task 4

### Task 4: Render echoes cards

**Files:**
- Modify: `src/render/summary.ts`
- Modify: `src/sidepanel/sidepanel.css`
- Modify: `src/__tests__/sidepanel_ui.test.ts`

- [x] Add `b-gray-echoes` CSS class for unknown echoes cards (light blue tint — check BGA for exact color)
- [x] Update `b-gray-cities` to be lighter (check BGA for exact color)
- [x] Add echo effect icon rendering: when icon is `"echo"`, render placeholder SVG in icon cell
- [x] Add `hexnote` icon rendering: treat like `hex` but use the hexnote icon image
- [x] Update `renderUnknownCard()` to handle `CardSet.ECHOES`
- [x] Echoes known cards: same 5-color scheme as base, base card layout, full card image tooltip on hover
- [x] Write/update tests for echoes card rendering
- [x] Run project test suite — must pass before task 5

### Task 5: Add echoes to section toggles

**Files:**
- Modify: `src/render/config.ts`
- Modify: `src/render/summary.ts`
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `src/sidepanel/sidepanel.css`

- [x] Add `"echoes"` as 3rd variant in deck and cards section toggles (base / echoes / cities)
- [x] Update toggle rendering to support 3 options
- [x] Update `applyToggleMode()` to handle `"echoes"` mode
- [x] Ensure toggle state persistence works with the new option
- [x] Write/update tests for 3-way toggle behavior
- [x] Run project test suite — must pass before task 6

### Task 6: Verify acceptance criteria

- [x] Manual test: extract data from a BGA Innovation game with Echoes expansion, verify summary in side panel
- [x] Manual test: verify echoes cards render with correct layout, colors, and echo icons
- [x] Manual test: verify card image tooltips work for echoes cards
- [x] Manual test: verify deck/cards section toggles work with base/echoes/cities
- [x] Manual test: verify initial deal shows 1 base + 1 echoes in hand
- [x] Manual test: verify games WITHOUT echoes still work correctly (2 base initial deal)
- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`
- [x] Verify test coverage meets 80%+

### Task 7: Update documentation

- [x] Update README.md with echoes expansion support
- [x] Update CLAUDE.md if internal patterns changed
- [x] Move this plan to `docs/plans/completed/`
