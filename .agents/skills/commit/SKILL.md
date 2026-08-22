---
name: commit
rank: 200
scope: project
description: >
  Create a Git commit from the current working tree.
  Use when the user asks to commit, save changes, checkpoint, or record progress.
  Stages all tracked and untracked files by default, writes a concise bullet-list
  message, and never pushes or deploys.
---

# Commit

## When to use this skill

Use when the user asks to:
- Commit changes
- Save progress / checkpoint
- Record modifications in Git

## Instructions

1. **Prepare the working tree**
   Run the deterministic preparation script:
   ```bash
   python3 .agents/skills/commit/scripts/prepare.py
   ```
   - Prints `git status --short`.
   - Automatically creates or appends to `.gitignore` when common artifacts
     (e.g. `node_modules/`, `.env`, `dist/`, `.venv/`) are untracked.
   - Re-prints the updated status so you can verify the tree is clean.

2. **Stage all changes**
   ```bash
   git add .
   ```
   This stages every tracked and untracked file in the working directory.

3. **Write the commit message**
   - Use a **concise bullet list** describing what changed.
   - Do **not** include an explicit author (`--author`).
   - Do **not** mention AI, assistants, or tooling.
   - Keep the first line under 72 characters.

4. **Create the commit**
   ```bash
   git commit -m "- <change summary>"
   ```
   If additional lines are needed, pass them as extra `-m` arguments:
   ```bash
   git commit -m "- <first change>" -m "- <second change>"
   ```

5. **Do not push or deploy**
   - Stop after the commit is created.
   - Do not run `git push`, `git pull`, or any deploy commands.

## Examples

### Basic commit

```bash
git status --short
git add .
git commit -m "- add user authentication module" -m "- implement JWT token refresh"
```

### Commit with `.gitignore` cleanup

```bash
git status --short
# Noticed: `node_modules/` and `.env` are untracked
# Created .gitignore first, then:
git add .
git commit -m "- initial project setup with auth and db config"
```

## Error handling

| Situation | Action |
|---|---|
| Working tree is clean | Inform the user: "Нет изменений для коммита." |
| Uncommitted files that should be ignored | Update `.gitignore`, then stage and commit. |
| Commit fails (e.g. merge conflicts) | Abort and report the error without retrying silently. |

## Edge cases

- **Large generated directories**: If `git status` shows directories like
  `dist/`, `node_modules/`, or `.venv/`, add them to `.gitignore` before committing.
- **Binary or lock files**: Commit them only if they are intentional deliverables.
- **Empty commits**: Do not create empty commits (`git commit --allow-empty`) unless
  explicitly requested.
