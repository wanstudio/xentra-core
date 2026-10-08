# Xentra — Sale → Cost of Sales Posting Integration v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-08  
**Scope:** Canonical Product Stock sale consumption and immutable Cost of Sales snapshot at the sale/acceptance boundary.

## 1. Boundary

```text
Sale / Branch Acceptance
        ↓
Inventory resolves Product Moving Average
        ↓
Product Stock OUTBOUND (SALE)
        ↓
historical movement cost evidence
        ↓
Cost of Sales snapshot
```

A pending customer order does not permanently reduce stock before the existing Branch Acceptance boundary.

## 2. Inventory Authority

Inventory owns Product Stock quantity, valuation state, canonical `SALE` movement, and the historical unit/total cost actually applied.

The sale path must not read Product master cost fields, Menu cost, selling price, supplier current price, or legacy Product stock as a cost authority.

## 3. Cost of Sales

The Cost of Sales snapshot is created only from canonical Product `SALE` movement evidence.

```text
Cost of Sales line = absolute SALE movement total cost
Aggregate snapshot = sum of immutable SALE movement costs
```

No COGS value is reconstructed later from Menu Composition Cost or current master data.

## 4. Cost Availability

A canonical COGS snapshot is `AVAILABLE` only when every stock-managed Product in the sale was successfully posted through canonical Product Stock and every movement has an authoritative cost.

During migration, a Product that still exists only in legacy branch stock may continue through the legacy compatibility path. Such a sale does not receive a canonical COGS snapshot because no canonical cost-bearing Product movement exists.

The system must not silently turn this state into zero COGS.

## 5. Currency

One sale snapshot has one currency. Mixed-currency canonical sale cost lines are rejected. Currency conversion is a separate future contract.

## 6. Atomicity

```text
BEGIN
  ↓
resolve Product costs
  ↓
decrement Product Stock
  ↓
append SALE movements
  ↓
write Cost of Sales snapshot
  ↓
commit sale/acceptance
```

Any failure rolls back the physical stock and Cost of Sales mutation together.

## 7. Idempotency

Each Product movement has a stable movement-level `posting_mutation_id`.
A completed canonical sale can be replayed safely without creating another Product Stock movement or another Cost of Sales snapshot.

## 8. Migration Boundary

`branch_products` / `branch_product_inventory` remain compatibility structures until Product Stock migration is accepted.
A legacy fallback is explicit migration behavior, not a new valuation authority.

**LOCKED — Sale → Cost of Sales Posting Integration v1.**