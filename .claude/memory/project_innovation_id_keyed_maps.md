---
name: Innovation Maps keyed by player ID
description: GameState per-player Maps (hands, boards, scores, etc.) keyed by PlayerInfo.id — not name
type: project
---
As of 2026-04-28, Innovation's per-player `Map`s in `GameState` (`hands`, `boards`, `scores`, `revealed`, `forecast`, `displays`, `achievementRelics`) are keyed by **player ID**, not name. `state.perspective` holds an ID, and `TransferEntry.sourceOwner`/`destOwner`, `TurnAction.player`, `pendingAction.player`, etc. all carry IDs.

**Why:** Originally name-keyed (the Python tracker's convention). Migrated to IDs to align with Crew (already ID-keyed) and to thread one uniform `PlayerInfo` model through all three games for player-color rendering. The user explicitly chose the bigger-scope migration over keeping name-keyed maps.

**How to apply:** When working with Innovation state, look up players via id. Log-message regex matches in `game_engine.processEntry` still produce names (e.g. "Alice reveals her hand: …") — convert via `_idByName` map cached in `GameEngine` during `initLog`. Same in `process_log.ts`: artifact-pass log lines match player NAMES; convert via the local `idByName` map before comparing to `artifactWindow.player` (an ID). Tests synthesize `PlayerInfo[]` with `id===name` so existing `state.hands.get("Alice")` style assertions keep working.
