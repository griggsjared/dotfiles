---
name: handoff
description: Create or refresh _notes/HANDOFF.md with the current repository state for another agent or future session. Use when asked to prepare or update a handoff, capture context, summarize work in progress, or preserve decisions, verification, blockers, and next steps.
---

# Handoff

Create a concise, self-contained snapshot that lets another agent continue without reconstructing the session.

Always write the handoff to `_notes/HANDOFF.md` relative to the current working directory. Create `_notes/` when it does not exist.

## Inspect

1. Read all applicable repository guidance files.
2. Read `_notes/HANDOFF.md` completely when it already exists.
3. Read relevant plans and notes referenced by the current task or existing handoff. Do not inventory unrelated documentation.
4. Inspect:
   - `git status --short --untracked-files=all`
   - the current branch and exact `HEAD`
   - staged and unstaged diffs, including relevant untracked text files
   - recent commits that explain the current work
5. Use the conversation for decisions, commands, test results, and deferred work that may not exist in the repository.
6. Inspect only enough surrounding code to identify exact names and paths. Do not restart the implementation or conduct a code review.

## Write

Create `_notes/` if needed, then create or rewrite `_notes/HANDOFF.md`. Refresh an existing handoff as a current snapshot instead of appending a session diary.

Include only sections that help the next agent:

- updated date
- current goal and scope
- branch and exact committed `HEAD`, when in a Git repository
- current uncommitted files and what each change does
- completed work and relevant commit hashes
- decisions and invariants that constrain implementation
- validation actually run, with exact results
- known blockers, failures, and deferred work
- ordered next steps
- links to canonical local plans or notes

Separate committed behavior from uncommitted work. Separate verified facts from planned behavior. Preserve exact class, method, command, status, and file names.

## Rules

- Do not modify source code, tests, configuration, or any file outside `_notes/HANDOFF.md`.
- Do not stage, commit, amend, push, fetch, or change branches.
- Do not run tests or quality tools solely to create the handoff. Record only commands and results that actually ran during the session or are clearly identified in existing notes.
- Do not claim the full suite passes when only focused tests ran. Include dates or qualifying language for older broad verification.
- Do not include secrets, credentials, environment-file contents, provider payloads, client tokens, or personal access data.
- Do not paste large diffs, logs, stack traces, or conversation transcripts. Summarize them and keep exact errors only when they remain actionable.
- Remove stale statements that current code, Git state, or later decisions disprove.
- Keep the file useful after context compaction. Prefer concrete facts over narrative.
- If the working directory is not a Git repository, omit Git-specific sections and record that limitation.

## Finish

Read the completed handoff once, check that paths and status claims match the repository, and report:

- the path written
- whether it was created or refreshed
- whether Git tracks or ignores it

Do not recap the handoff contents unless the user asks.
