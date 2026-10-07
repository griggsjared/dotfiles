---
name: refactor
description: Use when asked to refactor, clean up, consolidate, deduplicate, extract, abstract, or assess code structure and conventions. Also use before adding substantial duplication or extending a file near a documented project line limit. Not for standalone correctness reviews or feature work without a concrete maintainability concern. Activation permits assessment, not unrelated edits.
---

# Refactor

Improve structure without changing behavior or imposing patterns that conflict with the project. Prefer keeping duplication to introducing an uncertain abstraction. When the right boundary is unclear, present the tradeoff rather than guessing.

## 1. Read the Project's Direction

Read the target and gather relevant context before proposing changes:

1. Applicable repository and harness guidance, including nested instructions, contribution rules, architecture notes, and relevant README sections.
2. Project-provided tools and version-specific documentation. Prefer supported generators and framework guidance over memory.
3. Two to four sibling files or files with similar roles. Compare naming, structure, constructors, error handling, and tests. If patterns disagree, check recent history and shared callers before choosing one.
4. The target's recent history when a short `git log -p` inspection can clarify ongoing work.

Explicit guidance takes precedence over inferred patterns, which take precedence over personal preference. Follow the harness's instruction hierarchy. If a documented rule seems wrong for this case, raise the conflict rather than silently introducing an exception.

Keep only context relevant to the proposed refactor; do not inventory unrelated documentation.

## 2. Assess and Propose

Do not edit before establishing the intended change. For each finding, identify the location, concrete maintenance cost, proposed correction, and supporting project convention. Look for:

- repeated logic, not merely similar syntax
- mixed responsibilities or abstractions that expose their internals
- wrappers that add no useful boundary
- drift from documented or established conventions
- names that obscure the intended contract
- long files with distinct responsibilities, rather than length alone

Present a concise proposal with:

- **Direction read:** the relevant convention sources and constraints.
- **Findings and changes:** ranked problems, file/line references, and justified corrections.
- **Leaving alone:** material candidates deliberately excluded and why.

Wait for approval before implementation unless the user already approved a bounded change and its affected files, or explicitly asked you to proceed without a separate proposal. Neither exception waives applicable scope or file-list approval requirements: for more than three files, list them and wait unless that file list is already approved. Naming a module or saying “tidy this up” does not define a bounded refactor. When proceeding under prior approval, assess first and include the rationale in the final summary; an agreed extraction does not need approval twice.

### Proactive Use During Other Work

A concrete duplication concern or a documented file-length limit can justify this assessment during feature work. It does not authorize a refactor or require stopping the whole task for speculative cleanup.

If no justified change is needed, continue the approved task. If addressing the concern expands scope, propose that change and ask before editing. Preserve unrelated code and deferred work.

## 3. Edit and Validate

Within the approved scope:

- Make one logical change at a time, keeping behavior unchanged.
- Follow existing abstractions and file layout. Use the project's required scaffolding tools for new files.
- Add no dependencies, new architectural patterns, or new folder structures without explicit approval.
- Preserve existing tests and user changes. Do not remove tests without approval; tests usually need adapting rather than deletion.
- Run focused tests after each meaningful change. On failure, stop further refactoring and fix the change or undo only your own edit; do not discard user work.
- Run configured code-quality checks required by the project. Do not use them to reformat unrelated code.

Report what changed and why, what was deliberately left alone, checks actually run, and unresolved failures or follow-ups. Do not repeat the proposal as a long completion report.

## Extraction Decisions

### Repeated Logic

Three occurrences justify investigating a shared abstraction, not automatically creating one. Two copies often diverge for legitimate reasons; leave them unless there is stronger evidence.

An exception may be justified when two copies are identical and the project already has an obvious shared home. Propose that established pattern only if it fits the request and repository rules. Do not create a new abstraction just because two call sites exist.

### Warning Signs

Avoid an extraction when:

- its parameters outnumber the lines in the longest duplicated body
- it needs a vague name such as Helper, Manager, or Util because there is no shared concept
- the resulting call sites need explanation that the originals did not
- the similarity is structural, such as two loops doing different jobs, rather than repeated logic

These are reasons to reassess or leave the code alone, not a checklist to satisfy by renaming the abstraction.

### File Length

A project's line limit is a prompt to inspect responsibilities, not an instruction to split mechanically. Read the whole file. Keep a cohesive file intact; if it owns several jobs, propose boundaries already evident in method groups or concerns. Do not create arbitrary breaks at a line count. Surface conflicts with a hard project limit rather than ignoring it.

### Existing Patterns

Use an established solution to the same problem rather than adding a competing pattern. If the existing approach has a material limitation, explain it separately with the tradeoff of changing it across the project. Do not introduce a new pattern in one file without approval.

## Ask or Proceed

Ask when a proposed change exceeds approved files or scope, introduces a pattern or location, has several plausible abstraction boundaries, conflicts with guidance, or affects generated, migration, or framework-scaffolded code beyond the approved task.

Within an approved refactor, decide routine mechanical details yourself when they follow established patterns and preserve behavior. An approved multi-file plan does not require asking again for each named file; a newly discovered scope expansion does.
