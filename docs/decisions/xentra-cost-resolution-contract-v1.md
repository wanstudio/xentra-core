# Xentra — Cost Resolution Contract v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-08  
**Scope:** Deterministic resolution of inventory cost for valuation-bearing Material Stock and Product Stock movements under the locked Moving Average policy.

**Prerequisite authorities:**
- docs/decisions/xentra-inventory-valuation-policy-v1.md
- docs/decisions/xentra-costing-vocabulary-revision-v1.1.md
- docs/decisions/xentra-costing-hpp-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/decisions/xentra-uom-master-precision-rounding-contract-v1.md
- docs/decisions/xentra-cost-bearing-stock-movement-data-model-v1.md
- docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md

## 1. Purpose

Cost Resolution answers:

> **For this stock identity, at this Stock Location, at this posting boundary, what cost basis is valid for the movement?**

Cost Resolution is a cross-domain service contract.

It is not:
- a Product master field;
- a Menu cost field;
- a second inventory ledger;
- a replacement for Stock Movement;
- a historical re-costing engine.

Canonical path:

~~~
Stock Location
      +
Stock Identity
      ↓
Valuation State
      ↓
Cost Resolution
      ↓
Stock Movement Cost Evidence
~~~

## 2. Ownership

Inventory owns:
- physical stock quantity;
- valuation state;
- stock movement posting;
- historical movement cost evidence.

Costing owns:
- cross-domain cost interpretation;
- derived cost views;
- Menu Composition Cost;
- COGS reporting semantics.

Catalog and Product master data are never valuation authorities.

## 3. Valuation Key

Every canonical valuation resolution is scoped by:

~~~
Stock Location
+
Stock Identity Type
+
Stock Identity ID
~~~

Stock Identity Type is exactly one of:

~~~
MATERIAL
PRODUCT
~~~

A Branch ID alone is insufficient.

## 4. Resolution Context

Canonical mutation context must include:

~~~
stock_location_id
stock_identity_type
stock_identity_id
direction
quantity_base
posting_reference
posting_mutation_id
posting_timestamp
actor / authorization context
~~~

Direction is:

~~~
INBOUND
OUTBOUND
~~~

Transfer is:

~~~
source OUTBOUND
+
destination INBOUND
~~~

Production material consumption, sale, waste, and negative stock adjustments are OUTBOUND.

Purchase receipt and production output are INBOUND.

Opening stock and positive count correction are INBOUND with explicit cost basis.

## 5. Authoritative Source

### OUTBOUND

For Moving Average:

~~~
outgoing_unit_cost
=
current_moving_average_unit_cost
~~~

It must be resolved from the valuation state of the exact Stock Location + Stock Identity at the posting boundary.

It must not read Product/Menu master cost fields or selling price.

Forbidden outbound valuation authorities:

~~~
products.cost_price
menus.cost_price
products.unit_cost
products.inventory_cost
selling_price
current supplier price
legacy inventory_po_items.unit_cost
last-known-cost fallback
~~~

### INBOUND

Inbound cost does not come from the current moving average.

The resolver validates a source-specific valuation input:

~~~
PURCHASE_RECEIPT
→ normalized accepted purchase cost

PRODUCTION_OUTPUT
→ Production Output Unit Cost

TRANSFER_CARRIED
→ source carried movement value

OPENING_ACTUAL
→ explicit opening unit cost

OPENING_ESTIMATE
→ explicit estimated opening unit cost

COUNT_CORRECTION
→ explicit adjustment unit cost
~~~

Then the Inventory valuation policy applies Moving Average to update the destination valuation state.

Therefore:

~~~
incoming valuation input
≠
current moving average
~~~

## 6. Cost Basis Vocabulary

Keep two concepts separate.

### Valuation Method

The algorithm:

~~~
MOVING_AVERAGE
~~~

### Cost Basis Type

Why the value is valid:

~~~
PURCHASE_RECEIPT
PRODUCTION_OUTPUT
TRANSFER_CARRIED
OPENING_ACTUAL
OPENING_ESTIMATE
COUNT_CORRECTION
CURRENT_MOVING_AVERAGE
~~~

Example:

~~~
valuation_method = MOVING_AVERAGE
cost_basis_type   = PURCHASE_RECEIPT
~~~

The method and basis are not interchangeable.

## 7. Resolution Result

A successful canonical resolution conceptually returns:

~~~
{
  status: AVAILABLE | ESTIMATED | UNAVAILABLE,

  valuation_method: MOVING_AVERAGE,

  stock_location_id: ...,
  stock_identity_type: MATERIAL | PRODUCT,
  stock_identity_id: ...,

  quantity_base: ...,
  unit_cost: ...,
  total_cost: ...,

  cost_basis_type: ...,
  valuation_state_reference: ...,

  source_type: ...,
  source_reference: ...,

  currency_code: ...,
  resolved_at: ...,
  resolver_version: ...
}
~~~

For OUTBOUND:

~~~
quantity_base
=
quantity being removed

unit_cost
=
cost assigned to removed quantity

total_cost
=
quantity_base × unit_cost
~~~

For INBOUND:

~~~
quantity_base
=
quantity entering stock

unit_cost
=
validated incoming valuation input

total_cost
=
quantity_base × unit_cost
~~~

The posting layer captures the result as historical movement evidence.

## 8. Cost Availability States

Canonical states:

~~~
AVAILABLE
ESTIMATED
UNAVAILABLE
~~~

AVAILABLE means an authoritative cost exists.

For canonical OUTBOUND posting, only AVAILABLE is accepted.

ESTIMATED is allowed only where an explicit policy permits a non-final planning/opening result. It must never become historical COGS.

UNAVAILABLE means no valid cost basis exists.

UNAVAILABLE must never become:

~~~
0
last known cost
selling price
products.cost_price
~~~

Zero is valid only when the underlying business input is explicitly zero.

## 9. Outbound Resolution Contract

Conceptual interface:

~~~
resolveOutboundCost({
  stockLocationId,
  stockIdentityType,
  stockIdentityId,
  quantityBase,
  postingReference,
  postingMutationId,
  postingTimestamp
})
→ CostResolutionResult
~~~

Rules:

1. Stock identity exists and is valid.
2. Stock Location exists and is active.
3. Quantity is positive and expressed in Base Stock UOM.
4. Valuation state is internally valid.
5. Available quantity is sufficient.
6. Current Moving Average cost is available when quantity is removed.
7. Result status is AVAILABLE.
8. Result is captured by the posted movement.
9. Resolution and stock mutation use the same canonical transaction boundary.

When available quantity is insufficient:

~~~
INSUFFICIENT_STOCK
~~~

No stale cost is returned.

## 10. Inbound Resolution Contract

Conceptual interface:

~~~
resolveInboundValuation({
  stockLocationId,
  stockIdentityType,
  stockIdentityId,
  quantityBase,
  costBasisType,
  incomingUnitCost,
  incomingTotalCost,
  sourceType,
  sourceReference,
  postingMutationId,
  postingTimestamp
})
→ CostResolutionResult
~~~

Rules:

1. Quantity is positive and normalized to Base Stock UOM.
2. Cost Basis Type is allowed.
3. Incoming cost is explicit and internally consistent.
4. incomingTotalCost = quantityBase × incomingUnitCost.
5. Negative incoming cost is forbidden.
6. Production output uses Production Output Unit Cost.
7. Transfer receipt uses carried source movement value.
8. Opening/positive adjustment provides explicit unit cost.
9. Result is applied to destination Moving Average.
10. Posted movement preserves the cost evidence actually used.

## 11. Moving Average State Transition

Cost Resolution does not own physical stock mutation, but canonical posting applies the valuation transition atomically.

INBOUND:

~~~
incoming_value
=
incoming_quantity × incoming_unit_cost

new_quantity
=
old_quantity + incoming_quantity

new_value
=
old_value + incoming_value

new_average
=
new_value ÷ new_quantity
~~~

OUTBOUND:

~~~
outgoing_value
=
outgoing_quantity × current_average

new_quantity
=
old_quantity - outgoing_quantity

new_value
=
old_value - outgoing_value
~~~

If quantity would become negative, posting fails.

## 12. Atomicity and Concurrency

Canonical valuation mutation is:

~~~
read valuation state
      ↓
resolve cost
      ↓
validate quantity
      ↓
apply stock quantity
      ↓
apply valuation state
      ↓
append cost-bearing movement
      ↓
commit
~~~

These operations must occur in one database transaction.

Two concurrent outbound operations must not both resolve the same stale stock/value state and succeed.

Therefore authoritative Cost Resolution is transaction-bound.

A read-only preview may expose current cost, but preview is never proof for a later mutation.

## 13. Transfer Resolution

Transfer has two resolutions:

~~~
SOURCE
  resolveOutboundCost
        ↓
  carried movement value
        ↓
DESTINATION
  resolveInboundValuation
~~~

Transfer carried unit cost:

~~~
transfer_carried_value ÷ transfer_quantity_base
~~~

Destination must not substitute supplier price, latest purchase price, destination previous average, or Product master cost.

Destination then re-averages under Moving Average.

## 14. Production Resolution

### Material consumption

~~~
Material Stock
→ resolveOutboundCost
→ actual component cost
~~~

The resolved component costs become evidence for:

~~~
Production Actual Material Cost
~~~

### Product output

~~~
Production Actual Material Cost
÷
Actual Output Quantity
=
Production Output Unit Cost
~~~

That unit cost becomes the Product Stock INBOUND valuation input.

Production does not read Product master cost.

## 15. Sale / COGS Resolution

For a stock-managed Product:

~~~
Product Stock
→ resolveOutboundCost
→ outgoing movement value
→ COGS snapshot
~~~

Under v1:

~~~
COGS
=
resolved outbound Product Stock cost
~~~

Sale must not substitute:

~~~
Menu Composition Cost
selling price
products.cost_price
~~~

The exact COGS document/schema remains a later selling/accounting stage. The valuation cost source is fixed here.

## 16. Historical Snapshot Rule

The resolver result used for a posted movement must be preserved as historical evidence.

At minimum:

~~~
stock_location_id
stock_identity_type
stock_identity_id
quantity_base
unit_cost
total_cost
valuation_method
cost_basis_type
source_type
source_reference
posting_mutation_id
posting_timestamp
currency_code
resolver_version
~~~

Later changes to master data or current valuation state must not rewrite historical movement cost.

## 17. Backdating

If a new posting would insert a valuation event before an already-posted event for the same:

~~~
Stock Location × Stock Identity
~~~

resolution must fail:

~~~
BACKDATED_VALUATION_REJECTED
~~~

Client occurred_at does not reorder valuation history.

## 18. Opening / Estimated Cost

Opening stock may produce:

~~~
AVAILABLE + OPENING_ACTUAL
~~~

or:

~~~
ESTIMATED + OPENING_ESTIMATE
~~~

An estimated opening value remains explicitly estimated evidence.

It must not later be presented as actual historical purchase cost without deliberate reconciliation.

## 19. Error Contract

Canonical errors:

~~~
STOCK_IDENTITY_NOT_FOUND
STOCK_LOCATION_INVALID
STOCK_LOCATION_INACTIVE
BASE_UOM_UNRESOLVED
INVALID_QUANTITY
INBOUND_COST_UNRESOLVED
COST_UNAVAILABLE
INSUFFICIENT_STOCK
VALUATION_STATE_INVALID
VALUATION_VALUE_MISMATCH
BACKDATED_VALUATION_REJECTED
SOURCE_REFERENCE_REQUIRED
TRANSFER_COST_SOURCE_INVALID
PRODUCTION_OUTPUT_COST_REQUIRED
CURRENCY_BASIS_UNRESOLVED
~~~

Errors stay explicit.

No resolver error may be flattened to a zero-valued successful result.

## 20. Preview vs Authoritative Resolution

A read-only current-cost preview may exist for UI/reporting:

~~~
previewCurrentUnitCost(...)
~~~

But preview is non-authoritative.

Authoritative mutation interfaces are:

~~~
resolveOutboundCost(...)
resolveInboundValuation(...)
~~~

and must execute inside the posting transaction.

## 21. No Cost Reuse Across Valuation Keys

A cost belongs to its exact:

~~~
Stock Location + Stock Identity
~~~

A cost from:

~~~
Branch A + Rice
~~~

cannot be reused for:

~~~
Branch B + Rice
~~~

unless it arrives through an explicit Inventory Transfer.

Product costs cannot be reused across different Product identities.

## 22. Explicit Forbidden Sources

v1 valuation authority permanently excludes:

~~~
products.cost_price
menus.cost_price
selling_price
products.unit_cost
products.inventory_cost
legacy branch_products.stock
legacy inventory_movements cost assumptions
current PO price for already-posted historical movement
last-known-cost fallback
~~~

Legacy procurement unit cost may remain historical commercial evidence for migration, but not universal current valuation authority.

## 23. Implementation Boundary

This contract does not create the physical cost-bearing schema.

Next stage:

~~~
Cost Resolution Contract v1
        ✅ LOCKED
              ↓
Cost-bearing Stock Movement Data Model v1
              ✅
              ↓
Goods Receipt Cost Posting Integration v1
              ✅
              ↓
Production Cost Snapshot / Output Cost
              ↓
Menu Composition Cost Resolver
              ↓
Sale → COGS Snapshot
~~~

Schema must preserve these semantics and must not merely rename legacy cost fields.

## 24. Regression Requirements

Before canonical cost-bearing posting is enabled, tests must prove:

- weighted-average receipt;
- outbound current-average costing;
- independent valuation keys by location;
- transfer carried-value continuity;
- production output incoming cost;
- insufficient-stock rejection with no mutation;
- unknown-cost rejection with no zero fallback;
- historical movement cost immutability;
- concurrent outbound serialization;
- backdated valuation rejection;
- legacy cost-field isolation.

Minimum numeric fixture:

~~~
10 @ Rp10,000
20 @ Rp12,000
→ 30 @ Rp11,333.333...

issue 15
→ outbound value Rp170,000
~~~

## 25. Locked Decisions

1. Cost Resolution is an explicit cross-domain service/boundary.
2. Valuation key is Stock Location + Stock Identity Type + Stock Identity ID.
3. Stock Identity Type is MATERIAL or PRODUCT.
4. v1 valuation method is MOVING_AVERAGE.
5. OUTBOUND cost comes from current Moving Average valuation state at posting.
6. INBOUND cost comes from explicit source-specific valuation evidence, then updates Moving Average.
7. Transfer uses source outbound value as destination inbound carried value.
8. Production Material consumption uses outbound Material resolution.
9. Production output uses Production Output Unit Cost as Product inbound valuation input.
10. Sale/COGS uses resolved Product Stock outbound cost.
11. Authoritative resolution is transaction-bound.
12. Preview/read cost is never proof for mutation.
13. Canonical outbound resolution must be AVAILABLE.
14. Negative stock is rejected.
15. Backdated postings that reorder valuation history are rejected.
16. Posted movement cost evidence is immutable.
17. Legacy cost fields are not valuation authority.
18. Unknown cost is explicit and never silently coerced to zero.
19. Resolver does not own physical stock mutation.

**LOCKED — Xentra Cost Resolution Contract v1.**
