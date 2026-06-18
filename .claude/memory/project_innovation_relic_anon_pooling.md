---
name: project_innovation_relic_anon_pooling
description: Innovation relics must be excluded from anonymous same-group candidate pooling/selection in takeFromSource
metadata: 
  node_type: memory
  type: project
---

In the Innovation engine (`src/games/innovation/game_engine.ts`), `takeFromSource` must exclude resolved relic cards from BOTH the anonymous same-group candidate pooling AND the grouped-removal selection — via the `isRelicCard(card)` helper (`card.isResolved && cardDb.get(resolvedName).isRelic`).

**Why:** Relics are public, individually identified cards and always move *by name*. When a player holds a relic plus a non-relic of the same (age, cardSet) and an anonymous grouped `hand→deck` return fires for that group, the old code pooled the relic's singleton `{relicName}` into the union, dissolving its resolution. The later named `*→relics` transfer then threw `Relic "<name>" not found in <zone>` (game_engine.ts:132). Bug: table bgaa_868117803, move 64 — cHantun returned a non-relic age-3 cities card to deck (anonymous) then Timbuktu (age-3 cities relic) to relics in the same move.

**How to apply:** An anonymous/grouped transfer can never legitimately refer to a relic, so filtering relics out of pooling/selection is always safe. Regression test: "does not pool a resolved relic into an anonymous same-group return (bgaa_868117803)" in game_state.test.ts. Related: [[project_constraint_kernel]], the relic-return notes in MEMORY.md (Artifacts of History + Relics variant).
