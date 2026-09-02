---
name: project_nucleum_history_scope
description: Nucleum gets a turn history and nothing else, and why the scope stopped there
metadata:
  type: project
---

Nucleum support is a turn history and nothing more — decided 2026-09-01, with the alternatives (supply/deck counts, a rendered network map) offered and declined.

**Why:** the rulebook has no concealment rule anywhere. Action tiles sit face up in a public pool, contracts are public in the offer and on the player board, technology tiles are visible on the experiment board from setup, and everything on the map is open. The only genuinely unknown things are the shared face-down draw stacks, whose *composition* is randomised at setup. So there is no candidate narrowing to do and no Innovation-style deduction engine — the value is a log you can actually scan.

**How to apply:** a Nucleum row names what a player *chose*, never what it produced. Every `getBonus` (119 of them in one mid-game table), every `msg`, every market refill is dropped. This is the same scope the Innovation history keeps — see [[project_turn_history_scope]]. The side panel renders the history as its whole content rather than Innovation's corner overlay, since there are no sections to sit beside.

Rows are text and colour only: no sprites were cut for it, so nothing to re-download when BGA re-cuts its own. Protocol details in [[project_bga_nucleum_protocol]].
