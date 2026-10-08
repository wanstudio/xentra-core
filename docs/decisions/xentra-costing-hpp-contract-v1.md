# Xentra — Costing / HPP Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08

**Terminology revision:** `docs/decisions/xentra-costing-vocabulary-revision-v1.1.md` supersedes the naming of Menu HPP in this document. Wherever this v1 contract says **Menu HPP** for a derived Menu composition cost, the canonical term is now **Menu Composition Cost**. The underlying costing formulas and authority boundaries remain unchanged.
**Scope:** Material unit cost, production output cost, Menu HPP, transfer cost continuity, cost snapshots, costing boundaries, and migration treatment of legacy cost fields.

**Prerequisite authorities:**
- xentra-material-supplier-material-contract-v1.md
- xentra-production-item-recipe-bom-contract-v1.md
- xentra-production-batch-posting-mutation-contract-v1.md
- xentra-procurement-document-contract-v1.md
- xentra-inventory-transfer-state-machine-contract-v1.md
- xentra-menu-item-choice-stock-production-integration-contract-v1.md

## 1. Decision Summary

Xentra separates **physical stock quantity** from **stock cost**.

Inventory answers:

~~~text
What exists physically?
How much exists?
Where is it?
What movement changed it?
~~~

Costing answers:

~~~text
What is the cost basis of that stock?
What did a production run actually consume?
What is the current theoretical HPP of a Menu?
~~~

HPP is a **derived costing result**. It is not a second stock ledger.

The v1 cost chain is:

~~~text
Material Stock
  ↓ carrying / valuation cost
Material Unit Cost
  ↓
Recipe Component Cost
  ↓
Production Actual Cost
  ↓
Production Output Unit Cost
  ↓
Menu Effective Composition
  ↓
Menu HPP
~~~

v1 focuses on **direct material cost**.

Labor, overhead, utilities, packaging overhead, freight allocation, and financial accounting treatment remain separate extensions.

## 2. Costing Ownership

Inventory owns:
- stock quantity;
- stock movement;
- Stock Location;
- the physical carrying value/cost basis used by valuation;
- source/destination movement continuity for transfers.

Production owns:
- planned material requirement;
- actual material consumption;
- actual production output;
- production run cost evidence.

Catalog owns:
- Menu commercial composition;
- Menu Item and Item Choice structure;
- customer-facing selling price.

Costing/HPP is a cross-domain derived capability.

It may read authoritative values from Inventory, Production, Material, and Catalog.

It must not create a competing physical-stock ledger or redefine domain ownership.

## 3. Material Unit Cost

Every stock-managed Material has a cost per one unit of its Base Stock UOM.

Example:

~~~text
Material = Rice
Base UOM = kg
Current unit cost = Rp14,000 / kg
~~~

The cost basis used by a historical stock movement must be resolved from the valuation policy that applies at the posting time.

A historical transaction must not be silently re-costed because a current supplier price or master value changed.

The system should preserve, at minimum:
- quantity in Base UOM;
- unit cost used for the movement;
- total movement cost;
- source/reference document;
- posting timestamp;
- valuation/costing basis identifier where applicable.

## 4. Purchase Price Is Not Automatically HPP

Supplier Material price, PO agreed price, Material current cost, and Menu HPP are different concepts.

~~~text
Supplier Material
  = supplier commercial offer

PO line price
  = price actually agreed for that purchase

Inventory carrying cost
  = cost basis assigned to stock after receipt according to valuation policy

Material unit cost
  = normalized cost per Base Stock UOM

Menu HPP
  = derived cost of the Menu's effective composition
~~~

A later supplier price change must not rewrite historical PO/Receipt or historical stock movement cost.

A Purchase Order price alone is therefore not the universal HPP authority.

## 5. Goods Receipt Cost Boundary

When a Goods Receipt is POSTED:

~~~text
accepted quantity
  +
resolved cost basis
  ↓
Material Stock
~~~

The receipt must preserve the actual commercial price and the resolved stock cost basis used for that posting.

The final financial/valuation method determines how that receipt changes the Material's ongoing carrying cost.

Procurement still owns the receipt document.
Inventory still owns the stock mutation.

## 6. Material Valuation Method

Xentra v1 supports a valuation-policy abstraction but does not force one financial valuation algorithm into every merchant.

Candidate methods include:
- Standard Cost;
- Moving Average / Average Cost;
- FIFO.

The exact enabled method, scope, and accounting treatment remain a later valuation-policy decision.

The interface is locked:

~~~text
Inventory valuation policy
  → resolves unit cost for a stock movement
  → records the resolved cost on the movement
~~~

Established ERP systems similarly separate valuation methods such as Standard Cost, Average Cost, and FIFO and apply those methods to stock movements. ERPNext documents FIFO and Moving Average valuation, while Odoo documents Standard Price, Average Cost, and FIFO. These are supporting patterns, not Xentra authority.

## 7. Production Cost

For v1, Production cost is based on **actual Material consumption**.

For each consumed Material:

~~~text
component cost
  =
actual consumed Base UOM quantity
×
resolved Material unit cost
~~~

Production actual material cost:

~~~text
Production Actual Material Cost
  =
Σ(component actual quantity × component unit cost)
~~~

No automatic labor or overhead is added in v1.

Therefore:

~~~text
Production Actual Cost v1
  = direct material cost only
~~~

## 8. Production Output Unit Cost

A completed Production Batch must have:

~~~text
actual_output_quantity > 0
~~~

For one-output v1 Production Batches:

~~~text
Production Output Unit Cost
  =
Production Actual Material Cost
  ÷
Actual Output Quantity
~~~

Example:

~~~text
Actual Material Cost = Rp300,000
Actual Output        = 100 portions

Output Unit Cost
  = Rp3,000 / portion
~~~

The resolved output cost should be captured with the production completion evidence so historical production is not reinterpreted from today's Material prices.

This does not create a new Product SKU.

## 9. Production Planned Cost vs Actual Cost

Production keeps planned and actual cost separate.

### Planned / theoretical

Based on:

~~~text
Recipe Version
+
planned quantity
+
current component cost basis
~~~

Used for planning and estimated HPP.

### Actual

Based on:

~~~text
actual consumed Material quantities
+
cost basis resolved at completion
+
actual output quantity
~~~

Used for production performance and actual production cost.

A Recipe Version change must not rewrite historical Production Batch actual cost.

## 10. Menu HPP

For v1, Menu HPP is the sum of the effective Product/component costs represented by the Menu.

Conceptually:

~~~text
Menu HPP
  =
Σ(effective component quantity × effective Product unit cost)
~~~

For a Product with Production Item backing, the costing service must use an explicitly declared cost basis:
- `ACTUAL_OUTPUT` = completed Production Output Unit Cost; or
- `THEORETICAL_RECIPE` = current approved theoretical Production cost.

v1 does **not** permit silent fallback from one basis to the other. The reporting policy that selects the basis remains a later explicit policy contract.

For a purchased Product:

~~~text
Product unit cost
  =
Inventory-resolved carrying/valuation cost
~~~

For a stockless/non-SKU Product with no valid production or purchase cost basis:

~~~text
HPP = UNAVAILABLE
~~~

The system must not silently treat selling price as HPP.

## 11. Menu Item Choice Integration

Menu HPP follows the same resolved commercial composition used for selling.

~~~text
Menu
  ↓
Menu Item
  ↓
Base Product
  +
Choice Value Product effects
  ↓
Effective Product Composition
  ↓
HPP
~~~

Choice effects use the locked Catalog Product mappings.

Choice Value price adjustment does not automatically equal cost adjustment.

For ADD_PRODUCT and REPLACE_PRODUCT, the mapped Product contributes its own cost basis.

For NONE, no component cost is added.

Catalog still does not directly read or mutate raw Material Stock.

## 12. Quantity and UOM

Cost calculation uses normalized stock quantities.

Material components are first resolved into Material Base Stock UOM.

Example:

~~~text
Recipe
  Rice = 150 g

Material Base UOM
  kg

Resolved quantity
  0.15 kg
~~~

Cost:

~~~text
0.15 kg × Rp14,000/kg
= Rp2,100
~~~

The cost calculation must not depend on the supplier's current pack definition after the transaction snapshot is created.

## 13. Transfer Cost Continuity

An Inventory Transfer does not create or destroy economic cost by itself.

When stock is dispatched:

~~~text
Source quantity -
Source carrying value -
~~~

When stock is received:

~~~text
Destination quantity +
Destination carrying value +
~~~

The transfer carries the source stock's resolved unit-cost/value basis forward.

The receiving location may recalculate its ongoing average/current valuation according to the active valuation method, but the transfer itself is not a purchase and must not invent a supplier price.

## 14. Transfer and Costing Interaction

Example:

~~~text
Central Warehouse
  100 kg Rice
  carrying cost = Rp14,000/kg

Transfer 25 kg
  ↓

Central Warehouse
  75 kg

Branch Warehouse
  +25 kg
  receiving cost basis = Rp14,000/kg
~~~

The Branch may later have a different effective average cost if it already contains Rice at another cost.

The transfer document remains an Inventory movement, not a financial gain/loss event.

Detailed multi-location valuation policy remains open.

## 15. No Cost Mutation on Workflow Documents

These documents/states do not directly change stock cost merely by changing document status:
- Purchase Request;
- Purchase Order;
- Transfer DRAFT;
- Transfer REQUESTED;
- Transfer APPROVED;
- Production Batch DRAFT;
- Production Batch PLANNED;
- Production Batch IN_PROGRESS.

Physical stock and its cost basis change only at the corresponding Inventory posting boundary.

## 16. Historical Cost Snapshot Rule

Historical operational records must preserve enough information to explain the cost used at that time.

At minimum:

~~~text
document
→ quantity
→ UOM/base quantity
→ unit cost used
→ total cost used
→ posting identity
→ timestamp
~~~

Later edits to Supplier Material price, UOM conversion, Material default cost, Recipe Version, or Product/Menu composition must not silently rewrite completed historical transactions.

A deliberate revaluation/re-costing process is a separate action and must be auditable.

## 17. Legacy Cost Fields

Current Xentra runtime contains legacy cost fields such as:
- products.cost_price
- menus.cost_price
- inventory_po_items.unit_cost

These remain compatibility data during migration.

They must not be promoted to the long-term cross-domain HPP authority.

Specifically:
- Product Catalog must not become the permanent source of actual Material valuation.
- Menu must not become a manually maintained parallel cost ledger.
- legacy PO unit cost remains historical procurement data.
- future HPP must be derived from authoritative Material/Inventory/Production cost sources.

The existing UI field labeled **“HPP item terjual”** is therefore a legacy/manual cost input and must not be treated as proof of actual Inventory valuation or Production cost.

## 18. Cost Availability States

Costing consumers need an explicit result when cost cannot be safely derived.

Suggested states:

~~~text
AVAILABLE
ESTIMATED
UNAVAILABLE
~~~

Meaning:
- AVAILABLE = authoritative current cost basis exists.
- ESTIMATED = theoretical/planning calculation using a declared non-final basis.
- UNAVAILABLE = no valid cost basis exists.

Do not return numeric zero as a silent substitute for unknown HPP.

A zero cost is valid only when an explicit business rule says the input really costs zero.

## 19. Cost Calculation Examples

### Purchased Material

~~~text
Material: Oil
Base UOM: L
Current cost: Rp18,000/L

Recipe consumption: 0.2 L

HPP contribution:
0.2 × 18,000
= Rp3,600
~~~

### Production Output

~~~text
Actual Material Cost = Rp500,000
Actual Output = 200 pcs

Output Unit Cost = Rp2,500/pcs
~~~

### Menu Composition

~~~text
Menu: Paket Ayam + Nasi + Sambal

Ayam cost = Rp8,000
Nasi cost = Rp3,000
Sambal cost = Rp1,500

Menu HPP = Rp12,500
~~~

Selling price remains independent:

~~~text
Selling Price = Rp25,000
HPP          = Rp12,500
Gross Margin = Rp12,500
~~~

Margin reporting is a derived commercial report, not part of Inventory stock mutation.

## 20. Failure Boundaries

| Situation | Result |
|---|---|
| Supplier price changes | Historical receipt/stock cost unchanged |
| PO changes before posting | Cost is not posted to stock |
| Goods Receipt posts | Material stock quantity and cost basis post together |
| Production uses different actual quantity | Actual production cost uses actual consumption |
| Production yield is lower | Output unit cost rises accordingly if total input cost is unchanged |
| Production output is zero | Batch cannot complete under v1 |
| Transfer occurs | Total stock cost moves with the transferred stock; no new purchase cost |
| Menu composition changes | Future HPP changes; historical sales remain snapshots |
| Cost basis unavailable | Return UNAVAILABLE/ESTIMATED according to declared reporting policy |
| Legacy cost_price differs | Legacy field does not override canonical costing |
| Historical Recipe changes | Historical Batch cost remains tied to the executed Recipe Version |

## 21. What Is LOCKED

1. HPP is derived, not a second stock ledger.
2. Inventory owns physical stock cost/valuation evidence.
3. Production actual cost v1 is direct Material cost only.
4. Production keeps planned/theoretical cost separate from actual cost.
5. Production Output Unit Cost uses actual material cost divided by actual output quantity.
6. Completed Production Batch preserves the cost basis used for its actual calculation.
7. Menu HPP follows the effective commercial Product composition.
8. Item Choice Product mappings contribute cost through the resolved Product composition.
9. Supplier Material price is not automatically the universal HPP authority.
10. Transfer moves stock and its resolved cost basis; transfer itself does not create a purchase cost.
11. Historical cost evidence is immutable under ordinary master-data edits.
12. Legacy Product/Menu cost_price fields are compatibility data, not long-term HPP authority.
13. Unknown cost must not silently become numeric zero.
14. Labor, overhead, landed cost allocation, and financial accounting are outside v1 direct-material costing.

## 22. Explicitly Open for Later Contracts

- exact valuation method selection and scope;
- FIFO layer persistence;
- Moving Average calculation details;
- Standard Cost publishing/versioning;
- landed cost and freight allocation;
- labor cost;
- work-center cost;
- utilities/overhead;
- packaging cost;
- waste/scrap costing;
- yield variance costing policy;
- subcontracting cost;
- multi-currency / FX policy;
- revaluation workflow;
- accounting journal integration;
- whether Menu HPP prefers latest actual output cost or theoretical current recipe cost;
- location-specific valuation policy;
- lot-specific costing.

## 23. Current Runtime / Migration Boundary

The current runtime is not the canonical HPP implementation.

Existing Product/Menu cost fields and PO unit-cost fields remain compatibility evidence.

Do not:
- rename legacy cost_price fields and call that HPP;
- make Catalog calculate Inventory carrying value;
- make Production mutate cost fields in Product directly;
- make Transfer copy arbitrary current supplier prices;
- introduce a second independent costing ledger without an explicit contract.

Future implementation must place cost resolution behind explicit costing services/repositories while preserving the existing Product/Menu and Procurement compatibility seams during migration.

## 24. External Supporting Evidence

ERPNext documents BOM costing as an estimate derived from raw-material valuation rates and operation costs, and its inventory valuation documentation distinguishes FIFO, Moving Average, and Standard Cost. Odoo documents product costing using Standard Price, Average Cost, and FIFO and describes finished-goods valuation from consumed components plus production labor.

These references support the separation between operational stock movement, inventory valuation, component costing, and finished-goods cost. They do not override Xentra business authority.

References:
- https://docs.frappe.io/erpnext/bill-of-materials
- https://docs.frappe.io/erpnext/fifo-and-moving-average
- https://docs.frappe.io/erpnext/standard-valuation-rate
- https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/inventory_valuation/operations_valuation.html
- https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html

## 25. Change Control

Any change to:
- HPP authority;
- Production Actual Cost formula;
- Production Output Unit Cost formula;
- Menu HPP composition;
- transfer cost continuity;
- historical cost immutability;
- legacy cost field authority

requires a new explicit contract revision.

**LOCKED — Costing / HPP Contract v1.**
