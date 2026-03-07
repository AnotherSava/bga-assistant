---
name: commit-ralphex
description: Squash ralphex commits into a single Conventional Commit, push, and create a PR to main.
allowed-tools: Bash(git status*), Bash(git log*), Bash(git diff*), Bash(git reset*), Bash(git add*), Bash(git commit*), Bash(git push*), Bash(git symbolic-ref*), Bash(git rev-parse*), Bash(git branch*), Bash(git fetch*), Bash(git checkout*), Bash(git merge*), Bash(gh pr create*), Bash(ls *), Read, Glob, Grep
---

# Squash Ralphex Commits and Create PR

Squash all commits on the current feature branch into a single Conventional Commit, push, and open a PR to main.

## Workflow

### Step 1: Gather context

1. Determine the main branch:
   ```
   git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'
   ```
   Fall back to `main` if the command fails.

2. Get the current branch name:
   ```
   git rev-parse --abbrev-ref HEAD
   ```
   **Abort if on the main branch.** Tell the user to switch to a feature branch first.

3. Check if the remote branch has commits already merged to main:
   ```
   git fetch origin main
   git log origin/main..origin/<branch-name> --oneline
   ```
   If the remote branch has commits that are ahead of `origin/main`, these were already pushed from a previous session. Fast-forward main to absorb them before squashing:
   ```
   git checkout main
   git merge origin/<branch-name> --ff-only
   git push origin main
   git checkout <branch-name>
   ```
   Then verify the remaining commits with `git log main..HEAD --oneline` — only these will be squashed.

4. List commits to be squashed:
   ```
   git log main..HEAD --oneline
   ```
   Abort if there are no commits ahead of main.

5. Get the full diff for analysis:
   ```
   git diff main...HEAD --stat
   git diff main...HEAD
   ```

6. Find the latest completed plan doc — look in `docs/plans/completed/` for the most recently created file whose name relates to the current branch or the work described in the commits.

7. Find the matching progress log in `.ralphex/progress/`.

8. Read the plan and progress log to understand the scope and intent of the changes.

### Step 2: Draft commit message

Compose a commit message following Conventional Commits format:

```
type(scope): concise summary of the change

Longer description explaining the motivation and what was done.
Summarize the "why" not just the "what". Reference the plan topic.
```

Guidelines:
- **type**: `feat`, `fix`, `refactor`, `docs`, `chore`, etc. — pick based on the primary change
- **scope**: the subsystem affected (e.g. `engine`, `render`, `extract`, `sidepanel`)
- **subject line**: imperative mood, lowercase, no period, max ~72 chars
- **body**: explain what the plan accomplished, key design decisions, and notable implementation details
- Analyze the diff, commit messages, plan doc, and progress log to write a meaningful summary
- Do NOT include any AI attribution or Co-Authored-By trailers

### Step 3: Confirm with user

Display the full drafted commit message and ask the user to approve or revise it. Do not proceed until the user confirms.

### Step 4: Soft reset and commit

1. Squash all commits:
   ```
   git reset --soft main
   ```

2. Stage everything (ralphex may have left untracked files):
   ```
   git add -A
   ```

3. Create the single commit using a heredoc:
   ```
   git commit -F - <<'EOF'
   <approved commit message>
   EOF
   ```

### Step 5: Push and create PR

1. Push the branch:
   ```
   git push -u origin <branch-name>
   ```
   If the branch was already pushed with the old commits, use `--force-with-lease`:
   ```
   git push -u origin <branch-name> --force-with-lease
   ```

2. Create the PR:
   ```
   gh pr create --base main --title "<commit subject line>" --body "<PR description>"
   ```
   The PR body should include:
   - A summary of the changes (derived from the commit body)
   - A reference to the plan document filename

3. Report the PR URL to the user.
