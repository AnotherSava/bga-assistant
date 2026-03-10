# Add Azul Game Support

## Overview

Add Azul as a second supported game. Track tile bag and discard pile (box lid) contents across rounds, display remaining tile counts per color in a compact table. Support any player count (2-4). Azul tables trigger side-panel auto-hide and icon flashing. Reorganize codebase so Innovation and Azul modules have symmetric structure.

## Context

- Files involved:
  - Move: `src/engine/process_log.ts` → `src/innovation/process_log.ts`
  - Move: `src/engine/game_state.ts` → `src/innovation/game_state.ts`
  - Move: `src/render/summary.ts` → `src/innovation/render.ts`
  - Move: `src/render/config.ts` → `src/innovation/config.ts`
  - Modify: `src/background.ts` — multi-game routing in pipeline and probeGameTable
  - Modify: `src/sidepanel/sidepanel.ts` — game-type dispatch for rendering
  - Modify: `src/models/types.ts` — game type enum, shared types
  - Create: `src/azul/process_log.ts` — parse Azul BGA notifications
  - Create: `src/azul/game_state.ts` — bag/discard/wall tracking
  - Create: `src/azul/render.ts` — tile count table renderer
  - Create: `assets/bga/azul/` — tile sprites
- Related patterns: Innovation pipeline (process_log → game_state → render)
- Dependencies: none
- Sample data: `data/bgaa_816402832/` (in-progress 3p game, 4 rounds, observer perspective), `data/bgaa_816405832/` (in-progress 3p game)

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**BGA Azul notification schema:**

| Type | When | Key fields |
|------|------|-----------|
| `factoriesFilled` | Round start | `factories[][]` with tile objects `{id, type, location, line, column}` |
| `tilesSelected` | Player picks tiles | `type`, `selectedTiles[]`, `discardedTiles[]` (to center), `fromFactory` |
| `tilesPlacedOnLine` | Player places on pattern line | `placedTiles[]`, `discardedTiles[]` (to floor), `line` |
| `placeTileOnWall` | End-of-round wall tiling | `completeLines{pid: {placedTile, discardedTiles[], pointsDetail}}` |
| `emptyFloorLine` | End-of-round floor clearing | `floorLines{pid: {tiles[], points}}` or `[]` if empty |
| `firstPlayerToken` | During selection phase | `playerId` |

**Tile types:** `0` = first player marker, `1` = Black, `2` = Cyan, `3` = Blue, `4` = Yellow, `5` = Red.

**All Azul information is public** — no player/spectator distinction needed. Observer and player perspectives see the same data.

**`TileCounts` data structure:** A `number[6]` array indexed by tile type (0-5). Index 0 holds the first player marker count (included for completeness and potential future use). Used everywhere tile counts appear: bag, box (discard), wall, and potentially factories, center in future. Simple, lightweight, and avoids object key overhead.

**Bag tracking algorithm:**
1. Initialize bag to 20 of each color (types 1-5), discard and wall to 0
2. On `factoriesFilled`: count tiles drawn per type (excluding type 0). If total drawn > bag total, a refill occurred — add all discard counts to bag, reset discard to 0. Then subtract drawn from bag.
3. On `placeTileOnWall`: for each player's `completeLines`, add 1 to wall for placed tile type, add each discarded tile type to discard.
4. On `emptyFloorLine`: for each player's floor tiles (excluding type 0), add to discard.
5. `tilesSelected` and `tilesPlacedOnLine` don't affect bag/discard/wall — tiles move between "in play" zones (factories, center, hands, pattern lines, floor).

**Refill detection:** When `factoriesFilled` draws more tiles than the bag contains, the discard pile was emptied into the bag mid-draw. Track this as a discrete event so the UI can annotate it.

**Display — compact table:**
- 5 columns, one per tile color, headed by BGA tile icons
- 2 rows: "Bag" and "Box" with counts per color
- Uses BGA tile sprites from `assets/bga/azul/`

**Module reorganization:** Move Innovation-specific engine/render files into `src/innovation/`, creating symmetric structure:
```
src/innovation/process_log.ts, game_state.ts, render.ts, config.ts
src/azul/process_log.ts, game_state.ts, render.ts
```
Shared code stays in `src/models/` and `src/sidepanel/`. Update all imports.

**Multi-game pipeline:** `PipelineResults` gains a `gameName` field. `runPipeline()` checks game name and dispatches to the appropriate processor. Side panel uses `gameName` to choose renderer.

**probeGameTable:** Accept game name from URL. Innovation keeps 2-player restriction. Azul accepts 2-4 players. Default for unknown games: just check `gameui` exists.

**Tile assets:** Extract 5 tile color images from BGA's Azul sprite sheet. Store in `assets/bga/azul/tiles/`. Add to `manifest.json` web-accessible resources.

## Implementation Steps

### Task 1: Reorganize Innovation modules into `src/innovation/`

**Files:**
- Move: `src/engine/process_log.ts` → `src/innovation/process_log.ts`
- Move: `src/engine/game_state.ts` → `src/innovation/game_state.ts`
- Move: `src/render/summary.ts` → `src/innovation/render.ts`
- Move: `src/render/config.ts` → `src/innovation/config.ts`
- Modify: all files that import from the old paths
- Modify: all test files that import from the old paths

- [x] Move the four files to `src/innovation/`
- [x] Update all import paths in source files (`background.ts`, `sidepanel.ts`, etc.)
- [x] Update all import paths in test files
- [x] Remove empty `src/engine/` and `src/render/` directories (keep `src/render/help.ts` in place if it's game-agnostic)
- [x] Verify `npm run build` succeeds
- [x] Run project test suite — must pass before next task

### Task 2: Add game type routing to pipeline and side panel

**Files:**
- Modify: `src/models/types.ts` — add game name type
- Modify: `src/background.ts` — multi-game dispatch in `runPipeline()`, `probeGameTable()`, `classifyNavigation()`
- Modify: `src/sidepanel/sidepanel.ts` — game-type-aware rendering dispatch
- Modify: `src/__tests__/background.test.ts`

- [x] Add `GameName` type (`"innovation" | "azul"`) to `src/models/types.ts`
- [x] Add `gameName` field to `PipelineResults` and `NavigationAction` extract variant
- [x] Update `classifyNavigation()` to include `gameName` in the extract action
- [x] Update `probeGameTable()` to accept game name: 2 players for innovation, 2-4 for azul
- [x] Update `runPipeline()` to dispatch based on game name (azul path can be a stub/TODO for now)
- [x] Update side panel `render()` to check `gameName` and dispatch to appropriate renderer
- [x] Update tests for `classifyNavigation`, `shouldAutoClose`, `probeGameTable`
- [x] Run project test suite — must pass before next task

### Task 3: Extract Azul tile assets

**Files:**
- Create: `assets/bga/azul/tiles/` — 5 tile color images
- Modify: `manifest.json` — add azul assets to web-accessible resources

- [x] Download Azul tile sprite from BGA assets CDN
- [x] Extract individual tile color images (types 1-5: Black, Cyan, Blue, Yellow, Red)
- [x] Save as PNGs in `assets/bga/azul/tiles/`
- [x] Add `assets/bga/azul/*` to manifest web-accessible resources
- [x] No automated tests (asset extraction is one-time)

### Task 4: Implement Azul log processing

**Files:**
- Create: `src/azul/process_log.ts`
- Create: `src/__tests__/azul_process_log.test.ts`

- [x] Define Azul-specific log entry types: `FactoryFillEntry`, `WallPlacementEntry`, `FloorClearEntry`
- [x] Implement `processAzulLog(rawData)` — iterate packets, extract relevant notifications
- [x] Parse `factoriesFilled`: extract tile counts per type (excluding type 0)
- [x] Parse `placeTileOnWall`: extract placed tile and discarded tiles per player
- [x] Parse `emptyFloorLine`: extract floor tiles per player (excluding type 0)
- [x] Return structured `AzulGameLog` with round-by-round entries
- [x] Write tests using fixture data from sample tables
- [x] Run project test suite — must pass before next task

### Task 5: Implement Azul game state (bag/discard/wall tracking)

**Files:**
- Create: `src/azul/game_state.ts`
- Create: `src/__tests__/azul_game_state.test.ts`

- [x] Define `TileCounts` type — `number[6]` array (index = tile type 0-5), shared across all zones
- [x] Define `AzulGameState` with `bag: TileCounts`, `discard: TileCounts`, `wall: TileCounts`
- [x] Implement `initGame()` — bag starts at `[0, 20, 20, 20, 20, 20]`, discard/wall at all zeros
- [x] Implement `processLog(log)` — replay entries:
  - `factoriesFilled`: detect refill (drawn > bag total), apply refill, subtract drawn
  - `placeTileOnWall`: +1 wall for placed, +N discard for discarded
  - `emptyFloorLine`: +N discard for floor tiles
- [x] Track refill events (round number) for display annotation
- [x] Implement `toJSON()` and `fromJSON()` for serialization (side panel roundtrip)
- [x] Write tests: initial state, single round, multi-round with refill, edge cases
- [x] Verify against sample data: round-by-round bag/discard/wall counts match manual analysis
- [x] Run project test suite — must pass before next task

### Task 6: Implement Azul renderer

**Files:**
- Create: `src/azul/render.ts`
- Modify: `src/sidepanel/sidepanel.css` — Azul table styles
- Create: `src/__tests__/azul_render.test.ts`

- [x] Implement `renderAzulSummary(state, assetResolver)` — returns HTML string
- [x] Render compact table: 5 color columns (tile icons as headers), 2 rows (Bag, Box)
- [x] Each cell shows the count for that color in that zone
- [x] Style tile icons from `assets/bga/azul/tiles/`
- [x] Add CSS for the Azul table layout
- [x] If a refill occurred, annotate it (e.g., a note below the table: "Bag refilled from box before round N")
- [x] Write tests for HTML output structure
- [x] Run project test suite — must pass before next task

### Task 7: Wire Azul pipeline end-to-end

**Files:**
- Modify: `src/background.ts` — complete the Azul branch in `runPipeline()`
- Modify: `src/sidepanel/sidepanel.ts` — wire Azul renderer
- Modify: `src/__tests__/background.test.ts`

- [x] Implement Azul branch in `runPipeline()`: call `processAzulLog()` → `AzulGameState` → serialize
- [x] Wire side panel to call `renderAzulSummary()` when `gameName === "azul"`
- [x] Add `"azul"` to `SUPPORTED_GAMES` array
- [x] Update `probeGameTable()` to handle azul (2-4 players)
- [x] Write end-to-end pipeline test with Azul fixture data
- [x] Run project test suite — must pass before next task

### Task 8: Verify acceptance criteria

- [x] Manual test: open an Azul table, side panel shows bag/box tile counts
- [x] Manual test: counts update correctly with live tracking as moves are made
- [x] Manual test: bag refill from box is detected and annotated
- [x] Manual test: works with 2, 3, and 4 player games
- [x] Manual test: auto-hide and icon flashing work for Azul tables
- [x] Manual test: Innovation tables still work correctly after reorganization
- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`

### Task 9: Update documentation

- [x] Update README.md with Azul support
- [x] Update CLAUDE.md with new project structure (`src/innovation/`, `src/azul/`)
- [x] Move this plan to `docs/plans/completed/`
