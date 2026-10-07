---
name: peer-review
description: Use for read-only code reviews and audits of diffs, branches, or existing files. Report actionable correctness, security, design, and testing risks within the requested scope.
---

# Peer Review

Review correctness, design, and production risks—not formatting or personal preferences. Report only issues that would change the author's action or prevent a concrete failure. Remain read-only unless the user explicitly asks for fixes.

## Establish Scope

Classify the request before choosing a Git target:

- **Change review:** inspect the requested staged, working-tree, branch, or PR changes. Report defects introduced or materially worsened by those changes.
- **Current-state audit:** inspect the requested files or subsystem as they exist now. Existing defects are in scope; no diff is required.

Named scope overrides the default Git review target. In both change reviews and audits, restrict findings to the named files; read callers, dependencies, and tests outside that scope only as context. Do not include unrelated working-tree changes. If the review mode is ambiguous and the distinction changes what you would inspect, ask.

For change reviews:

1. For staged/index changes, use `git diff --cached`.
2. For working-tree/current changes, inspect staged, unstaged, and relevant untracked files.
3. For a branch or PR, diff from its merge base with the requested base, or the repository's default branch when none is named.
4. Without a specified target, review staged changes first, then other working-tree changes; if clean, compare the current branch against the default branch.
5. Read the full scoped diff before forming findings. Understand its intent, then read surrounding code, callers, dependencies, and related tests.

For current-state audits, read the named material and relevant callers, dependencies, or consuming instructions. Use history or diffs only when they help explain current behavior. Do not reject a current defect because it predates the latest change.

## Challenge the Assumptions

Identify relevant invariants, trust boundaries, and failure paths. Assume the happy path works, then try concrete counterexamples:

- malformed, hostile, empty, boundary, or oversized input
- legacy, nullable, stale, or partially migrated state
- timeouts, partial failure, retries, duplicate delivery, and non-idempotent behavior
- concurrency, ordering, cancellation, cleanup, and lifecycle transitions
- authorization, tenant isolation, privacy, and other trust boundaries
- realistic load, query growth, memory growth, and resource exhaustion
- rollout, rollback, and compatibility with callers or stored data

Trace each candidate from a reachable entry point to an observable impact. Inspect guards, callers, and tests that might disprove it. In a change review, also establish how the change introduced or worsened the risk. In an audit, establish that the defect exists in the requested current state. Do not manufacture findings to fill a checklist.

Apply only relevant checks:

- **Design:** responsibility boundaries, unnecessary abstractions, simpler alternatives, and documented conventions. Length, duplication, or naming alone is not a defect without a concrete maintenance risk.
- **Data and queries:** old records, defaults, migrations and rollback, transactions, preserved column attributes, N+1 queries, round trips, indexes, batching, and unbounded loading.
- **Failures and security:** external input, API timeouts/statuses/malformed responses, failure-state integrity, access controls, injection, and secrets in storage, responses, or logs.
- **Tests:** owned behavior, meaningful assertions, changed expectations, and distinct failure or edge cases. Missing coverage needs a concrete risk, not a coverage quota.
- **Frontend:** loading/error states, accessibility, response types, stale state, and user-facing behavior when applicable.

Prioritize high-impact paths when scope is large, but do not silently omit requested areas. Be adversarial toward assumptions, not the author.

## Finding Requirements

Report a finding only when you can identify:

- a concrete, reachable trigger or failure scenario
- its user, security, data, performance, or maintenance impact
- for change reviews, how the reviewed change introduced or materially worsened it; for audits, evidence of the current defect
- an exact file and line, plus a practical correction

Include only high- or medium-confidence findings. Resolve uncertainty from the source where possible; otherwise ask a focused question under **Consider** only if the answer could change correctness. Deduplicate findings with one root cause.

Do not report intentional, well-supported choices as defects merely because you prefer another approach. Do not treat optional hardening or absent tests as defects without a concrete failure scenario. For change reviews, exclude pre-existing problems the change does not expose or worsen.

## Report and Validate

Use this structure:

### Summary

Give a brief assessment of the reviewed scope. For change reviews, explain what changed and state approve, request changes, or comment; for audits, summarize the current risks without implying a pending patch.

### Issues

Order findings by impact. Include the file and line, problem, reachable scenario, impact, practical fix direction, and confidence. Categorize as:

- **Must fix:** broken functionality, security issues, or data corruption.
- **Should fix:** material performance, convention, or edge-case risks.
- **Consider:** unresolved design questions that could affect correctness.

If no findings meet the requirements, write `None.` Do not fill space with stylistic advice or rewrite the code for the author.

### Validation

State focused checks actually run and material behavior not verified. Run focused validation when it can confirm or disprove a finding. Avoid broad suites unless requested or justified by scope and risk. Never imply an unrun check passed.
