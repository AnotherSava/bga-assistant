---
created: 2026-08-22 22:50
---

# Handle BGA's three bulk card-removal notifications, which the Innovation engine has never…

Handle BGA's three bulk card-removal notifications, which the Innovation engine has never processed: removedHandsBoardsAndScores (Fission, base age 9), removedTopCardsAndHands (DeLorean) and removedPlayer (Exxon Valdez) — plus revealed → removed, which currently throws "Unknown zone in transfer". They used to leave a silently stale hand; since the position audit they throw at the next insert instead, so a real game reaching Fission now hard-fails with a downloadable archive. Grep finds none of those strings in src/.
