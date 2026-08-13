---
name: commit
description: Prepare Git commit messages and create commits when explicitly requested. Use when asked to suggest a commit message, stage changes, commit changes, or split work into atomic commits while matching the repository's recent commit style.
---

# Commit

Inspect the repository and act immediately. Do not delegate to a reviewer or perform a code review. Do not run tests unless the user asks; commit hooks may still run them.

Invoking this skill without arguments requests a message, not a commit. Create a commit only when the user's current request explicitly asks for one.

## Inspect

1. Run `git status --short --untracked-files=all`.
2. If anything is staged, inspect `git diff --cached --stat` and the full `git diff --cached`. For a message-only request, staged changes are the complete scope unless the user says otherwise.
3. If nothing is staged, inspect `git diff --stat`, the full `git diff`, and relevant untracked text files. Do not treat binary or generated files as text.
4. If there are no changes in scope, respond with `No changes to commit.` and stop.
5. Read the current identity with `git config --get user.name` and `git config --get user.email`. Inspect up to 20 recent subjects authored by that user, checking the affected paths first and then the repository-wide history.

Do not ask the user to identify files or repeat the workflow before performing this inspection.

## Plan Atomic Commits

Group changes by intent, not merely by file. Keep implementation, tests, and required configuration for one change together. Separate unrelated fixes, refactors, or tooling changes, and order dependent commits safely.

Treat the existing index as intentional:

- Do not unstage staged changes without confirmation.
- Do not add unstaged changes to a staged commit unless the user clearly included them and they belong to the same intent.
- If staged changes mix unrelated intents, show the proposed split and ask before changing the index.
- Never stage likely secrets or credentials. Stop and flag them.

## Match Commit Style

Match the current user's commits, not other contributors' commits. Prefer that user's style for the affected area, then their repository-wide style, including subject prefix, scope, capitalization, tense, and punctuation.

If no commits by the current user are found, use a short plain-English imperative subject with no type or scope prefix, body, description, or trailing period.

Describe why the repository changed, not the mechanics of editing. Keep each subject concise and specific.

## Message-only Requests

Do not stage files, modify files, run tests, review code, or commit.

- For one coherent change, return only the recommended message.
- For multiple unrelated changes, return a short ordered plan with each proposed message and its files or hunks.
- If the user asks for alternatives or an explanation, provide them without changing the repository.

## Commit Requests

When the user explicitly asks to commit:

1. Confirm the planned atomic groups from the inspected changes.
2. Stage only the files or hunks for the next group. Avoid broad staging commands when unrelated changes exist.
3. Inspect the staged diff before each commit and verify it contains exactly that group.
4. Commit with the inferred message, then repeat for the remaining groups the user requested.
5. Report each short hash and subject, followed by a concise note about any changes left uncommitted.

Do not modify source files as part of this workflow. Do not amend, create an empty commit, bypass hooks, force, or push unless explicitly requested. If conflicts exist or a clean atomic split is unsafe, stop and ask how to proceed.
