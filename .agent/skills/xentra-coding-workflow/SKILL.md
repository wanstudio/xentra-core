---
name: xentra-coding-workflow
description: Implement Xentra changes safely from Notion requirements to minimal Git patches while preserving domain contracts, reuse, and operational correctness.
---

# Xentra Coding Workflow

## Purpose
Turn a requested Xentra change into an implementation plan and a focused patch. Use this for normal feature work, refactors, and bug fixes.

## Before coding
1. Read the relevant Notion decision/requirement and identify locked invariants.
2. Inspect git status, recent commits, and relevant files/diff.
3. Trace the current flow before designing a new abstraction.
4. Identify the domain owner of the behavior and the correct application boundary.
5. Check whether a shared component/service/contract already exists.

## Implementation rules
- Change the smallest boundary that owns the behavior.
- Preserve existing business contracts unless Notion explicitly changes them.
- Prefer domain/service logic over controller, route, UI, or test-only business rules.
- Prefer reuse when responsibility is the same; do not abstract unrelated behavior just to reduce line count.
- Keep authoritative values server-side: tenant, branch, price, inventory, payment, permissions, and financial effects.
- Do not duplicate business rules across PWA, POS, dashboard, and API clients.
- Do not introduce a new field, state, endpoint, order type, or domain just because it is convenient for implementation; first verify the contract.
- Do not silently broaden scope during a fix.

## Cross-boundary change
For changes crossing domains, trace:
`client -> route/middleware -> application service -> domain/service -> repository/database -> side effects/events -> response`.

Confirm each boundary owns only its responsibility and passes explicit contracts between layers.

## Refactoring
Before moving or renaming code, search all call sites and public contracts. Preserve behavior first; improve structure second. Do not mix an unrelated architectural rewrite into a feature fix.

## Configuration and secrets
Configuration may select behavior but must not become an authorization bypass or replace business rules. Secrets, deployment tokens, signing keys, and credentials never belong in source code.

## Definition of done
A coding task is done when:
- the requested behavior is implemented at the correct owner boundary;
- locked Notion invariants still hold;
- no known caller is broken;
- the relevant runtime path is wired;
- documentation is updated when the contract/decision changed;
- the patch is committed with a clear WHAT + WHY.

## Completion record
For meaningful work, record:
`Requirement -> affected domain -> implementation boundary -> changed files -> invariants preserved -> verification -> remaining uncertainty`.
