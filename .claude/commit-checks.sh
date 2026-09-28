#!/usr/bin/env bash
# What /commit runs before it will draft a commit plan here. This repo commits straight to main, so
# the Build workflow on GitHub is the first thing that would otherwise read a change, after the push.
#
# The steps after the conventions checker are the ones `.github/workflows/build.yml` runs, in the
# same order: `npm run lint` is the only type check, because `vite build` strips types without
# checking them, so the build proves the bundle and the lint proves the types. Keep the two files in
# step — a check added here belongs in the workflow too, or they disagree about what main requires.
# The workflow's `npm run package` and its tag-versus-manifest check are left out: they gate a
# release, not a commit.
#
# The conventions checker belongs in no workflow: it measures the conventions this repo has adopted
# (`.claude/conventions` says how far), several of which are about files and links that only exist
# on a developer's machine. Nothing else invokes it. It runs first so a convention violation is
# reported before the slower steps.
#
# What a pass does not cover: `scripts/*.ts` sit outside tsconfig's `include`, so the CLI scripts are
# never type-checked, and nothing here loads the built extension into a browser.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The bare `python`, as the hooks call it: `python3` is an indirection on both machines, and on macOS
# it can resolve to the Command Line Tools 3.9 rather than the interpreter the hooks run. A machine
# without `python` fails here rather than skipping the step.
echo "==> conventions check"
python ~/.claude/conventions/check.py .

echo "==> npm run lint"
npm run lint

echo "==> npm run build"
npm run build

echo "==> npm test"
npm test
