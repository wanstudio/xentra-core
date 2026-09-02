---
name: xentra-business-logic
description: Reason about Xentra business workflows, domain boundaries, state transitions, and conflicts without inventing rules.
---

# Xentra Business Logic

## Objective
Preserve business intent while allowing implementation to improve.

## Domain boundary
Reason explicitly about:
Organization -> Brand -> Branch -> Product -> Inventory -> Order -> Fulfillment -> Payment -> POS.

Do not infer ownership or authority merely from where data is displayed.

## Important invariants
- Brand and Branch are distinct.
- Inventory responsibility is branch-level.
- One cart represents one fulfillment merchant.
- Cross-brand recommendation does not imply cross-cart fulfillment.
- Order state and payment state are separate state machines.
- Cash can be operationally confirmed before cash is financially settled.
- Cash settlement must have valid financial attribution; active cashier shift resolution is server-authoritative.
- Inventory mutations and financial ledger effects must be consistent and idempotent.
- Historical financial/order evidence must remain auditable.

## State changes
Before changing a state transition, identify:
- current state,
- requested transition,
- actor,
- authorization scope,
- side effects,
- idempotency behavior,
- audit evidence,
- rollback/refund/restock implications.

Do not call a valid intentional state combination a bug merely because another platform uses different terminology.

## Conflict analysis
When implementation conflicts with documentation:
1. Verify both.
2. Determine which source is stale or whether the implementation is an intentional evolution.
3. Do not change code solely to make terminology look conventional.
4. Escalate only when a business invariant is actually violated.

## Multi-client scaling
Prefer stable core domain contracts with client/brand configuration where variation is presentation/configuration rather than business behavior. Do not create client-specific forks without a real domain requirement.

## UI component boundary
Reusable cards/components should render a defined view-model/data contract. They should not silently decide authoritative tenant, branch, price, inventory, payment, authorization, or financial mutations.

## Business change methodology
When a better mechanism is discovered, document the reason and affected invariants rather than freezing the old implementation.
