# AGENT Guidelines

## Core Principles

1. **Reference surrounding code** - Always examine nearby code and match existing patterns, style, naming, and conventions before making edits.

2. **Make minimal edits** - Prefer the smallest correct change that solves the request. Do not refactor, rename, reformat, or reorganize code unless necessary.

3. **Avoid unnecessary abstractions** - Do not introduce new helpers, wrappers, dependencies, compatibility layers, or generalized solutions unless clearly justified by the task.

4. **Minimal comments** - Refrain from adding superfluous comments. Only add comments when necessary to explain complex or non-obvious logic.

5. **Update tests** - Always check for corresponding tests when editing code. Test the behavior, side effects, and edge cases of our code; avoid testing framework behavior or implementation details already covered by the framework. Update tests to maintain appropriate coverage and follow existing test patterns.

6. **Follow project conventions** - Check for linters, formatters, and configuration files. Follow the project's established conventions and formatting rules.

7. **Delegate broad exploration** - For broad codebase exploration or fan-out searches across many files, delegate to a read-only exploration subagent instead of searching directly. Keep only the conclusions in the main context.

## Prose Style

Apply these rules to all human-facing prose, including documentation, PR text, and messages. Do not apply them to code or exact technical terms. Use everyday words only when they preserve precision.

- Do not use a metaphor, simile, or other figure of speech that is common in print.
- Use a short word when it works as well as a long one.
- Cut every word that is not needed.
- Use the active voice when possible.
- Prefer everyday English to foreign phrases, scientific terms, or jargon when it preserves the meaning.
- Break any of these rules rather than write something unclear or awkward.
- Review all prose against these rules before delivering it.

## Scope Control

- Keep edits focused on the files directly related to the request.
- Do not include opportunistic cleanup in the same change.
- If a broader improvement is discovered, mention it separately instead of implementing it without being asked.
- When unsure whether a larger change is desired, ask before expanding the scope.
