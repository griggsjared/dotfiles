---
name: writing-tests
description: Use when adding or changing application behavior, fixing bugs, or writing, updating, auditing, or simplifying tests. Prefer minimal, meaningful coverage of supported behavior; testing rules override surrounding patterns. Audits remain read-only unless edits are requested.
---

# Writing Tests

Test current supported behavior and contracts our code owns—not the diff, development history, or framework internals. A code change does not automatically require a new test. Prefer a small set of clear tests that protect distinct behavior over many low-value tests.

These testing rules take precedence over patterns in surrounding tests. Existing tests show tooling and syntax, not what deserves coverage. Follow the harness's instruction hierarchy; raise conflicts with explicit project requirements rather than silently overriding them.

## Scope

- Before writing tests, confirm the project and relevant domain already test comparable behavior. If not, report the gap without adding tests or test infrastructure unless explicitly requested. An untested file within an already-tested domain is not a new testing practice.
- Cover this task's behavior, not everything the touched file can do. For audits or cleanup, inspect the requested tests without requiring a production diff. Do not invent behavior to test for comments, formatting, or other non-behavioral changes.
- Improve existing coverage before adding tests. During editing tasks, simplify, consolidate, or remove tests only within those already affected by the task or a requested cleanup scope. This needs no separate approval but does not waive project scope or file-approval requirements. Preserve user changes; leave unrelated tests alone.
- Before consolidating or removing coverage, or recommending either, identify retained tests protecting each distinct supported requirement or failure case, or explain why the candidate protects no supported behavior or contract. Similar code, coverage of the same lines, or a passing suite does not establish redundancy. If protection is unclear, keep the test and raise the question.
- Do not add unrelated regression coverage, dependencies, helpers, configuration, or production refactors without approval.

## 1. Identify the Behavior

Read the implementation under test, relevant callers, covering tests, and a sibling. Identify the language, runner, framework, and compatible project conventions.

For each candidate test, new or existing, answer:

1. What current supported behavior or explicit contract does this protect?
2. Which public entry point or contract boundary does it check?
3. What observable result, side effect, or failure matters to its caller?
4. What plausible mistake in our code would this catch that other tests would miss?

If the answer is only that the framework might stop working, the test adds no application coverage. Before adding a test, identify both the supported behavior or contract and a meaningful gap in existing coverage. First reuse, update, or simplify a covering test when that fully protects the requirement. Adding no new tests is valid. Ask about unclear intended behavior rather than inventing requirements from the current implementation.

Use these questions to select tests, not as comments or a long report.

## 2. Choose the Boundary and Cases

For behavior tests, use the public entry point that owns the rule; do not duplicate coverage throughout the call chain, use reflection, or expose private methods for testing.

- Cover distinct decisions, results, side effects, failure handling, and meaningful boundaries within the task's scope. Choose the entry point that owns the rule; do not force every test through the entire application.
- Use the framework to exercise our code; do not test standard persistence, casting, routing, validation, or serialization themselves. Applying authorization or validation to the right operation, saving required values, and excluding private response data are application behavior even when implemented with built-in features.
- Structural checks are valid when they protect an explicit supported contract. A declaration's existence alone does not justify a test. Skip constants, property lists, factory defaults, and trivial getters/setters without owned behavior or an explicit contract requirement.
- Test the current supported contract, not the history of the change. Do not assert that a removed column, field, method, class, or configuration entry is absent merely because it was deleted. Update affected tests for the remaining behavior; do not replace obsolete coverage with absence checks.
- Ask whether the test would make sense if the removed implementation had never existed. If not, omit it unless an explicit compatibility or migration requirement makes the transition part of the contract. Do not infer that requirement merely because the change includes a migration. Negative assertions still belong when they express current requirements, such as an unchanged balance on failure or no private data in an unauthorized response.
- Assert resulting data, responses, or messages when they prove the required outcome. For operations that add, update, or remove data, check the result and affected data—not a declaration's presence.
- Check what must remain unchanged on failure, not every available field.
- Add parameterized cases only for distinct rules or meaningful boundaries. Do not mechanically enumerate enum values, dependency failures, or input variations.

## 3. Use Compatible Test Conventions

Use the project's runner, assertions, naming, fixtures, factories, fakes, and file layout where they comply with these rules. Follow the language's conventions for asynchronous work, errors, and resource cleanup. Do not copy low-value cases, excessive setup, or implementation-detail assertions for consistency.

- Name the behavior or outcome, not a private method or implementation step.
- Keep one coherent behavior or contract per test. Use as many assertions as needed to prove it; do not split one outcome into a test per field or combine unrelated behaviors merely to lower the test count.
- Arrange inputs, exercise the operation, then assert its outcome. Avoid comments that narrate these steps.
- Use the smallest setup that reaches the behavior. Keep important inputs explicit and deterministic; avoid unrelated object graphs.
- Prefer focused assertions over snapshots of large objects or responses. Check each value needed to prove the behavior, not every available field.
- Reduce irrelevant setup and redundant assertions before extracting helpers. Prefer readable repetition over indirection. Use parameterization when meaningful cases share setup and assertions, not when it requires branching test logic or creates a large input matrix.
- Put new supporting helpers after tests when that matches existing conventions. Do not reorder unrelated code.

After each test edit, recheck the behavior questions, unique coverage, setup, and assertions before adding another. Simplify tests within scope instead of appending parallel coverage. A passing test alone does not justify keeping it.

### Collaborators

Prefer real collaborators when practical and relevant. Use established fakes or mocks for external systems, nondeterminism, expensive work, or behavior outside the module's responsibility. Never mock the subject under test or mock every dependency by default.

Assert collaborator calls only when the interaction is itself the contract, such as charging once or sending one notification. Do not assert private call order, helper invocation counts, or incidental delegation.

Never contact real payment providers, send real messages, or depend on live external services. Use the established test boundary without changing production visibility or behavior to accommodate tests.

## 4. Audit and Simplify Existing Tests

An audit or review is read-only unless edits are requested. Apply the same behavior questions to existing tests; age, passing status, and nearby patterns do not exempt them.

- Look for duplicate scenarios, irrelevant fixtures, redundant assertions, oversized snapshots, incidental mock expectations, and framework or change-history checks.
- Classify candidates as keep, simplify, consolidate, or remove. Report only actionable findings, with a file/line reference, the reason, and the proposed change; do not inventory every useful test.
- Preserve meaningful failure cases and assertions. Never weaken a test just to make it pass. Do not turn a simplification audit into unrelated coverage expansion.

## 5. Run and Report

Run new or updated tests and retained tests relied on by consolidation or removal with the narrowest supported filter and required project options, such as parallel execution. Do not run a whole file when the affected tests can be filtered. Expand only for a concrete shared-behavior risk or user direction; ask before running a broad suite.

Do not create verification scripts, substitute interactive debugging for tests, or test framework registration/discovery. Do not rerun unrelated tests merely because prose changed or your test-only additions were removed.

Test count, line count, and coverage percentage are not reasons to add or remove tests. Fewer tests are a result of removing low-value coverage, not a quota.

Report behavior covered or retained, why any removed coverage was unnecessary, commands actually run, real results, and unresolved failures. Distinguish earlier passing results from a new run; never claim an unrun check passed.

## Background

- [Google: Test Behavior, Not Implementation](https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html)
- [Martin Fowler: Test Coverage](https://martinfowler.com/bliki/TestCoverage.html)
- [Google: Tests Too DRY? Make Them DAMP!](https://testing.googleblog.com/2019/12/testing-on-toilet-tests-too-dry-make.html)
