---
name: project-bga-mode-detection
description: "How to read real-time vs turn-based mode from BGA gameui, plus tab-title and my_hand extraction quirks"
metadata: 
  node_type: memory
  type: project
---

Reading a BGA table's **real-time vs turn-based** mode and related extraction quirks:

- `gameui.bRealtime` — framework-level real-time flag (number, `1` real-time / `0` turn-based). Present on **every** BGA game → the reliable universal signal. Use this.
- `gameui.gamedatas.realTime` — boolean, but **game-specific**: The Crew exposes it, The Gang doesn't. Don't rely on it.
- `gameui.gamedatas.tablespeed` — universal but its value→mode mapping is **undocumented** (observed: real-time `"1"`, turn-based `"17"`). Don't hardcode a threshold.
- Move-gap timing (gaps between notification timestamps) is a universal heuristic but only available where packets exist (extraction); the user dislikes heuristics — prefer `bRealtime`.

**Tab title format:** `<notification/status> • <Game Name> • Board Game Arena` — the game name is the second-to-last ` • `-separated segment (used to derive a pretty display name).

**`gameui.gamedatas.my_hand` can lag the notification history:** extraction may snapshot a pre-move hand while the fetched notification log already includes that move. The replayed engine state can therefore be one step *ahead* of `my_hand`; treat the notification history as authoritative.

**Why:** the time-tracking feature needs per-table mode; investigation (table 858231817) showed `realTime` missing for The Gang and the my_hand/log divergence. See [[project-bga-player-metadata]].
