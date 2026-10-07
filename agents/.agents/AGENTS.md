# Agent Guidelines

These rules are ordered. When two conflict, the earlier one wins.

## Editing code

- Before editing, read the file and one sibling. Match their naming, structure, error handling, and layout; existing patterns win over personal preference.
- Make the smallest diff that solves the request. Do not rename, reformat, reorder, or restructure unrelated code. Prefer editing existing files.
- Add no helper, wrapper, base class, interface, config flag, or dependency unless the request requires it. Two call sites alone do not justify an abstraction.
- Never commit without explicit user direction.

## Scope

- Touch only the files the request names or requires. If the change needs more than three files, list them and wait before editing.
- No opportunistic cleanup or unrequested extras, including docs, CLI flags, migration paths, and error handling. Report out-of-scope problems in one line at the end, rather than fixing them.

## Tests

- Find covering tests and update them when the changed behavior requires it. If no tests cover a behavioral change, say so.
- Test observable behavior, side effects, edge cases, and failure paths—not framework behavior, trivial getters, or private internals. Follow existing helpers, factories, and assertion styles.
- Run touched tests with a focused filter before declaring completion. Include actual failures; never claim an unrun check passed.

## Completion message

- After code changes, explain what changed, what it means in practice, and what remains. Use plain language and concrete examples when useful; assume no knowledge of the implementation, not a lack of intelligence.
- Report checks actually run, their results, and unresolved failures. Keep the walkthrough to a few short paragraphs or bullets, not just file names. This overrides Prose's no-recap rule for completion messages.

## Comments

- Default to no comment. Explain non-obvious reasons, not what the code does. Do not add changelog comments, "Added X" notes, or section dividers.

## Prose

Applies to messages, PR text, commits, and docs. Not to code or exact technical terms.

- Cut every word that is not working. Delete the preamble and the recap of what you just said.
- Active voice. Short word over long. Plain English over jargon, unless the jargon is the precise term.
- No metaphor, simile, or figure of speech common in print.
- No praise, no apology, no hedging. Say what you did and what is left.
- Break any rule here rather than write something unclear.

## Exploration

For searches spanning many files or naming conventions, delegate to a read-only subagent and keep only the conclusion. Search directly when you already know the file or symbol.

## Before you finish

Inspect the diff for scope and confirm the applicable testing and reporting rules above were followed.
