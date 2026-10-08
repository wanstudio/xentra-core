# Xentra — Goods Receipt Cost Posting Integration v1

**Status:** LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Integration between the already-locked Goods Receipt contract and the Cost Resolution / cost-bearing Inventory model.

This document does not recreate or replace the Goods Receipt workflow.

## 1. Boundary

Existing Goods Receipt contract:

~~~
Purchase Order
    ↓
Goods Receipt
    ↓
POSTED
    ↓
accepted quantity enters Material Stock
~~~

Valuation extension:

~~~
Goods Receipt POSTED
    ↓
accepted Base Quantity
    ↓
resolved incoming purchase cost
    ↓
Cost Resolution
    ↓
Moving Average
    ↓
Material Stock quantity + value
    ↓
immutable Material Stock Movement
~~~

## 2. Ownership

Procurement owns:
- Purchase Order;
- Purchase Order Line;
- Goods Receipt;
- supplier commercial evidence;
- accepted/rejected quantities;
- receipt posting identity.

Inventory owns:
- Material Stock;
- Stock Location;
- valuation state;
- cost-bearing stock movement;
- Moving Average state.

Costing owns the cross-domain Cost Resolution boundary and derived cost semantics.

Procurement does not directly mutate Material Stock.

## 3. Posting Trigger

Only Goods Receipt status POSTED can create canonical Material Stock valuation.

These create no stock:

~~~
PO DRAFT
PO APPROVED
PO ORDERED
Goods Receipt DRAFT
Goods Receipt CANCELLED
~~~

Rejected quantity does not enter usable Material Stock through the receipt.

## 4. Atomic Receipt Posting

A multi-line receipt is one logical posting.

Example:

~~~
Rice +100 kg
Oil +20 L
Eggs +120 pcs
~~~

All accepted lines succeed together or none succeed.

A receipt must not claim POSTED while only part of its Inventory valuation mutation succeeded.

## 5. Partial Receipt

Partial receipt is first-class.

~~~
PO = 100 kg

GR-001 = 40 kg
GR-002 = 35 kg
GR-003 = 25 kg
~~~

Each POSTED receipt is its own valuation event.

Unreceived quantity has no stock value.

## 6. Source Cost

For a purchased Material, incoming valuation starts from the PO line's agreed commercial terms plus the historical purchase UOM / Supplier Pack conversion.

Conceptually:

~~~
PO agreed price
      +
historical purchase representation
      +
resolved Base Quantity
      ↓
incoming unit cost in Material Base Stock UOM
~~~

Current Supplier Material price is not consulted to rewrite a posted PO or receipt.

## 7. Price Normalization

Direct UOM example:

~~~
Base UOM = kg
Purchase UOM = g

5,000 g @ Rp70,000
      ↓
5 kg @ Rp14,000/kg
~~~

Supplier Pack example:

~~~
1 sack = 25 kg
4 sacks @ Rp350,000
      ↓
100 kg @ Rp3,500/kg
~~~

The historical conversion/content snapshot comes from the Procurement/UOM contract.

## 8. Price vs Material Unit Cost

These remain distinct:

~~~
PO line price
  = historical commercial evidence

incoming unit cost
  = valuation input for this receipt

Moving Average
  = algorithm producing current Material Unit Cost
~~~

Therefore:

~~~
PO line price
≠
current Material Unit Cost
~~~

## 9. Cost Resolution Integration

Each posted receipt line calls:

~~~
resolveInboundValuation(...)
~~~

with conceptually:

~~~
stock_location_id
stock_identity_type = MATERIAL
stock_identity_id
quantity_base
cost_basis_type = PURCHASE_RECEIPT
incoming_unit_cost
incoming_total_cost
source_type = GOODS_RECEIPT
source_reference = receipt id
posting_mutation_id
posting_timestamp
~~~

Cost Resolution validates the cost evidence before Inventory mutation.

## 10. Moving Average Posting

For each receipt line:

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

The balance update and immutable movement insert are committed atomically.

## 11. Cost-Bearing Movement

Each accepted receipt line creates:

~~~
movement_type = PURCHASE_RECEIPT
quantity_base > 0
unit_cost = normalized incoming unit cost
total_cost > 0
valuation_method = MOVING_AVERAGE
cost_basis_type = PURCHASE_RECEIPT
source_type = GOODS_RECEIPT
source_reference = receipt id
~~~

The resulting Material Stock Balance records:

~~~
quantity
carrying_value
moving_average_unit_cost
valuation_version
~~~

## 12. Idempotency

Goods Receipt posting has one stable:

~~~
goods_receipt_posting_id
~~~

Retrying the same logical post returns the original result and cannot duplicate:

~~~
stock quantity
valuation value
movement rows
~~~

The receipt posting identity is the aggregate idempotency boundary.

## 13. Rejected Quantity

Example:

~~~
Delivered = 100 kg
Accepted = 80 kg
Rejected = 20 kg
~~~

Inventory posts:

~~~
+80 kg
~~~

not +100 kg.

Rejected quantity remains receiving evidence until a separate disposition workflow exists.

## 14. Missing Cost

A normal purchase receipt cannot post to canonical valued Material Stock without valid incoming cost evidence.

Failure:

~~~
COST_UNAVAILABLE
or
INBOUND_COST_UNRESOLVED
~~~

must result in:

~~~
no Material Stock mutation
no cost-bearing movement
no silent zero
~~~

Legacy unit_cost absence or zero does not justify a zero-valued receipt.

## 15. Historical Immutability

Posted receipt valuation evidence preserves:

~~~
receipt reference
accepted Base Quantity
purchase UOM / pack snapshot
conversion snapshot
incoming unit cost
incoming total cost
valuation method
cost basis
posting identity
posting timestamp
~~~

Later changes to Supplier Material, Supplier Pack, UOM conversion, supplier price, Material master, or current average cost do not rewrite the posted movement.

## 16. Backdating

If the receipt would insert a valuation event before an already-posted event for the same:

~~~
Stock Location × Material
~~~

posting fails:

~~~
BACKDATED_VALUATION_REJECTED
~~~

Receipt UI date does not reorder valuation history.

## 17. Transaction Boundary

Canonical receipt posting:

~~~
BEGIN
  ↓
validate Goods Receipt
  ↓
resolve accepted Base Quantity
  ↓
resolve inbound cost
  ↓
load Material valuation state
  ↓
apply Moving Average
  ↓
update Material Stock Balance
  ↓
append immutable Material Stock Movement
  ↓
mark Goods Receipt POSTED
  ↓
update PO receiving progress/status
  ↓
COMMIT
~~~

The committed result must never claim POSTED without the matching Inventory mutation.

## 18. Procurement / Inventory Boundary

Forbidden:

~~~
Procurement Service
  → direct UPDATE of Material Stock
~~~

Required:

~~~
Procurement
  → Goods Receipt posting command
  → Inventory posting boundary
  → Cost Resolution
  → Inventory mutation
~~~

## 19. Legacy Bridge

Current structures remain migration seams:

~~~
inventory_purchase_orders
inventory_po_items
inventory_po_items.unit_cost
branch_products.stock
inventory_movements
~~~

The current legacy PurchaseOrderService is not the final canonical valuation implementation.

No rename-only reinterpretation is allowed.

## 20. Regression Requirements

Must prove:

- PO creation does not change stock;
- Goods Receipt DRAFT does not change stock;
- POSTED receipt increases Material Stock;
- receipt creates cost-bearing movement;
- weighted average is correct;
- partial receipt values only accepted quantity;
- rejected quantity creates no stock valuation;
- UOM / pack normalization is correct;
- missing cost blocks posting;
- duplicate posting identity cannot double-post;
- concurrent receipt posting preserves correct valuation;
- backdated insertion is rejected;
- historical movement cost is immutable;
- legacy unit_cost cannot become universal valuation authority.

Fixture:

~~~
Existing:
10 kg @ Rp10,000

Receipt:
20 kg @ Rp12,000

Result:
30 kg
carrying value = Rp340,000
Moving Average = Rp11,333.333...
~~~

## 21. Locked Decisions

1. Goods Receipt Cost Posting is an integration layer, not a second Goods Receipt contract.
2. Only POSTED Goods Receipt creates canonical Material Stock valuation.
3. Accepted Base Quantity is the inventory quantity.
4. Rejected quantity does not enter Material Stock through the receipt.
5. Each posted receipt is an independent valuation event.
6. Historical purchase terms are normalized to Material Base Stock UOM before valuation.
7. PO agreed price is commercial evidence, not current Material Unit Cost.
8. Purchase receipt uses Cost Basis Type PURCHASE_RECEIPT.
9. Moving Average updates Material valuation state.
10. Each accepted line creates immutable cost-bearing movement evidence.
11. Receipt posting is atomic and idempotent.
12. Missing or invalid cost fails explicitly; no zero fallback.
13. Posted receipt valuation evidence is immutable.
14. Backdated valuation insertion is rejected.
15. Procurement does not directly mutate Material Stock.
16. Legacy purchase/unit_cost structures remain compatibility seams.
17. Physical runtime migration remains a separate implementation stage.

**LOCKED — Xentra Goods Receipt Cost Posting Integration v1.**
