# Xentra — Inventory Valuation Policy v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-08  
**Scope:** Inventory valuation for Material Stock and stock-managed Product Stock, including Goods Receipt, production output, transfers, stock consumption, adjustments, historical posting, negative stock, and Cost Resolution.

**Prerequisite authorities:**
- docs/decisions/xentra-costing-vocabulary-revision-v1.1.md
- docs/decisions/xentra-costing-hpp-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/decisions/xentra-uom-master-precision-rounding-contract-v1.md
- docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md
- docs/decisions/xentra-multibranch-supply-stock-topology-contract-v1.md
- docs/decisions/xentra-production-batch-posting-mutation-contract-v1.md

---

## 1. Decision Summary

Xentra v1 uses:

> **MOVING AVERAGE (weighted average / average cost)**

as the inventory valuation method for all valuation-bearing:

- Material Stock;
- stock-managed Product Stock.

The method is applied independently for each:

~~~
Stock Location × Stock Identity
~~~

where Stock Identity is either Material or Product.

The v1 policy is deliberately single-method:

- no per-item valuation-method override;
- no per-location valuation-method override;
- no merchant UI for choosing FIFO / Average / Standard;
- no Product master field that acts as valuation authority.

The valuation method is an Xentra platform/business policy in v1, not a free-form merchant configuration.

The objective is a deterministic, auditable, low-complexity valuation model that works consistently across:

~~~
Purchase Receipt
→ Material Stock
→ Production Consumption
→ Production Output
→ Product Stock
→ Transfer
→ Sale / COGS
~~~

---

## 2. Why Moving Average Is Selected

Xentra's current business model has these characteristics:

1. Restaurant/F&B inventory is dominated by interchangeable materials and repeatable stock units.
2. The v1 costing boundary is direct-material costing.
3. Lot/expiry valuation is not yet active.
4. Production output is a sellable Product and must receive an actual production-derived cost.
5. Central/Branch/Hybrid stock topology is required.
6. Stock can move between Stock Locations.
7. The system needs a simple current Product/Material cost basis for Menu Composition Cost.
8. Historical stock movements must retain the cost actually used at posting.
9. The system must not recreate the legacy products.cost_price pattern under a new field name.

Moving Average satisfies those requirements with one running valuation state per Stock Location + Stock Identity.

Conceptually:

~~~
Current Carrying Value
÷
Current Stock Quantity
=
Current Moving Average Unit Cost
~~~

Incoming stock changes the weighted average.

Outgoing stock uses the current moving average.

This is materially simpler than maintaining FIFO layers while remaining an actual cost-flow model rather than a manually published master cost.

---

## 3. Candidate Valuation Methods Audit

### 3.1 Standard Cost

**Decision: REJECTED for Xentra v1.**

Standard Cost can be useful when an organization intentionally publishes a predetermined rate and separately manages purchase/production variances.

It is not appropriate as the primary v1 authority because:

- it requires a published/manual cost master;
- it creates a strong path back to products.cost_price semantics;
- receipts at different commercial prices would not naturally update the carrying basis;
- production output would require standard-cost publication rules;
- purchase and production variances would require another accounting/costing layer;
- it does not fit Xentra's current goal of deriving cost from actual stock events.

Xentra therefore rejects a design where a Product master field such as:

~~~
products.unit_cost
products.inventory_cost
products.standard_cost
~~~

becomes the universal stock valuation authority.

That would reproduce the semantic problem that the Costing Vocabulary and Legacy Quarantine contracts were created to prevent.

Standard Cost may be reconsidered only through a separate valuation-policy revision.

### 3.2 FIFO

**Decision: VALID MODEL, BUT DEFERRED from v1.**

FIFO provides explicit historical cost layers and precise layer-level outbound costing.

Its advantages include:

- strong historical cost-flow traceability;
- useful lot-sensitive or audit-sensitive valuation;
- exact layer consumption behavior.

Its cost is implementation complexity:

- cost layers;
- partial layer consumption;
- layer-aware reversals;
- layer-aware transfers;
- more complex historical reconstruction;
- more complex backdated handling;
- more state around production outputs and returns.

Xentra does not currently have an active lot/expiry model that requires this precision.

FIFO therefore remains a valid future valuation policy, not the v1 implementation target.

### 3.3 Moving Average

**Decision: SELECTED for Xentra v1.**

Advantages for Xentra:

- one running cost basis per Stock Location + Stock Identity;
- straightforward receipt valuation;
- straightforward production consumption;
- straightforward production output valuation;
- straightforward transfer continuity;
- simple Cost Resolution for Menu Composition Cost;
- no cost-layer engine required;
- lower complexity than FIFO;
- avoids a manually maintained Product cost master;
- produces stable/smoothed cost behavior appropriate to homogeneous, high-volume restaurant inventory.

The trade-off is accepted:

~~~
Moving Average
≠
exact individual purchase-lot cost
~~~

The v1 priority is deterministic inventory valuation with strong historical posting evidence, not lot-level cost tracing.

---

## 4. Valuation Scope

Valuation is independent for every:

~~~
Stock Location
+
Stock Identity
~~~

Examples:

~~~
Central Warehouse + Material: Rice
Branch A Kitchen  + Material: Rice
Branch B Kitchen  + Material: Rice
~~~

These are separate valuation states.

Likewise:

~~~
Central Kitchen + Product: Sambal
Branch A         + Product: Sambal
~~~

are separate Product Stock valuation states.

A Branch is not the valuation boundary.

A Stock Location is the physical valuation boundary.

This follows the locked rule:

~~~
Branch
  = operational/organizational scope

Stock Location
  = physical stock custody + valuation scope
~~~

---

## 5. Valuation State

The target valuation engine conceptually maintains, for each valuation key:

~~~
Stock Location × Stock Identity
~~~

the state:

~~~
quantity_on_hand
carrying_value
current_moving_average_unit_cost
~~~

The exact physical schema remains a later implementation concern.

Invariant:

~~~
carrying_value
=
quantity_on_hand × current_moving_average_unit_cost
~~~

subject to the canonical quantity and monetary precision contracts.

When quantity is zero:

- carrying value must be zero;
- no outgoing cost may be resolved from empty stock;
- a previous unit cost may exist as historical/context information, but it is not an authority for a new outbound transaction.

---

## 6. Incoming Stock Valuation

For a normal incoming movement:

~~~
old_qty
old_value
incoming_qty
incoming_unit_cost
~~~

calculate:

~~~
incoming_value
=
incoming_qty × incoming_unit_cost

new_qty
=
old_qty + incoming_qty

new_value
=
old_value + incoming_value

new_average
=
new_value ÷ new_qty
~~~

Example:

~~~
Existing:
10 kg @ Rp10,000
Value = Rp100,000

Receipt:
20 kg @ Rp12,000
Value = Rp240,000

New:
30 kg
Total value = Rp340,000

Moving Average
= Rp11,333.333... / kg
~~~

The calculation must use the canonical Base Stock UOM.

The valuation engine must not calculate from a supplier pack name or current Purchase UOM after the historical transaction has been normalized.

---

## 7. Goods Receipt Cost Posting

Goods Receipt remains a Procurement + Inventory handoff.

The existing Goods Receipt contract is not replaced.

The costing addition is:

~~~
PO commercial line
      ↓
verified received quantity
      ↓
resolved Base UOM quantity
      ↓
receipt valuation input
      ↓
Moving Average valuation
      ↓
Material Stock
~~~

For a normal purchased receipt, the receipt valuation input is the agreed purchase cost normalized to the Material Base Stock UOM.

Therefore:

~~~
PO line price
≠
Material Unit Cost
~~~

Rather:

~~~
PO line price
      ↓
historical receipt commercial evidence
      +
UOM/pack normalization
      ↓
incoming valuation cost input
      ↓
Material Unit Cost / Moving Average update
~~~

Any later supplier price change does not rewrite the posted receipt.

---

## 8. Partial Receipt

Partial receipt is first-class.

Example:

~~~
PO = 100 kg

Receipt #1 = 40 kg
Receipt #2 = 35 kg
Receipt #3 = 25 kg
~~~

Each posted receipt contributes only its accepted quantity and resolved cost.

Each receipt is an independent inventory valuation event.

The remaining PO quantity has no effect on stock valuation until actually received.

The valuation engine must never value unreceived quantity.

This is why Goods Receipt Cost Posting belongs between Procurement receiving and the Material Stock mutation, not inside Purchase Order master data.

---

## 9. Opening / Migration Stock

Opening stock requires an explicit valuation basis.

Allowed v1 opening bases:

~~~
OPENING_ACTUAL
OPENING_ESTIMATE
~~~

The migration process must provide:

~~~
opening quantity
+
opening unit cost
~~~

when creating canonical valued stock.

Forbidden:

~~~
opening stock
→ products.cost_price
→ automatic valuation
~~~

and:

~~~
opening stock
→ missing cost
→ 0
~~~

If reliable historical cost cannot be established, migration must either:

- explicitly classify the opening valuation as an estimate; or
- block canonical valuation posting until an approved value is supplied.

No legacy field may silently become the opening valuation authority.

---

## 10. Production Material Consumption

When a Production Batch consumes Material:

~~~
Material Stock
→ outbound valuation
~~~

The consumed quantity is valued at the Material's current Moving Average Unit Cost at the posting boundary.

For each consumed Material:

~~~
component_cost
=
actual_consumed_base_quantity
×
resolved_material_average_cost
~~~

Production Actual Material Cost is:

~~~
Production Actual Material Cost
=
Σ(component_cost)
~~~

The Product/Recipe master does not provide the actual consumption cost.

The Inventory valuation state does.

---

## 11. Production Output Valuation

A completed Production Batch produces Product Stock.

Its incoming valuation cost is:

~~~
Production Output Unit Cost
=
Production Actual Material Cost
÷
Actual Output Quantity
~~~

Then:

~~~
output_value
=
actual_output_quantity
×
production_output_unit_cost
~~~

The Product Stock Moving Average is updated with that output value using the same incoming formula.

Therefore Product inventory cost can originate from:

~~~
Purchase receipt
or
Production output
or
Transfer receipt
or
explicit stock adjustment
~~~

without making Product master data the valuation authority.

---

## 12. Inventory Transfer Valuation

A transfer does not invent a new cost.

Source:

~~~
source quantity decreases
source value decreases
~~~

The transfer carries the source outbound value.

Destination:

~~~
destination quantity increases
destination value increases
~~~

The destination then applies its Moving Average calculation.

Example:

~~~
Central:
100 kg @ Rp14,000
Transfer 25 kg

Transferred value
= 25 × 14,000
= Rp350,000
~~~

If Branch already has:

~~~
10 kg @ Rp12,000
~~~

then:

~~~
Old value = Rp120,000
Incoming value = Rp350,000

New qty = 35 kg
New value = Rp470,000

New average
= Rp13,428.571... / kg
~~~

The transfer remains an Inventory transaction.

It is not a Purchase Order.

It is not a new supplier-price event.

---

## 13. Outgoing Stock Valuation

For Moving Average:

~~~
outgoing_unit_cost
=
current_moving_average_unit_cost
~~~

Then:

~~~
outgoing_value
=
outgoing_quantity × outgoing_unit_cost

new_qty
=
old_qty - outgoing_qty

new_value
=
old_value - outgoing_value
~~~

If stock remains positive, the Moving Average Unit Cost remains unchanged after an ordinary outbound movement.

Example:

~~~
20 units @ Rp15,000
Sell/consume 4

COGS / outbound value
= 4 × 15,000
= Rp60,000

Remaining:
16 units
Value = Rp240,000
Average = Rp15,000
~~~

---

## 14. Cost Resolution

**Cost Resolution is a cross-domain service contract, not a Product field.**

Its responsibility is to answer:

> “What valuation cost applies to this stock movement at this posting boundary?”

The resolver reads the authoritative valuation state for:

~~~
Stock Location × Stock Identity
~~~

and returns an explicit result.

Conceptual successful outgoing result:

~~~
status: AVAILABLE
valuation_method: MOVING_AVERAGE
quantity_base: ...
unit_cost: ...
total_cost: ...
stock_location_id: ...
stock_identity_type: MATERIAL | PRODUCT
stock_identity_id: ...
valuation_basis: MOVING_AVERAGE
source_state_reference: ...
~~~

Allowed cost states remain:

~~~
AVAILABLE
ESTIMATED
UNAVAILABLE
~~~

Cost must never silently become numeric zero.

Zero is valid only when the underlying business input is explicitly zero.

---

## 15. Cost Resolution Must Not Read Product Cost Masters

The following are forbidden as current valuation authority:

~~~
products.cost_price
menus.cost_price
products.unit_cost
products.inventory_cost
menu.cost
selling_price
PO current price
~~~

unless a future explicit contract assigns one of them a bounded meaning.

The v1 canonical sequence is:

~~~
Stock Location
  ↓
Stock Identity
  ↓
Valuation State
  ↓
Cost Resolution
  ↓
Movement Cost
~~~

not:

~~~
Product
  ↓
cost field
  ↓
everything else
~~~

---

## 16. Negative Stock

**Decision: canonical valued stock may not become negative in v1.**

Any valuation-bearing mutation that would result in:

~~~
quantity_on_hand < 0
~~~

must be rejected at the canonical posting boundary.

This applies to:

- Material consumption;
- Production material issue;
- Product sale;
- Product waste;
- inventory decrease adjustment;
- transfer dispatch;
- other outbound stock movements.

Reason:

- Moving Average needs a valid existing stock/value state;
- negative stock requires a fallback rule;
- fallback rules are exactly where hidden cost assumptions re-enter the system;
- Xentra has explicitly forbidden silent cost substitution.

Therefore v1 chooses:

~~~
INSUFFICIENT_STOCK
~~~

instead of:

~~~
use last known cost
use zero
invent provisional cost
~~~

Offline POS may maintain provisional local state, but canonical server reconciliation still respects this valuation rule. An offline transaction that cannot be posted because canonical stock is insufficient becomes an operational reconciliation exception; it does not acquire an invented valuation.

---

## 17. Stock Adjustment

v1 distinguishes quantity adjustment from value revaluation.

### Quantity increase

A positive adjustment requires an explicit unit-cost basis.

Examples:

~~~
COUNT_CORRECTION
OPENING_STOCK
MANUAL_RECEIPT_CORRECTION
~~~

Added quantity enters Moving Average using the supplied unit cost.

### Quantity decrease

A negative quantity adjustment uses the current Moving Average cost.

Example:

~~~
Stock count finds 3 units missing

Adjustment:
-3 units

Value reduction
=
3 × current average cost
~~~

### Value-only revaluation

**NOT SUPPORTED in v1.**

A future revaluation contract is required for:

- manual stock value correction;
- market value adjustment;
- valuation correction without quantity change;
- landed-cost adjustment;
- retrospective cost reassessment.

---

## 18. Reversal / Cancellation

Posted stock movements are historically immutable.

Do not update a posted movement to change its quantity or cost.

Correction uses a separate reversal/compensating movement:

~~~
Original Movement
      ↓
immutable historical evidence

Correction
      ↓
REVERSAL_OF(original movement)
~~~

The reversal must reference the original movement and preserve the original valuation evidence.

The original row is never silently rewritten.

---

## 19. Backdated Transactions

**Decision: backdated valuation posting is not allowed in v1 when it would insert a valuation event before an already-posted valuation event for the same Stock Location + Stock Identity.**

Canonical valuation ordering uses the server-authoritative posting timestamp/sequence.

Client occurred_at may be stored for audit/context, but it does not silently reorder valuation history.

Therefore:

~~~
client occurred_at
≠
valuation posting order
~~~

This deliberately avoids a reposting engine during v1.

A future policy may introduce:

- controlled backdating;
- historical reposting;
- valuation freeze dates;
- forward-chain recomputation.

Those require an explicit contract because they materially change historical cost semantics.

---

## 20. Historical Immutability

For every posted valuation-bearing movement, historical evidence must preserve at least:

~~~
Stock identity
Stock Location
signed quantity
Base UOM quantity
unit cost used
total movement value/cost
valuation method
valuation basis
source/reference
posting identity
posting timestamp
actor / authority
~~~

Later changes to Product, Material, supplier, Recipe Version, supplier pack, UOM configuration, current average cost, Menu composition, or selling price must not rewrite the historical movement.

---

## 21. Zero Stock and Cost Availability

An empty Stock Location can have no outgoing valued movement.

Therefore:

~~~
stock = 0
→ outgoing cost resolution
→ UNAVAILABLE / INSUFFICIENT_STOCK
~~~

It is forbidden to answer:

~~~
stock = 0
→ last known cost
→ AVAILABLE
~~~

for a new outbound transaction.

A stale cost number must not masquerade as currently available inventory value.

---

## 22. Menu Composition Cost Interaction

For a stock-managed Product, current Product cost used by Menu Composition Cost resolves from the Product Stock valuation state.

Conceptually:

~~~
Product Stock valuation state
→ Cost Resolution
→ current Product unit cost
~~~

The production-backed reporting basis remains explicitly controlled by the existing costing policy:

~~~
ACTUAL_OUTPUT
or
THEORETICAL_RECIPE
~~~

This valuation decision does not silently collapse those Menu Composition Cost reporting bases into one.

The critical distinction remains:

~~~
Menu Composition Cost
≠
COGS
~~~

---

## 23. Sale / COGS Interaction

For a stock-managed Product sold through POS/Commerce:

~~~
Sale acceptance / posting
        ↓
Product Stock consumption
        ↓
Cost Resolution
        ↓
outgoing movement value
        ↓
COGS snapshot
~~~

Under Moving Average:

~~~
COGS
=
sold_base_quantity
×
Product Stock current moving-average unit cost
~~~

The sale must not copy:

~~~
Menu Composition Cost
selling_price
products.cost_price
~~~

as COGS.

Historical COGS is the cost actually resolved for the stock movement at posting time.

---

## 24. Canonical Cost Hierarchy

~~~
PURCHASED MATERIAL
    ↓
Goods Receipt incoming valuation
    ↓
Material Moving Average

PRODUCTION MATERIAL CONSUMPTION
    ↓
Material Moving Average
    ↓
Production Actual Material Cost
    ↓
Production Output Unit Cost
    ↓
Product Stock incoming valuation
    ↓
Product Moving Average

TRANSFER
    ↓
Source outgoing value
    ↓
Destination incoming value
    ↓
Destination Moving Average

SALE
    ↓
Product Moving Average
    ↓
COGS snapshot
~~~

No step may skip directly to a Product/Menu master cost field.

---

## 25. Failure Rules

A canonical valuation post must fail explicitly when:

- stock identity cannot be resolved;
- Stock Location is invalid/inactive;
- quantity is invalid;
- Base UOM quantity cannot be resolved;
- incoming movement has no valid valuation input;
- outgoing movement exceeds available stock;
- valuation state is internally inconsistent;
- a required historical reference is missing;
- a backdated event would violate valuation ordering;
- a required monetary/currency basis cannot be resolved by the applicable policy.

Failure must remain explicit.

Do not convert these errors into zero-valued stock.

---

## 26. Implementation Boundary

This policy intentionally does **not** define the physical schema.

The implementation sequence after this decision is:

~~~
Inventory Valuation Policy v1
        ↓
Cost Resolution Contract
        ↓
Cost-bearing Stock Movement Data Model
        ↓
Goods Receipt Cost Posting Integration
        ↓
Production Cost Snapshot / Output Cost
        ↓
Menu Composition Cost Resolver
        ↓
Sale → COGS Snapshot
~~~

The target schema must represent the policy, not force the policy to fit a legacy table.

---

## 27. Current Legacy Runtime Audit

The current branch still contains legacy inventory mechanisms such as:

- branch_products.stock;
- inventory_movements;
- inventory_po_items.unit_cost;
- legacy Purchase Order / Goods Receipt service methods that mutate the legacy branch inventory shape.

These are migration targets, not authority for the new valuation model.

The forward target already defines:

~~~
Stock Location
+
Material Stock
+
Product Stock
+
explicit Stock Movement
~~~

and this policy adds:

~~~
+
valuation state
+
movement cost evidence
~~~

No blind rename of cost_price, unit_cost, or legacy movement fields is authorized.

---

## 28. V1 Non-Goals

The following remain outside this policy:

- FIFO;
- Standard Cost;
- specific identification;
- lot/expiry valuation;
- landed cost allocation;
- freight allocation;
- labor costing;
- overhead costing;
- WIP valuation;
- by-product valuation;
- multi-step manufacturing valuation;
- retrospective reposting engine;
- value-only revaluation;
- accounting journal integration;
- tax valuation;
- multi-currency valuation policy;
- autonomous purchasing.

Each requires a separate explicit contract/revision.

---

## 29. Regression / Simulation Requirements

Before Cost-bearing Stock Movement is production-ready, tests must cover at least:

### Moving Average receipt

~~~
10 @ 100
20 @ 120
→ 30 @ 113.333333...
~~~

### Outbound

~~~
30 @ 113.333333...
issue 15
→ cost 1,700
→ remaining 15 @ 113.333333...
~~~

### Multi-location separation

~~~
Location A = 10 @ 100
Location B = 10 @ 140
~~~

One location's receipt must never alter the other's valuation.

### Production output

~~~
Material consumption = Rp300,000
Actual output = 100
→ Product output unit cost = Rp3,000
~~~

### Production output averaging

~~~
existing Product Stock
+
new production output
→ weighted Product average
~~~

### Transfer continuity

~~~
Source outgoing value
=
Transfer carried value
=
Destination incoming value
~~~

before destination re-averaging.

### Negative stock

Any outbound request above available quantity must fail with an explicit insufficiency condition and must not create a cost fallback.

### Backdating

A valuation event inserted before an already-posted event for the same valuation key must be rejected.

### Historical immutability

Changing current Material/Product data must not alter historical movement unit cost or total value.

### Legacy isolation

No valuation result may read:

~~~
products.cost_price
menus.cost_price
~~~

as authority.

---

## 30. External Supporting Evidence

Established inventory systems use valuation methods to determine how incoming stock becomes valued and how outgoing stock produces inventory value / COGS.

ERPNext documents FIFO and Moving Average and explains that Moving Average recalculates valuation from existing stock value plus incoming stock value. It also documents that different valuation methods produce different outbound cost behavior and that backdated transactions may require valuation reposting.

Reference:
https://docs.frappe.io/erpnext/fifo-and-moving-average

Odoo documents Standard Price, Average Cost (AVCO), and FIFO, records value on stock movements, and distinguishes movement unit cost from the product-form Cost field.

Reference:
https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/inventory_valuation/operations_valuation.html

IAS 2 permits FIFO or weighted-average cost formulas for ordinarily interchangeable inventory, while specific identification applies to non-interchangeable items.

Reference:
https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/

These references support general valuation patterns. They do not override Xentra domain contracts.

---

## 31. Locked Decisions

1. Xentra v1 uses Moving Average valuation.
2. Valuation is scoped by Stock Location + Stock Identity.
3. Stock Identity is explicitly Material or Product.
4. There is one valuation method in v1; merchant/item/location overrides are not enabled.
5. Material receipts update Material Moving Average.
6. Production consumes Materials using current Material Moving Average.
7. Production output enters Product Stock using Production Output Unit Cost.
8. Product Stock then follows the same Moving Average policy.
9. Transfers carry source value forward and do not invent supplier cost.
10. Outgoing stock uses the current Moving Average Unit Cost.
11. Negative canonical stock is forbidden in v1.
12. Backdated valuation posting that would reorder an existing valuation chain is forbidden in v1.
13. Posted valuation movements are historically immutable.
14. Quantity adjustments and value revaluation are separate concerns; value-only revaluation is out of scope.
15. Cost Resolution is a service/boundary, not a Product master cost field.
16. products.cost_price, menus.cost_price, and legacy unit_cost fields do not become valuation authority.
17. Unknown cost must be explicit as AVAILABLE, ESTIMATED, or UNAVAILABLE; no silent zero fallback.
18. COGS is resolved from actual stock consumption cost, not from Menu Composition Cost or selling price.
19. Physical cost-bearing schema is still a separate implementation stage.

**LOCKED — Xentra Inventory Valuation Policy v1.**
