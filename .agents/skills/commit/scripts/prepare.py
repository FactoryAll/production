#!/usr/bin/env python3
"""
prepare-commit.py — deterministic pre-commit hygiene check.

1. Prints `git status --short`.
2. Identifies untracked files/directories that usually belong in `.gitignore`.
3. If `.gitignore` is missing or incomplete, appends the required patterns.
4. Prints the updated `git status --short` so the agent sees the clean state.
"""

import subprocess
import sys
import os
from pathlib import Path

# Patterns to watch for and their corresponding `.gitignore` lines.
TRIGGERS = [
    # (basename to match, gitignore line(s) to add)
    ("node_modules", "node_modules/"),
    (".env", ".env\n.env.*\n!.env.example"),
    (".envrc", ".envrc"),
    ("dist", "dist/\nbuild/"),
    ("build", "build/"),
    (".venv", ".venv/\nvenv/"),
    ("__pycache__", "__pycache__/\n*.pyc"),
    (".pytest_cache", ".pytest_cache/"),
    (".DS_Store", ".DS_Store"),
    (".idea", ".idea/\n.vscode/"),
    ("coverage", "coverage/"),
    (".coverage", ".coverage"),
    (".tmp", "*.tmp"),
]


def git_status() -> str:
    result = subprocess.run(
        ["git", "status", "--short"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("Error: not inside a Git repository.", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def collect_untracked(status: str) -> list[str]:
    files = []
    for line in status.strip().splitlines():
        if line.startswith("?? "):
            files.append(line[3:])
    return files


def match_patterns(files: list[str]) -> set[str]:
    needed: set[str] = set()
    for f in files:
        basename = os.path.basename(f)
        for trigger, pattern in TRIGGERS:
            if basename == trigger or f"/{trigger}" in f or f"{trigger}/" in f:
                for line in pattern.splitlines():
                    if line:
                        needed.add(line)
                break
    return needed


def ensure_gitignore_patterns(patterns: set[str]) -> int:
    gitignore = Path(".gitignore")
    existing: set[str] = set()
    if gitignore.exists():
        existing = {line.strip() for line in gitignore.read_text().splitlines()}

    to_add = sorted(patterns - existing)
    if not to_add:
        return 0

    with gitignore.open("a") as fh:
        fh.write("\n".join(to_add) + "\n")
    return len(to_add)


def main() -> int:
    # Move to repo root so paths are stable
    repo_root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], text=True
    ).strip()
    os.chdir(repo_root)

    print("=== Git Status ===")
    status = git_status()
    print(status, end="")
    print()

    untracked = collect_untracked(status)
    if not untracked:
        print("Working tree clean. Nothing to prepare.")
        return 0

    needed = match_patterns(untracked)
    if not needed:
        return 0

    added = ensure_gitignore_patterns(needed)
    if added:
        print(f"Added {added} ignore pattern(s) to .gitignore")
        print()
        print("=== Updated Git Status ===")
        print(git_status(), end="")

    return 0


if __name__ == "__main__":
    sys.exit(main())
