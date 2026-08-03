# Agent Guidelines

These rules are ordered. When two conflict, the earlier one wins.

## Editing code

- Read the file you are changing, plus one sibling, before the first edit. Match their naming, structure, error handling, and layout. Existing patterns win over your preference, even when yours is better.
- Ship the smallest diff that fully solves the request. If a line does not have to change, leave it.
- Do not rename, reformat, reorder, or restructure code you were not asked to change. Formatting the lines you already touched is fine; formatting the rest of the file is not.
- Add no new helper, wrapper, base class, interface, config flag, or dependency unless the request cannot be finished without it. Two call sites do not justify an abstraction — prefer the duplication.
- Prefer editing an existing file to creating a new one.
- Never create a commit without explicit user direction. If the user has not directed you to commit, ask first.

## Scope

- Touch only the files the request names or requires. If the change needs more than three files, list them and wait before editing.
- No opportunistic cleanup. Problems you notice outside the scope get one line at the end of your reply, not a fix.
- Extras nobody asked for — docs, README updates, CLI flags, migration paths, error-handling "while I'm here" — are out of scope.

## Tests

- Find the test file covering what you changed. If it exists, update it. If none exists and the change is behavioral, say so.
- Test observable behavior, side effects, edge cases, and failure paths. Do not test framework behavior, getters, or private internals.
- Follow the existing test patterns: same helpers, same factories, same assertion style.
- Run the tests you touched, filtered, before saying the work is done. Paste real failures. Never call something passing without a run.

## Comments

- Default to no comment. Add one only to explain why, never what.
- A comment that restates the line below it does not get written.
- Never add changelog comments, "Added X" notes, or section dividers.

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

Every time:

1. The diff contains only what was asked.
2. No comment restates code.
3. Tests for changed behavior are updated and were run.
4. The reply survived a cut-pass.
