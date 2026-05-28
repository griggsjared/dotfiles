Write a handoff to `<workspace-root>/_notes/HANDOFF.md` for the next agent to pick up.

Before writing, determine the workspace root:
- If this is a git repo, use the git top-level directory.
- Otherwise, use the current working directory.

Include:
- **Summary** — what this session accomplished
- **Completed** — fully done tasks
- **In Progress** — unfinished work with enough detail to resume
- **Blockers / Decisions** — dependencies, trade-offs, known issues, or context not visible in code
- **Next Steps** — prioritized list for the next agent
- **Files Touched** — key files modified or created (only if not obvious from git)

Create `<workspace-root>/_notes/` if it does not exist. Overwrite any existing `HANDOFF.md`.

Exclude git state — the next agent can check that themselves. Keep it lean.
