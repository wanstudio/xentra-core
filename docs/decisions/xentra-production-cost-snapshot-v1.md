# Xentra — Production Cost Snapshot v1

**Status:** 🔒 LOCKED / ACTIVE TARGET IMPLEMENTATION  
**Decision date:** 2026-10-08
**Scope:** Historical direct-material Production Actual Cost and Production Output Unit Cost created at Production Batch completion.

## 1. Authority
Production owns the transformation record and production cost evidence of a completed Production Batch.
Inventory owns physical Material/Product Stock balances and stock movement cost evidence.
Costing consumes the production snapshot; it does not create a second production stock ledger.

## 2. Snapshot Boundary
Only a successful `IN_PROGRESS → COMPLETED` Production Batch creates a Production Cost Snapshot.

```text
Production Batch IN_PROGRESS
        ↓
resolve actual Material consumption cost
        ↓
Production Actual Material Cost
        ↓
Actual Output Quantity
        ↓
Production Output Unit Cost
        ↓
immutable Production Cost Snapshot
```

Status changes before completion do not create a cost snapshot.

## 3. Cost Formula
v1 is direct-material only:

```text
component actual cost
  = actual Material Base Stock UOM quantity
    × Material Moving Average Unit Cost resolved at posting

Production Actual Cost
  = Σ(component actual cost)
```

Labor, overhead, utilities, packaging overhead, freight allocation, and accounting allocation are out of scope.

## 4. Output Cost
For the one-main-output v1 model:

```text
Production Output Unit Cost
  = Production Actual Material Cost
    ÷ Actual Output Quantity
```

Actual output must be positive and valid for the Product Stock UOM.

## 5. Historical Evidence
The snapshot preserves:
- production_batch_id;
- production_posting_id;
- actual material cost;
- actual output quantity;
- Production Output Unit Cost;
- currency;
- availability state.

Snapshot lines preserve each consumed Material's normalized Base quantity, resolved unit cost, total cost, input Stock Location, and Inventory movement reference.

## 6. Atomic Completion
Production completion is one transaction owned by the Production application boundary and using the Inventory posting boundary for physical stock:

```text
BEGIN
  → resolve Material costs
  → decrement Material Stock
  → append PRODUCTION_ISSUE movement
  → calculate Output Unit Cost
  → increment Product Stock
  → append PRODUCTION_OUTPUT movement
  → write Production Cost Snapshot
  → mark Batch COMPLETED
COMMIT
```

Any failure rolls back all related physical and cost mutations.

## 7. Idempotency
One stable `production_posting_id` identifies a completion posting.
Replaying the same posting for the same Batch returns the original snapshot/evidence and does not mutate stock again.
A posting identity cannot be reused for a different Batch.

## 8. Currency
All Material costs contributing to one Production Cost Snapshot must use one currency.
Mixed-currency consumption is rejected in v1. Currency conversion requires a separate explicit contract.

## 9. Recipe Version
The completed Batch retains the exact `recipe_version_id` used for execution.
Changing or publishing a later Recipe Version never rewrites an existing snapshot.

## 10. Availability
Canonical completion requires `AVAILABLE` Material costs.
`ESTIMATED` and `UNAVAILABLE` cost states cannot become a completed actual-cost snapshot.

## 11. Correction
Completed snapshots are immutable. Physical correction requires compensating Inventory mutations and a later explicit Production reversal/correction contract.

**LOCKED — Xentra Production Cost Snapshot v1.**