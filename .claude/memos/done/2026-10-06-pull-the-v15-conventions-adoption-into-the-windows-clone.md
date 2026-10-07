---
created: 2026-10-06 19:05:04
platform: windows
---

# Pull the v15 conventions adoption into the Windows clone rather than running /adopt

The record in .claude/conventions here is committed at v15 and pushed as of 9d0cbff. Until that clone pulls, its own copy still reads 11, so its session-start notice will report 4 conventions behind — which is the state that invites a second walk.

Running /adopt there would migrate v12 through v15 again from the same base and write a second record claiming v15, the conflict /adopt names in its hand-to-commit section. Every migration is already in the merged tree, so the clone needs nothing but the commits.

Measured 2026-10-06: the automatic pull request /commit sends was refused with unknown_project. The dashboard showed CHROME reachable, heartbeat 27 s, nothing unreadable, and no session open in this project — so there was no session there to receive it.
