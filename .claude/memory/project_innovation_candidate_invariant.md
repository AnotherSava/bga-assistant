---
name: innovation-candidate-set-per-pool-equivalence-classes
description: "Innovation's candidate model is per-pool-equivalence-class — not per-group, per-container, or per-unordered-container; explains why naked-N is dead code"
metadata: 
  node_type: memory
  type: project
---

Innovation's candidate model has a per-pool-equivalence-class structure. Not a global invariant, not per-container, not per-unordered-container — per-pool.

A "pool" (equivalence class) is the set of Cards that participated in a single `mergeCandidates`, grouped-removal pool, or discard-aware meld-filter pool. Cards in the same pool share candidates. Cards in different pools can have arbitrarily different candidates. A single zone (even an unordered one like a hand) can hold multiple pools' Cards if intermediate moves shuffled them around.

**Example**: after Alice meld-filters with 3 discards (pooled to `{A,B,C}`) and 2 keeps, the deck holds the 3 returned cards (pool class A) plus the original deck cards (pool class B = `{F,G,H}` from prior naked-single propagation). Bob's subsequent grouped deck draws pull cards across both classes into his hand, where both classes coexist as unresolved cards with different candidate sets.

**Why naked-N tuple is effectively dead in Innovation** (despite the limited invariant): the pool's candidate set always consists of names that were RESOLVED before the pool operation. By that point, naked-single propagation has stripped those names from every other Card's candidates. So at the moment naked-N's firing condition holds for a pool, no Cards outside the pool have any of the pool's names. Deduction is vacuous by construction.

This disjointness property holds across zones and across pool epochs because it's about *what names are in the pool* (resolved before pooling) versus *what names other Cards hold* (everything except resolved names).

**Per-Card hidden-single is also dead** under the same property: within a pool, every name is in every pool Card; outside, no Card has any pool's names. Never "exactly one Card."

**How to apply**: when reasoning about Innovation's candidates, don't assume groupwide identity. Reason per-pool. When evaluating whether a kernel deduction (naked-N, hidden-single) would fire usefully, check whether pool-set ∩ non-pool-set is non-empty — it usually isn't, by construction.

**Future change that could break this**: any engine change that pools BEFORE all peers have been naked-single-propagated would create overlap and let naked-N find real deductions.

See also: [[project_innovation_deck_order]] for the discard-aware pooling machinery added in May 2026.
