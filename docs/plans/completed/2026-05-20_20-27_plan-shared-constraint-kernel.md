# Plan: Shared Constraint-Propagation Kernel

## Overview

Extract a game-agnostic constraint-propagation kernel and migrate both `src/games/crew/game_engine.ts` and `src/games/innovation/game_engine.ts` onto it. The two engines today re-implement the same bipartite-matching deduction algorithm with different ergonomic choices; each is missing a deduction rule the other has. A shared kernel resolves both gaps in one place and lays groundwork for future trick-taking or deduction games (Hanabi, Yokai Septet, Skat, etc.).

### What the kernel does

Three propagation rules applied to a set of "placeholders" (candidate-bearing slots) until fixed-point:

1. **Naked single** — a placeholder with one candidate eliminates that card from all other placeholders.
2. **Hidden single (per-placeholder)** — a card appearing as a candidate in only one placeholder is resolved to that placeholder.
3. **Hidden single (per-container)** — a card appearing as a candidate in only one container's placeholders must be in that container; resolve any matching placeholder there.

### What this unlocks for the two existing games

- **Crew** keeps the per-container hidden-single (current fix for `bgaa_847667119_291`) and *gains* per-placeholder hidden-single via the shared kernel.
- **Innovation** *gains* per-container hidden-single, with one safety constraint: the kernel skips committing to placeholders inside **ordered containers** (deck, forecast, revealed). BGA's grouped-access semantics reference position within those zones (e.g. `sourceCards[0]` for a deck draw), so committing a name to a specific placeholder there would falsely pin a position the observer cannot know. Per-container fires freely in unordered containers (hands, scores, boards, etc.) where the engine's placeholder choice is observer-equivalent.
- Both games keep their own event handling (void detection, communication, named transfers, etc.) — the kernel runs only after candidates have been mutated by those handlers.

### Kernel API: the `isContainerOrdered` flag

The kernel's `PropagateOptions` exposes two callbacks:
- `containerOf(placeholder) → string` (enables per-container deduction).
- `isContainerOrdered(containerId) → boolean` (default: all-unordered).

This lets each game declare which of its containers have observable internal order. Crew's hands are unordered (default works). Innovation marks `deck:`, `forecast:`, and `revealed:` prefixes as ordered. Future games supply their own predicate.

### What stays game-specific

- Crew's void / communication / card-exchange / captain handlers.
- Innovation's transfer/move logic, group construction, `mergeSuspects`, `updateOpponentKnowledge`, and the **opponent-knowledge propagation pass** (Innovation's current `propagate` step 3). That layer reasons about *what the opponent has seen*, not about *what's where* — it's the same algorithm conceptually but applied to a different fact and tied to Innovation's `OpponentKnowledge` model.

## Context (from discovery)

- `src/games/crew/game_engine.ts:64-128` — current `propagateNakedSingles`, `propagateHiddenSingles`, and `propagate` driver. Per-container hidden-single only; no per-placeholder hidden-single.
- `src/games/innovation/game_engine.ts:608-663` — current `propagate(groupKey)`. Three passes: singletons, per-placeholder hidden-singles, suspect propagation. Called from 7 sites (`145`, `157`, `236`, `459`, `530`, `537`, and recursively in `move`).
- `src/games/crew/game_state.ts` — `CardGuess` is `{ candidates: Set<string> }`; hands are `Record<playerId, CardGuess[]>`.
- `src/games/innovation/types.ts` — `Card` has `candidates: Set<string>` (mutable) plus identity fields. `_groups: Map<AgeSetKey, Card[]>` indexes Cards by `(age, cardSet)`.
- Test fixtures: `src/games/crew/__tests__/` and `src/games/innovation/__tests__/`. Both follow `vitest` conventions; large fixtures live in `__tests__/fixtures/`.
- No existing `src/engine/` directory — this plan creates it.

## Development Approach

- **Testing approach**: Regular (code first, then tests) — matches project convention and the kernel's behavior is well-specified by the existing two engines.
- Each task must include new/updated tests for code it touches.
- All tests must pass before starting the next task.
- After each task: run `npm test` and `npm run lint`. Before declaring overall completion: also `npm run build`.
- Backward compatibility: serialization formats for both games are unchanged. Only the propagation algorithm is refactored.

## Critical design decisions

### Kernel API shape

```typescript
// src/engine/constraint.ts

export interface Placeholder<CardId> {
  candidates: Set<CardId>;
}

export interface PropagateOptions<P extends Placeholder<unknown>> {
  containerOf: (p: P) => string;
}

export function propagate<CardId, P extends Placeholder<CardId>>(
  placeholders: ReadonlyArray<P>,
  options: PropagateOptions<P>,
): boolean;
```

- **Structural type**: any object with `{ candidates: Set<CardId> }` qualifies. `Card` and `CardGuess` both already match — no wrapping required.
- **In-place mutation**: the kernel only ever calls `candidates.add`, `candidates.delete`, or `candidates.clear()` followed by `candidates.add()`. Never `slot.candidates = new Set(...)`. This is the contract that lets callers keep their existing Set references.
- **Container identity**: caller-supplied callback. Crew returns the player ID for each slot. Innovation returns `${playerId}/${zone}` (or just the zone identifier for `deck`, `achievements`, `relics`).
- **Return value**: `true` if any change was made — useful for callers that want to chain into further game-specific propagation.

### Class handling (distinguishability groups)

The kernel does **not** model Innovation's `(age, cardSet)` groups. The caller invokes `propagate` once per group with that group's placeholders. This keeps the kernel API trivial and pushes group iteration to the caller (where the index already exists).

Crew calls `propagate` once on all hand slots (single global universe).

### Innovation's `propagate(groupKey)` after migration

```typescript
private propagate(groupKey: AgeSetKey): void {
  const group = this._groups.get(groupKey);
  if (!group) return;

  let changed = true;
  while (changed) {
    changed = false;
    if (kernelPropagate(group, { containerOf: c => this.locateCard(c) })) changed = true;
    if (this.propagateSuspects(group)) changed = true;
  }
}
```

The kernel handles steps 1+2; the suspect propagation (step 3) becomes its own helper method. `locateCard(card)` returns a container key derived from which zone container holds the Card.

### Crew's `propagate(state)` after migration

```typescript
function propagate(state: CrewGameState): void {
  const placeholders: { candidates: Set<string>; pid: string }[] = [];
  for (const pid of Object.keys(state.hands)) {
    for (const slot of state.hands[pid]) placeholders.push({ candidates: slot.candidates, pid });
  }
  kernelPropagate(placeholders, { containerOf: p => p.pid });
}
```

Or, more efficiently without allocation, attach `pid` to the slot via a parallel `WeakMap` or by accepting a slight refactor of `CardGuess` to carry its owner. Decision deferred to implementation; both options are local.

### What the kernel does NOT do

- No pair/triple/N-set deductions. If we observe a real game state where those would help, we add them — not before.
- No Hall's-theorem subset enumeration. Same reasoning.
- No opponent-knowledge tracking. That's Innovation-specific and stays in Innovation.
- No event handling. Callers translate game events into candidate-set mutations before calling propagate.

## Implementation Steps

### Task 1: Create constraint kernel module

- [ ] Create `src/engine/` directory.
- [ ] Create `src/engine/constraint.ts` with the `Placeholder` type, the three propagation functions (`nakedSingles`, `hiddenSinglesPerPlaceholder`, `hiddenSinglesPerContainer`), and the `propagate` driver loop.
- [ ] Document each function with a one-paragraph block explaining the deduction rule it implements and the mutation contract (in-place only, never replace the Set).
- [ ] Create `src/engine/__tests__/constraint.test.ts`.
- [ ] Write tests for `nakedSingles`: singleton placeholder removes its card from peers; chains until stable; returns false when nothing changes.
- [ ] Write tests for `hiddenSinglesPerPlaceholder`: a card in only one placeholder's candidates resolves that placeholder; doesn't fire when card appears in multiple placeholders.
- [ ] Write tests for `hiddenSinglesPerContainer`: a card in only one container's placeholders resolves to a placeholder in that container; smallest-candidate-set tiebreak; doesn't fire when card spans containers.
- [ ] Write a test for the driver `propagate`: alternating naked / hidden / per-container converges to fixed-point; idempotent on stable input.
- [ ] Write a test confirming the kernel mutates candidates Sets in place (caller-held reference still sees mutations).
- [ ] Run `npm test` — must pass before next task.
- [ ] Run `npm run lint` — must pass before next task.

### Task 2: Migrate Crew engine onto kernel

- [ ] In `src/games/crew/game_engine.ts`, replace `propagateNakedSingles` and `propagateHiddenSingles` (lines 64-118) with an import of the kernel.
- [ ] Replace the `propagate(state)` driver (lines 120-128) with a thin adapter that builds the placeholder list (one entry per `(player, slot)` pair, container = playerId) and calls the kernel.
- [ ] Delete the now-unused helper functions.
- [ ] Verify all 7 call sites of `propagate(state)` in `game_engine.ts` still type-check (signature unchanged).
- [ ] Run the existing Crew test suite: `npx vitest run src/games/crew/` — every existing test must pass unchanged, including the `bgaa_847667119_291` per-container hidden-single regression test added earlier in this conversation.
- [ ] Add a new test `hidden single (per-placeholder): card resolves to its only candidate slot` in `src/games/crew/__tests__/game_engine.test.ts` — set up a scenario where one specific slot is the only one that can hold a given card (e.g., communications narrowed all other slots' candidates) and assert that slot resolves. This demonstrates the deduction Crew gains from the migration.
- [ ] Run `npm test` (full suite) — must pass before next task.
- [ ] Run `npm run lint` — must pass before next task.

### Task 3: Migrate Innovation engine onto kernel

- [ ] In `src/games/innovation/game_engine.ts`, extract the existing suspect-propagation pass (lines 644-661) into its own private method `propagateSuspects(group: Card[]): boolean` that returns whether it changed anything.
- [ ] Replace the existing `propagate(groupKey)` body (lines 608-663) with: look up the group, then loop calling the kernel + `propagateSuspects` until both return false.
- [ ] Add a `locateCard(card: Card): string` helper that returns a stable container key for the Card (e.g., scan zone maps; for performance, build and cache a `Card → containerKey` map keyed by Card object identity inside the same `propagate` call). Decide between caching strategies during implementation; do not over-engineer.
- [ ] Verify all 7 call sites of `this.propagate(groupKey)` still type-check (signature unchanged).
- [ ] Run the existing Innovation test suite: `npx vitest run src/games/innovation/` — every existing test must pass unchanged.
- [ ] Innovation declares ordered containers via `isContainerOrdered` (deck/forecast/revealed prefixes). Per-container hidden-single fires safely in unordered containers (hands, scores, boards). No new dedicated Innovation test required — the existing `bgaa_823235522` fixture passes with per-container enabled, demonstrating that the ordered-container guard prevents the previous failure mode.
- [ ] Run `npm test` (full suite) — must pass before next task.
- [ ] Run `npm run lint` — must pass before next task.

### Task 4: Verify acceptance criteria

- [ ] Confirm `src/games/crew/game_engine.ts` and `src/games/innovation/game_engine.ts` no longer contain any naked-single or hidden-single propagation code — both call the kernel.
- [ ] Confirm the Crew `bgaa_847667119_291` regression test still passes (per-container hidden single deduction works end-to-end).
- [ ] Re-run the full game-state CLI on `data/bgaa_847667119_291/game_log.json` and verify DungeonChar's hand still shows `5:4`, `1:3`, `3:8` resolved (output identical to the original fix).
- [ ] Run all archive fixtures through the CLI to confirm no regressions (`npm run game-state -- <each fixture> --game <name>` for any existing fixtures referenced by tests).
- [ ] Run `npm test` — full suite must pass.
- [ ] Run `npm run lint` — must pass.
- [ ] Run `npm run build` — must succeed without warnings beyond existing baseline.

### Task 5: Documentation

- [ ] Update `CLAUDE.md` Project Structure section to list `src/engine/constraint.ts` with a one-line description.
- [ ] In `src/engine/constraint.ts`, ensure the module-level comment explains the bipartite-matching framing in one short paragraph for future readers.
- [ ] Update `docs/pages/data-flow.md` only if the kernel changes the architecture diagram or message protocol (it does not, so likely no change — re-read the page and confirm).
- [ ] No README or per-game docs page changes required (kernel is internal; user-facing behavior unchanged except for additional deductions, which don't warrant new feature docs).

## Testing Strategy

- **Unit tests**: the kernel is tested in isolation in `src/engine/__tests__/constraint.test.ts`. Each propagation rule has its own focused tests; the driver has its own convergence test.
- **Integration tests**: existing Crew and Innovation test suites cover the engines end-to-end. Both must pass unchanged after migration (the kernel's behavior on existing scenarios must match the previous in-engine implementations).
- **Regression tests**: the `bgaa_847667119_291` per-container hidden-single test (Crew) and the new per-placeholder test (Crew) and the new per-container test (Innovation) together pin the deductions both engines gain.
- **No E2E**: the project has no Playwright/Cypress UI tests; this change has no UI surface anyway.

## Risks and mitigations

- **Risk**: Innovation's `Card` objects have identity used elsewhere (`mergeSuspects`, `updateOpponentKnowledge`). The kernel must mutate `candidates` Sets in place, not replace them. — *Mitigation*: explicit contract in the kernel's docstring; a dedicated test confirms in-place mutation.
- **Risk**: Innovation calls `propagate(groupKey)` 7 times in `game_engine.ts`. A subtle behavior change could regress a complex scenario. — *Mitigation*: every existing test must pass before declaring Task 3 done; full archive-fixture re-run in Task 4.
- **Risk**: Building the `Card → containerKey` map for Innovation on every `propagate` call could be expensive. — *Mitigation*: build it lazily per call (groups are small, ≤ ~30 Cards per `(age, cardSet)` typically); profile only if measurable; do not pre-optimize.
- **Risk**: Performance of the kernel's `cardToPlaceholders` map construction on large groups. — *Mitigation*: groups are bounded (Innovation: ≤ ~30 per age/set, Crew: 40 total); not a concern in practice.

## Post-Completion

Items requiring manual attention after merge:

- **Manual verification**: load a real Crew game in the extension and confirm the side panel still updates correctly across communications, void plays, and trick wins.
- **Manual verification**: load a real Innovation game and confirm the side panel still shows correct hand candidates and opponent suspects across a few turns.
- **Future work** (out of scope for this plan):
  - Add naked-pair / hidden-pair deductions to the kernel when a concrete game state demonstrates the need.
  - Consider extracting Innovation's suspect-propagation layer into a sibling kernel module once a second game needs opponent-knowledge tracking.
  - Plug Hanabi / Yokai Septet / other deduction games into the same kernel when added.
