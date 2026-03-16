# Restructure GameState and type PipelineResults

## Overview

Separate Innovation's `GameState` into a plain data interface and a `GameEngine` class that holds the logic, and type `PipelineResults` as a discriminated union. This makes the conceptual model clearer: GameState is the data being passed around and serialized, GameEngine is the tool that builds and queries it.

## Context

- Files involved:
  - Modify: `src/games/innovation/types.ts` — strip Card to data + getters only, remove `groupKey`, `resolve`, `markPublic`, `removeCandidates`
  - Modify: `src/games/innovation/game_state.ts` — extract `GameState` interface (zone data only), rename class to `GameEngine`, add `findGroup`/`buildGroups` helpers, move Card mutation inline, extract `toJSON`/`fromJSON` as standalone functions with full-candidate format
  - Modify: `src/games/innovation/render.ts` — accept `GameEngine` for opponent-knowledge queries
  - Modify: `src/background.ts` — type `PipelineResults` as discriminated union, update `runPipeline`
  - Modify: `src/sidepanel/sidepanel.ts` — consume typed `PipelineResults`, update deserialization
  - Modify: `src/games/innovation/__tests__/game_state.test.ts` — update for `GameEngine`, move `removeCandidates` to test helper
  - Modify: `src/__tests__/background.test.ts` — update for typed `PipelineResults`
  - Modify: `src/__tests__/sidepanel_ui.test.ts` — update for typed `PipelineResults`
- Related patterns: current `GameState` class, `PipelineResults` interface, Azul pipeline
- Dependencies: None

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Card class simplification**: `Card` keeps only data fields and computed getters. Remove `groupKey` (callers compute `ageSetKey(card.age, card.cardSet)` where needed). Remove mutation methods `resolve()`, `markPublic()`, `removeCandidates()` — the engine inlines the 1-3 line mutations directly. `removeCandidates` moves to a test helper since it's only used in tests. Computed getters `isResolved` and `resolvedName` stay (derived from `candidates`, no stored state).

```typescript
export class Card {
  age: number;
  cardSet: CardSet;
  candidates: Set<string>;
  opponentKnowledge: OpponentKnowledge;

  constructor(age: number, cardSet: CardSet, candidates?: Iterable<string>) { ... }

  get isResolved(): boolean { return this.candidates.size === 1; }
  get resolvedName(): string | null { return this.isResolved ? this.candidates.values().next().value! : null; }
}
```

**GameState as a plain interface**: Holds only the zone data, players, and perspective. This is the serialization boundary — what gets passed between background and sidepanel.

```typescript
export interface GameState {
  decks: Map<AgeSetKey, Card[]>;
  hands: Map<string, Card[]>;
  boards: Map<string, Card[]>;
  scores: Map<string, Card[]>;
  revealed: Map<string, Card[]>;
  forecast: Map<string, Card[]>;
  achievements: Card[];
  players: string[];
  perspective: string;
}
```

**GameEngine class**: Holds `CardDatabase` and manages `_groups` (master card list for constraint propagation) internally. Owns all mutation logic: `initGame`, `processLog`, `move`, `propagate`. Meld-filter tracking (`meldIcon`, `discardNames`, `remainingReturns`) becomes local state within `processLog` rather than instance fields — it's transient processing state, not engine configuration.

```typescript
export class GameEngine {
  private cardDb: CardDatabase;
  private _groups: Map<AgeSetKey, Card[]>;

  constructor(cardDb: CardDatabase) { ... }

  initGame(state: GameState, expansions?: { echoes: boolean }): void { ... }
  processLog(state: GameState, log: GameLogEntry[], myHand: string[]): void { ... }
  move(state: GameState, action: Action): Card { ... }
  findGroup(age: number, cardSet: CardSet): Card[] { ... }
  buildGroups(state: GameState): void { ... }

  // Queries (used by render)
  opponentHasPartialInformation(card: Card): boolean { ... }
  opponentKnowsNothing(card: Card): boolean { ... }
}
```

**Meld-filter state stays on the engine**: `meldIcon`, `discardNames`, `remainingReturns` move from the old GameState class to `GameEngine` as private fields. They're transient processing state (only meaningful during `processLog`), but the engine is already stateful (`_groups`), so this is simpler than threading a context parameter through `move`.

**Serialization as standalone functions**: `toJSON` and `fromJSON` become module-level functions independent of the engine. `toJSON` serializes candidate names directly (not as exclusion lists). `fromJSON` reconstructs `GameState` from the JSON without needing `CardDatabase` — candidate sets are stored in full. After deserializing, callers use `engine.buildGroups(state)` to prepare the engine for queries.

```typescript
export function toJSON(state: GameState): SerializedGameState { ... }
export function fromJSON(data: SerializedGameState): GameState { ... }
```

This changes the serialized format: `SerializedCard` stores `candidates: string[]` instead of `excluded: string[]`. Existing ZIP files with the old format become incompatible — this is acceptable since ZIPs are debugging artifacts, not persistent storage.

**`findGroup` helper**: Replaces `this._groups.get(card.groupKey)` with `this.findGroup(card.age, card.cardSet)`. Encapsulates the `_groups` lookup and `ageSetKey` computation.

**Render receives GameEngine for queries**: `renderSummary` and `renderFullPage` currently take `GameState` and call `opponentKnowsNothing`/`opponentHasPartialInformation` on it. After restructuring, they take both `GameState` (for zone data) and `GameEngine` (for queries). The `prepareMyCards` helper passes `GameEngine` instead of `GameState` for the opponent-knowledge categorization.

**PipelineResults discriminated union**: Replace `gameLog: any | null` and `gameState: any | null` with game-specific types:

```typescript
type PipelineResults =
  | { gameName: "innovation"; tableNumber: string; rawData: RawExtractionData; gameLog: GameLog; gameState: SerializedGameState }
  | { gameName: "azul"; tableNumber: string; rawData: RawExtractionData; gameLog: AzulGameLog; gameState: SerializedAzulGameState }
  | { gameName: string; tableNumber: string; rawData: RawExtractionData; gameLog: null; gameState: null };
```

The third variant covers unsupported games (raw data only). Consumers narrow on `gameName` to get typed access.

**No defensive fallbacks**: Do not design fallback values that mask invalid data (e.g. showing "?" for null ages). Trust input correctness — let invalid values surface as visible `null` or runtime errors rather than silently producing plausible-looking wrong output.

## Implementation Steps

### Task 1: Simplify Card class

**Files:**
- Modify: `src/games/innovation/types.ts`
- Modify: `src/games/innovation/game_state.ts` — inline Card mutations
- Modify: `src/games/innovation/__tests__/game_state.test.ts` — add `removeCandidates` test helper

- [x] Remove `groupKey` getter from Card; update all usages in `game_state.ts` to use `ageSetKey(card.age, card.cardSet)`
- [x] Remove `resolve()` method from Card; inline `card.candidates = new Set([name])` at call sites in `game_state.ts`
- [x] Remove `markPublic()` method from Card; inline `card.opponentKnowledge = { kind: "exact", name: card.resolvedName }` at call sites
- [x] Remove `removeCandidates()` method from Card; create a local helper in the test file for tests that use it
- [x] Update test assertions that reference removed methods
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 2: Extract GameState interface and rename class to GameEngine

**Files:**
- Modify: `src/games/innovation/game_state.ts` — define `GameState` interface, rename class to `GameEngine`, add `findGroup`, move state fields to interface
- Modify: `src/games/innovation/render.ts` — accept `GameEngine` for queries
- Modify: `src/games/innovation/__tests__/game_state.test.ts`
- Modify: `src/games/innovation/__tests__/render.test.ts`

- [x] Define `GameState` interface with zone maps, `players`, `perspective`
- [x] Rename the class from `GameState` to `GameEngine`
- [x] Remove zone maps, `players`, `perspective` from the engine class; engine methods take `GameState` as first parameter
- [x] Add `findGroup(age: number, cardSet: CardSet): Card[]` helper on engine
- [x] Replace all `this._groups.get(card.groupKey)` with `this.findGroup(card.age, card.cardSet)`
- [x] Keep `_groups` and `cardDb` as private engine fields
- [x] Update `render.ts`: `renderSummary`/`renderFullPage` accept `GameEngine` alongside `GameState`; pass engine to `prepareMyCards`
- [x] Update all test files for the new class name and method signatures
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 3: Type PipelineResults as discriminated union

**Files:**
- Modify: `src/background.ts` — replace `PipelineResults` with discriminated union
- Modify: `src/sidepanel/sidepanel.ts` — narrow on `gameName` for typed access
- Modify: `src/__tests__/background.test.ts`
- Modify: `src/__tests__/sidepanel_ui.test.ts`

- [x] Import `GameLog`, `SerializedGameState` from Innovation types and `AzulGameLog`, `SerializedAzulGameState` from Azul types
- [x] Replace `PipelineResults` interface with a discriminated union type on `gameName`
- [x] Update `runPipeline` return type annotations for each branch
- [x] Update `sidepanel.ts` render dispatch: narrow `results.gameName` to access typed `gameLog`/`gameState`
- [x] Update test fixtures to satisfy the typed variants
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 4: Make serialization standalone and store full candidates

**Files:**
- Modify: `src/games/innovation/game_state.ts` — extract `toJSON`/`fromJSON` as module-level functions, change serialized format to store candidates instead of exclusions, add `buildGroups` to engine
- Modify: `src/background.ts` — update `runPipeline` serialization calls
- Modify: `src/sidepanel/sidepanel.ts` — update deserialization: call `fromJSON` then `engine.buildGroups`
- Modify: `src/games/innovation/__tests__/game_state.test.ts`
- Modify: `src/__tests__/background.test.ts`
- Modify: `src/__tests__/sidepanel_ui.test.ts`

- [x] Change `SerializedCard` to store `candidates?: string[]` instead of `excluded?: string[]`
- [x] Extract `toJSON(state: GameState): SerializedGameState` as a module-level function; serialize `card.candidates` directly as an array (omit for resolved cards which already store `resolved`)
- [x] Extract `fromJSON(data: SerializedGameState): GameState` as a module-level function; reconstruct Card with candidates from the stored array, no CardDatabase needed
- [x] Add `buildGroups(state: GameState): void` on `GameEngine` — scans all zone cards and populates `_groups`
- [x] Update `runPipeline` in `background.ts`: call `toJSON(state)` instead of `engine.toJSON(state)`
- [x] Update `sidepanel.ts`: call `fromJSON(data)` to get `GameState`, then `engine.buildGroups(state)` before rendering
- [x] Update serialization round-trip tests to verify full-candidate format
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 5: Verify acceptance criteria

- [x] Manual test: open side panel on an Innovation game, verify rendering works
- [x] Manual test: open side panel on an Azul game, verify rendering works
- [x] Manual test: verify ZIP download produces valid files
- [x] Manual test: verify live tracking updates work
- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`
- [x] Run build: `npm run build`

### Task 6: Update documentation

- [x] Update README.md if user-facing behavior changed
- [x] Update CLAUDE.md if internal patterns changed (GameEngine, GameState interface)
- [x] Move this plan to `docs/plans/completed/`
