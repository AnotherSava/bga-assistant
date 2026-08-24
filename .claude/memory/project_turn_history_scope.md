---
name: project_turn_history_scope
description: The turn history lists actions only — no extra lines describing what an action did
metadata:
  type: project
---

The turn history (side panel and the in-page log) lists a player's actions — meld, draw, dogma, endorse, achieve, promote, the Artifact pre-turn choice — and nothing about their consequences. A Fission sweep reads as `dogma Fission`, not as a separate "all hands removed" line.

**Why:** offered on 2026-08-24 for the bulk removals, and declined: "we don't provide details in event history for now". The card name already tells an Innovation player what happened, and the board empties in front of them.

**How to apply:** do not add `ActionType` members for the effects of an action. A new entry has to be an action a player took.
