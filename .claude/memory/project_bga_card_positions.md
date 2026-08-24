---
name: project_bga_card_positions
description: BGA Innovation's position_from/position_to name the exact card in a hidden zone — semantics per zone, verified against innovation.game.php
metadata:
  type: project
---

Every `transferedCard` packet carries `position_from` / `position_to`, and they are the true DB values — never scrubbed for hidden cards. Source of truth: `transferCardFromTo()` in `innovation.game.php` (micahstairs/bga-innovation, `main-dev`, ~line 1250-1400).

Stack keying, straight from the SQL filters:
- **hand / score / forecast / relics** — one stack per `(owner, location, type, age, is_relic)`. Insert takes `position = COUNT(*)` (append); removal runs `position = position - 1 WHERE position > position_from` (close the gap). So the index identifies one specific card even when `name` is null — this is what lets the tracker follow anonymous returns.
- **deck** — per `(type, age)`, numbered from the **bottom**: the top card has the highest position, `bottom_to` inserts at 0 and shifts everything up.
- **board** — per `(owner, color)`. **revealed / display** — per owner only, all ages and sets in one stack.
- **achievements** — the shared pool is keyed by `(type, age)`; a player's own pile is not.

Melds and reveals report real positions too (they only *look* like a constant 0 because the mover usually takes the front card and the gap closes behind it). `bottom_to` — which renumbers the stack and inserts at 0, making the reported index meaningless — is only ever passed for a board tuck or a deck return; no call site bottom-inserts into hand, score or forecast, so an index into those always means "appended here".

That makes `position_to` a free audit of our own bookkeeping: on an appending insert it equals the size of the destination stack in BGA's model, so a disagreement means we are tracking a different stack (`verifyDestinationSize`). Verified by replaying two full captures against an independent append/gap-close simulation: 35/35 and 20/20 named removals land on the right slot, 43/43 and 32/32 insert indexes match — provided the unlogged opening deal is seeded the way `initGame` seeds it.

**Reading an index makes the zone ordered, and that has a price.** Whatever we index into must go in `isOrderedContainer`, or `hiddenSinglesPerContainer` keeps committing a name to whichever slot it likes and the index reads the coin flip back as a fact. Same for every other unevidenced slot pin: `resolveHand` used to assign the opening deal's names in `Set` order and is backwards in the committed `bgaa_823235522` capture; named removals used to take the first card that *could* be the named one, which permutes the stack for good whenever a card that cannot be it sits in between. Both now go through the index, and the name/index pair cross-checks itself on every meld.

Consequences worth remembering: cards known only as a set stay pooled instead of resolving one-per-slot, so **naked-N tuples are live now** — the deal pools names before anything resolves them, which is exactly the break [[project_innovation_candidate_invariant]] predicted. The audit also forced BGA's three bulk wipes to be handled, since an unswept hand fails the next insert; they are now `RemovalEntry` log entries feeding a "removed" zone (see [[project_bga_bulk_removals]]).

The reverse-walk in `deduceInitialHand` cannot see a sweep, so after one the observer's opening hand comes back short — `resolveHand` therefore declines to narrow a stack whose names it cannot account for in full, rather than pinning the survivors to slots BGA indexes.

Consumed as `TransferEntry.sourcePosition` / `destPosition`; see [[project_innovation_deck_order]] for deck ordering.
