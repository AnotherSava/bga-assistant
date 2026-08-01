---
name: project_bga_framework_dom_probing
description: How to locate and reproduce BGA framework UI (banners, bars) on a live table when debugging the compact header
metadata:
  type: project
---

The compact header rearranges BGA's *framework* chrome, so when something of BGA's goes missing or lands wrong, the question is always "which element, put there by what, and when". Working that out from screenshots is guesswork; the live table answers it directly.

**Find the element's owner.** Walk `gameui`'s prototype chain for a likely method name, then read the method body and pull its string literals — the element ids are in there. Findings so far: `addLastTurnBanner(text)` appends `<div id="bga-last-turn-banner">` to `#page-title` (this is the "End of game triggered!" notice); `addWinConditionBanner` inserts `#bga-win-condition-banner` before `#game_play_area_wrap`. Both delegate to `gameui.bga.gameArea`.

**Reproduce a transient state.** Call the framework method yourself in the board frame — `gameui.addLastTurnBanner('End of game triggered!')` — it is a pure DOM insert, client-side only, gone on reload. It no-ops on a table whose game is over, so there insert the markup by hand instead.

**Get a real end-of-game DOM.** Finished tables still render the board frame at `/tableview?table=<id>`, in their final state. Past table ids are listed at `boardgamearena.com/gamestats`.

**Identify the game before theorising.** The compact header runs on every BGA game and they look alike once folded, but per-game CSS keyed on `data-bgaa-game` means the culprit may be game-specific — an Ark Nova gap was diagnosed as an Innovation one for a full round. The prompt wording, the side-panel icons, or the game history will say which table it is.

See also [[project_bga_tableview_iframe]] for drilling into the board frame.
