---
name: project_gate_test_load_sensitive
description: The slowest sidepanel test failed the commit gate under concurrent load on vitest's 5s default, with nothing wrong in the change set; vite.config.ts now sets testTimeout to 15s suite-wide
metadata:
  type: project
---

The "populates turn-history element during render" case in `src/__tests__/sidepanel_ui.test.ts` reads
a file from disk and renders, taking about 1.8 s on its own against vitest's 5 s default. Under
concurrent load it crosses that and fails as `Test timed out in 5000ms`, which reads exactly like a
regression in whatever was just changed.

Measured 2026-10-06: `.claude/commit-checks.sh` failed on it at 5575 ms while a 14-agent workflow was
running on the same machine. The test passed alone at 1792 ms, and the full gate then passed
1205/1205 once nothing was competing. The change set that provoked it touched no file under `src/`.

**Why:** a timeout is the one failure mode that carries no information about the code, so reading it
as a regression sends the next session hunting a defect that is not there — and the gate runs exactly
when other work is most likely to be in flight.

**How to apply:** `vite.config.ts` now sets `testTimeout: 15000`, which is the fix — it covers every
test in the suite rather than this one, since nothing makes this case special beyond being the
slowest. A timeout failure after that means a slowdown well past the 3x already measured, so treat
it as real: re-run the case alone first, then the gate with nothing else running, and investigate if
it still fails idle.
