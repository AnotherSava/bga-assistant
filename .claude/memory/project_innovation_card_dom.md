---
name: project_innovation_card_dom
description: Innovation's BGA client card DOM and layout constants — what to patch to restyle or resize table cards
metadata:
  type: project
---

Restyling Innovation's table cards means working against its client (`micahstairs/bga-innovation`, `innovation.js`), not our repo. What matters:

**Card identity is in the element id**, format `item_<id>__age_<n>__type_<t>__is_relic_<0|1>__<zone class>` (`getCardHTMLId`), parsed back by `getCardIdFromHTMLId`. Every face-up card already contains its six spot icons, `.card_age` and `.card_title` as children — so restyling needs no card database in the page and no mapping from BGA's card ids to ours.

**Layout is JS-computed, not CSS.** `gameui.card_dimensions["M card"]` (182×126, "CSS + 2" for the border), `gameui.delta.my_hand`, `gameui.overlap_for_splay["M card"]` are the constants everything derives from; BGA writes inline `left`/`top` per card and recomputes on every move, splay and resize. Patch those three and call `gameui.refreshLayout()` — it re-runs hand sizing and `refreshSplay` over every pile, so splay direction, echo-effect visibility and pile-width clamping keep working. Hands and boards use `"M card"`; opponents' hands, score, achievements and decks use `"S recto"` (face-down, nothing to restyle).

**Splay direction is only on `splay_indicator_<pid>_<color>`** as a `splay_<0-3>` class — no DOM relation to the pile, so no selector reaches it from a card. 0=none, 1=left, 2=right, 3=up; left reveals the cards' right edge, right their left edge, up their bottom.

**DOM order is not stack order.** `createAndAddToZone` does `dojo.place(node, start)` and then `addToZone(zone, id, position, …)`: the node is appended to the container while its height in the pile comes from the zone's separate `items` array. A tuck — a card melded to the *bottom*, which Innovation does constantly — is therefore last in the DOM and bottom of the stack. To find a pile's top card, read `zone.items[items.length - 1].id` (BGA's own splay code comments that index as the top card); never a CSS sibling test.

**Arrow icons are one sprite rotated.** `city_special_icon.icon_11/12/13` are left/right/up, drawn from a single image with `transform: rotate(180deg)` (right) and `rotate(90deg)` (up) — so any `transform` of your own replaces the direction. Arrows only ever occupy the two centre spots (`top_center`, `bottom_center`).

**`city_search_icon` is mostly frame.** The magnifier marking a Cities card's top-centre icon is a 45px sprite that is largely a border around the 36px icon, with the magnifier a small badge in one corner — so scaling it to a small cell renders the badge at under 3px. Not salvageable by scaling; replace it.

**Pile chrome is floored at BGA's own card**: `.pile { min-height: 126px }` and `.board { min-height: 171px }`, with the splay arrow a sibling *after* the pile. Both must be restated when cards shrink, or the arrow strands ~80px below them.

**Card names are uppercased into the markup** (`_(card_data.name).toUpperCase()`), so no `text-transform` can restore title case — `gameui.cards[id].name` holds the original. **Text sizes are baked as a `font_size_N` class on an inner `<span>`** by `createAdjustedContent`, which measures against BGA's own card width — override the span, not just the element.

See also [[project_bga_framework_dom_probing]] for BGA's framework chrome, as opposed to a game's own client.
