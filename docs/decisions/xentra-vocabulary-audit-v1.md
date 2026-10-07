# Xentra — Vocabulary Audit v1

**Status:** 🔎 AUDIT COMPLETE / INPUT TO DATA-MODEL DESIGN  
**Audit date:** 2026-10-07  
**Audited ref:** `proposal/xentra-taxonomy-composed-menu-v1`  
**Scope:** backend source, database schema, domain services, repositories, API routes, and relevant architecture documents.

## 1. Executive Finding

The source is **not uniformly wrong**. Xentra currently contains a mixture of:

1. canonical vocabulary already implemented;
2. explicit compatibility vocabulary retained during migration;
3. boundary debt where code is still physically owned by an older domain;
4. ambiguous vocabulary that must be resolved before the Production / Material / Procurement model is implemented.

The most important finding is:

> **The new Production / Material / Procurement layers must not be built on top of the current Branch + Product-centric inventory vocabulary.**

The current sellable Product stock model is valid for the existing sales channel contract, but it is not a sufficient physical inventory model for central warehouse, central kitchen, raw materials, production, and inter-location transfer.

## 2. Current Canonical Vocabulary

### Catalog

Current canonical concepts:
- Product = atomic reusable Catalog identity.
- Menu = customer-facing commercial selling unit.
- Menu Item = Product component of a Menu.
- Branch Menu = Branch adoption/configuration of a Menu.
- Branch Category = branch-local catalog classification.
- Master Category / Sub Category / Rasa / Level = Catalog master/reference vocabulary.

Evidence in source:
- `domains/catalog/schema/ComposedMenuSchema.js` defines `menus`, `menu_items`, `branch_menus`, and `branch_menu_categories`.
- `domains/catalog/services/ComposedProductService.js` treats Product as the stable identity and SKU lifecycle.

Assessment: **CANONICAL / KEEP**.

## 3. Product Audit

### Canonical

The forward Product model is now clear enough:

```text
Product
  id
  brand scope
  name
  sku
  description
  media
  lifecycle
```

SKU determines whether a Product participates in the current sellable Product stock contract.

### Compatibility / legacy fields

`products` still contains older fields such as:
- `category_id`;
- `price`;
- `regular_price`;
- `image_url` / `image`;
- `options_config`;
- `menu_schema_version`;
- `menu_migration_status`.

The code explicitly documents these as legacy/compatibility data where the forward Menu architecture has taken ownership.

Assessment: **CANONICAL ENTITY + LEGACY FIELD DEBT**.

Action: do not blindly remove or rename fields. Audit each consumer first, then quarantine/remove after migration proof.

## 4. Menu Audit

Current canonical storage:

```text
menus
menu_items
branch_menus
branch_menu_categories
```

This is the correct forward direction.

However, legacy runtime still contains:

```text
branch_products
branch_product_categories
```

and several APIs still expose compatibility aliases such as `adopted_products` / `available_master_products` even when their underlying value is now a canonical Menu object.

Assessment: **CANONICAL MENU MODEL + COMPATIBILITY SURFACE DEBT**.

Action: preserve compatibility until all consumers are migrated; new code must use Menu terminology.

## 5. Item Vocabulary Audit

`Item` is **not a valid generic backend business entity name** in Xentra.

The source currently contains multiple legitimate but different meanings:

```text
Menu Item
Order Item
Purchase/PO Item (legacy)
Sale Item (target POS concept)
Recipe Component (target Production concept)
```

These must remain qualified by domain.

Important current cases:
- `menu_items` = Catalog Menu Item.
- `order_items` = Commerce Order Item.
- `inventory_po_items` = legacy Procurement/Purchase Line concept, currently owned by Inventory.
- future `production` components must not be called generic Item if their actual meaning is Recipe Component.

Assessment: **AMBIGUOUS TERM — QUALIFY, DO NOT GLOBAL-RENAME**.

## 6. Order Item / Menu Identity Boundary

`order_items` now has both legacy `product_id` and canonical `menu_id`-oriented fields.

Current schema includes:

```text
order_items.product_id
order_items.menu_id
order_items.menu_type
order_items.component_snapshot
```

The source documentation explains that `menu_id` is the forward commercial identity and component/product data may remain for snapshots/compatibility.

Assessment: **MIGRATION SEAM IS CORRECT; OLD `product_id` MUST NOT BE REINTERPRETED AS THE NEW MENU IDENTITY**.

Action: map every Order API/query/test consumer before removing or changing the legacy Product reference.

## 7. Stock / Inventory Audit

### Current canonical sellable Product stock

`branch_product_inventory.stock_qty` is the current canonical ready-to-sell Product stock.

Current contract:

```text
Branch + Product → Sellable Product Stock
```

This correctly represents the existing one-shared-Branch-stock-pool model across POS/PWA/Dine-in/Delivery/WhatsApp.

### Legacy stock

`branch_products.stock` remains compatibility data.

Assessment: **VALID FOR CURRENT SELLABLE PRODUCT CONTRACT; NOT A GENERAL PHYSICAL INVENTORY MODEL**.

### Critical target mismatch

The new supply topology requires:

```text
Stock Location + Stock Identity → Stock Balance
```

because stock may live in:
- Branch Stock Location;
- Central Warehouse;
- Central Kitchen;
- other authorized locations;
- transit where required.

The current `branch_product_inventory` and `inventory_movements` are Branch + Product-centric and therefore cannot become the final Material Inventory model without structural extension.

Assessment: **HIGH-PRIORITY DATA-MODEL GAP**.

Action: design Stock Location before implementing Material Stock / Production consumption / Procurement receipt.

## 8. Inventory Movement Vocabulary Audit

Current `inventory_movements` contains:

```text
branch_id
product_id
movement_type
quantity INTEGER
previous_stock
current_stock
reference_id
mutation_id
```

Current movement types include purchase-in, sale deduction, transfer-in/out, waste/spoilage, and adjustment.

This is adequate evidence for the current Product stock ledger, but it conflates several future concepts under one Product-centric movement model.

Examples:
- Material receipt must reference Material Stock, not Product Stock.
- Production consumption must reference Material Stock.
- Production output may reference Product Stock or another explicit stocked Production output according to future policy.
- Inter-location transfer must be location-to-location.

Assessment: **CURRENT LEDGER VALID FOR CURRENT SCOPE; TARGET LEDGER NEEDS LOCATION + STOCK-IDENTITY GENERALIZATION**.

Do not rename `product_id` blindly. First design the target stock identity abstraction and compatibility path.

## 9. Procurement Audit

Current source contains:

```text
domains/inventory/services/PurchaseOrderService.js
inventory_purchase_orders
inventory_po_items
InventoryRepository.insertPurchaseOrder(...)
```

The current PO schema uses:

```text
brand_id
branch_id
supplier_name
product_id
quantity INTEGER
unit_cost
received_quantity
```

The current implementation also uses the correct invariant that PO creation does not mutate stock and Goods Receipt is the stock mutation point.

However, two things are wrong for the target architecture:

1. Procurement lifecycle is physically owned by Inventory.
2. The purchase line references `product_id`, while the future purchasing concept should resolve through Procurement-owned Supplier Material.

Assessment: **WRONG DOMAIN OWNER + WRONG FUTURE BUSINESS IDENTITY**.

Action: migrate the capability to Procurement incrementally after consumer/FK/API mapping. Do not rewrite the current production flow merely to make the folder name look correct.

## 10. Supplier Vocabulary Audit

Current procurement stores `supplier_name` as free text.

Target architecture requires:

```text
Supplier
Supplier Material
Purchase Line
```

because supplier-specific pack size, price, lead time, and sourcing data cannot safely live as one string on the Purchase Order.

Assessment: **TARGET ENTITY MISSING / CURRENT FREE-TEXT COMPATIBILITY**.

Action: create Supplier + Supplier Material in Procurement during target-model design.

## 11. Material Audit

No authoritative Material domain implementation was found in the current source tree.

No canonical tables/services were found for:
- Material;
- Raw Material;
- Material specification;
- Material Stock.

Assessment: **EXPECTED MISSING TARGET DOMAIN, NOT LEGACY DEBT**.

Action: do not improvise Material schema inside Inventory or Catalog.

## 12. Production Audit

No authoritative Production domain implementation was found in the current source tree.

No canonical tables/services were found for:
- Production Item;
- Recipe / BoM;
- Recipe Component;
- Yield;
- Production Batch;
- Production Output.

Assessment: **EXPECTED MISSING TARGET DOMAIN, NOT LEGACY DEBT**.

Action: design after vocabulary/data-model gate; do not derive Production from Menu CRUD.

## 13. Batch Vocabulary Audit

The term `batch` already exists in Commerce for Order Addition Batch:

```text
order_addition_batches
addition_batch_id
```

This is **not** a Production Batch.

Assessment: **VOCABULARY COLLISION BUT SEMANTICALLY SEPARABLE**.

Rule: future Production must always use qualified vocabulary such as `production_batch`, never generic `batch` as a domain authority.

## 14. Branch / Location Audit

Current code correctly treats `branch_id` as organizational/operational scope across Catalog, Commerce, POS, Dining, Delivery, and current sellable stock.

However, the new supply contract requires:

```text
Branch
  = organizational / operational scope

Stock Location
  = physical inventory custody
```

The source currently has no authoritative Stock Location model.

`location` references found in the current system primarily concern customer/geographic addresses and delivery, not warehouse custody.

Assessment: **HIGH-PRIORITY MISSING TARGET CONCEPT**.

Action: introduce Stock Location as a distinct Inventory concept; never overload customer/location geography identifiers.

## 15. Sale vs Order Audit

Architecture says:

```text
Commerce → Order
POS → Sale
```

But current POS runtime persists the POS transaction through the shared `orders` / `order_items` storage and `PosOrderService`.

This is not automatically wrong: it can be a compatibility implementation seam while the canonical Sale domain contract is being formed.

However, the storage vocabulary must not silently redefine:

```text
Order = Sale
```

Assessment: **SEMANTIC DEBT / FUTURE POS DATA-MODEL GAP**.

Action: keep the conceptual distinction locked; audit POS Sale/Sale Item target persistence separately before changing storage.

## 16. Payment Vocabulary Audit

`order_payments` is the current order-level Payment record.
`pos_check_payments` and `pos_payment_group_payments` represent POS payment allocation/execution records.

The current code correctly keeps payment settlement authority in the Payment domain while POS drives execution workflows.

Assessment: **GENERALLY ALIGNED; DETAILS REQUIRE NO TAXONOMY REWRITE NOW**.

## 17. Rasa / Flavor Vocabulary

The business vocabulary is `Rasa`, but the current physical table is `menu_flavors` and the service/repository contains `Rasa` methods over that table.

Assessment: **API/BUSINESS VOCABULARY IS CLEAR; STORAGE NAMING IS LEGACY/INCONSISTENT**.

Action: do not rename now. Record as a low-risk naming debt and resolve during a later Catalog schema cleanup only if migration cost is justified.

## 18. Catalog Boundary Status

`domains/commerce/services/CatalogService.js` is already a documented compatibility shim to Catalog.

The more important remaining issue is that `domains/catalog/services/CatalogService.js` still reads legacy Branch Product compatibility fields for current runtime/data compatibility.

Assessment:
- Commerce boundary: **NEARLY RESOLVED / SHIM ONLY**.
- Catalog runtime compatibility: **ACTIVE LEGACY PATH**.

Action: continue consumer migration; do not treat the Commerce shim as evidence that two catalog authorities exist.

## 19. Dining Boundary Status

Current source still contains Dining services under both:

```text
domains/dining/
domains/pos/
```

Architecture already identifies this as migration debt.

Assessment: **WRONG PHYSICAL OWNER / VALID TARGET BOUNDARY**.

Action: separate migration wave from the Production/Material/Procurement data-model work unless a direct dependency appears.

## 20. Summary Matrix

| Vocabulary | Current status | Target interpretation | Priority |
| --- | --- | --- | --- |
| Product | Mostly canonical + legacy fields | Catalog Product | Medium |
| Menu | Canonical forward model | Catalog Menu | Medium |
| Menu Item | Canonical | Catalog Menu Item | Low |
| Order Item | Canonical but transitional Product ref | Commerce Order Item + Menu identity | High |
| Purchase Line | Legacy as PO Item under Inventory | Procurement Purchase Line | High |
| Supplier | Free-text today | Procurement Supplier | High |
| Material | Missing | Material domain | High |
| Production | Missing | Production domain | High |
| Stock | Mixed meanings | Qualified Product Stock / Material Stock | High |
| Inventory | Domain canonical | Physical stock authority | High |
| Batch | Mixed with Order Addition Batch | Production Batch must be qualified | Medium |
| Branch | Valid organizational scope | Remains organizational scope | Low |
| Location | Customer/delivery geography today | New Stock Location must be distinct | High |
| Sale | Conceptual POS authority, shared Order storage today | POS Sale | High |
| Payment | Generally aligned | Payment domain | Low |
| Rasa | Business term clear, table name legacy | Catalog Rasa | Low |

## 21. What Must NOT Be Changed Yet

Do not currently:
- globally rename `product_id`;
- delete `branch_products`;
- replace `branch_product_inventory` with a guessed Material Stock schema;
- move Purchase Order code without consumer/FK/API mapping;
- create Material tables directly inside Inventory;
- create Production tables based on Menu tables;
- rename every `item` table just for naming symmetry;
- equate POS `orders` rows with the conceptual Order = Sale boundary;
- create Stock Location schema before the target inventory identity model is designed.

## 22. Refactoring Priority

The audit establishes this priority:

```text
PRIORITY 0
Freeze vocabulary + ownership
        ↓
PRIORITY 1
Stock Location + stock identity target model
        ↓
PRIORITY 2
Material + Supplier Material vocabulary/data model
        ↓
PRIORITY 3
Production / Recipe / BoM model
        ↓
PRIORITY 4
Procurement target model
        ↓
PRIORITY 5
Incremental migration of current Inventory PO + Product stock seams
        ↓
PRIORITY 6
POS Sale / Order persistence reconciliation
        ↓
Legacy quarantine + removal after proof
```

## 23. Audit Conclusion

The locked Xentra architecture is **semantically compatible with the current source**, but the existing physical model is still heavily shaped by the earlier Product + Branch implementation.

The next design gate is therefore not another vocabulary debate.

> **Next step: Target Data Model Design, beginning with Stock Location + Stock Identity, while preserving the current sellable Product stock contract through a compatibility seam.**

Only after that should Material, Production, Procurement tables and their relationships be finalized.

**AUDIT COMPLETE — no source/runtime changes were made as part of this audit.**