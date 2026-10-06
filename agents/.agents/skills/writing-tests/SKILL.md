---
name: writing-tests
description: Write, update, or assess tests for added or changed functionality owned by our code. Use whenever adding or changing application behavior, fixing a bug, writing or updating tests, or deciding what needs test coverage. Follow the language and project's testing idioms. Never test things the framework already tests, duplicate coverage, or expand beyond the requested change.
---

# Writing Tests

Test the added or changed behavior that the module owns. Never test things the framework, language runtime, or dependency already tests.

Use the framework to exercise our code. Do not write tests that prove the framework works.

## Scope

- Follow repository instructions and the user's approved scope.
- Cover the behavior introduced or changed by this task, not everything the touched file can do.
- Prefer updating an existing relevant test over adding another test for the same behavior.
- Do not add tests merely because a model, field, enum, method, or class was added.
- Do not add unrelated regression coverage, dependencies, test helpers, configuration, or production refactors without approval.
- Preserve existing tests and user changes. Do not remove existing tests without approval.
- If the task only changes comments, formatting, or other non-behavioral details, do not invent behavior to test.

## 1. Identify the Owned Behavior

Read the changed implementation, its relevant callers, the covering tests, and one sibling before editing. Identify the actual language, test runner, framework, and project conventions.

For each proposed test, answer:

1. What added or changed rule does this module own?
2. Which public entry point exercises that rule?
3. What observable result, side effect, or failure matters to its caller?
4. What specific mistake in our code would make this test fail?

If the answer is only that the framework might stop working, omit the test. If existing tests already catch the same mistake, update them only where the changed contract requires it.

Do not turn these questions into comments or a long report. Use them to choose the smallest useful test set. Ask when the intended behavior is unclear; do not invent requirements from the current implementation.

## 2. Test Only the Added Functionality

Choose the public entry point that owns the added or changed functionality. Test it there; do not duplicate its tests throughout the call chain.

- Test the decisions, results, side effects, and failure handling introduced or changed by our code.
- Use framework helpers to exercise that functionality, not to prove that the helpers work.
- Do not test standard persistence, casting, routing, validation engines, serialization, or other behavior already tested by the framework or dependency.
- Do not test declarations, constants, property lists, factory defaults, or trivial getters and setters merely because they exist.
- Custom behavior built on a framework is eligible for testing. Assert our custom rule, not the framework mechanism that runs it.
- Inspect stored data, responses, messages, or other outputs only to prove the changed functionality produced the required outcome.

## 3. Write Idiomatic, Focused Tests

- Use the project's runner, assertions, naming, fixtures, factories, fakes, and file layout. Do not introduce a second testing style.
- Follow the language's normal patterns for asynchronous work, errors, exceptions, resource cleanup, and parameterized cases. Do not copy another language's idioms.
- Exercise public behavior. Do not use reflection, expose private methods, or change production visibility for tests.
- Name the behavior or outcome, not the private method or implementation steps.
- Follow arrange → act → assert: prepare the inputs, call the public operation, then check its outcome.
- Use the smallest setup that reaches the changed behavior. Do not create an unrelated object graph.
- Keep important inputs explicit. Avoid randomness in values that determine the expected result.
- Assert the result and relevant side effects. If the operation adds, removes, or updates something, check the expected change and the affected data—not whether a declaration exists.
- Check what must remain unchanged on failure. Do not assert every field because it is available.
- Cover happy paths and distinct edge or failure paths introduced or affected by the change. Do not enumerate every possible dependency failure or input variation mechanically.
- Add parameterized cases only when each case protects a distinct application rule or meaningful boundary. Do not loop over every enum value just because an enum exists.
- Avoid snapshots of large objects or responses when a few focused assertions express the contract.
- Put newly added supporting helpers after the test cases when that matches the project's conventions. Do not reorder unrelated existing code.
- Do not add comments that restate the setup or assertions, including arrange/act/assert labels.

### Collaborators and Side Effects

Prefer real collaborators when they are practical and relevant to the behavior. Use the project's fakes or mocks for external systems, nondeterminism, expensive work, or behavior outside the module's responsibility.

Never mock the subject under test. Do not mock every dependency by default.

Assert collaborator calls only when the interaction itself is the owned contract, such as sending one notification or charging once. Do not assert private call order, helper invocation counts, or delegation merely because those calls appear in the implementation.

Never contact real payment providers, send real messages, or depend on live external services during tests. Use the established test boundary without changing production code to accommodate it.

## 4. Check Only What Changed

- Run the new or updated tests with the narrowest supported filter. Follow project requirements such as parallel execution.
- Do not run an entire file when only a few changed tests need checking and the runner supports filtering.
- Expand the run only for a concrete shared-behavior risk or explicit user direction. Ask before running a broad suite.
- Do not create verification scripts, use interactive debugging as a substitute for tests, or add tests for test discovery and framework registration.
- Do not rerun unrelated tests solely because test-only additions were removed or prose changed.
- Report the commands actually run and their real results. Distinguish earlier passing results from a new run. Never claim unrun tests pass.

Before finishing, check each added test again: it must catch a specific mistake in the changed behavior we own. Remove duplicate assertions and unnecessary setup from your additions. Leave unrelated existing tests alone.

Report the behavior covered, the focused checks run, and any unresolved failure. Do not use test count or coverage percentage as a reason to add tests.
