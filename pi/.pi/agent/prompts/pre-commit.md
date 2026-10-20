---
description: Review the intended commit for correctness, useful tests, and unnecessary complexity
argument-hint: "[scope or focus]"
---
Perform a read-only pre-commit review.

Scope or focus: ${@:-Use the current approved slice.}

Use the `peer-review`, `refactor`, `writing-tests`, and `code-documentation` skills. Check correctness, justified simplifications, test value or redundancy, and in-code documentation against our documentation rules. Identify retained coverage before recommending test removal.

Run necessary focused checks or clearly reuse still-current results. Report readiness, actionable findings, and verification limits. Separate regressions from existing issues.

Do not edit, stage, or commit. Propose cleanup and wait for approval. Never override environment or configuration without approval.
