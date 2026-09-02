---
name: xentra-database
description: Audit Xentra database integrity, transactions, constraints, concurrency, inventory, payment, and auditability.
---

# Xentra Database & Integrity

## Objective
Protect correctness of persisted state across tenants, branches, inventory, orders, payments, POS, and audit records.

## Audit checklist
Inspect:
- primary/foreign keys,
- unique constraints,
- nullability,
- ownership relationships,
- transaction boundaries,
- isolation/concurrency behavior,
- update/delete cascades,
- duplicate prevention,
- idempotency keys/references,
- ledger/event evidence,
- historical snapshots.

## Atomicity
When one business operation produces multiple consequential writes, determine whether partial completion is possible.

Examples:
- payment settlement + payment record + inventory deduction + inventory movement + audit/event,
- cash settlement + shift attribution,
- order transition + audit record.

If atomicity is required, verify the actual transaction boundary rather than assuming one.

## Concurrency
For inventory, payment, settlement, shift, and state transitions, test reasoning under simultaneous/replayed requests.

Ask:
same input + same state + concurrent execution -> can both succeed and create an invalid combined result?

## Idempotency
Retries and duplicate external events must not create duplicate financial, inventory, or state side effects.

## Inventory
Inventory is branch-scoped. Verify that product availability and deductions cannot cross unauthorized branches and that mutation semantics match the documented business lifecycle.

## Financial integrity
Payment state, cash collection, settlement, refunds, and shift attribution are distinct concerns. Do not conflate operational order state with financial state.

## Historical integrity
Historical transaction evidence should remain reconstructable after current configuration changes. Do not derive past financial truth solely from mutable current configuration.

## Database-first skepticism
Application checks are not a substitute for database integrity when a database constraint/transaction can enforce the invariant safely.

## Finding classification
Distinguish confirmed data-integrity defects from hardening opportunities. Explain the exact inconsistent state that could occur.
