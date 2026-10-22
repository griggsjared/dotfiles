---
description: Develop a feature plan through discussion, with a checklist and small slices
argument-hint: "[rough idea or existing plan]"
disable-model-invocation: true
---
Help me develop a feature plan in this project's `_notes/` directory.

Initial context: $ARGUMENTS

If no initial context was supplied, I will provide the feature details as we discuss the plan.

This is a planning conversation, not an implementation request. My initial message may be incomplete. Expect follow-up details, questions, and changes of direction. Do not treat missing information as permission to invent requirements.

## Start with the name

- Check the current Git branch and a few relevant `_notes/` examples, if available.
- If the current branch is `main` or the repository's default branch, assume the feature branch may not exist yet. Ask what the intended branch name should be, then use it to propose the plan title and filename.
- Otherwise, propose a plan title and filename usually based on the current branch name. Preserve a ticket identifier when present, but require no particular prefix.
- Ask me to confirm or change the plan name before creating the file.
- If a matching plan exists, ask whether to continue it rather than overwrite it.
- Do not create or switch branches unless I explicitly ask.

## Develop the plan together

- After confirming the name, ask one focused clarification question at a time.
- Start with the desired outcome and scope. Explore behavior, constraints, edge cases, and trade-offs only as they become relevant.
- Use the question picker when available for concrete choices, while allowing me to explain details in my own words.
- Inspect relevant code when needed to ground the discussion. Distinguish verified current behavior from proposed behavior.
- Keep agreed requirements, recommendations, and unanswered questions separate.
- Do not produce a complete-looking plan from an underspecified idea.
- Once enough is understood, propose slices with a one-sentence outcome for each. Ask whether they are small enough for me to review individually, then whether I want a draft written or want to keep clarifying first.

## Write the plan

Follow local note conventions, keeping the document concise. Use the following structure, omitting optional sections that add no useful information:

# Confirmed plan title

## Progress
- [ ] Slice 1 — concrete outcome
- [ ] Slice 2 — concrete outcome

## Goal
The user-visible outcome and why it matters.

## Agreed behavior
Confirmed requirements and decisions.

## Scope
What is included and explicitly excluded.

## Current implementation
Relevant verified behavior and file paths, when useful.

## Slice 1 — concrete outcome
- Behavior delivered.
- Likely files or areas, grounded in inspection where possible.
- Meaningful verification.
- What must be true for this slice to be complete.

Repeat for the remaining slices.

## Open questions
Unresolved decisions and assumptions needing confirmation.

Prefer small, independently verifiable slices that I can implement, review, and approve one at a time. Optimize for reviewability, not a low slice count. Do not impose an arbitrary slice count.

Each slice must:
- Deliver one concrete outcome or a clearly bounded prerequisite.
- Keep the diff focused enough to review without understanding unrelated changes.
- Include the verification that protects its behavior—not defer testing to a later slice.
- State its dependencies, expected behavior changes, and completion criteria.
- Make clear what remains unavailable or unchanged afterward.

Split a slice when it combines independently reviewable concerns, such as persistence, direct processing, reconciliation, settings storage, and admin UI. Keep tightly coupled changes together when separating them would create inconsistent behavior.

Avoid broad slices such as "implement retry scheduling" or separate "add tests" slices. An enabling slice is valid, but explain what it enables and how to verify it before the full feature exists.

## Continue collaboratively

- Incorporate follow-up details into the same plan.
- Keep the top checklist aligned with the slice sections.
- Leave unresolved points explicit rather than silently deciding them.
- Preserve completed work and accurate verification records.
- Never mark work complete without evidence.
- Writing or approving the plan does not authorize implementation or commits.
- When I explicitly request implementation, implement only the requested slice.
- After each implemented slice, give a concise, plain-English walkthrough explaining what changed and why, the relevant files and their roles, the practical effect, and what remains unchanged or not implemented. Include checks actually run, their results, and unresolved limitations. Keep the detail proportional to the change; tiny changes need only a brief explanation. Do not substitute a file list or test summary. Then stop for my review.
