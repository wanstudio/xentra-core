# Xentra — Cost-Bearing Stock Movement Data Model v1

**Status:** 🔒 LOCKED / ACTIVE TARGET DATA MODEL  
**Decision date:** 2026-10-08  
**Scope:** Logical persistence model for historical cost-bearing Material Stock and Product Stock movements and their Moving Average valuation state.

**Prerequisite authorities:**
- docs/decisions/xentra-inventory-valuation-policy-v1.md
- docs/decisions/xentra-cost-resolution-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/decisions/xentra-uom-master-precision-rounding-contract-v1.md
- docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md

## 1. Purpose

The target model preserves both physical stock quantity and the cost/value evidence used when that quantity changed.

It must answer:

~~~
What stock existed?
Where was it?
How much changed?
What cost was applied?
Why was that cost valid?
Which transaction caused it?
What valuation state resulted?
~~~

This is a logical target data model. It does not authorize immediate migration of legacy tables.

## 2. Core Design

Xentra keeps Material and Product stock identities separate:

~~~
Material Stock Balance
        +
Material Stock Movement

Product Stock Balance
        +
Product Stock Movement
~~~

Do not use one polymorphic movement table with nullable material/product identity.

## 3. Valuation State

Each valuation key is:

~~~
Stock Location
+
Stock Identity Type
+
Stock Identity ID
~~~

The current state contains:

~~~
quantity_on_hand
carrying_value
moving_average_unit_cost
valuation_version
updated_at
~~~

Current valuation state is authoritative for new cost resolution.

Movement history is authoritative for historical evidence.

Invariant:

~~~
carrying_value
=
quantity_on_hand × moving_average_unit_cost
~~~

subject to canonical quantity/monetary precision.

When quantity is zero, carrying value is zero.

## 4. Material Stock Balance

Logical entity:

~~~
material_stock_balances
~~~

Identity:

~~~
(stock_location_id, material_id)
~~~

Fields:

~~~
stock_location_id
material_id
quantity_base
carrying_value
moving_average_unit_cost
valuation_version
created_at
updated_at
~~~

Quantity uses Material Base Stock UOM.

## 5. Product Stock Balance

Logical entity:

~~~
product_stock_balances
~~~

Identity:

~~~
(stock_location_id, product_id)
~~~

Fields:

~~~
stock_location_id
product_id
quantity
carrying_value
moving_average_unit_cost
valuation_version
created_at
updated_at
~~~

Quantity uses Product Stock UOM.

No channel-specific stock pools are introduced.

## 6. Material Stock Movement

Logical entity:

~~~
material_stock_movements
~~~

Each posted row is immutable.

Fields:

~~~
id
stock_location_id
material_id

movement_type
quantity_base
previous_quantity
current_quantity

unit_cost
total_cost

valuation_method
cost_basis_type

source_type
source_reference
source_movement_id

posting_mutation_id
valuation_version
posting_timestamp
actor_id
resolver_version

notes
created_at
~~~

Semantics:

~~~
unit_cost  = absolute rate applied
total_cost = signed movement value
~~~

INBOUND has positive quantity and positive total cost.

OUTBOUND has negative quantity and negative total cost.

## 7. Product Stock Movement

Logical entity:

~~~
product_stock_movements
~~~

Same structure as Material Stock Movement, replacing material identity with product identity.

The same immutability and cost-evidence rules apply.

## 8. Movement Type Vocabulary

Material movement types:

~~~
PURCHASE_RECEIPT
TRANSFER_IN
TRANSFER_OUT
PRODUCTION_ISSUE
OPENING_STOCK
ADJUSTMENT_IN
ADJUSTMENT_OUT
WASTE
~~~

Product movement types:

~~~
PRODUCTION_OUTPUT
TRANSFER_IN
TRANSFER_OUT
SALE
OPENING_STOCK
ADJUSTMENT_IN
ADJUSTMENT_OUT
WASTE
~~~

Movement type describes the physical stock event. It is not itself the valuation method.

## 9. Cost Basis Vocabulary

The model records both:

~~~
valuation_method
cost_basis_type
~~~

v1 valuation method:

~~~
MOVING_AVERAGE
~~~

Cost basis types:

~~~
PURCHASE_RECEIPT
PRODUCTION_OUTPUT
TRANSFER_CARRIED
OPENING_ACTUAL
OPENING_ESTIMATE
COUNT_CORRECTION
CURRENT_MOVING_AVERAGE
~~~

Keep method and basis as separate fields.

## 10. Source Evidence

Historical evidence uses:

~~~
source_type
source_reference
source_movement_id
~~~

Examples:

~~~
PURCHASE_RECEIPT → Goods Receipt reference
PRODUCTION_OUTPUT → Production Batch reference
TRANSFER_IN → source movement id
SALE → Sale reference
~~~

Stock movement stores the evidence pointer; it does not become the source business document.

## 11. Posting Identity

Every canonical stock mutation has:

~~~
posting_mutation_id
~~~

which is unique for that logical mutation.

This prevents duplicate stock and duplicate cost posting.

The same identity must be preserved across the canonical posting path.

## 12. Valuation Version

Each valuation state has:

~~~
valuation_version
~~~

A successful mutation increments it exactly once.

Example:

~~~
state version 14
      ↓
post
      ↓
state version 15
      ↓
movement.valuation_version = 15
~~~

This provides an ordering/integrity anchor for the valuation key.

## 13. Atomic Posting

Canonical posting is one transaction:

~~~
BEGIN
  ↓
load valuation state
  ↓
resolve cost
  ↓
validate source/reference
  ↓
calculate new quantity/value/average
  ↓
update balance
  ↓
append immutable movement
  ↓
COMMIT
~~~

There must not be a committed stock balance change without its corresponding movement, or a movement without its balance transition.

## 14. Outbound Snapshot

For OUTBOUND:

~~~
unit_cost
=
current Moving Average Unit Cost
~~~

Movement records:

~~~
quantity_base
unit_cost
total_cost
valuation_method = MOVING_AVERAGE
cost_basis_type = CURRENT_MOVING_AVERAGE
~~~

This is the historical cost actually used for the stock consumption.

## 15. Inbound Snapshot

For INBOUND:

~~~
unit_cost
=
validated source-specific incoming valuation input
~~~

The movement preserves the original incoming value.

Example:

~~~
old:
10 kg @ 10,000

receipt:
20 kg @ 12,000

movement:
quantity = +20
unit_cost = 12,000
total_cost = +240,000

new balance:
30 kg
carrying_value = 340,000
average = 11,333.333...
~~~

Movement unit cost and resulting balance average are intentionally different concepts.

## 16. Transfer

A transfer creates two movement records:

~~~
SOURCE
TRANSFER_OUT
quantity < 0
total_cost < 0

DESTINATION
TRANSFER_IN
quantity > 0
total_cost > 0
cost_basis_type = TRANSFER_CARRIED
source_movement_id = source movement
~~~

Invariant:

~~~
abs(source.total_cost)
=
destination.total_cost
~~~

before destination re-averaging.

Transfer does not create a new purchase valuation.

## 17. Production

Material issue:

~~~
PRODUCTION_ISSUE
→ current Material Moving Average
→ Production Actual Material Cost evidence
~~~

Product output:

~~~
PRODUCTION_OUTPUT
→ Production Output Unit Cost
→ Product Stock incoming valuation
~~~

Production does not read Product master cost.

## 18. Sale / COGS

Product sale creates:

~~~
SALE
quantity < 0
~~~

Its total_cost is the authoritative inventory-cost input for the later COGS snapshot.

Sale does not reconstruct COGS from Menu Composition Cost, selling price, or Product master cost fields.

## 19. Adjustments

Positive adjustment requires explicit incoming unit cost.

Negative adjustment uses current Moving Average.

Value-only revaluation is out of scope in v1.

No quantity-neutral value mutation is introduced without a future explicit revaluation contract.

## 20. Opening Stock

Opening stock uses movement type:

~~~
OPENING_STOCK
~~~

with cost basis:

~~~
OPENING_ACTUAL
or
OPENING_ESTIMATE
~~~

An estimated opening value remains explicitly estimated historical evidence.

## 21. Historical Immutability

Posted movements are append-only.

Forbidden:

~~~
UPDATE posted movement cost
UPDATE posted movement quantity
DELETE posted movement
~~~

Correction uses a separate compensating/reversal movement linked to the original.

Historical cost is never recomputed from current master data.

## 22. Integrity Constraints

The target model must enforce:

1. valid Stock Location and Stock Identity;
2. correct Base Stock UOM;
3. signed quantity matching movement direction;
4. non-negative unit cost;
5. total cost consistent with quantity × unit cost;
6. non-negative previous/current quantity;
7. valuation method fixed to MOVING_AVERAGE in v1;
8. unique posting_mutation_id;
9. monotonic valuation_version per valuation key;
10. TRANSFER_IN has source movement evidence;
11. posted rows are immutable.

Exact SQL mechanisms remain an implementation detail.

## 23. Compatibility Bridge

Current legacy structures remain during migration:

~~~
branch_product_inventory
inventory_movements
inventory_purchase_orders
inventory_po_items
branch_products.stock
~~~

They must not be reinterpreted as canonical cost-bearing state.

Legacy procurement unit cost is historical PO commercial evidence, not universal current Material Unit Cost.

No rename-only migration is authorized.

## 24. Target Relationship

~~~
Stock Location
    ↓
Material Stock Balance / Product Stock Balance
    ↓
Material Stock Movement / Product Stock Movement
    ↓
historical cost evidence
~~~

Balance answers current state.

Movement answers historical mutation evidence.

Cost Resolution determines the cost before the movement is persisted.

## 25. Regression Requirements

Implementation must prove:

- weighted-average receipt;
- outbound current-average costing;
- independent valuation by location;
- transfer carried-value continuity;
- production issue costing;
- production output costing;
- sale cost snapshot input;
- insufficient-stock rejection;
- unknown-cost rejection without zero fallback;
- duplicate mutation protection;
- backdated valuation rejection;
- historical movement immutability;
- legacy cost-field isolation.

Example:

~~~
10 @ Rp10,000
20 @ Rp12,000
→ 30 @ Rp11,333.333...

issue 15
→ outbound value Rp170,000
~~~

## 26. Locked Decisions

1. Material and Product use separate stock movement identities.
2. Stock Location + Stock Identity is the valuation key.
3. Current valuation state and immutable movement history are separate concerns.
4. Valuation state includes quantity, carrying value, Moving Average unit cost, and valuation version.
5. Every movement stores quantity, unit cost, total cost, valuation method, cost basis, source evidence, posting identity, and resolver version.
6. Outbound movement cost is current Moving Average.
7. Inbound movement cost is explicit source-specific input.
8. Transfers carry source value into destination.
9. Production issue/output preserve resolved cost evidence.
10. Sale movement cost is the inventory-cost input to COGS.
11. Posted movements are immutable.
12. No polymorphic Material/Product movement table in v1.
13. Legacy tables remain compatibility/migration structures.
14. Physical SQL implementation is the next stage.

**LOCKED — Xentra Cost-Bearing Stock Movement Data Model v1.**
