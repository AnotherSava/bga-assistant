---
name: BGA player metadata source-of-truth
description: Per-player info comes from gameui.gamedatas.players[pid] in extract.ts; color is bare 6-char hex (no #)
type: project
---
The canonical source for per-player BGA metadata (`PlayerInfo: {id, name, colorHex, isCurrent}`) is `gameui.gamedatas.players[pid]`, read in `src/extract.ts`. The `.color` field is a bare 6-char hex string without `#`. The full BGA palette includes Red, Green, Blue, Yellow (orange), Black, White, Pink, Purple, Cyan, Orange, Khaki green, Gray.

**Why:** Notification packets carry `color` inconsistently — Crew's `startNewMission.args.players[].color` has it, but Innovation/Azul packets do not. Only `gamedatas.players[pid].color` is universally present on every BGA game page.

**How to apply:** When adding a new game or any feature that needs player identity/color, read from `RawExtractionData.players: Record<string, PlayerInfo>` (already populated by extract.ts). Do not consult notification args. Per the no-defensive-fallbacks rule, treat missing `gamedatas.players[pid].color` as a hard error in extract.ts.
