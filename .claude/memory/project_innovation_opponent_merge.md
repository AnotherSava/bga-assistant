---
name: project-innovation-opponent-merge
description: "mergeSuspects must only pool partial-kind opponent knowledge; a slot's suspect set must always contain its true card"
metadata: 
  node_type: memory
  type: project
---

In Innovation's `game_engine.ts` `mergeSuspects` (opponent-knowledge pooling when one of our cards moves between private zones), **only `partial`-kind cards may be pooled.**

- `exact` cards are distinguishable — the opponent knows them — so pooling would wrongly downgrade them to `partial`.
- `none` cards are untracked — pooling fabricates a suspect set that can **exclude the card's own true identity** (the original bug: a hidden Education slot got suspects `[alchemy, compass, translation]`, which excluded Education).

**Invariant:** a slot's opponent suspect set must always contain its true card. This affects only the opponent's-view annotations, never the observer's own resolutions.

**Why:** bug #858231817 — after a public reveal, kept/returned cards (opponent-`exact`) and an older hidden card (opponent-`none`) were all blindly pooled. Fixed by filtering `affected` to `partial` only; regression test in `game_state.test.ts`. Distinct from [[project-innovation-candidate-invariant]] (which is about the *observer's* candidate sets).
