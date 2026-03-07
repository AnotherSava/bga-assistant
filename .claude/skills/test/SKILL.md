---
name: test
description: Run regression tests for the Innovation tracker extension.
allowed-tools: Bash(npm test*), Bash(npm run test*), Read, Glob, Grep
---

# Run Regression Tests

Run the test suite and report results.

## Workflow

### Step 1: Run tests

```
npm test
```

### Step 2: Report results

If all tests pass, report success with a short summary.

If any tests fail, analyze the failure:
1. Read the vitest output carefully — note which test(s) failed and the assertion diff
2. Read the relevant test and source files to understand the mismatch
3. Explain **what** changed and **why** it likely changed (recent code modifications)
4. Suggest whether the test expectations need updating or the code change introduced a bug
