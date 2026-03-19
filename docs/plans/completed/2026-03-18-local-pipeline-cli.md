# Local pipeline CLI runner

## Overview

Two CLI scripts that run the extension's pipeline stages locally for debugging. Accepts input files, runs the corresponding pipeline functions, and writes output to the same directory.

## Context

The extension pipeline has 2 debuggable stages per game:
1. **game-log**: `raw_data.json` → structured game log (`game_log.json`)
2. **game-state**: `game_log.json` → engine processing → serialized state (`game_state.json`)

The ZIP download saves all intermediate artifacts. Both `raw_data.json` and `game_log.json` include the game name (added by this plan), so scripts auto-detect the game.

## Prerequisites: add game name to data formats

### `src/extract.ts`
Add `gameName` to extraction output — derive from the BGA page URL (already available via `location.pathname`).

### `RawExtractionData` (`src/models/types.ts`)
Add `gameName: string` field (required — always populated by extract.ts from the page URL).

### Serialized game state formats
Add `gameName` field to `SerializedGameState` (Innovation), `SerializedAzulGameState`, and `SerializedCrewGameState`.

### Game log formats
Add `gameName` field to `GameLog` (Innovation), `AzulGameLog`, and `CrewGameLog`.

### `src/background.ts`
Populate `gameName` in pipeline results from the classified URL. Pass through to serialized outputs.

## Scripts

### `scripts/game-log.ts`

Produces `game_log.json` from `raw_data.json`.

```
npx tsx scripts/game-log.ts <raw_data.json>
```

- Reads `raw_data.json`, detects game from `gameName` field
- Calls the game-specific `processLog` function
- Writes `game_log.json` to the same directory

### `scripts/game-state.ts`

Produces `game_state.json` from `game_log.json`.

```
npx tsx scripts/game-state.ts <game_log.json> [--debug]
```

- Reads `game_log.json`, detects game from `gameName` field
- Runs engine processing + serialization
- Writes `game_state.json` to the same directory
- **`--debug` flag**: creates a `game_states/` subfolder in the input directory and writes `0001.json`, `0002.json`, etc. — one snapshot after each turn (Innovation: after each action marker, Crew: after each trick, Azul: after each round)

### npm scripts

```json
"game-log": "tsx scripts/game-log.ts",
"game-state": "tsx scripts/game-state.ts"
```

Usage:
```
npm run game-log -- data/bgaa_823235522_23/raw_data.json
npm run game-state -- data/bgaa_823235522_23/game_log.json
npm run game-state -- data/bgaa_823235522_23/game_log.json --debug
```

## Implementation

### Extracting pipeline logic

`runPipeline()` lives in `src/background.ts` which imports Chrome APIs. Extract the pure pipeline logic into a shared module that both background.ts and the CLI scripts can import:

- Create `src/pipeline.ts` — exports `processGameLog(rawData, gameName)` and `processGameState(gameLog, gameName, cardDb)` which dispatch to game-specific functions (reusing the existing switch logic from `runPipeline`)
- `src/background.ts` imports from `src/pipeline.ts` instead of inlining the dispatch
- CLI scripts import from `src/pipeline.ts` directly

### Debug snapshots

For `--debug`, the game-state script needs to serialize state after each logical turn. This requires exposing incremental processing:

- Innovation: `processEntry()` is private. Add a public method or callback hook that serializes state after each `gameStateChange` marker (action boundary)
- Azul: state is built from log entries — snapshot after each round-ending entry
- Crew: snapshot after each `trickWon` entry

The simplest approach: the debug script processes entries one at a time (like the engine's `processLog` does internally), calling `toJSON()` at turn boundaries.

## Files to create/modify

- **Create**: `scripts/game-log.ts` — game-log CLI
- **Create**: `scripts/game-state.ts` — game-state CLI with `--debug`
- **Create**: `src/pipeline.ts` — extracted pure pipeline functions
- **Modify**: `src/extract.ts` — add `gameName` to extraction output
- **Modify**: `src/models/types.ts` — add `gameName` to `RawExtractionData`
- **Modify**: `src/background.ts` — import pipeline from `src/pipeline.ts`, populate `gameName`
- **Modify**: `src/games/innovation/process_log.ts` — add `gameName` to `GameLog`
- **Modify**: `src/games/innovation/serialization.ts` — add `gameName` to serialized state
- **Modify**: `src/games/azul/process_log.ts` — add `gameName` to `AzulGameLog`
- **Modify**: `src/games/azul/game_state.ts` — add `gameName` to serialized state
- **Modify**: `src/games/crew/process_log.ts` — add `gameName` to `CrewGameLog`
- **Modify**: `src/games/crew/serialization.ts` — add `gameName` to serialized state
- **Modify**: `package.json` — add npm scripts, add `tsx` dev dependency
- **Modify**: `CLAUDE.md` — add CLI scripts to Commands section

## Verification

1. `npm test` — all tests pass (refactor doesn't change behavior)
2. `npm run build` — builds successfully
3. `npm run game-log -- data/bgaa_823235522_23/raw_data.json` — produces `game_log.json`
4. `npm run game-state -- data/bgaa_823235522_23/game_log.json` — produces `game_state.json`
5. `npm run game-state -- data/bgaa_823235522_23/game_log.json --debug` — produces numbered snapshots
6. Compare CLI output with ZIP download output — should be identical (minus gameName field addition)

## Tasks

### Task 1: Add gameName to data formats

- [x] Add `gameName: string` field to `RawExtractionData` in `src/models/types.ts`
- [x] Add `gameName` to extraction output in `src/extract.ts` (derive from URL pathname)
- [x] Add `gameName` field to `GameLog` in `src/games/innovation/process_log.ts` and populate it in `processRawLog`
- [x] Add `gameName` field to `SerializedGameState` in `src/games/innovation/serialization.ts` and populate in `toJSON`
- [x] Add `gameName` field to `AzulGameLog` in `src/games/azul/process_log.ts` and populate in `processAzulLog`
- [x] Add `gameName` field to `SerializedAzulGameState` in `src/games/azul/game_state.ts` and populate in `toJSON`
- [x] Add `gameName` field to `CrewGameLog` in `src/games/crew/process_log.ts` and populate in `processCrewLog`
- [x] Add `gameName` field to `SerializedCrewGameState` in `src/games/crew/serialization.ts` and populate in `crewToJSON`
- [x] Populate `gameName` in `runPipeline` results in `src/background.ts` — pass through to serialized outputs
- [x] All tests pass (`npm test`) and build succeeds (`npm run build`)

### Task 2: Extract pipeline logic into shared module

- [x] Create `src/pipeline.ts` with `processGameLog(rawData, gameName)` and `processGameState(gameLog, gameName, cardDb)` functions
- [x] Refactor `src/background.ts` to import and use pipeline functions from `src/pipeline.ts`
- [x] All tests pass (`npm test`) and build succeeds (`npm run build`)

### Task 3: Create CLI scripts and npm configuration

- [x] Add `tsx` as a dev dependency
- [x] Create `scripts/game-log.ts` — reads raw_data.json, detects game, calls processGameLog, writes game_log.json
- [x] Create `scripts/game-state.ts` — reads game_log.json, detects game, runs engine + serialization, writes game_state.json, supports `--debug` flag
- [x] Add `game-log` and `game-state` npm scripts to `package.json`
- [x] All tests pass (`npm test`) and build succeeds (`npm run build`)

### Task 4: Documentation

- [x] Add CLI scripts to Commands section in `CLAUDE.md`
- [x] Update `README.md` with CLI usage information
- [x] Update `docs/data-flow.md` if pipeline extraction changes affect data flow
