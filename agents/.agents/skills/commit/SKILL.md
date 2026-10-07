---
name: commit
description: Use when asked to suggest a Git commit message, stage changes, or create atomic commits. Match the author's recent style and preserve index intent; commit only when explicitly requested.
---

# Commit

Inspect before asking the user to identify files. Do not perform or delegate a code review or modify source files as part of this workflow. Run tests only when asked; commit hooks may still run them.

Invoking this skill without arguments requests a message, not staging or a commit. Distinguish message-only, stage-only, and explicit commit requests before changing the index. Create commits only when the user's current request explicitly asks for them; a completed earlier request is not standing permission.

## Inspect

1. Run `git status --short --untracked-files=all`.
2. If anything is staged, read `git diff --cached --stat` and the full `git diff --cached`. For message-only requests, staged changes are the complete scope unless the user says otherwise.
3. If nothing is staged, or the user explicitly includes unstaged changes in the request, read `git diff --stat`, the full `git diff`, and relevant untracked text files. Do not treat binary or generated files as text.
4. If there are no changes in scope, say `No changes to commit.` or `No changes to stage.`, as appropriate, and stop. Ask if the requested scope remains unclear after inspection.
5. When preparing messages, read `git config --get user.name` and `git config --get user.email`. Inspect up to 20 recent subjects authored by that user, checking affected paths before repository-wide history.

## Group and Protect the Index

Group by intent, not file. Keep implementation, tests, and required configuration for one change together. Separate unrelated fixes, refactors, or tooling changes; order dependent commits safely.

Treat the existing index as intentional:

- Do not unstage changes without confirmation.
- Do not add unstaged changes to a staged commit unless the user clearly included them and they share its intent.
- If staged changes mix unrelated intents, propose a split and ask before changing the index.
- Never stage likely secrets or credentials; stop and flag them.
- If conflicts exist or a safe atomic split is unclear, stop and ask.

## Write Messages

Match the current user's subjects for the affected area, then their repository-wide style: prefix, scope, capitalization, tense, and punctuation. Do not copy other contributors' conventions. If no matching history exists, use a short plain-English imperative subject without a type/scope prefix, body, or trailing period.

Describe the purpose or behavior, not the editing mechanics. Match formatting conventions without copying unclear wording. Use direct verbs and precise technical terms with explicit relationships; clarity matters more than the shortest possible subject. Preserve the diff's actual scope and guarantees.

Read the subject without the diff: can a reader tell what changes and when? Prefer `rebuild only when the manifest is older than its source files` over `gate rebuild on stale manifest detection`.

## Act on the Request

### Message only

Do not stage, modify files, run tests, review code, or commit. For one coherent change, return only the recommended message. For unrelated changes, return an ordered plan with messages and their files or hunks. Provide alternatives or explanation only when requested.

### Stage only

Stage only the requested files or hunks, preserving existing staged work. Avoid broad staging commands when unrelated changes exist. If staging several proposed groups would mix unrelated intents, ask which group to stage first.

Inspect the resulting staged diff and report what is staged and what remains unstaged. Do not create a commit.

### Commit

For each requested atomic group, confirm it matches the inspected scope, stage only its files or hunks, inspect the staged diff, and commit with the inferred message. Avoid broad staging commands when unrelated changes exist.

Report each short hash and subject, plus any changes left uncommitted. Do not amend, create empty commits, bypass hooks, force, or push unless explicitly requested.
