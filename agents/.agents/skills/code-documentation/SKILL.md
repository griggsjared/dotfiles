---
name: code-documentation
description: Write, revise, or assess in-code documentation in any language. Use when asked to document a class, service, module, interface, protocol, trait, concern, mixin, public API, entry point, function, method, docblock, docstring, or inline comment; explain a workflow or contract in code; improve exception documentation; or remove obvious, repetitive, or wordy comments. Focus on purpose, caller expectations, and reasons that code alone does not explain. Use plain technical English and the language's existing documentation conventions. This is a documentation task, not permission to refactor behavior or create external docs.
---

# Code Documentation

Help a reader understand why code exists, when to use it, and what matters when calling or changing it.

Put the main explanation at the public entry point. Give its class or module a short statement of responsibility. Use private-method docs and inline comments only for useful details that do not belong at the entry point.

These instructions are thorough so the resulting documentation can be short. Do not turn this skill's checklist into a checklist in every docblock.

## Scope

- Follow repository instructions, language conventions, and the user's chosen style. Required API or safety documentation takes priority over this skill's defaults for brevity.
- If asked for advice or assessment, explain what belongs where without editing. If asked to add or revise docs, make the smallest useful change.
- Read the named code and one relevant sibling before editing. Preserve the user's existing changes.
- Stay within the approved files. Related code is context to read, not permission to document the whole call graph.
- Do not change behavior, signatures, visibility, names, control flow, exception handling, or tests to make documentation easier to write.
- Do not add a documentation generator, dependency, configuration file, README, or other external document unless requested.
- Imports used only by documentation are acceptable when the language and project support them. Do not introduce runtime imports or dependency cycles just to shorten a reference.
- Do not commit unless explicitly asked.

## 1. Establish the Facts

Before writing, answer these questions from the code:

1. What job does this component own? What nearby job belongs elsewhere?
2. What are its real entry points? Include exported functions, public methods, handlers, or other caller-facing operations as appropriate. Include methods consumed through composition even when their declared visibility is protected. Public visibility alone does not make a constructor or trivial accessor worth documenting.
3. What does a caller need to know that the name and signature do not say?
4. What state can change? What does success mean? Can work remain incomplete after a successful return?
5. What happens on a retry, partial failure, cancellation, or concurrent call, if relevant?
6. What failures can reach the caller, and which require different handling?
7. For a contract or composed behavior, what must implementations or consuming classes provide, and what may their callers rely on?

Read implementations, nearby callers, and relevant tests to check these answers. Follow delegated calls far enough to verify claims about results, side effects, and errors. Do not inventory the entire application or every possible infrastructure failure.

Treat existing comments as claims to check, not proof. A method named `save` does not prove durability; a transaction does not prove external work rolls back; a lock does not prove the whole operation is safe to retry.

Do not promise more than the code guarantees. In particular, verify claims such as:

- safe to retry or idempotent
- atomic or all-or-nothing
- never charges twice
- always releases resources
- leaves state unchanged on failure
- thread-safe or cancellation-safe
- guaranteed ordering or freshness

If the intended behavior is unclear, ask a focused question. If code contradicts the desired docs, report the mismatch rather than documenting a guarantee that does not exist or silently fixing the code.

## 2. Choose Where Each Fact Belongs

| Location | Explain | Usually omit |
|---|---|---|
| Class, service, or module | Its responsibility and the boundary with nearby components | Method inventory, dependency list, detailed workflow |
| Public entry point | Purpose, important caller expectations, result meaning, relevant side effects and failures | A line-by-line account of implementation |
| Private helper | A hidden assumption, special recovery role, or constraint needed to change it safely | A sentence made from its method name |
| Inline comment | Why this decision, ordering, guard, or exception boundary matters here | What the next statement does |

Put each fact where a reader needs it. Do not repeat the whole explanation at every level. A brief entry-point warning and a local explanation of the mechanism can both be useful; identical paragraphs are not.

### Contracts and Composed Behavior

For an interface, protocol, or abstract API, document the guarantees consumers may rely on and the obligations each implementation must meet. Focus on contract facts that signatures do not encode, such as required state or lifecycle, semantic rules for hooks, required properties or collaborators, ordering, and who owns a failure or recovery step. Omit implementation details and guarantees that the implementations do not support.

For a trait, concern, mixin, or similar composition unit, explain the shared behavior and its boundary: what the consuming class must provide, how and when it should apply the behavior, and what callers receive through the class. Document an externally consumed method even when composition makes it protected. Describe what a hook must accomplish and when it runs, not just its signature.

Document required behavior, not the implementation that currently supplies it. If a component requires abstract hooks, do not prescribe a named sibling trait or class merely because current consumers use it. Name a concrete implementation only when the documented code actually depends on it or callers need that reference to choose the correct API. Do not repeat composition already visible in `use`, `implements`, or import statements.

Distinguish direct dependencies from implementation choices. Direct property access requires the consuming class to supply that property; an abstract accessor requires a method with the declared return type, not a particular backing property. Document actual one-way dependencies without turning the current composition into a requirement.

Keep the shared contract at its declaration or composition unit. Keep host-specific workflow at the host entry point rather than duplicating that workflow in the shared unit. Include only obligations relevant to the abstraction; do not force an exhaustive checklist onto every trait. Do not invent a documentation-only interface or change behavior to make the documentation cleaner.

### Class or Module Purpose

Usually use one short paragraph, or a purpose sentence followed by a boundary sentence.

Explain the work this component owns. Mention a neighboring component only when that helps readers choose the right entry point or avoid an unsafe use.

Do not start with empty phrases such as "This class is responsible for" or "Provides methods to." Do not describe the constructor's dependencies unless ownership or lifetime is part of the public contract.

For example, if supported by the code:

```php
/**
 * Collects order payments using account credit, a payment provider, or both.
 *
 * Starts new payments and continues saved ones. If an order is waiting for a payment
 * result, use the payment reconciler instead.
 */
```

A small class with one obvious purpose may not need more than one sentence. A module that has no useful role-level explanation does not need a ceremonial summary.

### Public Entry Points

Start with the purpose of the operation, not a paraphrase of its name. Then add only facts that affect how callers use it.

Useful facts can include:

- when to call this operation rather than a related one
- whether saved state takes priority over new input
- what a successful result does and does not mean
- whether the operation may leave work pending
- caller obligations before or after the call
- important side effects, ownership, lifetime, or units
- failure conditions that require a caller to act differently

Do not fill every category. A simple method may need one sentence; a payment or recovery entry point may need several short paragraphs.

If a component has multiple meaningful entry points, document all in-scope entry points using the same standard. Each needs its own purpose and relevant expectations, not identical headings or equal length. Explain meaningful differences between starting, retrying, canceling, and recovering rather than pasting shared text into each method.

Do not add parameter or return tags that merely repeat types and names. Keep tags required by the toolchain or needed for shapes, generics, ownership, units, valid values, or result meaning that the signature cannot express.

### Workflow Lists

A short Markdown list is useful when it makes a multi-stage workflow easier to understand. It is optional, not a standard section to add everywhere.

- Prefer a few meaningful stages, usually three to five.
- Describe domain decisions, not local variables or helper calls.
- Use bullets for priorities or conditional paths. Use numbers only when they represent a real sequence.
- Replace overlapping prose with the list; do not keep both.
- Keep branch details and local safety reasons beside the code.
- Use plain text if the project's documentation tool does not render Markdown lists.

For example:

```php
/**
 * Collect a full or partial payment, at checkout or without the customer present.
 *
 * - Continue a saved payment attempt before accepting new payment choices.
 * - Start a new attempt only if money is still owed and no attempt is already open.
 * - Mark the order paid only when nothing is owed and no attempt is still waiting for a result.
 *
 * A successful payment does not mean the whole order is paid.
 */
```

Do not turn this into "load the order, assign the user, call the resolver, return the result." That is code in sentence form.

### Private Methods and Delegation

Default to no private-method docblock. A clear name and signature are often enough.

Add one when the helper has a non-obvious role, such as recovering incomplete work, preserving a compatibility rule, or requiring a lock or reservation established by its caller. State the assumption and why it matters. Do not restate the algorithm.

An entry point that mostly delegates can still need important documentation. Its purpose is the caller-facing operation, not "calls these helpers."

Place a short comment at a delegation decision when the reason for choosing that path is not apparent. For example:

```text
An order can stop accepting payments while credit is still held for an earlier attempt.
Check that payment to decide whether to use or return the held credit. Do not start a new charge.
```

Do not add a comment above every branch. A guard that clearly rejects a negative number needs no narration unless the reason for that restriction is surprising.

## 3. Document Failures Callers Can Use

Document important failure behavior, not a complete inventory of dependency exceptions.

Trace catches, conversions, rethrows, and returned failures before adding tags. A dependency throwing an exception does not mean the entry point exposes it. A provider decline returned as data must not be documented as a thrown exception.

For each failure worth documenting, identify:

- the type or result callers receive
- the condition that produces it
- any important state left behind or required next action

Use the project's stable exception or error family when several failures share the same caller response. Name a subtype separately when handling it as an ordinary failure would be unsafe or misleading.

For example, a payment API might need only:

```php
 * @throws PaymentException when the request, saved attempt, or provider cannot complete the payment
 * @throws PaymentOutcomeUnknownException when a provider request may have taken effect; do not assume payment failed
 * @throws InsufficientCreditBalanceException when the customer has less credit than the payment needs
```

The broader type may include the named subtype. Highlighting it separately is useful if callers must distinguish an uncertain outcome from a confirmed failure. Do not collapse unrelated exception classes under a parent they do not share.

A few useful entries are better than a long list, but there is no fixed limit. List more when distinct caller actions or project requirements justify them. Do not hide meaningful error distinctions merely to meet a count.

Usually omit generic database, filesystem, framework, and programming errors unless they form part of the API's documented behavior. Do not add `Throwable`, `Exception`, or equivalent catch-all entries simply because anything could fail.

Returned errors, result variants, status codes, panics, rejected promises, and thrown exceptions are different mechanisms. Document the one the caller actually receives. Do not invent `throws` tags for a language that returns errors.

## 4. Use the Language's Documentation Conventions

Keep the principles language-agnostic, not the syntax. Identify the actual language, documentation tool, and sibling-file style before choosing tags, markup, or placement.

| Language or tool | Usual form and important distinctions |
|---|---|
| PHP / PHPDoc | `/** ... */`, useful `@throws` entries, and supported symbol references. Avoid redundant `@param` and `@return` types. |
| JavaScript / TypeScript | Follow the project's JSDoc or TSDoc conventions; they are not interchangeable. Distinguish synchronous throws from promise rejection. JSDoc types may be required for checking JavaScript. |
| Python | Follow the project's docstring style, such as Google, NumPy, or reStructuredText. Use its Returns, Raises, or other sections only where useful or required. |
| Java / Kotlin | Follow Javadoc or KDoc syntax and checked-exception requirements. Do not copy another language's inline links or tags. |
| C# | Use the project's XML documentation conventions, including useful `summary`, `remarks`, `exception`, and `see` elements. Keep XML well-formed. |
| Go | Use doc comments that start with the exported name. Explain returned errors and partial results in prose; do not add exception tags. |
| Rust | Use rustdoc and the project's conventions for Errors, Panics, and Safety. Keep required unsafe preconditions explicit; brevity is not a reason to remove them. |
| C / C++ | Follow the chosen style or Doxygen setup. Ownership, lifetimes, error codes, preconditions, and exception guarantees often matter more than flow lists. |
| Swift | Follow the project's documentation markup for parameters, return values, and thrown errors. Distinguish throws from other failure results. |
| Other languages | Read a relevant sibling and the documentation tool's guidance. Do not force PHPDoc or any other template onto it. |

This table is a starting point, not permission to change a project's chosen format.

### References and Links

Use a symbol reference only when following it helps the reader understand or use the API.

- An inline reference can keep a sentence readable without adding a separate reference list.
- Do not add both an inline reference and a standalone tag for the same point without a reason.
- Verify symbol resolution and syntax for the actual documentation tool. PHPDoc `{@see ...}`, Javadoc links, rustdoc links, and C# `cref` are not interchangeable.
- A valid tag does not guarantee that every editor renders it as a clickable link.
- Formatting and static analysis alone do not prove a documentation renderer supports a tag. Check tool documentation or run the project's documentation check when needed.
- Do not add URLs or cross-references as decoration. Do not change code just to make a reference possible.

For PHPDoc, an inline reference can look like `{@see PaymentException}`. Use it only where the surrounding sentence explains why that reference matters.

## 5. Write Plain Technical English

Assume the reader knows the language but does not know why this code was designed this way. Use direct technical prose: neither formal and abstract nor conversational and oversimplified. Short is not enough; a short sentence can still be hard to understand.

- Say who does what: the customer pays, the provider may have charged them, the method returns an error. Avoid abstract phrases such as "resolve the unsettled provider outcome" when "check the result of an existing payment" says what you mean.
- Prefer two clear sentences over one sentence packed with conditions and technical nouns.
- Use short sentences and concrete subjects.
- Prefer common words: "use," "start," "keep," "check," "before," and "after."
- Keep exact technical terms when they matter: payment attempt, reserved credit, pending, idempotency key, transaction, lock, and ownership. Do not replace a precise term with a longer lay explanation; explain its consequence when useful.
- Prefer "The provider may already have charged the customer" to "The operation may have produced non-idempotent downstream side effects."
- Avoid "utilizes," "facilitates," "leverages," "aforementioned," and "in order to."
- Avoid introductions such as "This method is used to" when a direct purpose sentence works.
- Do not call code robust, seamless, efficient, safe, or thread-safe without a precise, verified meaning.
- Do not narrate implementation history: "Added support for," "Now handles," or "Refactored from."
- Do not speculate about future features or explain an abstraction the code does not have.
- Preserve exact identifiers, statuses, units, and error names when they help readers act correctly.
- Do not bury a warning under background detail.

Apply the removal test to each sentence: **What would the reader misunderstand or do wrong without this?** If the answer is nothing, remove it.

Then apply the plain-English test: **Would this be clear in technical documentation without sounding abstract or overly conversational?** If not, rewrite it. This applies to class summaries, entry-point docs, error descriptions, and private comments alike.

### Choose Direct, Precise Wording

These are examples of the target tone, not a list of banned words or automatic replacements:

| Formal or abstract | Too conversational | Plain technical English |
|---|---|---|
| Resolve the unsettled provider outcome. | Find out what happened to a payment already started. | Check the result of an existing payment. |
| The provider outcome must be resolved before another payment begins. | We need to know whether the provider charged the customer before starting another payment. | Check whether the provider charged the customer before starting another payment. |
| The saved payment method need not remain available. | It is okay if the old payment method is gone. | The existing payment can be checked even if its saved payment method is no longer available. |
| A successful result applies to this payment, not necessarily the whole order. | Success here does not mean everything is paid. | A successful payment does not mean the whole order is paid. |
| The credit portion exceeds the available balance. | There is not enough credit to cover it. | The customer has less credit than this payment needs. |
| The operation preserves the previously published revision on failure. | Readers keep seeing what was there before if this goes wrong. | If this fails, readers still see the last published version. |

Keep terms that carry a precise meaning. For example, keep "payment attempt," "reserved credit," "pending," and "idempotency key." Explain that an idempotency key lets the provider recognize a retry as the same payment when that consequence matters; do not replace it with a vague phrase such as "safety value." Keep the key's time limit or other conditions when they matter.

Do not simplify away distinctions. A pending payment is not a failed payment. A saved attempt is not necessarily an exact copy of the original request. Names such as `PAYMENT_PENDING` can be clearer than shorthand such as "parked." If a simpler sentence changes the claim, it is not an improvement.

### Why, Not What

Weak:

```text
Check the external payment setup before reserving credit.
```

Useful:

```text
Do not reserve the customer's credit if we already know the rest cannot be charged.
```

Weak:

```text
Set the release flag to false.
```

Useful:

```text
The provider may already have charged the customer, even if we did not save the result.
Keep the credit reserved until the payment result is known.
```

Weak:

```text
Begin a transaction and create both records.
```

Useful:

```text
If this fails, we need a payment record to find and return any credit still on hold.
```

These examples are conditional on the code actually providing those guarantees. Copy the reasoning style, not an unverified claim.

### Same Principles, Different Languages

A Python docstring can explain a non-obvious result without restating its type:

```python
"""Save the draft without publishing it.

The returned revision identifies the saved draft. Readers still see the last
published revision until publish() succeeds.

Raises:
    RevisionConflict: Another writer saved a newer draft; reload before retrying.
"""
```

A Go comment can explain an error and its side effects without exception tags:

```go
// Publish makes a saved revision visible to readers.
// It returns ErrRevisionConflict if a newer draft exists; the currently published
// revision remains visible in that case.
```

Use the project's format, and verify the behavior in each example before applying similar wording. Do not add every possible section because the language supports it.

## 6. Check the Change

Before finishing:

1. Read the docs alongside the implementation, relevant callers, and tests. Check every behavioral claim, especially failure state and retry advice.
2. Check that all meaningful entry points in scope received the same level of care.
3. Check that class docs state responsibility, entry-point docs serve callers, and local comments explain reasons.
4. Remove duplicate prose, obvious comments, and tags that repeat the signature.
5. Verify exception inheritance, propagation, result meanings, symbol references, and language-specific syntax.
6. For contracts and composed behavior, compare the documentation with implementations, consuming classes, and relevant calls. Check that every stated obligation and guarantee is supported and placed at the shared or host boundary where readers need it. For each named implementation or backing property, ask: could another implementation satisfy the declared contract without it? If yes, remove that reference from the contract docs. Remove composition notes that merely repeat declarations.
7. Inspect the diff. It must contain only requested documentation changes and any necessary documentation references or imports. Remove imports made unused by deleted tags when safe.
8. Run required project checks, scoped to the touched files when supported. Avoid repository-wide formatting changes.
9. Run documentation builds, doctests, or focused tests if the changed documentation is executable or affects tools. Examples include Rust doctests, Python doctests, JavaScript type-bearing JSDoc, and annotations consumed by frameworks. Do not assume all comments are inert.
10. For ordinary prose-only changes, do not edit tests or run a broad test suite solely to validate wording. Follow repository requirements and state which checks actually ran. Passing a formatter is not proof that the prose is true.
11. Read the result as technical documentation. Replace abstract or overly conversational phrases with clear actors and actions, then cut words that do not help the reader. Do not remove precise terms or conditions just to shorten a sentence.

If a documentation check or required tool is unavailable, say so. Do not claim rendered links, tests, or behavior were verified when they were not.

## Finish

Report the files changed, the documentation focus, and checks actually run. Mention a material unresolved ambiguity if one remains. Keep the response short; do not paste all the documentation unless asked.

The desired result is useful context at the entry point, a clear responsibility at the class or module, and a small number of comments that protect decisions a reader could otherwise undo. More comments are not the goal.
