Pick up where the previous session left off.

1. Determine the workspace root:
   - If this is a git repo, use the git top-level directory.
   - Otherwise, use the current working directory.
2. Read `<workspace-root>/_notes/HANDOFF.md`.
3. If it is not found, search once under `<workspace-root>` for `**/_notes/HANDOFF.md` before concluding it is missing. If still missing, say so and ask if I want to proceed without it.
4. Synthesize a concise briefing:
   - What is completed
   - What is in progress
   - Any blockers or important decisions
5. Check git state (branch, status, recent commits) as supplementary context.
6. Propose 2-3 logical next actions and ask which one to pursue.

Do not make any changes until I confirm which action to take.
