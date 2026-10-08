# Xentra — Production Item + Recipe / BoM Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Product ↔ Production Item routing, Recipe / Recipe Version identity, Recipe Components, yield semantics, production-location routing, and the boundary to Inventory.

**Prerequisite authorities:**
- docs/decisions/xentra-domain-vocabulary-boundary-v1.md
- docs/decisions/xentra-production-material-procurement-vocabulary-gate-v1.md
- docs/decisions/xentra-material-supplier-material-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md

## 1. Decision Summary

Xentra keeps these concepts separate:

~~~
Product
  = Catalog identity that can be sold / stock-managed

Production Item
  = Production-owned definition for how one Product is produced

Recipe
  = logical production formula owned by a Production Item

Recipe Version
  = immutable published revision of that Recipe

Recipe Component
  = one Material input used by one Recipe Version
~~~

Therefore:
Product ≠ Production Item ≠ Recipe ≠ Material.

A Product may exist without a Production Item because it may be purchased, transferred, or otherwise made available without an Xentra production definition.

A Product may have multiple Production Items when there are materially distinct production definitions or routing contexts.

## 2. Product ↔ Production Item Cardinality

Canonical relationship:

~~~
Product
  1
  │
  └── 0..N Production Items
~~~

Each Production Item references exactly one output Product:
production_items.output_product_id → products.id

The relationship means:
> This Product can be produced through this Production definition.

It does not mean the Production Item is another Product master.

### 2.1 Why 0..N

Multiple Production Items are allowed when the same Product legitimately has materially different production definitions or routing contexts.

Example:
~~~
Product: Ayam Geprek

Production Item A
  Central Kitchen route

Production Item B
  Branch Kitchen route
~~~

Do not create another Production Item merely because the formula changed. Normal formula revision is handled by Recipe Version.

### 2.2 Routing invariant

When production is requested for a Product at a Production Location, the Production domain must resolve one unambiguous active Production Item for that context.

If multiple active Production Items are equally eligible, the system must not silently choose one. The routing policy must explicitly resolve the selection.

Production Item location applicability and the v1 deterministic routing rule are defined by `docs/decisions/xentra-production-routing-stock-location-contract-v1.md`: one active Production Item per Product + Production Stock Location.

## 3. Production Item Meaning

Production Item is the Production domain answer to:
> What production definition / route do we use to make this Product?

It may carry production-specific metadata such as production_item_id, internal name/code, output_product_id, lifecycle state, and production-location applicability.

It must not duplicate Product identity, Product SKU, Material master, stock quantity, or Recipe Version content.

Product remains the canonical sellable / stock identity.

## 4. Product Can Be Purchased and Produced

The existence of a Production Item does not mean the Product can only be manufactured.

Example:
~~~
Product: Chili Sauce
  ├── Procurement can provide it
  └── Production Item can also produce it
~~~

Inventory decides how much Product Stock exists.
Procurement decides purchased supply.
Production decides manufactured supply.

The same Product identity is reused.

## 5. Recipe Relationship

Canonical hierarchy:

~~~
Production Item
      ↓
   Recipe
      ↓
 Recipe Version
      ↓
Recipe Components
~~~

### 5.1 One Production Item → one logical Recipe

For v1, each Production Item has one canonical Recipe identity.

If the formula changes over time, create a new Recipe Version.

If two production methods are materially different and need to coexist as separate routes, create separate Production Items.

This establishes:
~~~
Production Item
  = production definition for one Product

Production Item Location Applicability
  = eligibility mapping of that definition to a Stock Location

Production routing
  = resolution process that selects the applicable Production Item

Recipe Version
  = revision of the same Recipe
~~~

## 6. Recipe

Recipe is a logical production formula belonging to one Production Item.

Recipe answers:
> What formula belongs to this Production Item?

Recipe is not an execution record and does not contain live stock or post Inventory.

Canonical relationship:
recipes.production_item_id → production_items.id

## 7. Recipe Version

Recipe Version is the exact formula revision that a Production Batch uses.

A published Recipe Version is immutable.

When the formula changes:
~~~
Recipe Version 1 → publish
Recipe Version 2 → publish
~~~

Do not edit a published version in place.

A Production Batch must reference the exact recipe_version_id used for execution.

This prevents historical production from being reinterpreted using today's active formula.

## 8. Recipe Version Core Semantics

Conceptually:
- recipe_version_id
- recipe_id
- version number
- lifecycle state
- effective period
- planned output/yield quantity
- yield UOM
- approval/publication metadata
- timestamps

The exact database schema remains an implementation detail.

## 9. Yield

Each Recipe Version defines a planned yield.

Example:
~~~
Recipe: Ayam Geprek
Yield: 20 pcs / batch

Chicken = 4 kg
Chili   = 0.6 kg
Oil     = 0.4 L
~~~

Component quantities are interpreted against that planned yield.

Planned yield is not actual production output. Actual output belongs to the Production Batch.

## 10. Recipe Component

Forward v1 component identity is explicitly Material:
recipe_components.material_id → materials.id

A Recipe Component answers:
> Material apa yang dikonsumsi untuk Recipe Version ini, dan berapa kebutuhan terencananya?

Conceptually:
- recipe_version_id
- material_id
- planned quantity
- UOM
- sequence/order where useful

The quantity may use a directly compatible UOM; final Inventory consumption must resolve to the Material Base Stock UOM.

Example:
~~~
Material: Flour
Base UOM: kg
Recipe Component: 150 g
Resolved consumption: 0.15 kg
~~~

## 11. Component Type Boundary

For v1, Recipe Components are Material-only.

Do not introduce a polymorphic generic component identity merely to anticipate future cases.

Therefore the first model is:
~~~
Recipe Version
  └── Recipe Components
        └── Material
~~~

Semi-finished outputs, sub-assemblies, and other produced intermediates require a later explicit contract.

## 12. Production and Inventory Boundary

Recipe and Recipe Version define requirements; they do not mutate stock.

Production owns transformation/execution records.
Inventory owns physical stock mutation.

The future batch-posting flow is:
~~~
Recipe Version
   ↓ planned consumption
Production Batch
   ↓ actual execution
Inventory
   ├── Material Stock decrease
   └── Product Stock increase
~~~

The Production Batch state machine and posting transaction are defined by the locked Production Batch + Posting / Mutation Contract v1.

## 13. Production Location

A production execution must identify a physical Production Location through the Inventory Stock Location model.

branch_id alone is not the physical production-location authority.

A Branch may have multiple Stock Locations, and a Central Kitchen may exist without being a Branch.

The Production Item / routing layer may restrict where a Production Item can be executed.

## 14. Lifecycle

Production Item:
~~~
DRAFT → ACTIVE → ARCHIVED
~~~

Recipe:
~~~
DRAFT → ACTIVE → ARCHIVED
~~~

Recipe Version:
~~~
DRAFT → ACTIVE / PUBLISHED → RETIRED
~~~

Published Recipe Versions remain readable for historical reconstruction.
Archive/retire is preferred over destructive deletion after operational references exist.

## 15. Cross-Domain Example

~~~
Catalog
Product
  Ayam Geprek
  SKU = AYAM-GEP-001
        │
        │ output_product_id
        ▼
Production
Production Item
  Central Kitchen / Ayam Geprek
        │
        ▼
Recipe
  Ayam Geprek Standard
        │
        ▼
Recipe Version 3
  Yield = 20 pcs
        │
        ├── Chicken 4 kg
        ├── Chili 0.6 kg
        └── Oil 0.4 L
        │
        ▼
Production Batch
  actual output = 18 pcs
        │
        ▼
Inventory
  actual Material Stock consumption
  Product Ayam Geprek +18 pcs
~~~

The Product SKU stays the same.
The Production Batch has its own execution identity.
The Recipe Version identifies the exact formula used.

## 16. Central vs Branch Production

The same Product can be produced in different contexts:
~~~
Product: Sambal Ijo

Production Item A
  Central Kitchen route

Production Item B
  Branch Kitchen route
~~~

Both output the same Product.
The routing layer selects the applicable Production Item for the execution context.

## 17. Locked Invariants

1. Product and Production Item are different business entities.
2. A Product may have 0..N Production Items.
3. Every Production Item produces exactly one canonical Product in v1.
4. production_items.output_product_id is the canonical Product reference.
5. Production Item represents a distinct production definition/route, not a Product duplicate.
6. Recipe version changes do not require a new Product or Production Item.
7. Each Production Item has one canonical Recipe identity in v1.
8. Recipe has one-to-many Recipe Versions.
9. Published Recipe Versions are immutable.
10. Production Batch must reference the exact Recipe Version used.
11. Every Recipe Version has planned yield quantity + compatible yield UOM.
12. Recipe Components reference material_id explicitly.
13. Recipe Components are Material-only in v1.
14. Recipe/Recipe Version never owns live stock or stock mutation.
15. Production execution uses a physical Stock Location context.
16. Routing must resolve one unambiguous active Production Item for a Product + production context.
17. Existing Product SKU identity is reused; a new SKU is not created per Production Batch.
18. Historical Recipe Versions remain addressable after retirement.
19. Destructive deletion is not allowed once operational/history references exist.

## 18. Explicitly Open for Later Contracts

- advanced route priority when multiple methods must coexist at one location;
- WIP;
- semi-finished Products / sub-assemblies as Recipe Components;
- by-products;
- lot / expiry;
- Make-to-Order trigger/reservation;
- scheduling / capacity;
- yield variance / waste posting;
- exact valuation method / accounting integration;
- autonomous production/replenishment;
- exact Item Choice → Product / Production mapping.

## 19. External Supporting Evidence

Current ERP documentation supports the separation of a manufactured Product from its manufacturing definition and BoM/version/alternative behavior. Odoo configures manufacturing on Products and supports BoMs for products and variants. ERPNext describes a BOM as the components/sub-assemblies required to manufacture an Item and supports alternative active BOMs, BOM-driven Work Orders, and production planning. These references support the structure but do not override Xentra business authority.

References:
https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html
https://www.odoo.com/documentation/master/applications/inventory_and_mrp/manufacturing/advanced_configuration/product_variants.html
https://docs.frappe.io/erpnext/bill-of-materials
https://docs.frappe.io/erpnext/production-plan

## 20. Change Control

Any change to Product ↔ Production Item cardinality, Recipe identity/version semantics, Recipe Component identity, or the production routing invariant requires a new explicit contract revision.

**LOCKED — Production Item + Recipe / BoM Contract v1.**