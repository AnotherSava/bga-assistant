---
name: feedback-tests-no-gitignored-data
description: Committed tests must not read from the gitignored data/ folder; inline a reproducer or copy the file into committed __tests__/fixtures/
metadata: 
  node_type: memory
  type: feedback
---

A committed test must not read files from `data/`. Use an inline reproducer, or copy the needed file into the game's committed fixtures dir (`src/games/<game>/__tests__/fixtures/`) and commit it, then load it from there.

**Why:** `data/` is gitignored. It is the intended, correct place to download game archives for investigation (e.g. via `/investigate`) — that's its purpose, nothing wrong with it. But a committed test that reads from it passes on the author's machine and fails for everyone else and in CI, where those files don't exist.

**How to apply:** When writing a regression test, keep the test self-contained — inline the minimal moves, or commit a small fixture under `__tests__/fixtures/`. Downloading/extracting archives into `data/` for the investigation itself is fine; just don't let the committed test depend on them.
