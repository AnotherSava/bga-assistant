---
name: project_bga_bulk_removals
description: BGA Innovation's four ways of taking cards out of the game, their notification shapes, and which zones each one clears
metadata:
  type: project
---

Four things put Innovation cards in `location = 'removed'`. Three are raw SQL sweeps that name no cards and send one notification for the lot; only the fourth is an ordinary transfer. Verified in `innovation.game.php` (micahstairs/bga-innovation, `main-dev`) — a grep for `UPDATE card SET … location` outside `transferCardFromTo` finds exactly these three plus deck setup, so the list is complete.

| Card | Notification | SQL / args | Zones cleared |
|---|---|---|---|
| Fission (base 9, id 88) | `removedHandsBoardsAndScores`, args `{}` | `WHERE location IN ('hand','board','score','revealed')` | every player's hand, board, score **and revealed** — the age-10 card the effect just drew is in `revealed`, so it always goes too. Forecasts, displays, achievements and decks survive |
| DeLorean DMC-12 (Artifacts 10, id 213) | `removedTopCardsAndHands`, args carry `top_cards_to_remove` | `location='hand'` + `MAX(position)` per `(owner,color)` | every hand, plus the top card of each board pile. The tops are face up, so BGA lists their rows (keyed by card id — resolve names through `gamedatas.cards`, which is the full 466-card static catalogue) |
| Exxon Valdez (Artifacts 10, id 207) | `removedPlayer`, args carry `player_to_remove` | `WHERE owner = {player_id}` | everything that player owns: hand, board, score, revealed, forecast, display **and their claimed achievements**. Our achievements pool is unattributed, so the claimed ones cannot be picked out — harmless, since they stay unresolved in the group either way |
| The Big Bang (Artifacts 9, id 203) | ordinary `transferedCard` | `transferCardFromTo($card, 0, 'removed')` | one named card, `revealed → removed` |

All three sweeps arrive with a `_spectator` twin on the table channel — `notifyAllPlayersBut` always emits one, and `notifyAll` is just `notifyAllPlayersBut(array(), …)` — so reading the sweep from the spectator copy sees it exactly once and in step with the transfers around it. `removedPlayer` goes out via `notifyPlayer` to the victim *and* `notifyAllPlayersBut` to the rest, which is where its spectator copy comes from.

Removed cards keep their place in their (age, set) group in `state.removed`: one swept face-down out of a hand left unidentified, and its possible names must leave with it rather than falling back to the cards still in play. See [[project_bga_card_positions]] for why an unhandled sweep is now a thrown error rather than a silently stale hand.
