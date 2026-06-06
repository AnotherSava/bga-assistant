---
name: innovation-deck-order-handling-and-meld-filter-returns
description: "Engine treats decks as ordered arrays matching BGA's physical deck; meld-filter return logic uses discard-aware pooling to preserve keeps' resolutions"
metadata: 
  node_type: memory
  type: project
---

Innovation engine treats `state.decks[groupKey]` as an ordered array matching BGA's physical deck (sourceCards[0] = top of deck; push = bottom, unshift = top via `TransferEntry.topOfDeck`).

**Meld-filter return handling (rewritten May 2026)**:

The previous conversion of grouped→named based on engine's hand array order was REMOVED. It was a drift source: when 2+ discards remained in the hand, the engine picked one by `sourceCards.find()` (engine's array order), which may not match BGA's actual return order. Pushed in the wrong relative order, the deck array drifted from BGA's physical order, and later draws (especially grouped) returned the wrong identity. The failure surfaced in `bgaa_855455504_44`.

Replaced with discard-aware pooling in `takeFromSource`:
- Pool only Cards whose candidates ⊆ `discardNames` (the discards). Kept cards (resolved to non-discard names) stay untouched.
- Card-finding prefers a discard candidate over any sameGroup card (since the return is a discard by construction).
- The `remainingReturns` decrement was moved to AFTER `takeFromSource` in `move()` so the filter sees `remainingReturns > 0` during the current return.

This preserves keeps' resolutions during meld filters (test: "preserves kept cards and pools discards separately when meld filter has both"). It also avoids the deck-order drift because the engine no longer commits a specific Card to a name based on its own hand array order.

**Defensive salvage retained**: `takeFromSource`'s named-deck-draw path uses `sourceCards.find(c => c.isResolved && c.resolvedName === action.cardName) ?? sourceCards[0]`. This compensates for residual order drift from other paths and lets artificial test scenarios (e.g. `bgaa_818433588` "decrements meld filter counter for named returns") that draw back a just-returned card immediately still work. If a future change ever pushes the engine to strictly enforce deck-array order matching BGA's, the salvage can be replaced with a fail-fast assertion.

See also: [[project_innovation_candidate_invariant]] for how the discard-aware pooling shapes the per-pool-equivalence-class structure.
