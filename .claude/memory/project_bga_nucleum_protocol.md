---
name: project_bga_nucleum_protocol
description: How BGA's Nucleum implementation marks turns, undos and actions, and where its id→name tables live
metadata:
  type: project
---

BGA slug `nucleum`, board served in the `/tableview` iframe, 2-4 players (no solo). The adaptation is closed-source — none of this is checkable against a `.game.php`, it was read off a live 189-packet table (907048482) and `gameui`.

**Turn structure.** `gameStateChange` `args.id === 2` with `args.args.main === true` starts a turn (`active_player` is the new player); `args.id === 3` ends one (`active_player` is the player who just *finished*). `id:2` with `main === false` is a step inside a turn. `args.args.realActive === false` marks a state pushed while a stale pending node names someone who is not really on turn — don't take the active player from it.

**Undo rewinds by re-starting the turn.** An undo that cancels a whole turn re-emits `id:2 main === true` for the *same* player with no `id:3` in between, so "a turn start for the player whose turn is already open" is the rewind signal. Cancelled actions stay in the packet stream and are usually replayed. `undo.args.logs` carries inverse-operation tuples keyed by `LOG_*` opcodes, but `LOG_MOVE_STUFF` doesn't say which *kind* of piece moved without the `stuff` table, so tuple decoding can't disambiguate a building from a mine from a milestone.

**No spectator duplicates** — unlike Innovation, one packet stream, no dedupe pass. The only private notification in a whole game is `energizeOptions`, a UI hint.

**Two traps in the notification vocabulary:**
- `getActionTiles` means Develop **with** `player_name` and the tile-retrieval half of a Recharge **without** it (attribute the latter to the active player).
- A Recharge emits `placeMileStone` *before* its `getActionTiles`, so a milestone can't be suppressed by checking whether a recharge was already recorded — drop it when the recharge arrives.

**`updateNetworks.conns` gains a city pair exactly when a link is completed**, which is the only way to name the cities a railway placement joined: `placeTile` gives a road number (1-45) and BGA exposes no road→city map (the board is a positioned image, and the two board sides number roads differently).

**id → name lookups**, all from `gamedatas` (the extension extracts none of these today):
- `consts` is an array of `[NAME, value]` pairs, not an object. Holds `CITY_*` 0-18, `STUFF_*`, `ACTION_*`, `BONUS_*`, `ORIGIN_*`, `LOG_*`, `ST_*`.
- `stuff` is the master piece pool keyed by `STUFF_*` type; `id` is globally unique across types. A building's `subtype >= 60` means energized (`subtype - 60` is the base).
- `actionTiles` / `contracts` are standard BGA Decks; a tile's `type` maps to its two printed actions via `gameui.getATText(type)`. For a railway, `actionTiles[id].location_arg = rot ? -road : road`.
- `getBonus.origin` and `unlockTech.origin` arrive as translated *strings*, not the numeric `ORIGIN_*` const, and the two spell the turbine/mine row differently — don't match on them.

Nucleum has no hidden player information at all, so there is nothing to deduce; see [[project_nucleum_history_scope]] for what the extension does with the log instead.
