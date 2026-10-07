---
name: code-documentation
description: Use when writing, revising, or assessing in-code documentation and comments, including API contracts, docblocks, docstrings, and failure behavior. Focus on verified guarantees, caller expectations, and non-obvious reasons—not behavior changes or external documentation.
---

# Code Documentation

Explain why code exists, when to use it, and what matters when calling or changing it. Put caller-facing facts at the entry point, responsibility at the class or module, and local safety reasons beside the code. More comments are not the goal.

## Scope

- For advice or assessment, explain without editing. For requested documentation changes, preserve the user's existing edits and stay within the approved files; related code is context, not permission to document the call graph.
- Follow repository guidance, the user's chosen style, and language conventions. Required API or safety documentation takes priority over brevity.
- Do not change behavior, signatures, visibility, names, control flow, exception handling, or tests to make documentation easier. Do not add external docs, generators, dependencies, or configuration unless requested.
- Documentation-only imports are acceptable when supported by the project and language. Do not introduce runtime imports or dependency cycles merely to shorten references.

## 1. Verify the Facts

Read the named code, a relevant sibling, callers, and covering tests. Follow delegated calls far enough to verify results, side effects, and failures without inventorying the entire application.

Establish:

- the component's responsibility and where neighboring responsibilities begin
- meaningful caller-facing entry points, including methods consumed through composition even when declared protected
- caller obligations, result meaning, state changes, and work that may remain incomplete after success
- relevant retry, partial-failure, cancellation, concurrency, and recovery behavior
- failures callers actually receive and which require different handling
- obligations and guarantees for implementations or consuming classes

Existing comments are claims to check, not proof. A method named `save` does not prove durability; a transaction does not prove external work rolls back; a lock does not make the whole operation safe to retry.

Verify claims such as idempotency, atomicity, no duplicate charges, resource release, unchanged state on failure, thread or cancellation safety, ordering, and freshness. Preserve their conditions and limits. If intent is unclear, ask; if code contradicts the desired docs, report the mismatch rather than inventing a guarantee or silently fixing behavior.

## 2. Put Each Fact Where It Belongs

| Location | Explain | Usually omit |
|---|---|---|
| Class or module | Responsibility and boundary with nearby components | Method inventory, dependency list, detailed workflow |
| Public entry point | Purpose, caller obligations, result meaning, relevant side effects and failures | Line-by-line implementation |
| Private helper | Hidden assumption, recovery role, or constraint needed to change it safely | A sentence made from its name |
| Inline comment | Why this ordering, guard, decision, or exception boundary matters | What the next statement does |

Do not repeat whole explanations across levels. A brief entry-point warning and a local explanation of the mechanism can both help; identical paragraphs do not.

### Contracts and Composition

For interfaces, protocols, or abstract APIs, document consumer guarantees and implementation obligations that signatures do not encode: required state or lifecycle, hook semantics, collaborators, ordering, and responsibility for failure or recovery. Do not promise guarantees the implementations cannot support.

For traits, concerns, or mixins, explain the shared behavior, what the consuming class must provide, when to apply it, and what callers receive through the host. Document externally consumed methods even when protected. Describe what a hook must accomplish and when it runs, not just its signature.

Separate actual dependencies from current implementation choices:

- An abstract accessor requires a method with the declared return type, not a particular backing property. Direct property access does require that property.
- Do not require a named sibling trait or class merely because current consumers use it. Name one only when the code depends on it or callers need it to choose the correct API.
- Do not restate composition already visible in declarations or imports.

Keep the shared contract at its declaration or composition unit and host-specific workflow at the host entry point. Include only relevant obligations; do not invent a documentation-only interface or impose an exhaustive checklist on every trait.

### Class and Entry-Point Docs

A class or module usually needs a purpose sentence and, when useful, a boundary sentence. Name a neighboring component only to help readers choose the correct API or avoid unsafe use. Do not inventory constructor dependencies unless ownership or lifetime is part of the contract. Omit ceremonial summaries where there is no useful role-level explanation.

At each meaningful in-scope entry point, state its purpose rather than paraphrasing its name, then add only facts that affect use:

- when to choose it over a related operation
- whether saved state takes priority over new input
- what success means, including pending work or partial completion
- obligations before or after the call
- relevant side effects, ownership, lifetime, units, and failures

Do not turn these categories into required headings or fill every category in each docblock. A simple method may need only one sentence.

Give starting, retrying, canceling, and recovering their own expectations rather than copying shared text. A delegating entry point still owns a caller-facing purpose. Public visibility alone does not make a constructor or trivial accessor worth documenting.

Keep parameter and return tags required by the toolchain or needed to express shapes, generics, ownership, units, valid values, or result meaning. Omit tags that only repeat names and types unless required.

### Workflows and Local Reasons

Use a short workflow list only when it explains meaningful domain stages more clearly than prose. Prefer a few stages; use numbers for a real sequence and bullets for priorities or alternatives. Replace overlapping prose rather than keeping both. Follow the documentation tool's markup support.

For example, if verified by the implementation:

```php
/**
 * Collect a full or partial payment, at checkout or without the customer present.
 *
 * - Continue a saved payment attempt before accepting new payment choices.
 * - Start a new attempt only if money is owed and none is already open.
 * - Mark the order paid only when nothing is owed and no result is pending.
 *
 * A successful payment does not mean the whole order is paid.
 */
```

Do not turn a workflow into “load the order, call the resolver, return the result.” Keep branch details and local safety reasons beside the code.

Default to no private-method docblock. Add one for a non-obvious assumption, recovery role, compatibility constraint, or lock or reservation required from the caller. State the assumption and why it matters, not the algorithm. Comment on a delegation choice only when its reason is not apparent; do not narrate every branch or obvious guard.

Instead of “Set the release flag to false,” explain the reason:

```text
The provider may already have charged the customer, even if we did not save the result.
Keep the credit reserved until the payment result is known.
```

Copy the reasoning style, not an unverified guarantee.

## 3. Document Failures Callers Can Act On

Trace catches, conversions, rethrows, and returned failures before documenting them. A dependency exception may never reach the entry point's caller; a decline returned as data is not a thrown exception.

For each important failure, state its type or result, the triggering condition, and any state left behind or required next action. Use a stable error family when several failures require the same response. Name a subtype separately when treating it as an ordinary failure would be unsafe or misleading:

```php
 * @throws PaymentException when the request, saved attempt, or provider cannot complete the payment
 * @throws PaymentOutcomeUnknownException when a provider request may have taken effect; do not assume payment failed
 * @throws InsufficientCreditBalanceException when the customer has less credit than the payment needs
```

An uncertain outcome can warrant a separate entry even when its type belongs to the broader family. Verify inheritance; do not group unrelated classes under a parent they do not share.

There is no fixed exception-count limit. Preserve distinctions that require different caller actions or are required by the project. Usually omit incidental database, filesystem, framework, and programming errors unless they form part of the API contract. Do not add catch-all entries merely because anything could fail.

Document the actual mechanism: returned error, result variant, status code, panic, promise rejection, or thrown exception. Do not invent exception tags for returned errors or confuse synchronous throws with asynchronous rejection.

## 4. Follow the Actual Documentation Tool

Identify the language, tool, and sibling style before choosing tags, markup, or placement. Do not impose one language's template on another.

| Language or tool | Important distinctions |
|---|---|
| PHP / PHPDoc | Use supported symbol references and useful `@throws` entries; avoid redundant type tags. |
| JavaScript / TypeScript | Follow the project's JSDoc or TSDoc, which are not interchangeable. JSDoc types may be required for JavaScript checking. |
| Python | Follow the existing Google, NumPy, reStructuredText, or other docstring style; use sections only when useful or required. |
| Java / Kotlin | Follow Javadoc or KDoc syntax and checked-exception requirements. |
| C# | Use well-formed XML and the project's `summary`, `remarks`, `exception`, and `see` conventions. |
| Go | Start exported doc comments with the symbol name; explain returned errors and partial results in prose. |
| Rust | Follow rustdoc conventions for Errors, Panics, and Safety; never cut required unsafe preconditions for brevity. |
| C / C++ | Follow the chosen style or Doxygen setup; preserve ownership, lifetime, error-code, precondition, and exception guarantees. |
| Swift | Follow project markup for parameters, returns, and thrown errors; distinguish throws from other failure results. |
| Other languages | Read a sibling and the documentation tool's guidance. |

Use symbol references only when they help readers understand or use the API. Do not duplicate an inline reference with a standalone tag without a reason, add decorative URLs, or change behavior to enable a link.

Verify resolution and syntax for the actual tool: PHPDoc `{@see ...}`, Javadoc links, rustdoc links, and C# `cref` are not interchangeable. A valid tag, formatter, or static-analysis pass does not prove that a renderer supports a clickable link. Consult tool documentation or run the relevant documentation check when needed.

## 5. Write and Validate

Assume readers know the language, not this code's design. Use direct actors and actions, short sentences, and common words. Avoid both abstract wording and conversational simplification. Prefer “Check whether the provider charged the customer” over “Resolve the unsettled provider outcome.”

Keep precise terms, identifiers, statuses, units, and error names. Explain consequences when useful rather than replacing terms with vague substitutes. Pending is not failed; a saved attempt need not be an exact copy of the original request. Preserve conditions such as an idempotency key's time limit.

Avoid empty introductions, unsupported praise such as “safe” or “thread-safe,” change-history notes, and speculation about future features. Put warnings before background detail. Ask of each sentence: **What would the reader misunderstand or do wrong without this?** Cut it if nothing; rewrite it if shorter wording changes the claim or obscures who does what.

Before finishing:

1. Compare claims with implementation, callers, and tests, especially failure state, retry advice, result meaning, and exception propagation. Give every meaningful in-scope entry point the same care, not identical length or headings.
2. Check contract obligations against implementations and consuming classes. If another valid implementation could omit a named class or backing property, remove that requirement from the contract docs.
3. Remove duplicate explanations, obvious comments, redundant tags, and composition inventories. Verify syntax and symbol references; remove imports made unused by deleted tags when safe.
4. Inspect the diff for documentation-only scope, allowing necessary documentation references or imports. Do not format unrelated files.
5. Run required project checks, scoped where supported. Run documentation builds, doctests, or focused tests when docs affect execution or tools, such as Rust/Python doctests, type-bearing JSDoc, or framework annotations. Comments are not always inert.
6. For ordinary prose-only changes, do not edit tests or run a broad suite just to validate wording. A formatter cannot prove the prose is true.

Report the changed files, documentation focus, checks actually run, and material unresolved ambiguity or unavailable tools. Do not claim rendered links, tests, or behavior were verified when they were not, or paste the documentation unless asked.
