# Xentra — Pre-Implementation Vocabulary Gate v1

**Status:** 🔎 AUDIT COMPLETE / REQUIRED PRE-IMPLEMENTATION GATE
**Date:** 2026-10-08

This document operationalizes the locked Domain Boundary and Canonical Vocabulary decision before any new Production, Material, Procurement, or Stock Location schema/API/refactor is added.

## 1. Gate result

**PASS — vocabulary is sufficiently stable to begin target data-model design, with mandatory guardrails below.**

The current codebase contains a mixture of canonical vocabulary, compatibility vocabulary, and legacy naming. This is expected during staged migration, but legacy names must not be copied into new business authority.

DDD's Ubiquitous Language principle is directly relevant: the domain language should be rigorous and used consistently because software does not handle ambiguity well; bounded contexts exist so that a vocabulary has a precise meaning within a model.

## 2. Canonical vocabulary registry

| Term | Canonical meaning | Owner | Canonical identifier |
|---|---|---|---|
| Organization | top-level organizational scope | Core / identity boundary | `organization_id` |
| Brand | commercial brand under an Organization | Catalog / identity boundary | `brand_id` |
| Branch | operational / selling scope | operational boundary | `branch_id` |
| Stock Location | physical inventory custody location | Inventory | `stock_location_id` |
| Product | atomic reusable Catalog identity | Catalog | `product_id` |
| Menu | customer-facing commercial selling entity | Catalog | `menu_id` |
| Menu Item | one component reference inside one Menu | Catalog | `menu_item_id` |
| Item Choice | choice attached to one Menu Item | Catalog | `item_choice_id` |
| Material | reusable input / ingredient identity | Material | `material_id` |
| Material Stock | physical quantity of Material at a Stock Location | Inventory | `material_stock_balance` |
| Product Stock | ready-to-sell quantity of Product at a Stock Location | Inventory | `product_stock_balance` |
| Stock Movement | physical inventory mutation | Inventory | domain-qualified movement |
| Production Item | production / preparation definition for an output | Production | `production_item_id` |
| Recipe | logical production definition | Production | `recipe_id` |
| Recipe Version | immutable production definition used by an execution | Production | `recipe_version_id` |
| Recipe Component | one input line in a Recipe Version | Production | `recipe_component_id` |
| Production Batch | one production execution instance | Production | `production_batch_id` |
| Production Output | output recorded from a Production Batch | Production | `production_output_id` |
| Supplier | procurement counterparty | Procurement | `supplier_id` |
| Supplier Material | supplier-specific sourcing definition for a Material | Procurement | `supplier_material_id` |
| Replenishment Requirement | business need to replenish a stock condition | Inventory / planning | `replenishment_requirement_id` |
| Shopping List | user-facing planning/read model derived from replenishment needs | Procurement / planning | no stock authority |
| Purchase Request | request / approval object for procurement | Procurement | `purchase_request_id` |
| Purchase Order | commercial purchasing commitment | Procurement | `purchase_order_id` |
| Purchase Line | line inside a Purchase Order | Procurement | `purchase_order_line_id` |
| Goods Receipt | verified record of physically accepted supplier quantity | Procurement + Inventory handoff | `goods_receipt_id` |
| Inventory Transfer | internal movement between Stock Locations | Inventory | `inventory_transfer_id` |
| Order | Commerce transaction demand | Commerce | `order_id` |
| Order Item | commercial line in an Order | Commerce | `order_item_id` |
| Sale | POS transaction execution | POS | `sale_id` |
| Sale Item | line in a Sale | POS | `sale_item_id` |
| Payment | payment lifecycle | Payment | `payment_id` |
| Settlement | finalization of payment obligation | Payment | `settlement_id` |

## 3. Mandatory anti-ambiguity rules

### Item
`Item` is not a new generic Xentra business entity. Always qualify it: Menu Item, Order Item, Sale Item, Purchase Line, Recipe Component, Production Item.

### Stock
`Stock` is not a new unqualified quantity authority. Use Material Stock or Product Stock. Existing legacy `stock` fields may remain only as compatibility data.

### Product
Use Product only for Catalog Product. Do not use Product as a synonym for Material, Production Item, Menu, Supplier Material, or Sale Item.

### Purchase
Do not create a generic Purchase entity. Use Purchase Request, Purchase Order, or Goods Receipt.

### Receipt / Receiving
Receiving is the operational action/workflow. Goods Receipt is the business record of a verified receipt.

### Batch
Always qualify Batch. Commerce already contains `order_addition_batches`; Production must use `production_batch_id` and must never reuse generic `batch_id` semantics.

### Location
Stock Location is the universal physical-inventory term. Warehouse and Central Kitchen are location types. Delivery Destination is a separate concept and is never a Stock Location.

## 4. Critical current-code findings

### 4.1 Current Branch Product inventory is compatibility vocabulary
Current evidence includes `branch_product_inventory`, `branch_products`, and `inventory_movements` keyed by `product_id`. This is valid for the current ready-to-sell Product Stock contract, but it is not the target Material Stock model.

Target meaning:
`branch_product_inventory` → compatibility bridge for Product Stock at a Branch sellable Stock Location.

Do not copy the Branch + Product shape into Material inventory.

### 4.2 Purchase Order is still implemented under Inventory
Repository evidence still contains `domains/inventory/services/PurchaseOrderService.js`, `inventory_purchase_orders`, and `inventory_po_items`. Those are migration debt. The forward owner is Procurement.

### 4.3 Current inventory movement ledger is Product-only
Current `inventory_movements` requires `product_id`. Do not rename that column blindly. A future Material Stock ledger needs `material_id` and `stock_location_id` semantics explicitly.

### 4.4 `menu_items.product_id` is a real Product reference
`menu_items.product_id` is semantically valid and must remain a Product FK. It must never be reinterpreted as Material, Production Item, or Stock identity.

### 4.5 Menu Item requires stable identity before Choice persistence
The current physical Menu Item identity is effectively `(menu_id, product_id)`. The Item Choice contract requires Choice to belong to a specific Menu Item. Therefore the target model should introduce `menu_item_id` rather than making Choice depend on the current composite key forever.

### 4.6 Current `title_id` / `menu_titles` needs caution
The current physical implementation contains `title_id` / `menu_titles`, while the current Menu contract defines Title as explicit Owner-entered commercial text. Therefore new Production/Material work must not propagate `title_id` as a new cross-domain identity.

### 4.7 Choice is not the old POS Option model
Forward Catalog vocabulary is Item Choice. Existing POS `options_config` and other legacy option semantics are compatibility-era concepts. They must not be merged silently.

### 4.8 Paket is a commercial Menu shape, not a new stock/production entity
A multi-item Menu may be called Paket in business/UI language. Do not create a generic Package entity or let legacy `menu_type` become a Production identity rule.

## 5. FK naming gate

New foreign keys must expose business meaning:

`menu_item.product_id`
`recipe_component.material_id`
`purchase_order_line.supplier_material_id`
`material_stock_balance.stock_location_id`
`material_stock_balance.material_id`
`product_stock_balance.stock_location_id`
`product_stock_balance.product_id`
`production_batch.production_item_id`
`production_batch.recipe_version_id`
`goods_receipt.destination_stock_location_id`
`inventory_transfer.source_stock_location_id`
`inventory_transfer.destination_stock_location_id`

A bare `item_id`, `stock_id`, `purchase_id`, `receipt_id`, `batch_id`, or overloaded `location_id` should be rejected when the real business reference is more specific.

`product_id` is still correct when the referenced concept is actually Catalog Product.

## 6. Error and log vocabulary gate

Troubleshooting should carry the same business vocabulary as the domain model.

Preferred examples:
`STOCK_LOCATION_REQUIRED`
`MATERIAL_NOT_FOUND`
`MATERIAL_STOCK_NOT_FOUND`
`PRODUCT_STOCK_NOT_FOUND`
`SUPPLIER_MATERIAL_NOT_FOUND`
`PURCHASE_ORDER_NOT_FOUND`
`GOODS_RECEIPT_NOT_POSTED`
`PRODUCTION_ITEM_NOT_FOUND`
`RECIPE_VERSION_NOT_FOUND`
`PRODUCTION_BATCH_POSTING_FAILED`
`MENU_ITEM_NOT_FOUND`
`ITEM_CHOICE_INVALID`

Avoid generic errors such as `ITEM_NOT_FOUND`, `STOCK_ERROR`, `PURCHASE_ERROR`, `BATCH_ERROR`, and `LOCATION_ERROR` in new cross-domain code.

## 7. Vocabulary-to-ownership rule

| Concept | Owner | Other domains may |
|---|---|---|
| Product | Catalog | read / reference |
| Menu / Menu Item / Item Choice | Catalog | read / resolve |
| Material | Material | read / reference |
| Stock Location / Material Stock / Product Stock | Inventory | query / request mutation through contract |
| Production Item / Recipe / Batch / Output | Production | read / invoke workflow through contract |
| Supplier / Supplier Material / Purchase docs / Goods Receipt | Procurement | read / invoke workflow through contract |
| Order | Commerce | consume from POS / Payment / Delivery |
| Sale | POS | consume from Payment / Inventory / Reporting |
| Payment / Settlement | Payment | consume from Commerce / POS |

## 8. Required implementation gate

Before any new schema, repository, service, route, or UI is added:

```
Vocabulary term
  ↓
Domain owner confirmed
  ↓
Canonical entity confirmed
  ↓
FK meaning confirmed
  ↓
API name confirmed
  ↓
Error / log vocabulary confirmed
  ↓
Legacy alias classified
  ↓
Only then: implementation
```

This gate is intentionally stricter for Production / Material / Procurement because these domains introduce several similarly named concepts that can otherwise produce silent semantic coupling.

## 9. Supporting references

Martin Fowler explains Ubiquitous Language as a common, rigorous language between domain experts and developers and explains Bounded Context as a boundary within which a model and vocabulary are valid.
ERPNext documents separate Purchase Receipt, Stock Entry, Work Order, and BOM concepts.
GS1 separately distinguishes stable product/class identification, batch/lot identification, and physical-location identification.

References:
https://martinfowler.com/bliki/UbiquitousLanguage.html
https://martinfowler.com/bliki/BoundedContext.html
https://docs.frappe.io/erpnext/purchase-receipt
https://docs.frappe.io/erpnext/stock-entry
https://docs.frappe.io/erpnext/work-order
https://docs.frappe.io/erpnext/bill-of-materials
https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard

## 10. Final gate decision

**Vocabulary Audit: PASS.**

The target model may proceed, but new code must use the registry above and explicitly isolate compatibility vocabulary. No big-bang rename of legacy columns is authorized by this gate.