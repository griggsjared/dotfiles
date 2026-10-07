---
name: writing-tests
description: Use when adding or changing application behavior, fixing bugs, or writing, updating, or assessing tests. Cover behavior owned by our code using existing test conventions; preserve read-only scope during reviews.
---

# Writing Tests

Test the added or changed behavior our code owns, not framework, runtime, or dependency behavior. Use the framework to exercise our code. During a read-only assessment, recommend coverage without editing.

## Scope

- Before writing tests, confirm the project and relevant domain already test comparable behavior. If not, report the gap without adding tests or test infrastructure unless explicitly requested. An untested file within an already-tested domain is not a new testing practice.
- Cover this task's behavior, not everything the touched file can do. Do not invent behavior to test for comments, formatting, or other non-behavioral changes.
- Prefer updating relevant tests over duplicating coverage. Preserve existing tests and user changes; do not remove tests without approval.
- Do not add unrelated regression coverage, dependencies, helpers, configuration, or production refactors without approval.

## 1. Identify the Behavior

Read the changed implementation, relevant callers, covering tests, and a sibling. Identify the language, runner, framework, and project conventions.

For each proposed test, answer:

1. What added or changed rule does our code own?
2. Which public entry point exercises it?
3. What observable result, side effect, or failure matters to its caller?
4. What specific mistake in our code would make the test fail?

If the answer is only that the framework might stop working, omit the test. If existing tests catch the same mistake, update them only when the changed contract requires it. Ask about unclear intended behavior rather than inventing requirements from the current implementation.

Use these questions to select tests, not as comments or a long report.

## 2. Choose the Boundary and Cases

Test through the public entry point that owns the behavior; do not duplicate coverage throughout the call chain, use reflection, or expose private methods for testing.

- Cover decisions, results, side effects, and failure handling introduced or affected by this change, including meaningful boundaries.
- Do not test standard framework persistence, casting, routing, validation, or serialization. Custom rules built on those mechanisms are eligible; test the rule, not the mechanism.
- Do not add tests merely because a model, field, enum, method, or class exists. Skip declarations, constants, property lists, factory defaults, and trivial getters/setters without owned behavior.
- Test the current supported contract, not the history of the change. Do not assert that a removed column, field, method, class, or configuration entry is absent merely because it was deleted. Update affected tests for the remaining behavior; do not replace obsolete coverage with absence checks.
- Ask whether the test would make sense if the removed implementation had never existed. If not, omit it unless an explicit compatibility or migration requirement makes the transition part of the contract. Negative assertions still belong when they express current requirements, such as an unchanged balance on failure or no private data in an unauthorized response.
- Assert resulting data, responses, or messages when they prove the required outcome. For operations that add, update, or remove data, check the result and affected data—not a declaration's presence.
- Check what must remain unchanged on failure, not every available field.
- Add parameterized cases only for distinct rules or meaningful boundaries. Do not mechanically enumerate enum values, dependency failures, or input variations.

## 3. Follow Existing Test Patterns

Use the project's runner, assertions, naming, fixtures, factories, fakes, and file layout. Follow the language's conventions for asynchronous work, errors, resource cleanup, and parameterized cases; do not introduce a second testing style.

- Name the behavior or outcome, not a private method or implementation step.
- Arrange inputs, exercise the operation, then assert its outcome. Avoid comments that narrate these steps.
- Use the smallest setup that reaches the behavior. Keep important inputs explicit and deterministic; avoid unrelated object graphs.
- Prefer focused assertions over snapshots of large objects or responses.
- Put new supporting helpers after tests when that matches existing conventions. Do not reorder unrelated code.

After adding or updating each test, recheck the four behavior questions, unique coverage, setup, and assertions before adding another. Remove or simplify your new tests if they test dependency behavior, duplicate coverage, or require unrelated setup; trim unnecessary assertions and setup from your edits. Leave unrelated existing tests alone. A passing test alone does not justify keeping it.

### Collaborators

Prefer real collaborators when practical and relevant. Use established fakes or mocks for external systems, nondeterminism, expensive work, or behavior outside the module's responsibility. Never mock the subject under test or mock every dependency by default.

Assert collaborator calls only when the interaction is itself the contract, such as charging once or sending one notification. Do not assert private call order, helper invocation counts, or incidental delegation.

Never contact real payment providers, send real messages, or depend on live external services. Use the established test boundary without changing production visibility or behavior to accommodate tests.

## 4. Run and Report

Run new or updated tests with the narrowest supported filter and required project options, such as parallel execution. Do not run a whole file when the changed tests can be filtered. Expand only for a concrete shared-behavior risk or user direction; ask before running a broad suite.

Do not create verification scripts, substitute interactive debugging for tests, or test framework registration/discovery. Do not rerun unrelated tests merely because prose changed or test-only additions were removed.

Test count and coverage percentage are not reasons to add tests.

Report behavior covered, commands actually run, real results, and unresolved failures. Distinguish earlier passing results from a new run; never claim an unrun check passed.
