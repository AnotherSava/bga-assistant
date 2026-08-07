---
name: project-innovation-zone-placement
description: Innovation replaces BGA's zone placement function, so zone.item_width/item_height are ignored and card_dimensions is the only size BGA reads
metadata:
  type: project
---

Innovation does not use BGA's framework placement for its zones. `setPlacementRules(zone, left_to_right)` installs its own `itemIdToCoordsGrid` on every zone it builds, and that function reads each card's box from **`gameui.card_dimensions[this.HTML_class]`**, with the step and row count from `gameui.delta[location]` and `gameui.num_cards_in_row[location]`. The framework's own grid function — the one that reads `zone.item_width`, `item_height`, `item_margin` — never runs, so **setting those on a zone does nothing**.

That box is also what sizes the container: `setPattern("grid")` leaves `autoheight` on, and `updateDisplay` sets the container's height to the tallest `y + h` the placement function returned. Under-report the height and the zone's contents overflow their box; the cards themselves still look right, because CSS sizes them and `delta` places them, which makes it read as a styling bug rather than a layout one.

Hands are `setPlacementRules(zone, true)`; only the score piles pass `false` (right-to-left, starting at `control_width - w`).

**Why:** `card_dimensions["S recto"]` is shared by opponents' hands, all 50 deck piles, every forecast and score back, `#relics` and both achievement rows, so it cannot be patched to resize one zone kind. Replacing the per-zone function is the only lever that reaches one kind alone — and it is what Innovation itself does to a board pile in `refreshSplay`.

**How to apply:** stash `zone.itemIdToCoordsGrid` before replacing it, keep BGA's `delta`/`num_cards_in_row` (guard `num_cards_in_row` with `Math.max(1, …)` if your step is much wider than BGA's, or a narrow board rounds it to zero and `index % 0` is NaN), and restore the original on teardown. See `src/games/innovation/simplified_cards.ts`'s `resizeHandZones`. Related: [[project_innovation_card_dom]].
