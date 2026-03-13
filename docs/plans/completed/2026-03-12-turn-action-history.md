# Turn action history section

## Overview

Add a compact turn history display to the Innovation side panel showing the last few turns' actions (meld, draw, dogma, endorse, achieve) with newest first. This gives players an at-a-glance view of recent game flow without scrolling through the BGA log. Card names in the history have hover tooltips showing card face images.

## Context

- Files involved:
  - Modify: `src/games/innovation/types.ts` — add `TurnMarkerEntry` type, extend `GameLogEntry` union
  - Modify: `src/games/innovation/process_log.ts` — emit `TurnMarkerEntry` from `gameStateChange` packets
  - Create: `src/games/innovation/turn_history.ts` — action classification and history extraction
  - Modify: `src/games/innovation/render.ts` — render turn history HTML
  - Modify: `src/games/innovation/config.ts` — add `"turn-history"` section ID and label
  - Modify: `src/sidepanel/sidepanel.ts` — wire up turn history rendering and visibility toggle
  - Modify: `sidepanel.html` — add `#turn-history` container element
  - Modify: `src/sidepanel/sidepanel.css` — position and style the turn history
  - Create: `src/games/innovation/__tests__/turn_history.test.ts` — unit tests
  - Modify: `src/__tests__/background.test.ts` — update smoke tests if GameLogEntry union changes
- Related patterns: `GameLogEntry` discriminated union, `SECTION_IDS`/`SECTION_LABELS` in config, `renderSummary` in render.ts, section selector in sidepanel.ts
- Dependencies: None

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Data source: `gameStateChange` packets with state `id: 4`**. These fire in player-channel packets when a player is about to choose their action. They contain `action_number` (1 or 2) and `active_player` (player ID). process_log already iterates all packets in Pass 2 — adding a check for `gameStateChange` type with `id: 4` is minimal.

**New log entry type: `TurnMarkerEntry`**. Emitted into the game log when state 4 is detected:
```typescript
interface TurnMarkerEntry {
  type: "turnMarker";
  move: number;
  player: string;       // player name (resolved from ID)
  actionNumber: number; // 1 or 2
}
```
This marks "player X is about to take action N." The actual action type is determined by subsequent entries in the same move.

**Action classification** happens in a new module `turn_history.ts`. It walks the game log and, for each `turnMarker`, looks at the next entries in the same move to classify the action:
- `logWithCardTooltips` with "activates the dogma of" → `dogma`, card name parsed from message
- `logWithCardTooltips` with "endorses the dogma of" → `endorse`, card name parsed
- First `transfer` with `meldKeyword: true`, `source: "hand"`, `dest: "board"` → `meld`, card name from transfer
- First `transfer` with `source: "deck"` (no preceding meld) → `draw`, age + set from transfer
- `transfer` with `source: "achievements"`, `dest: "achievements"` → `achieve`, age from transfer
- If no subsequent action entries in the same move → `pending` (the player hasn't chosen yet)

**Endorse is a player action**. In the Echoes expansion, endorsing a dogma costs one of the endorsing player's 2 actions. It appears as a separate move in the game log with its own `gameStateChange` state 4 and `action_number`.

**Display format**: one action per line, newest first, up to 3 half-turns shown:
```
AnotherSava: dogma Agriculture
potzertommy: dogma Philosophy
potzertommy: meld Coal
AnotherSava: meld Atlantis
AnotherSava: draw [2]
```
Pending (no action chosen yet): `AnotherSava:` (just the name with colon).
Draw display: `draw [2]` for base set, `draw [2] cities` / `draw [2] echoes` for other sets. If card name is known: `draw Construction`.
Achieve display: `achieve [3]`.

**First turn**: the first player gets only 1 action (`qualified_action: "a single action"`, `action_number: 1`). Their half-turn shows just 1 line — no special visual treatment.

**Positioning**: the turn history sits in a `<div id="turn-history">` between `#section-selector` and `#content` in the HTML. It is NOT part of the scrollable card summary — it stays fixed below the top bar. CSS positions it to the right side.

**Visibility toggle**: added to the section selector dropdown as "Turn history". Uses `localStorage` like other sections. Default: visible. When hidden, the `#turn-history` element gets `display: none`.

**Card tooltips**: card names in the turn history are wrapped in tooltip spans reusing the existing `positionTooltip` infrastructure from `render/toggle.ts`. Only cards that exist in the CardDatabase get tooltips (unknown draws don't).

**Separate module rationale**: turn history classification is orthogonal to constraint propagation in `game_state.ts`. It reads the game log independently and produces a flat list of actions. Keeping it in its own module avoids bloating GameState with unrelated concerns.

**Pipeline integration**: `buildTurnHistory()` is called in the side panel's `renderWithDb()` alongside `renderSummary()`, receiving the same `gameLog` and `cardDb`. The turn history HTML is set on the `#turn-history` element separately from the main `#content`.

## Implementation Steps

### Task 1: Add TurnMarkerEntry type and emit from process_log

**Files:**
- Modify: `src/games/innovation/types.ts`
- Modify: `src/games/innovation/process_log.ts`
- Modify: `src/games/innovation/__tests__/process_log.test.ts`

- [x] Add `TurnMarkerEntry` interface to `types.ts`:
  ```typescript
  export interface TurnMarkerEntry {
    type: "turnMarker";
    move: number;
    player: string;
    actionNumber: number;
  }
  ```
- [x] Extend `GameLogEntry` union: `TransferEntry | MessageEntry | TurnMarkerEntry`
- [x] In `processRawLog` Pass 2, add handling for `gameStateChange` notifications: when `notif.type === "gameStateChange"` and `notif.args.id === 4` and `notif.args.args.action_number` exists, emit a `TurnMarkerEntry` with `player` resolved from `notif.args.active_player` via `playerNames`
- [x] Update existing process_log tests: verify `turnMarker` entries appear in processed output for the test fixture
- [x] Add focused test: raw packet with gameStateChange state 4 produces correct TurnMarkerEntry
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 2: Build turn history module

**Files:**
- Create: `src/games/innovation/turn_history.ts`
- Create: `src/games/innovation/__tests__/turn_history.test.ts`

- [x] Define `ActionType` and `TurnAction` types:
  ```typescript
  export type ActionType = "meld" | "draw" | "dogma" | "endorse" | "achieve" | "pending";

  export interface TurnAction {
    player: string;
    actionNumber: number;
    actionType: ActionType;
    cardName: string | null;
    cardAge: number | null;
    cardSet: string | null;
  }
  ```
- [x] Implement `buildTurnHistory(log: GameLogEntry[]): TurnAction[]` — iterates log entries, tracks current turnMarker, classifies action from subsequent entries in the same move:
  - `logWithCardTooltips` msg matching `/activates the dogma of (\d+) (.+) with/` → dogma
  - `logWithCardTooltips` msg matching `/endorses the dogma of (\d+) (.+) with/` → endorse
  - First `transfer` with `meldKeyword && source === "hand" && dest === "board"` → meld
  - First `transfer` with `source === "deck"` and no meld seen in same move → draw
  - `transfer` with `source === "achievements" && dest === "achievements"` → achieve
  - Last marker with no action → pending
- [x] Implement `recentTurns(actions: TurnAction[], count: number): TurnAction[]` — returns actions from the last `count` half-turns, in reverse order (newest first). A half-turn is a consecutive group of actions by the same player.
- [x] Tests: build turn history from a handcrafted game log with meld, draw, dogma, endorse, and pending entries; verify action types, card names, ordering
- [x] Tests: `recentTurns` returns correct slice for 0, 1, 2, 3 half-turns
- [x] Tests: first turn (single action) correctly produces 1-action half-turn
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 3: Render turn history HTML

**Files:**
- Modify: `src/games/innovation/render.ts`

- [x] Add `renderTurnHistory(actions: TurnAction[], cardDb: CardDatabase): string` function:
  - Each action → one line: `<div class="turn-action">PlayerName: actionType CardName</div>`
  - Pending → `<div class="turn-action pending">PlayerName:</div>`
  - Card names wrapped in tooltip span (reuse existing card tooltip infrastructure) when card exists in CardDatabase
  - Draw with unknown card: `draw [age]` or `draw [age] setName` (skip "base")
  - Achieve: `achieve [age]`
  - Half-turn groups separated by a subtle visual break (CSS margin or border)
- [x] Tests: verify rendered HTML contains expected action text and tooltip markup
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 4: Side panel integration and styling

**Files:**
- Modify: `sidepanel.html`
- Modify: `src/sidepanel/sidepanel.css`
- Modify: `src/sidepanel/sidepanel.ts`
- Modify: `src/games/innovation/config.ts`

- [x] Add `<div id="turn-history"></div>` between `#section-selector` and `#content` in `sidepanel.html`
- [x] Add `"turn-history"` to section visibility system in `config.ts`: add to `SECTION_LABELS` (label: "Turn history"). Do NOT add to `SECTION_IDS` array (it's not a card section rendered by `renderSummary`)
- [x] In `sidepanel.ts` `renderWithDb()`: call `buildTurnHistory(gameLog.log)` and `recentTurns(actions, 3)`, then `renderTurnHistory(recent, cardDb)`, set result on `#turn-history` element
- [x] In `buildSectionSelector()`: add a "Turn history" checkbox that toggles `#turn-history` visibility via localStorage (separate from the main section loop, since turn-history is not a `.section[data-section=...]` element)
- [x] CSS for `#turn-history`:
  - Positioned below top bar, right-aligned
  - Small font, compact spacing
  - Semi-transparent background matching dark theme
  - Player names styled distinctly (bold or different color)
  - `.pending` line dimmed
  - Half-turn group spacing (small gap between different players' groups)
- [x] Tests: verify turn history element is populated during render flow
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes
- [x] Run `npm run build` — build succeeds

### Task 5: Verify acceptance criteria

- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`
- [x] Run build: `npm run build`
- [x] Update README.md if needed
- [x] Move this plan to `docs/plans/completed/`
