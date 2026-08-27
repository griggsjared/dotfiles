---
name: refactor
description: Review, consolidate, and abstract existing code to make it more maintainable while respecting the project's existing direction (repository and harness guidance, sibling-file conventions, framework idioms, project documentation, and available tooling). Use this skill whenever the user asks to refactor, clean up, review, consolidate, deduplicate, extract, or abstract code; whenever a file is approaching its project's line-limit guideline; whenever new code would repeat patterns already present elsewhere; or when the user says things like "this is getting messy," "too much repetition," "tidy this up," "make this more maintainable," or "is this following our conventions?" Also use it proactively before adding code that would significantly extend a long file or duplicate existing logic. Prefer using this skill over freelancing a refactor — the value is in the methodology, not just the changes.
---

# Refactor

Thoughtful refactoring — reviewing existing code, consolidating duplication, introducing abstractions — without imposing changes that fight the project's existing direction.

Most refactoring failures aren't from missing the duplication. They're from extracting the wrong abstraction, breaking conventions the codebase had already settled on, or quietly adding scope (new dependencies, new folders, new patterns) that nobody approved. This skill keeps you on the rails.

The default stance is conservative. When in doubt about whether to consolidate or abstract, surface the question to the user rather than guess. Duplication you flag is recoverable; a bad abstraction tends to stick.

## The workflow

Three phases. Don't skip ahead — the phases exist because each one catches a different failure mode.

### Phase 1: Read the project's direction

Before proposing or making any changes, gather context on what this project considers idiomatic. This is the single most important step. Sources, in priority order:

- Repository and harness guidance files — read all relevant files, including instruction files, contribution guides, architecture notes, and README files. These encode the most explicit, enforceable rules.
- Nested guidance files — some projects have instruction or convention files in subfolders that override or refine root guidance. Check the folder containing the file you're refactoring.
- Project-provided tools and documentation — use framework- or harness-specific tools when available. Prefer version-specific project docs and supported generators over memory or generic guidance.
- Sibling files — open 2–4 files in the same directory or with similar roles (the module next to the one you're touching, another validator, another resource). Skim for naming conventions, constructor style, error handling, and test patterns. If two siblings disagree, look at the more recent one and at any file that imports both.
- The file's recent history — if git log -p for the file is cheap, scan it. In-progress refactoring direction often shows up in recent commits.

While reading, keep a running list of the rules and patterns that apply to the file at hand. You'll cross-reference them in Phase 2.

#### What “project direction” means in practice

It's a hierarchy: explicit repository and harness instructions beat patterns inferred from sibling files, which beat your own general knowledge of “best practices.” If project guidance says “use the established data-access layer, not raw queries,” that's the rule — even if a particular query feels like it'd be cleaner in raw SQL. If the rule seems wrong for the case, that's a discussion to have with the user, not a license to silently deviate.

### Phase 2: Review — don't edit yet

Produce a written review before touching code. The review has four parts. Skipping the review and going straight to edits is the most common way this skill gets misused; the review is where the user catches missed context.

#### What you read

The convention sources you consulted, in 2–3 sentences. Shows your work.

#### Findings

Actual code smells, roughly ranked by impact:

- **Duplication** — same logic in 3+ places. Two places is usually not enough; see the three-strikes rule below.
- **Mixed concerns** — a function/class doing more than one job.
- **Leaky abstraction** — a wrapper that just passes its arguments through; an abstraction whose users have to know its internals.
- **Convention drift** — file violates a documented project rule (e.g., reads configuration through an unsupported path; performs validation inline when the project uses dedicated validators; bypasses the established data-access layer).
- **Length** — file is approaching or past the project's stated line limit. Length alone doesn't justify a split; see “When length is the signal.”
- **Naming** — variables/methods named in ways that obscure intent.

#### Proposed changes

For each finding, state the proposed fix and the justification rooted in project direction. The justification is the thing that distinguishes a real proposal from a stylistic preference. Example: “Extract validation into the project's existing validation abstraction — repository guidance requires validation to live outside the handler, and the neighboring handlers already follow this pattern.”

#### Leaving alone

Places where you noticed something but decided not to act. Explaining why you didn't act matters as much as explaining what you did; it tells the user you saw the thing and made a deliberate call.

Present the review to the user and wait for approval before editing. If the user says “just do it,” proceed — but a short summary version of the review still surfaces at the end.

### Phase 3: Edit incrementally

Once approved:

- One logical change at a time. Don't bundle five refactors into a single edit. Bundled edits are hard to review and hard to revert.
- Run targeted tests after each meaningful change. Use the tightest filter the project supports. Don't keep refactoring past a failing test — fix or revert immediately.
- Run the project's code quality tools as specified in its repository or harness guidance. If they aren't mentioned, look for project configuration files and run whatever's configured.
- Never remove tests without explicit user approval. Tests that “no longer apply” after a refactor usually still apply — they just need updating.
- Never introduce new dependencies (packages, base folders, new architectural patterns) without explicit user approval. This is the most common way refactors quietly expand scope.
- Use the project's scaffolding tools for new files. If repository guidance or framework documentation specifies a generator, use it — don't hand-write files that the project would scaffold.

End with a concise summary: what changed, what was left alone, any follow-ups the user might want to take on.

## Judgment calls

The hardest part of this work is knowing when not to act. A few principles.

### The three-strikes rule for extraction

Duplication is fine — even valuable — at two occurrences. The two copies may diverge for legitimate reasons later. Wait for a third occurrence before extracting a shared abstraction. If you see only two copies, note it in the review under “leaving alone” with a one-line reason: “two copies isn't enough signal yet; will revisit if a third appears.”

The exception: if the two copies are exactly identical and the project already has an obvious home for shared logic (a Traits/ folder, a service class, a Form Request being used elsewhere), extracting is fine — the project has effectively pre-decided where this kind of thing goes.

### Resist over-abstraction

Over-abstraction is more harmful than duplication, because duplication is visible and bad abstractions hide. Signs you're about to over-abstract:

- The proposed abstraction has more parameters than the longest of the duplicated bodies has lines.
- The proposed name has to be vague (Helper, Manager, Util, Processor, Service with no qualifier) because the things you're unifying don't share a clear conceptual identity.
- After the extraction, the call sites would need a comment to explain what they're doing.
- The “duplication” is structural similarity, not actual repeated logic (two loops that happen to look alike but do different things).

If any of these are true, leave the code alone and note it in the review.

### When length is the signal

A file approaching the project's stated line limit (e.g., 400 lines) is a prompt to look, not an instruction to split. When you encounter a long file:

- Skim the whole file before proposing anything.
- Ask: is this file doing one job that happens to be big, or several jobs in one place?
- One job: leave it. Splitting a cohesive file for length alone creates artificial seams that future readers have to mentally rejoin.
- Several jobs: propose splits along the existing seams (clear method clusters, distinct concerns, natural groupings already visible in the code), not arbitrary section breaks at the line limit.

### Prefer existing patterns over new ones

If the codebase already has a pattern for solving this kind of problem, use that pattern — even if you'd personally write it differently. Introducing a second pattern to do the same job makes the codebase harder to maintain, not easier; future readers have to learn both and figure out which one applies where.

If the existing pattern feels genuinely wrong, surface that in the review as a separate item: “the project's current approach to X has a known limitation — here's the tradeoff if you want to consider changing it across the board.” Don't unilaterally introduce a competing pattern in the one file you happen to be touching.

### When to ask vs. when to decide

Ask the user when:

- The change would touch files outside the one being refactored.
- The change would introduce a new pattern, a new folder, or move logic to a new location.
- The abstraction's shape isn't obvious from the duplication (multiple plausible extractions exist).
- The “right” change conflicts with a documented project rule (you might be misreading the rule, or it might have an exception worth confirming).
- The change would touch generated, migration, or framework-scaffolded code.

Decide yourself when:

- The change is contained to the file being refactored.
- The change follows an existing pattern in the codebase exactly.
- The change is mechanical cleanup: rename for clarity, remove dead code, fix a documented convention violation, add missing return type declarations the project requires.

## Output format

### Phase 2 (review)

```markdown
## Project direction read
[2–3 sentences on what you consulted and the rules that apply]

## Findings
1. [Finding] — [where, with file:line] — [impact]
2. ...

## Proposed changes
1. [Change] — [justification rooted in project direction]
2. ...

## Leaving alone
- [Thing] — [why]
- ...
```

### Phase 3 (final summary)

```markdown
## Changed
- [file:lines] — [what and why]

## Left alone
- [thing] — [why]

## Follow-ups (optional)
- [thing to consider for later]
```

## A worked example

User asks: “Can you tidy up UserService? It's getting long.”

Bad approach: open the file, see three methods with similar validation, extract a validateUserData() helper, save, done.

Good approach:

1. Read the direction. Open the repository's guidance files and inspect sibling services. The project keeps validation in dedicated modules, and neighboring services use one validator per operation. Check the framework documentation or project tooling if the supported generator or validation syntax is unclear.
2. Review. Findings: (a) create(), update(), and import() all perform inline validation with overlapping rules — this violates the documented convention and diverges from sibling services. (b) notifyUser() and sendWelcome() both build the same notification payload — two copies, leave alone for now. (c) The file is 380 lines, close to the 400-line guideline, but it's cohesive (all user operations) — length alone doesn't justify a split. Proposed changes: extract the validators using the project's existing structure and generator. Leaving alone: the notification payload duplication (three-strikes rule), the file length (cohesive single concern).
3. Edit after approval. Scaffold the validators with the project's supported tool, move the rules, update service calls, and run the focused tests and configured quality checks.

The good approach is more steps, but every change is justified by something the project already said it wanted.
