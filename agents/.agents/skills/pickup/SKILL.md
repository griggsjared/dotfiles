---
name: pickup
description: Resume repository work from _notes/HANDOFF.md, explain the verified state and next-step tradeoffs, and ask the user what to start. Use when asked to pick up prior work, continue from a handoff, restore session context, or choose the next task.
---

# Pickup

Read and verify `_notes/HANDOFF.md`, then continue from its current state.

## Load Context

1. Look for `_notes/HANDOFF.md` relative to the current working directory.
2. If it does not exist, state that there is no handoff to pick up and stop. Do not create one in this skill.
3. Read the handoff completely.
4. Read all applicable repository guidance files.
5. Read the canonical plans and notes linked by the handoff when they affect the requested or next task.

## Verify

Before relying on the handoff, inspect:

- `git status --short --untracked-files=all`
- the current branch and exact `HEAD`
- staged and unstaged diffs, including relevant untracked text files
- the files named in the current-work and next-step sections
- recent commits when `HEAD` or completed-work claims differ

Call out stale or conflicting handoff content. Current repository state wins over the handoff. Do not repeat validation commands merely because the handoff records them.

## Explain the State

Before asking what to do next, give the user enough context to choose without reading the handoff themselves. Aim for roughly 200–400 words unless the repository state genuinely needs more.

Summarize:

- the current goal and what is already complete
- committed and uncommitted work, including its verification state
- the decisions, blockers, or dependencies that affect what should happen next

Then explain 2–4 reasonable next steps. Give each option 2–3 sentences covering:

- what outcome it produces
- why it is ready now or what it depends on
- its main scope, risk, or tradeoff

Use concrete class or file names only when they help the decision. Recommend one option and give a short reason. Do not provide a full implementation plan or repeat every handoff detail.

## Ask What to Start

When the user invokes pickup without an explicit task, calling the interactive question tool is mandatory.

1. Explain the state and options first.
2. Call the interactive question tool with 2–4 option labels that match the explained options.
3. Keep picker descriptions to one useful line.
4. Do not end the turn after only printing directions or a numbered list.
5. Do not choose an option for the user, even when one is recommended.

If only one implementation step appears available, ask whether to start it or inspect/replan first. If the interactive question tool is unavailable, ask the same choice directly and stop for the answer.

## Continue

- If the user supplied a task with the pickup request, explain the relevant handoff context and any conflict before performing it; no additional picker is required.
- After the user selects an option, preserve the handoff's decisions, invariants, scope boundaries, and deferred work unless the user explicitly changes them.
- Follow normal repository guidance before editing, testing, or delegating.

## Rules

- Do not rewrite `_notes/HANDOFF.md` unless the user separately asks to update the handoff.
- Do not assume uncommitted files, commits, branches, tests, or blockers still match the handoff; verify them.
- Do not expose secrets, credentials, environment-file contents, provider payloads, client tokens, or personal access data found while inspecting the repository.
- Do not treat planned behavior as implemented or old verification as current.
- Give enough context for a decision, then stop. Do not paste or paraphrase the entire handoff.
