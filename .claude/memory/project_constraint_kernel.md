---
name: shared-constraint-kernel-and-per-game-opt-ins
description: src/engine/constraint.ts is the shared deduction kernel; Crew and Innovation opt into different rules based on their candidate model
metadata: 
  node_type: memory
  type: project
---

`src/engine/constraint.ts` exposes `propagate(placeholders, options)` with four rules:
- **Naked single** (always): a placeholder with one candidate removes that card from all others.
- **Hidden single per-placeholder** (always): a card in only one placeholder's candidates resolves that placeholder.
- **Hidden single per-container** (opt-in via `containerOf` callback): a card in only one container's placeholders resolves a slot there. Skips ordered containers via `isContainerOrdered`.
- **Naked N-tuple** (opt-in via `enableNakedTuples`): N placeholders' combined candidates size = N → those N cards are confined; prune from all other placeholders. Pure prune, never commits.

**Ordered-container guard**: per-container hidden-single is unsound for containers whose internal position is BGA-observable (Innovation's deck, forecast, revealed). Committing a name to a specific placeholder there would falsely pin a position the observer cannot know. `isContainerOrdered(containerId)` callback returns true for those zones; the deduction is detected but no commit happens.

**Per-game settings**:

| Setting | Crew | Innovation |
|---|---|---|
| `containerOf` | `playerId` | `${zone}:${player}` (private) / `${zone}:${groupKey}` (deck) |
| `isContainerOrdered` | not provided (all unordered) | matches `deck:`, `forecast:`, `revealed:` prefixes |
| `enableNakedTuples` | `true` | `false` |

**Why Innovation opts out of nakedTuples**: per-pool-equivalence-class structure (see `project_innovation_candidate_invariant`) — pool candidates are disjoint from non-pool candidates by construction, so naked-N's preconditions are met only vacuously. Crew's slot candidates diverge non-uniformly via communications/voids without a pooling step, so naked-N finds real deductions there.

**Innovation's `move()` calls `propagate` at the end** (after destination is finalized) — per-container hidden-single depends on container membership which changes on every move. Without this, the deduction wouldn't fire after grouped draws (no per-named-event trigger in those code paths).

**Naked-N safety**: pure pruning, never commits a placeholder to a name. So unlike per-container, no ordered-container guard is needed — it's safe regardless of zone semantics.
