---
name: innovation-debug
description: Debug a game state discrepancy reported by the user. Extracts archive, analyzes all pipeline stages, creates a failing regression test with correct expectations, fixes the logic, and verifies the fix.
argument-hint: <archive-or-table-id> <description-of-discrepancy>
allowed-tools: Bash(unzip *), Bash(ls *), Bash(mkdir *), Bash(npm test*), Bash(npm run test*), Bash(npm run build*), Bash(npm run lint*), Read, Write, Edit, Glob, Grep, Agent
---

# Debug Game State Discrepancy

Investigate a user-reported discrepancy in the Innovation tracker output, create a regression test, and fix the bug.

## Input

`$ARGUMENTS` should contain:
1. An archive filename (e.g. `bgaa_816598364.zip`) or just a table ID (e.g. `816598364`). If a bare table ID is given, the archive is `data/bgaa_<TABLE_ID>.zip`.
2. A description of the discrepancy the user noticed

If either is missing, ask the user.

## Workflow

### Step 1: Extract archive

Resolve the archive path from the argument (filename or table ID). Derive the folder name by stripping `.zip` (e.g. `bgaa_816598364`).

```
mkdir -p data/<FOLDER>
unzip -o data/<ARCHIVE> -d data/<FOLDER>
```

The archive contains up to 4 files:
- `raw_data.json` — raw BGA packet extraction (input to `processRawLog`)
- `game_log.json` — structured game log (output of `processRawLog`, input to `GameState.processLog`)
- `game_state.json` — serialized game state (output of `GameState.toJSON`)
- `summary.html` — rendered HTML summary

### Step 2: Analyze the discrepancy

Read the relevant files from `data/<FOLDER>/` to understand the reported issue. Work backwards from the symptom:

1. **Summary HTML** — confirm the user's observation visually (search for the specific cards/sections mentioned)
2. **game_state.json** — check the serialized state for the problematic zone (decks, hands, scores, etc.)
3. **game_log.json** — trace the transfers that led to the bad state; look at `players`, `currentPlayerId`, `myHand`, and the `log` entries
4. **raw_data.json** — if the game_log looks wrong, check whether `processRawLog` misinterpreted raw BGA packets

Identify which pipeline stage introduced the error:
- **raw_data.json is wrong** → extraction bug in `src/extract.ts` — fix the extraction script, then ask the user to reload the extension and re-download the data
- **game_log.json is wrong** → `processRawLog` in `src/engine/process_log.ts` has a bug
- **game_state.json is wrong but game_log is correct** → `GameState` logic in `src/engine/game_state.ts` has a bug
- **summary.html is wrong but game_state is correct** → rendering bug in `src/render/summary.ts`

Document your findings clearly before proceeding.

### Step 3: Determine the correct expected output

Based on your analysis:
- Determine what the **correct** output should be at the buggy stage
- For game_state bugs: figure out the correct card locations, candidate sets, or opponent knowledge
- For process_log bugs: figure out the correct structured log entries
- For render bugs: figure out the correct HTML output

Be specific — identify exact card names, ages, sets, zones, and players involved.

### Step 4: Create a regression test

Create or extend a test in `src/__tests__/` that:
1. Loads the relevant input data from the archive (read it from `data/<FOLDER>/`)
2. Runs the buggy pipeline stage
3. Asserts the **correct** expected output (not the current buggy output)

**Test patterns to follow** (see existing tests in `src/__tests__/game_state.test.ts`):

- For **game_state bugs** — feed the game_log entries into `GameState.processLog()` and assert the resulting state
- For **process_log bugs** — feed raw packets into `processRawLog()` and assert the structured log
- For **render bugs** — build a `GameState` (or use `GameState.fromJSON`), render, and assert HTML content

**Test data strategy:**
- For small reproducers: inline the minimal log entries needed to trigger the bug
- For complex bugs requiring full game context: load `game_log.json` from the fixture and run the full pipeline, then assert the specific problematic part of the output

When loading fixture data, use the pattern:
```typescript
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const thisDir = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(thisDir, "../../data/<FOLDER>/game_log.json"), "utf-8"));
```

Name the test descriptively based on the bug, e.g.:
```typescript
describe("bug: age 3 cards appearing in age 4 deck", () => { ... });
```

### Step 5: Verify the test fails

```
npm test
```

Confirm that the new test fails with an assertion error that matches the known buggy behavior. If the test passes, the test is not correctly capturing the bug — revisit Step 4.

### Step 6: Fix the bug

Modify the source code to fix the bug:
- `src/extract.ts` for extraction bugs — after fixing, ask the user to reload the extension and re-download the data
- `src/engine/process_log.ts` for log processing bugs
- `src/engine/game_state.ts` for game state tracking bugs
- `src/render/summary.ts` or `src/render/config.ts` for rendering bugs

Keep changes minimal and focused on the specific bug.

### Step 7: Verify the fix

```
npm test
```

All tests must pass — both the new regression test and all existing tests.

Then rebuild:
```
npm run build
```

### Step 8: Report

Summarize:
1. **Root cause** — what went wrong and where
2. **Fix** — what was changed
3. **Test** — what the regression test covers
4. **Verification** — test and build results
