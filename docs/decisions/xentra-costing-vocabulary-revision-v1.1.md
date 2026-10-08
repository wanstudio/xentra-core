# Xentra — Costing Vocabulary Revision v1.1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Canonical naming for Menu Composition Cost, Production/Product cost, Cost of Goods Sold (COGS), and Indonesian HPP terminology.

**Supersedes:** `docs/decisions/xentra-costing-hpp-contract-v1.md` terminology only.
The costing formulas, ownership boundaries, stock/cost snapshot rules, transfer cost continuity, and open valuation policy from Costing/HPP Contract v1 remain in force unless explicitly changed below.

## 1. Decision Summary

Xentra will **not** use the bare term **HPP** as a canonical engineering name for every form of menu/product cost.

The canonical cost vocabulary is:

~~~
Material Unit Cost
        ↓
Production Actual Material Cost
        ↓
Production Output Unit Cost
        ↓
Inventory / Product Stock Cost Basis
        ↓
Menu Composition Cost
        ↓
Cost of Goods Sold (COGS)
~~~

In Indonesian financial/reporting UI, **Harga Pokok Penjualan (HPP)** may be used as the localized label for **Cost of Goods Sold (COGS)**.

Therefore:

~~~
Menu HPP                 → DO NOT USE as canonical engineering term
Recipe HPP               → DO NOT USE as canonical engineering term
Product HPP              → DO NOT USE as canonical engineering term

Menu Composition Cost    → canonical derived menu-cost term
COGS                     → canonical sold-inventory cost term
HPP Penjualan (COGS)     → allowed Indonesian reporting/UI label
~~~

## 2. Why the distinction is required

Inventory cost and cost of sales are not the same thing.

IAS 2 distinguishes the cost of inventories from the subsequent recognition of that carrying amount as an expense when inventories are sold. The cost formulas are applied to inventory, and when inventory is sold its carrying amount is recognized as an expense in the period of the related revenue.

Industry ERP systems follow the same separation:
- inventory movements carry inventory value/cost;
- manufacturing consumes component cost and adds finished-goods value;
- outbound sale/delivery recognizes the cost associated with inventory leaving stock;
- recipe/BOM costing is an estimate/planning calculation and is distinct from the stock valuation ledger.

## 3. Canonical Terms

### 3.1 Material Unit Cost

Cost per unit of Material Base Stock UOM used by Inventory/valuation.

Example:

~~~
Rice
Base UOM = kg
Material Unit Cost = Rp14,000/kg
~~~

This does not mean supplier list price must equal the final inventory valuation basis.

### 3.2 Production Actual Material Cost

Actual direct Material cost consumed by one Production Batch.

~~~
Production Actual Material Cost
= Σ(actual consumed quantity × resolved Material unit cost)
~~~

v1 includes direct Material cost only.

### 3.3 Production Output Unit Cost

Actual cost per unit of Product produced by a completed Production Batch.

~~~
Production Output Unit Cost
= Production Actual Material Cost
  ÷ Actual Output Quantity
~~~

This is a production-cost result. It is not automatically COGS.

### 3.4 Inventory / Product Stock Cost Basis

The resolved cost/value basis attached to Product stock by the active Inventory valuation policy.

It is an Inventory/valuation result, not a Product master selling-price field.

The exact valuation method remains governed by the separate valuation-policy decision.

### 3.5 Menu Composition Cost

**Menu Composition Cost** is the derived cost of the Menu's current effective Product composition.

Conceptually:

~~~
Menu Composition Cost
= Σ(effective Product quantity × applicable Product cost basis)
~~~

It may be presented for:
- menu costing;
- price-setting;
- margin simulation;
- planning;
- operational analysis.

It is **not**:
- a second inventory ledger;
- a stock balance;
- a purchase price;
- a Production Batch cost record;
- accounting COGS;
- a historical sales cost entry.

### 3.6 Cost of Goods Sold (COGS)

COGS is the cost recognized for goods/inventory that are actually sold or otherwise recognized as cost of sales according to the applicable accounting/operational policy.

For an inventory-backed sale, COGS must be derived from the authoritative inventory cost of the quantities that leave stock, not copied from the current Menu Composition Cost.

COGS belongs to the selling/accounting execution/reporting boundary, not to Menu master data.

### 3.7 HPP

For Indonesian reporting/UI:

~~~
HPP = Harga Pokok Penjualan
~~~

When the intended meaning is COGS, use the explicit label:

~~~
HPP Penjualan (COGS)
~~~

or another reporting label that clearly indicates **cost of goods sold**.

Do not use bare HPP in a new engineering API, database field, service, or domain entity when the underlying meaning is Menu Composition Cost or Production cost.

## 4. Required Separation

The following distinctions are mandatory:

| Term | Meaning | Canonical use |
|---|---|---|
| Material Unit Cost | Material cost per Base Stock UOM | Inventory/valuation |
| Production Actual Material Cost | Actual direct material consumed by Batch | Production |
| Production Output Unit Cost | Actual cost per produced Product unit | Production/costing |
| Inventory / Product Stock Cost Basis | Cost/value assigned to Product stock | Inventory/valuation |
| Menu Composition Cost | Derived cost of current effective Menu composition | Costing/Menu analysis |
| COGS | Cost recognized for sold inventory | Selling/accounting/reporting |
| HPP Penjualan | Indonesian reporting label for COGS | UI/reporting |

## 5. No Silent Equivalence

These terms must never be treated as interchangeable:

~~~
Menu Composition Cost ≠ COGS
Production Output Unit Cost ≠ COGS
Supplier Material Price ≠ COGS
PO Line Price ≠ COGS
Selling Price ≠ COGS
~~~

A current Menu Composition Cost may be useful to estimate margin, but it does not become the historical COGS of a completed sale.

## 6. Cost Basis for Menu Composition Cost

The existing Costing/HPP v1 rule remains:

A production-backed Product used in Menu Composition Cost must use an explicitly declared cost basis, such as:
- ACTUAL_OUTPUT
- THEORETICAL_RECIPE

The system must not silently switch between these bases.

Therefore a resolver must return an explicit cost availability/result state:

~~~
AVAILABLE
ESTIMATED
UNAVAILABLE
~~~

Unknown cost must not silently become numeric zero.

## 7. Historical Sales and COGS

When a Menu is sold:

~~~
Menu
  ↓
effective Product composition
  ↓
sale / stock consumption
  ↓
authoritative inventory cost leaves stock
  ↓
COGS / HPP Penjualan
~~~

A later edit to Menu composition, Product master data, Recipe Version, Supplier Material price, or current valuation does not rewrite the historical sale.

Historical COGS must therefore be backed by the stock/cost evidence used for that execution.

## 8. UI Vocabulary

For an owner-facing Menu editor, use:

~~~
Biaya Menu
or
Estimasi Biaya Menu
~~~

for Menu Composition Cost.

Do not label this field:
- HPP
- HPP item
- HPP item terjual

unless the field actually represents a sold-item Cost of Goods Sold result.

For financial/sales reports, use:

~~~
HPP Penjualan
Cost of Goods Sold (COGS)
~~~

as explicit reporting vocabulary.

## 9. Engineering Vocabulary Rules

New code must prefer:
- menuCompositionCost
- productionActualMaterialCost
- productionOutputUnitCost
- inventoryUnitCost / inventoryCostBasis
- costOfGoodsSold

Avoid introducing new canonical fields/services/entities named only:
- hpp
- menu_hpp
- product_hpp
- recipe_hpp
- hpp_cost
- hpp_service

Legacy names may remain only inside explicitly bounded migration/compatibility seams.

## 10. Migration Rule

This revision does **not** require an immediate physical schema rewrite.

Existing fields such as:
- products.cost_price
- menus.cost_price
- legacy unit_cost

remain compatibility/historical data where already required.

They must not gain new cross-domain authority merely because their label is changed.

A future migration may map legacy data into an explicit cost-basis model, but the migration must preserve historical evidence and must not reinterpret old values as COGS without proof.

## 11. External Supporting Evidence

- **IFRS IAS 2** separates the cost of inventories from recognition of the carrying amount as an expense when inventories are sold, and defines cost formulas such as FIFO and weighted average for applicable inventories.
- **Odoo Inventory Valuation** records value on stock movements; receipts increase value, deliveries decrease value, and internal movements move stock without changing total company value. Odoo also distinguishes the Unit Cost on stock movements from the product form's Cost field.
- **ERPNext BOM Costing** describes BOM costing as an approximate manufacturing cost derived from material valuation and operation costs, supporting the separation of estimated manufacturing/menu cost from the inventory ledger.
- **IAI** accounting learning material explicitly uses Harga Pokok Penjualan for the cost associated with inventory sold and illustrates perpetual inventory entries where HPP is debited and inventory is credited.

References:
- https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/
- https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/inventory_valuation/operations_valuation.html
- https://docs.frappe.io/erpnext/bill-of-materials
- https://web.iaiglobal.or.id/assets/materi/Sertifikasi/CA/modul/ak/files/basic-html/page451.html

## 12. Locked Decision

1. **Menu Composition Cost** replaces **Menu HPP** as the canonical engineering/business-analysis term for derived Menu composition cost.
2. **COGS** is the canonical engineering/accounting term for cost recognized on sold inventory.
3. **HPP Penjualan (COGS)** is allowed as an Indonesian reporting/UI label.
4. Bare **HPP** must not be introduced as a new ambiguous engineering term.
5. Menu Composition Cost must not be treated as historical COGS.
6. Production Output Unit Cost must not be treated as COGS merely because the Product is sellable.
7. No silent fallback between cost bases and no silent numeric-zero fallback for unknown cost.
8. This revision changes terminology/authority language only; it does not replace the existing physical stock, production, procurement, or inventory valuation contracts.

**LOCKED — Costing Vocabulary Revision v1.1.**
