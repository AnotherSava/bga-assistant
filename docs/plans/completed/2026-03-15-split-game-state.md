# Split game_state.ts into three modules

## Overview

Split `src/games/innovation/game_state.ts` (803 lines) into three focused modules: data layer, engine logic, and serialization. The file contains three independent concerns with different consumers — splitting makes the separation physically visible and improves navigability.

## Context

- Files involved:
  - Split: `src/games/innovation/game_state.ts` — into 3 modules below
  - Create: `src/games/innovation/game_engine.ts` — GameEngine class + helpers
  - Create: `src/games/innovation/serialization.ts` — toJSON/fromJSON + serialized types
  - Modify: `src/background.ts` — update imports
  - Modify: `src/sidepanel/sidepanel.ts` — update imports
  - Modify: `src/games/innovation/render.ts` — update imports
  - Modify: `src/games/innovation/__tests__/game_state.test.ts` — update imports
  - Modify: `src/games/innovation/__tests__/render.test.ts` — update imports
  - Modify: `CLAUDE.md` — update project structure
- Related patterns: recent `game_state.ts` restructuring (commit 75b7b93) separated GameState data from engine logic conceptually; this makes it physical
- Note: `src/__tests__/background.test.ts` and `src/__tests__/sidepanel.test.ts` do NOT import from game_state directly

## Development Approach

- Testing approach: No new tests needed — this is a pure refactor with no behavior change
- Complete each task fully before moving to the next
- All tests must pass before starting next task

## Design Notes

**Module boundaries (line ranges from current file):**

| Module | Lines | Contents |
|--------|-------|----------|
| `game_state.ts` | 51-104 | `GameState` interface, `createGameState()`, `cardsAt()` |
| `game_engine.ts` | 22, 110-665, 779-802 | `REGULAR_ICONS`, `GameEngine` class, `extractSuspects()`, `combinations()` |
| `serialization.ts` | 24-48, 671-773 | `SerializedCard`, `SerializedOpponentKnowledge`, `SerializedGameState`, `toJSON()`, `fromJSON()` |

**Dependency direction (no cycles):**
- `game_engine.ts` → imports `GameState`, `createGameState`, `cardsAt` from `game_state.ts`
- `serialization.ts` → imports `GameState`, `createGameState` from `game_state.ts`
- `game_engine.ts` does NOT depend on `serialization.ts` and vice versa

**Import mapping for consumers:**

| File | Current imports | New source |
|------|----------------|------------|
| `background.ts` | `GameEngine, createGameState, toJSON as innovationToJSON, SerializedGameState` | `createGameState` from `game_state`, `GameEngine` from `game_engine`, `toJSON, SerializedGameState` from `serialization` |
| `sidepanel.ts` | `GameEngine, fromJSON as innovationFromJSON` | `GameEngine` from `game_engine`, `fromJSON` from `serialization` |
| `render.ts` | `GameState, GameEngine` | `GameState` from `game_state`, `GameEngine` from `game_engine` |
| `game_state.test.ts` | `GameState, GameEngine, createGameState as newGameState, cardsAt, toJSON, fromJSON` | `GameState, createGameState, cardsAt` from `game_state`, `GameEngine` from `game_engine`, `toJSON, fromJSON` from `serialization` |
| `render.test.ts` | `GameState, GameEngine, createGameState` | `GameState, createGameState` from `game_state`, `GameEngine` from `game_engine` |

## Implementation Steps

### Task 1: Create game_engine.ts

**Files:**
- Create: `src/games/innovation/game_engine.ts`

- [x] Create file with imports from `./types.js` (all type/class imports GameEngine needs) and `./game_state.js` (`GameState`, `createGameState`, `cardsAt`)
- [x] Move `REGULAR_ICONS` constant (line 22)
- [x] Move `GameEngine` class (lines 110-665)
- [x] Move `extractSuspects()` helper (lines 780-789)
- [x] Move `combinations()` generator (lines 792-802)
- [x] Export `GameEngine` class

### Task 2: Create serialization.ts

**Files:**
- Create: `src/games/innovation/serialization.ts`

- [x] Create file with imports from `./types.js` (types needed by serialization) and `./game_state.js` (`GameState`, `createGameState`)
- [x] Move `SerializedCard` interface (lines 28-34)
- [x] Move `SerializedOpponentKnowledge` type (lines 36-38)
- [x] Move `SerializedGameState` interface (lines 40-48)
- [x] Move `toJSON()` function (lines 672-723)
- [x] Move `fromJSON()` function (lines 726-773)
- [x] Export `SerializedGameState`, `toJSON`, `fromJSON`

### Task 3: Trim game_state.ts

**Files:**
- Modify: `src/games/innovation/game_state.ts`

- [x] Remove everything except: imports needed by remaining code, `GameState` interface, `createGameState()`, `cardsAt()`
- [x] Clean up imports — only keep types used by these three items
- [x] Verify exports: `GameState`, `createGameState`, `cardsAt`
- [x] Run `npm run lint` — must pass

### Task 4: Update consumer imports

**Files:**
- Modify: `src/background.ts`
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `src/games/innovation/render.ts`
- Modify: `src/games/innovation/__tests__/game_state.test.ts`
- Modify: `src/games/innovation/__tests__/render.test.ts`

- [x] Update each file per the import mapping table in Design Notes
- [x] Run `npm run lint` — must pass
- [x] Run `npm test` — all tests must pass
- [x] Run `npm run build` — must succeed

### Task 5: Update documentation

- [x] Update CLAUDE.md project structure: replace single `game_state.ts` entry with three module entries
- [x] Move this plan to `docs/plans/completed/`
