# Plan: Pre-turn artifact step in turn history

## Context

Innovation turn history currently renders the two regular actions each player takes per turn (with optional `promote → dogma` sub-actions for endorsed turns). The Artifacts-of-History expansion adds an additional **pre-turn choice** that is currently invisible: when a player starts their turn with an artifact on display, they must choose between *dogma* (Free Artifact Dogma), *return* (return to deck without dogma), or *pass* (leave on display for this turn). This choice is consequential (it can fire a dogma for free and shape the rest of the turn), but it's missing from the action feed, so the history reads as two actions that "came from nowhere" when an artifact was involved.

Add the artifact step as an optional entry at the start of a player's turn in turn history, rendered as a distinct line like `you: pass Jiskairumoko Necklace artifact`.

## Approach

Emit the artifact step as a synthetic `TurnAction` with a sentinel `actionNumber: 0` whose `actions` array holds a single `ActionDetail` of a new type (`artifact_dogma` / `artifact_return` / `artifact_pass`). This fits cleanly into the existing flat `TurnAction[]` stream, preserves the `actions[0] = primary` invariant in `TurnAction`, and requires no changes to `recentTurns` grouping (a preceding `actionNumber: 0` action sits inside the same turn boundary — `recentTurns` groups consecutive same-player actions, which is exactly a turn).

Detect the step inside `processRawLog`:

1. **Marker**: BGA emits `gameStateChange id:15` at the start of any turn where the player has an artifact on display. Extend the existing `gameStateChange` handler (currently only reads `id:4`) to also watch `id:15` from the spectator-channel packet, with the same player+move dedup logic used for `id:4`. Opens an "artifact-step window" pinned to that player.

2. **Track display owners**: Maintain a `displaysByPlayer: Map<string, {cardName, cardAge, cardSet}>` inside `processRawLog`. Update on every transfer with `dest === "display"` (attribute to `destOwner`); clear on transfer with `source === "display"`. The plan requires this because the pass message (`"<player> chooses not to return or dogma his Artifact on display."`) omits the card name, and the user wants the name in the output.

3. **Classify while the window is open**, matching on the turn player:
   - `log` entry matching `/^(.+?) chooses not to return or dogma (?:his|her) Artifact on display\.$/` → `artifact_pass`, resolve name/age via `displaysByPlayer`.
   - `transfer` with `source === "display" && dest === "deck" && sourceOwner === turnPlayer` → `artifact_return` with the transfer's name/age.
   - `logWithCardTooltips` matching the existing `dogma` pattern → `artifact_dogma` with the dogma message's name/age. Only classify here while the artifact window is open; regular `dogma` classification continues to handle the mid-turn case.

   Emit the synthetic `actionNumber: 0` `TurnAction` and close the artifact window.

4. **Window closure**: the window closes on the first classification above, OR when the next `gameStateChange id:4 action_number:1` marker arrives for the same player (meaning the player had no artifact-step emission — should not happen when id:15 fired, so throw if it does, consistent with `no_defensive_fallbacks` feedback). The id:15 marker does NOT fire when the player has no artifact on display, so turns without an artifact step simply don't open a window.

5. **FAD disambiguation**: without id:15, a FAD dogma (`artifact_dogma` followed by auto display→deck transfer) is indistinguishable from a regular first-action dogma of an artifact the player holds. The id:15 marker is the authoritative signal. When FAD classifies, the subsequent display→deck transfer for the same card is the game's auto-return and must NOT re-classify as `artifact_return` — the window is already closed, so this falls out naturally.

## Critical files

- `src/games/innovation/turn_history.ts` — extend `ActionType` union with `"artifact_dogma" | "artifact_return" | "artifact_pass"`. No changes needed to `recentTurns`.
- `src/games/innovation/process_log.ts` — add id:15 handling, `displaysByPlayer` tracking, three new classifier branches, and the `actionNumber: 0` emission. Reuse existing `classifyMessage` regex for the FAD dogma match (adapt return type).
- `src/games/innovation/render.ts` — in `formatActionDetail` add three branches (use existing `cardTooltipSpan`). In `renderTurnHistory`, when `action.actionNumber === 0` render as a distinct line with label `artifact:` and a new CSS class `th-artifact`.
- `src/sidepanel/sidepanel.css` — add `.turn-action.th-artifact { color: #b8d4b8; font-style: italic; }` (muted green, parallel to existing `.th-time` muted styling) near lines 430-437.
- `src/games/innovation/__tests__/process_log.test.ts` — add id:15 marker fixture and three classification test cases (pass / return / FAD-dogma), plus a test that a turn without id:15 produces no artifact-step.
- `src/games/innovation/__tests__/render.test.ts` — add test cases for each of the three variants rendering as a top-level line with `th-artifact` class.
- `src/games/innovation/__tests__/turn_history.test.ts` — add a test that `recentTurns` groups an `actionNumber: 0` step with subsequent actions of the same player into one turn.
- `src/render/help.ts` — update the Innovation action history help text (line 83) to mention the artifact step.
- `docs/pages/innovation.md` — update the turn history description and feature bullet to mention the artifact step (keep aligned with `help.ts` per CLAUDE.md).

## Rendering

Output shape (confirmed with user):

```
you:  pass Jiskairumoko Necklace artifact
you:  meld Philosophy
  -> dogma Philosophy
opp:  return Holmegaard Bows artifact
opp:  endorse Flute
```

- `pass <card> artifact` / `return <card> artifact` / `dogma <card> artifact` — verb first, card name with tooltip, then a trailing `artifact` word to disambiguate from a regular `dogma`/`return` action
- Distinct styling (muted green, italic) via `th-artifact` class
- Card names get the standard `cardTooltipSpan` treatment

## Reuse

- `classifyMessage` (`process_log.ts:142`) already matches the dogma pattern — reuse it for FAD detection.
- `cardTooltipSpan` (`render.ts`, near line 275) handles card-name rendering with hover tooltips — reuse unchanged.
- `recentTurns` (`turn_history.ts:33`) already groups consecutive same-player actions (turns) and needs no modification.
- `displaysByPlayer` bookkeeping mirrors the existing `relicNameByAge` pattern (pre-scan for card identity to resolve anonymous log entries).

## Verification

1. `npm run lint` — TypeScript typecheck passes.
2. `npm test` — existing tests pass, new tests pass.
3. Regression against the real sample: `npm run game-log -- data/bgaa_839716682_140/raw_data.json --game innovation` then `npm run game-state -- data/bgaa_839716682_140/game_log.json --game innovation`. Inspect the generated `game_log.json` `actions[]` for expected `actionNumber: 0` entries at the four `"chooses not to return or dogma"` moves (100, 106, 109, 122) and at the display→deck transfer moves (18, 41, 50, 115, 130). Confirm counts match id:15 occurrences (15 total).
4. `npm run build`, reload the unpacked extension, and open a live Artifacts-with-Relics game. Verify the sidepanel turn-history shows the new `artifact: ...` lines for any turn where the opponent (or you) has an artifact on display at turn start, with correct card names and styling.
