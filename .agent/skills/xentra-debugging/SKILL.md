---
name: xentra-debugging
description: Diagnose Xentra UI, PWA, backend, and integration problems through reproducible evidence and root-cause analysis.
---

# Xentra Debugging

## Objective
Find the root cause, not the first plausible fix.

## Workflow
1. Reproduce.
2. Define exact expected vs observed behavior.
3. Inspect the smallest relevant boundary.
4. Compare with a known-working implementation when useful.
5. Trace ownership and event/data flow.
6. Form hypotheses.
7. Test hypotheses.
8. Implement the smallest justified fix.
9. Run regression validation.
10. Verify on the affected runtime/device when relevant.

## UI/PWA
For nested scroll/touch/layout issues inspect:
- DOM hierarchy,
- containing blocks,
- flex/grid sizing,
- min-width/min-height constraints,
- overflow/clipping,
- scroll container ownership,
- touch-action,
- pointer/touch event handling,
- passive listeners,
- viewport/runtime differences,
- service-worker/cache effects.

Do not prescribe a CSS property from pattern recognition alone.

## Reuse architecture
Repeated UI objects should use shared components/contracts where responsibility is the same. Do not solve duplication by runtime-fetching HTML templates for every item unless there is a verified reason.

Preferred conceptual flow:
API/DB -> domain/service -> view model -> component -> page composition.

## Backend
Trace:
request -> middleware -> service -> DB -> side effects -> response.

For failures involving payment, inventory, orders, or POS, inspect transaction and idempotency behavior before changing status logic.

## Regression
A fix is incomplete until the original failure is prevented and nearby valid behavior remains valid.

## Troubleshooting record
For meaningful issues preserve:
Symptom -> Reproduction -> Scope -> Root cause -> Constraint/invariant -> Options -> Decision -> Verification -> Remaining uncertainty.

Do not turn a debugging hypothesis into a business rule.

## Performance
Optimize measured bottlenecks. Reuse and abstraction are primarily maintainability/consistency tools; they are not automatically runtime performance optimizations. Avoid adding network fetches, repeated DOM parsing, unnecessary renders, or duplicated event handlers merely to implement reusable templates.
