# AGENT Guidelines

## Core Principles

1. **Reference surrounding code** - Always examine nearby code and match existing patterns, style, naming, and conventions before making edits.

2. **Make minimal edits** - Prefer the smallest correct change that solves the request. Do not refactor, rename, reformat, or reorganize code unless necessary.

3. **Avoid unnecessary abstractions** - Do not introduce new helpers, wrappers, dependencies, compatibility layers, or generalized solutions unless clearly justified by the task.

4. **Minimal comments** - Refrain from adding superfluous comments. Only add comments when necessary to explain complex or non-obvious logic.

5. **Update tests** - Always check for corresponding tests when editing code. Test the behavior, side effects, and edge cases of our code; avoid testing framework behavior or implementation details already covered by the framework. Update tests to maintain appropriate coverage and follow existing test patterns.

6. **Follow project conventions** - Check for linters, formatters, and configuration files. Follow the project's established conventions and formatting rules.

7. **Delegate broad exploration** - For broad codebase exploration or fan-out searches across many files, delegate to a read-only exploration subagent instead of searching directly. Keep only the conclusions in the main context.

## Scope Control

- Keep edits focused on the files directly related to the request.
- Do not include opportunistic cleanup in the same change.
- If a broader improvement is discovered, mention it separately instead of implementing it without being asked.
- When unsure whether a larger change is desired, ask before expanding the scope.
