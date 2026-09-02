---
name: xentra-ponytail-review
description: Review Xentra changes for unnecessary complexity, speculative abstraction, duplicated responsibility, and architecture churn before completion.
---

# Xentra Ponytail Review

## Objective
Review a proposed Xentra change for unnecessary complexity without weakening the business contract, security boundaries, or domain architecture.

## Review scope
Inspect the actual diff and ask:
- Did the change add an abstraction that current callers do not need?
- Did it duplicate an existing responsibility instead of extending the owner?
- Did it add a dependency where the current stack is sufficient?
- Did it broaden the change into unrelated refactoring?
- Did it introduce configuration or indirection only for hypothetical future cases?
- Did it move logic across domain boundaries merely to reduce local code?

## Xentra override
Notion's locked decisions and invariants outrank simplicity preferences.
A larger change is justified when it establishes a required domain boundary, security boundary, transaction boundary, stable cross-domain contract, or reusable responsibility required by current callers.

## Evidence
Base the review on:
1. current Git diff/history,
2. current repository structure and callers,
3. relevant Notion requirement/decision,
4. concrete maintenance or correctness impact.

Do not reject a design merely because a smaller diff exists in theory.

## Findings
Classify observations as:
- unnecessary complexity,
- duplication,
- speculative abstraction,
- justified architectural change,
- or no issue.

For a finding state the exact code path and the simpler valid alternative.

## Completion check
The final implementation should be as small as practical while still preserving required boundaries, correctness, security, data integrity, and maintainability.