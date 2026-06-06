---
name: Innovation Artifact display→board meld
description: A player may spend one of their two regular turn actions to meld their Artifact from display→board. BGA logs it as transferedCard display→board with meld_keyword=true; classifyTransfer must accept source ∈ {hand, display}.
type: project
---
In Innovation's Artifacts of History expansion, after the pre-turn artifact decision (FAD/return/pass) the Artifact may still sit on the player's display. As a regular action — either action 1 or action 2, not auto-melded — the player can choose to meld that Artifact straight from display to their board.

**Why:** I initially modeled this as an "auto-meld after pass" tied to action 1. The user corrected: it's a player choice, can be any action.

**How to apply:** In `src/games/innovation/process_log.ts`, `classifyTransfer` matches a meld when `meldKeyword && dest === "board" && (source === "hand" || source === "display")`. Don't add logic that depends on what the prior action was — the display→board meld is an independent action.

**BGA log signature:** `transferedCard` with `location_from=display`, `location_to=board`, `meld_keyword=true`, `type=1` (artifacts), same `owner_from` and `owner_to`.
