# Xentra — Stock Location + Stock Identity Target Data Model v1

**Status:** 🔎 PROPOSED TARGET DATA MODEL / PRE-IMPLEMENTATION DESIGN
**Date:** 2026-10-08
**Prerequisites:**
- `docs/decisions/xentra-production-material-procurement-vocabulary-gate-v1.md`
- `docs/decisions/xentra-material-supplier-material-contract-v1.md`

This document defines the target logical model only. It does not authorize immediate SQLite migration or runtime refactoring.

## 1. Design objective

The target model must answer four different questions:

1. What is the thing? → Product or Material.
2. Where is it physically held? → Stock Location.
3. How much exists? → Stock Balance.
4. What changed the quantity? → Stock Movement.

Therefore Xentra must not introduce one generic Stock Item identity.

## 2. Core model

```
Organization
  ├── Stock Locations
  │     ├── Branch Stock Location
  │     ├── Central Warehouse
  │     ├── Central Kitchen
  │     └── Other Authorized Location
  ├── Materials
  │     └── Supplier Materials
  └── Brands
        └── Products
              └── Menus
```

Physical stock is then:

```
Material → Material Stock Balance → Stock Location
Product  → Product Stock Balance  → Stock Location
```

## 3. Stock Location

Recommended logical entity: `stock_locations`.

Core fields:
`id`, `organization_id`, `code`, `name`, `location_type`, `branch_id nullable`, `is_active`, timestamps.

Initial `location_type` vocabulary:
- `BRANCH`
- `CENTRAL_WAREHOUSE`
- `CENTRAL_KITCHEN`
- `OTHER`

Do not make Warehouse the universal term. Warehouse is one Stock Location type.

A Branch may have zero, one, or many Stock Locations. A Stock Location may exist without a Branch association.

Do not use `branch_id` as the physical stock authority.

## 4. Current sellable Product Stock compatibility

Current canonical ready-to-sell stock is `branch_product_inventory(branch_id, product_id, stock_qty)`.

Target interpretation:

```
Branch
  ↓ operational scope
Stock Location
  ↓ physical custody
Product Stock Balance
  ↓
Product
```

The Branch's current shared sellable stock pool should map to one designated sellable Product Stock Location for the current operational context.

This preserves the locked rule that POS, PWA, Dine-in, Delivery, and WhatsApp do not get separate stock pools.

## 5. Product Stock Balance

Recommended logical entity: `product_stock_balances`.

Core fields:
`stock_location_id`, `product_id`, `quantity`, `updated_at`.

Logical identity:
`(stock_location_id, product_id)`.

Meaning:
ready-to-sell quantity of a specific Product at one physical Stock Location.

Do not create channel-specific Product Stock.

## 6. Material Stock Balance

Recommended logical entity: `material_stock_balances`.

Core fields:
`stock_location_id`, `material_id`, `quantity_base_uom`, `updated_at`.

Logical identity:
`(stock_location_id, material_id)`.

Meaning:
physical quantity of a Material at one Stock Location.

Material identity and Material Stock Balance are different concepts.

## 7. Stock Movement

For the first target implementation, prefer two explicit movement identities:

`material_stock_movements`
`product_stock_movements`

This is safer than immediately creating a polymorphic `inventory_movements` with nullable `material_id` and `product_id` because it prevents invalid states where neither or both identities are populated.

The current `inventory_movements` remains a legacy Product-oriented ledger during migration and must not be renamed blindly.

Conceptual Material movement fields:
`id`, `stock_location_id`, `material_id`, `movement_type`, `quantity_base_uom`, `previous_quantity`, `current_quantity`, `reference_type`, `reference_id`, `mutation_id`, `actor_id`, `notes`, `created_at`.

Conceptual Product movement fields use the same pattern with `product_id` and product quantity.

## 8. Material master

Recommended logical entity: `materials`.

Conceptual fields:
`id`, `organization_id`, `code`, `name`, `description`, `base_uom_id`, `is_active`, timestamps.

Material is Organization-scoped and reusable across Brands/Branches within the Organization supply network.

Do not duplicate Material merely because different suppliers or branches buy it differently.

## 9. Supplier Material

Recommended logical entities:
- `supplier_materials`
- `supplier_material_packs`

Conceptual `supplier_materials` fields:
`id`, `supplier_id`, `material_id`, `supplier_item_code`, `is_active`, validity fields, and current/default sourcing metadata.

A Supplier Material may have one-to-many dated purchase forms/packs. Conceptual `supplier_material_packs` fields include:
`id`, `supplier_material_id`, `name`, `purchase_uom_id` nullable, `content_quantity_base`, `content_uom_id`, `minimum_order_quantity`, `unit_price`, `currency`, `effective_from`, `effective_to`, `is_active`.

`Supplier Material` owns supplier-specific commercial data. `Material` remains the identity of what the input actually is.

Important: purchase UOM and supplier pack are different vocabulary concepts. A directly convertible measurement such as `5,000 g → 5 kg` uses UOM conversion. A commercial representation such as `1 sack = 25 kg` is modeled as a pack/content definition. Historical PO/Receipt lines snapshot the resolved conversion/content.

## 10. Production Item

Recommended logical entity: `production_items`.

Recommended conceptual relationship:

```
Product
  1
  │
  └── 0..N Production Items
```

A Production Item is a production/preparation definition, not a second Product master.

Core recommendation:
`production_items.output_product_id → products.id`.

The Product ↔ Production Item relationship is locked by `docs/decisions/xentra-production-item-recipe-bom-contract-v1.md`: Product → 0..N Production Items, each Production Item has exactly one `output_product_id`, and routing must resolve one unambiguous active Production Item for the production context.

## 11. Recipe and Recipe Version

Recommended hierarchy:

```
Recipe
  ↓
Recipe Version
  ↓
Recipe Components
```

Recipe Version should be immutable after publication.

Conceptual fields:
`recipe_id`, `version_no`, `status`, `effective_from`, `effective_to`, production-location applicability, `yield_quantity`, `yield_uom_id`, approval metadata.

Relationship: `recipes.production_item_id → production_items.id`.

A Production Item has one logical Recipe in v1; formula changes create new Recipe Versions rather than new Recipes or Products. Published Recipe Versions are immutable.

A Production Batch must record exactly which Recipe Version it used.

This is necessary so historical production is not reinterpreted from today's active recipe.

## 12. Recipe Component

Default target relation:
`recipe_component.material_id`.

Conceptual fields:
`recipe_version_id`, `material_id`, `quantity`, `uom_id`, sequence/order where useful.

Do not introduce polymorphic `component_item_id` until there is an explicit business requirement for semi-finished/by-product structures.

## 13. Production Batch

Recommended logical entity: `production_batches`.

Conceptual fields:
`id`, `production_item_id`, `recipe_version_id`, `production_stock_location_id`, `planned_quantity`, `actual_quantity`, `status`, `started_at`, `completed_at`, `created_by`, `completed_by`, `notes`.

Production location must be explicit. `branch_id` alone is insufficient as physical production authority.

Planned and actual values must remain separate.

## 14. Production Output

Recommended logical entity: `production_outputs`.

Conceptual fields:
`id`, `production_batch_id`, `product_id`, `quantity`, `uom_id`, `stock_location_id`.

At current make-to-stock scope, a Production Batch produces one main Product output. The `production_outputs.product_id` must match the Production Item's `output_product_id` for that batch.

Completed output becomes Product Stock through Inventory posting.

The model should not yet introduce a polymorphic output identity for semi-finished goods; semi-finished outputs and by-products require a later explicit contract.

## 15. Procurement target chain

```
Replenishment Requirement
  ↓
Purchase Request
  ↓
Purchase Order
  ↓
Goods Receipt
  ↓
Material Stock
```

### Purchase Request
Recommended entities: `purchase_requests`, `purchase_request_lines`.

Purpose: demand/approval workflow.

Does not mutate stock.

### Purchase Order
Recommended entities: `purchase_orders`, `purchase_order_lines`.

Header should include:
`organization_id`, `supplier_id`, `destination_stock_location_id`, `status`, required date, creator/approver, timestamps.

Line should include:
`supplier_material_id`, ordered purchase quantity, purchase UOM, resolved base quantity, unit price, currency, conversion snapshot.

PO creation never increases stock.

### Central procurement
Because a central PO can consolidate requests from several Branches, introduce demand-to-procurement traceability with `purchase_order_line_allocations` rather than duplicating demand into the stock model.

## 16. Goods Receipt

Recommended entities: `goods_receipts`, `goods_receipt_lines`.

Header:
`purchase_order_id`, `destination_stock_location_id`, status, receiver, received/posting timestamps.

Line:
`purchase_order_line_id`, accepted purchase quantity, accepted base quantity, rejected quantity, UOM, conversion snapshot.

Only accepted quantity posts to Material Stock.

Partial receipt is first-class:

```
PO = 20 kg
Receipt 1 = 12 kg
Receipt 2 = 6 kg
Outstanding = 2 kg
```

## 17. UOM boundary

Every stock-managed Material has one authoritative base Stock UOM.

Supplier purchasing may use a different Purchase UOM:

```
5 sacks × 25 kg
      ↓
125 kg base quantity
```

The conversion used for a historical transaction must be preserved on that transaction. Historical stock must not depend on today's edited conversion rule.

## 18. Inventory Transfer

Recommended logical entity: `inventory_transfers`.

Core references:
`source_stock_location_id`, `destination_stock_location_id`.

Conceptual lifecycle:

```
Requested → Approved → Dispatched → In Transit → Received
```

The exact state machine remains a separate contract.

At posting, the audit trail must preserve source deduction and destination receipt.

Transfer is Inventory-owned. It is not a Purchase Order and not a Production Batch.

## 19. Production posting boundary

Production owns the transformation record.
Inventory owns the physical mutation.

Posting a completed Production Batch should atomically apply:

```
Material Stock − actual consumption
Product Stock  + actual output
```

Where both mutations are in the same persistence boundary, they must commit or roll back together.

## 20. Menu / Item Choice integration

Target Catalog relation:

```
Menu
  ↓
Menu Item
  ↓
Item Choice
```

The Menu Item should get a stable `menu_item_id` before Item Choice persistence is finalized.

Item Choice may eventually resolve to an additional Product or production requirement, but it must never directly execute a raw-material stock deduction.

Catalog resolves composition. Production decides production impact. Inventory posts physical stock.

## 21. Current-to-target compatibility map

| Current | Target interpretation | Status |
|---|---|---|
| `branch_product_inventory` | Product Stock Balance at Branch sellable Stock Location | compatibility bridge |
| `inventory_movements` | Product movement ledger during staged migration | legacy compatibility |
| `inventory_purchase_orders` | future Procurement Purchase Order model | migration debt |
| `inventory_po_items` | future Purchase Order Lines | migration debt |
| `branch_products.stock` | old compatibility stock | legacy |
| `menus` | current Catalog Menu | active authority |
| `menu_items.product_id` | Menu Item → Product | active relation |
| `order_items.product_id` | compatibility pointer | not Menu identity |
| `order_items.menu_id` | Commerce Order → Catalog Menu | canonical reference |

## 22. Strong recommendations ready for contract promotion

1. Stock Location is the physical stock boundary.
2. Material Stock and Product Stock use different stock identities.
3. Supplier Material is separate from Material.
4. Product SKU is not Production Batch or Lot identity.
5. Production Batch records an immutable Recipe Version.
6. PO does not mutate stock; Goods Receipt does.
7. UOM conversion is explicit and transaction quantities preserve resolved base quantities.
8. Menu Item needs a stable identity before Choice persistence.
9. Production and Inventory keep separate authorities.
10. New FKs are domain-qualified.

## 23. Still OPEN

Do not lock these from this document:
- exact Recipe / Production Item location applicability schema;
- exact WIP / multi-step production model beyond the v1 direct issue-and-produce flow;
- semi-finished/by-product model;
- lot/expiry activation and data model;
- make-to-order trigger/reservation semantics;
- exact transfer state machine;
- production scheduling/capacity;
- HPP/valuation;
- procurement approval matrix;
- autonomous replenishment;
- exact Item Choice → Product/Production mapping.

## 24. External support

ERPNext separates Purchase Receipt, Stock Entry, Work Order, and BOM concepts, which supports keeping procurement, physical stock mutation, and manufacturing execution as distinct responsibilities.
GS1 separates product/class identification from batch/lot identification and separately identifies physical locations, supporting the separation of Product, Production Batch/Lot, and Stock Location.

References:
https://docs.frappe.io/erpnext/purchase-receipt
https://docs.frappe.io/erpnext/stock-entry
https://docs.frappe.io/erpnext/work-order
https://docs.frappe.io/erpnext/bill-of-materials
https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard

## 25. Final assessment

Vocabulary Gate: PASS.
Stock Location + Stock Identity model: sufficiently defined for the next contract layer.

The next design gate is **Production Batch + Posting / Mutation Contract**, using the locked Production Item + Recipe / BoM semantics and this Stock Location / Stock Identity model.
