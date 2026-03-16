# Promote sub-actions and chronological turn history order

## Overview

Extract the action detail fields into a reusable `ActionDetail` type and extend `TurnAction` to hold a list of action details, so compound actions (meld → promote from forecast → dogma promoted card) render as indented continuation lines. Also reverse the turn history display order from newest-first to oldest-on-top / newest-on-bottom.

## Context

- Files involved:
  - Modify: `src/games/innovation/turn_history.ts` — restructure types (`ActionDetail`, updated `TurnAction`), reverse `recentTurns` order
  - Modify: `src/games/innovation/process_log.ts` — detect promote/dogma-promoted sub-actions after primary classification
  - Modify: `src/games/innovation/render.ts` — render sub-action continuation lines, adapt to new type shape
  - Modify: `src/games/innovation/__tests__/turn_history.test.ts` — update for new type shape and chronological order
  - Modify: `src/games/innovation/__tests__/render.test.ts` — update for new type shape
  - Modify: `src/games/innovation/__tests__/process_log.test.ts` — add promote sub-action tests
  - Modify: `src/__tests__/sidepanel_ui.test.ts` — update action fixtures for new shape
- Related patterns: current `TurnAction` flat type, `classifyTransfer`/`classifyMessage` helpers, `renderTurnHistory` renderer
- Dependencies: None

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Design Notes

**Restructured types**: Extract the shared action fields into `ActionDetail`:
```typescript
export interface ActionDetail {
  actionType: ActionType;
  cardName: string | null;
  cardAge: number | null;
  cardSet: string | null;
}

export interface TurnAction {
  player: string;
  actionNumber: number;
  time: number | null;
  actions: ActionDetail[];  // [0] = primary, [1..] = sub-actions
}
```
`ActionType` gains `"promote"`. The `actions` array always has at least one element. Sub-actions (index 1+) are rendered as indented continuation lines with `→` prefix.

**Promote detection in process_log**: After the primary action is classified (currently `pendingAction` is set to null), continue scanning entries within the same turn marker for:
1. A transfer with `source: "forecast"`, `dest: "board"`, `meldKeyword: true` → append `promote` sub-action with the card's name/age/set
2. A log message matching `"chooses to dogma his promoted card"` followed by an "activates the dogma of" message → append `dogma` sub-action with the card name

Implementation: instead of setting `pendingAction = null` after primary classification, transition to a "scanning for sub-actions" state that appends to `actions[actions.length - 1].actions`. The scan ends when the next `gameStateChange` marker arrives (which also starts the next action).

**"Chooses not to promote" case**: No sub-action emitted — the action stays as a plain meld line with no continuation. The log message `"chooses not to promote a card from his forecast"` is simply ignored.

**Chronological order reversal**: `recentTurns` currently returns newest-half-turn-first with newest-action-first within each group. Change to return oldest-half-turn-first with oldest-action-first within each group (chronological). The renderer already iterates the array linearly, so the visual result becomes oldest on top, newest on bottom.

**Rendering sub-actions**: After the primary action line, iterate `actions[1..]` and render each as:
```html
<div class="turn-action th-sub th-me">  → promote Feudalism</div>
```
Sub-action lines inherit the player's color class (`th-me`/`th-opp`) but use `th-sub` for indentation styling. No timestamp or `you:`/`opp:` label on sub-lines. The `→` is a literal Unicode arrow (U+2192) in the text.

**CSS for sub-actions**: `.th-sub` gets `padding-left` for visual indentation. The `→` prefix is part of the text content, not a CSS pseudo-element, for simplicity.

**No defensive fallbacks**: Do not design fallback values that mask invalid data (e.g. showing "?" for null ages). Trust input correctness — let invalid values surface as visible `null` or runtime errors rather than silently producing plausible-looking wrong output.

## Implementation Steps

### Task 1: Restructure TurnAction types

**Files:**
- Modify: `src/games/innovation/turn_history.ts`
- Modify: `src/games/innovation/process_log.ts`
- Modify: `src/games/innovation/render.ts`
- Modify: `src/games/innovation/__tests__/turn_history.test.ts`
- Modify: `src/games/innovation/__tests__/render.test.ts`
- Modify: `src/games/innovation/__tests__/process_log.test.ts`
- Modify: `src/__tests__/sidepanel_ui.test.ts`

- [x] In `turn_history.ts`: add `"promote"` to `ActionType`, extract `ActionDetail` interface, restructure `TurnAction` to have `actions: ActionDetail[]` instead of flat fields
- [x] In `process_log.ts`: update `classifyTransfer` and `classifyMessage` to return `ActionDetail` instead of `TurnAction`; update the action-building code to wrap the primary `ActionDetail` into a `TurnAction` with `actions: [detail]`
- [x] In `render.ts`: update `formatActionDetail` to accept `ActionDetail` instead of `TurnAction`; update `renderTurnHistory` to read `action.actions[0]` for the primary action
- [x] Update all test files: change `TurnAction` fixtures from flat `{ actionType, cardName, ... }` to `{ actions: [{ actionType, cardName, ... }] }`; update `toMatchObject` assertions accordingly
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 2: Detect promote sub-actions in process_log

**Files:**
- Modify: `src/games/innovation/process_log.ts`
- Modify: `src/games/innovation/__tests__/process_log.test.ts`

- [x] After the primary action is classified and pushed to `actions`, instead of discarding subsequent entries, continue scanning for sub-actions until the next `gameStateChange` marker: track the last pushed `TurnAction` as `currentAction`
- [x] When a transfer has `source: "forecast"`, `dest: "board"`, `meldKeyword: true` and `currentAction` exists: append a `promote` ActionDetail to `currentAction.actions`
- [x] When a log message matches `"activates the dogma of"` and `currentAction` exists and `currentAction.actions` has a promote sub-action: append a `dogma` ActionDetail to `currentAction.actions`
- [x] When the next `gameStateChange` marker arrives, clear `currentAction`
- [x] Add test: meld packet followed by forecast→board transfer produces `actions: [meld, promote]`
- [x] Add test: meld + promote + "chooses to dogma his promoted card" + dogma message produces `actions: [meld, promote, dogma]`
- [x] Add test: meld + "chooses not to promote" produces `actions: [meld]` (no sub-actions)
- [x] Add test: non-meld primary actions (draw, dogma, achieve) do not pick up spurious sub-actions
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes

### Task 3: Render sub-actions and reverse display order

**Files:**
- Modify: `src/games/innovation/turn_history.ts`
- Modify: `src/games/innovation/render.ts`
- Modify: `src/sidepanel/sidepanel.css`
- Modify: `src/games/innovation/__tests__/turn_history.test.ts`
- Modify: `src/games/innovation/__tests__/render.test.ts`

- [x] In `recentTurns`: reverse the return order to chronological (oldest half-turn first, oldest action first within each group)
- [x] In `renderTurnHistory`: after the primary action line, iterate `action.actions.slice(1)` and render each as `<div class="turn-action th-sub ${playerCls}">  → ${formatActionDetail(sub, cardDb)}</div>` — no timestamp, no `you:`/`opp:` label
- [x] Add CSS: `.th-sub { padding-left: 12px; }` (or similar) for visual indentation
- [x] Update `recentTurns` tests: reverse all expected orderings to chronological
- [x] Add render test: TurnAction with sub-actions produces `→ promote` and `→ dogma` continuation lines with `th-sub` class
- [x] Add render test: sub-action lines inherit player color class but have no player label
- [x] Run `npm test` — all tests pass
- [x] Run `npm run lint` — type-check passes
- [x] Run `npm run build` — build succeeds

### Task 4: Verify acceptance criteria

- [x] Manual test: open side panel on a game with promote actions, verify compound rendering
- [x] Manual test: verify turn history shows oldest on top, newest on bottom
- [x] Manual test: verify non-promote games still render correctly
- [x] Run full test suite: `npm test`
- [x] Run linter: `npm run lint`

### Task 5: Update documentation

- [x] Update README.md if user-facing behavior changed
- [x] Update CLAUDE.md if internal patterns changed
- [x] Move this plan to `docs/plans/completed/`
