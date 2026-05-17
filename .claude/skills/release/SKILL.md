---
name: release
description: Bump the extension version, tag the commit, push to trigger CI, and verify the GitHub release. Use this skill whenever the user mentions preparing a release, bumping versions, writing release notes, tagging a release, or publishing the extension.
allowed-tools: AskUserQuestion, Bash(git status --porcelain), Bash(git branch --show-current), Bash(git fetch origin *), Bash(git rev-list *), Bash(git describe --tags *), Bash(git log *), Bash(git tag *), Bash(git push origin *), Bash(git add manifest.json package.json), Bash(git commit -S -m *), Bash(gh run list *), Bash(gh run watch *), Bash(gh run view *), Bash(gh release view *), Bash(gh release edit *), Bash(gh release create *), Bash(gh repo view *), Bash(node -p *)
---

# Release

Tag the current `main` commit as `vX.Y.Z`, which triggers `.github/workflows/build.yml` to build the extension and publish the zip as a GitHub Release. The version in `manifest.json` and `package.json` must match the tag — the workflow fails fast on mismatch.

## Context

- Working tree clean?: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Fetch remote: !`git fetch origin main`
- Unmerged remote commits: !`git rev-list HEAD..origin/main --count`
- Unpushed local commits: !`git rev-list origin/main..HEAD --count`
- Latest tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "(none)"`
- Manifest version: !`node -p "require('./manifest.json').version"`
- Package version: !`node -p "require('./package.json').version"`

## 1. Check preconditions

Run all of these checks and stop with an error if any fail. Do NOT assume state from earlier in the conversation:

- Working tree must be clean
- Must be on `main`
- Local main must be in sync with origin (no unpushed, no unmerged)
- `manifest.json` version must equal `package.json` version

## 2. Determine version

1. Read the latest tag and the current manifest version (both shown in Context).
2. Compare:
   - If `manifest.version > latest-tag.version`: the bump is already committed. Use `manifest.version` as the release version, skip to step 4.
   - Else: ask the user for the new version. Recommend patch / minor / major based on `git log <latest-tag>..HEAD --oneline`. Tag format is `vX.Y.Z`.

## 3. Bump version (if needed)

If the manifest version equals the latest tag, bump both files atomically:

- Edit `manifest.json` `"version"` field
- Edit `package.json` `"version"` field
- Commit with GPG signature: `git commit -S -m "chore: bump version to X.Y.Z"`
- Push to main: `git push origin main`

Use Edit tool for the bumps — do not regenerate the files.

## 4. Compile release notes

Build the notes from `git log <latest-tag>..HEAD --oneline` (or all commits if no prior tag).

- One bullet per commit, in chronological order (oldest first)
- Strip the conventional-commit type prefix (`feat:`, `fix:`, `refactor:`, etc.) and capitalize the first letter
- Group closely related commits into a single bullet only if obvious
- Skip pure-internal commits with no user-visible effect (CI tweaks, doc-only changes, internal refactors)

Present the draft to the user and ask for confirmation or edits. Do not push the tag until approved.

## 5. Create and push tag

Only after the user confirms:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag push triggers the `build.yml` workflow's release job, which packages the extension and creates the GitHub Release with the zip attached.

## 6. Monitor CI

Poll the workflow run until it completes:

```bash
gh run list --branch vX.Y.Z --limit 1 --json databaseId,status,conclusion
gh run watch <run-id>
```

If the run fails, show the logs and stop:

```bash
gh run view <run-id> --log-failed
```

## 7. Verify release and update notes

Once CI succeeds:

1. Confirm the release exists with the zip attached:
   ```bash
   gh release view vX.Y.Z --json tagName,assets
   ```

2. Replace the auto-generated notes with the drafted notes:
   ```bash
   gh release edit vX.Y.Z --notes "..."
   ```

3. Print the release URL:
   ```bash
   gh release view vX.Y.Z --json url --jq .url
   ```

## Checklist

Before tagging:
- [ ] Working tree clean, on main, in sync
- [ ] `manifest.json` and `package.json` versions match
- [ ] Release notes drafted and reviewed

After tagging:
- [ ] CI workflow green (build + release jobs)
- [ ] GitHub Release created with `bga-assistant-X.Y.Z.zip` attached
- [ ] Release notes replaced via `gh release edit`
- [ ] Zip downloaded and ready for Chrome Web Store upload
