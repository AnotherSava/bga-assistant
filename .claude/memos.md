# Memos

_No open memos._
- [x] 2026-07-28 16:59 — extend chrome store description from Game assistant for Board Game Arena
- [x] 2026-08-07 17:28 — extension history doesnt update upon game events
- [ ] 2026-08-07 17:40 — try transparent icons
- [x] 2026-08-08 18:26 — if user opens the table and his action is required during the opponents turn change top bar background
- [x] 2026-08-10 14:18 — fix eye menu layout to maintain size and position while changing police-line movement speed
- [x] 2026-08-22 22:50 — Handle BGA's three bulk card-removal notifications, which the Innovation engine has never processed: removedHandsBoardsAndScores (Fission, base age 9), removedTopCardsAndHands (DeLorean) and removedPlayer (Exxon Valdez) — plus revealed → removed, which currently throws "Unknown zone in transfer". They used to leave a silently stale hand; since the position audit they throw at the next insert instead, so a real game reaching Fission now hard-fails with a downloadable archive. Grep finds none of those strings in src/.
