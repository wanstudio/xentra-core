# Xentra — Production Routing + Stock Location Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Production Item applicability to physical Stock Locations and deterministic resolution of the Production Item used by a Production Batch.

**Prerequisite authorities:**
- docs/decisions/xentra-production-item-recipe-bom-contract-v1.md
- docs/decisions/xentra-production-batch-posting-mutation-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/decisions/xentra-multibranch-supply-stock-topology-contract-v1.md

## 1. Decision Summary

Production is location-aware.

~~~
Product
  ↓
Production Item
  ↓
Production Item Location Applicability
  ↓
Production Stock Location
  ↓
Production Batch
~~~

A Production Item is a production definition that may be used at one or more authorized production Stock Locations.

The Stock Location is the physical execution context. Branch is only organizational/operational scope.

## 2. Production Item Location Applicability

v1 introduces the logical relationship:

`production_item_locations.production_item_id → production_items.id`
`production_item_locations.stock_location_id → stock_locations.id`

Conceptual fields:
- production_item_id;
- stock_location_id;
- active state;
- effective dates if needed by the implementation;
- audit timestamps.

This relationship answers:
> **At this physical Stock Location, is this Production Item an allowed production definition for its output Product?**

A mapping does not create stock. It only establishes routing eligibility.

## 3. One Active Route Per Product + Production Location

To keep routing deterministic in v1:

> **For one Product at one Production Stock Location, only one active Production Item may be eligible at a time.**

Therefore this combination is invalid:

~~~
Product A + Central Kitchen
  Production Item 1 = ACTIVE
  Production Item 2 = ACTIVE
~~~

The system must not silently choose between competing active Production Items.

If two methods need to coexist at the same location, that is a future advanced routing/priority capability and requires a new contract.

This makes the v1 resolver deterministic without hidden priority heuristics.

## 4. How Routing Resolves a Production Item

A production request must provide or resolve an explicit `production_stock_location_id` before a Production Batch can be executed.

Resolver:

~~~
Requested Product
      +
Production Stock Location
      ↓
Find active Production Item
      ↓
exactly 1 → proceed
0        → PRODUCTION_ROUTE_NOT_FOUND
>1       → PRODUCTION_ROUTE_AMBIGUOUS / data-integrity failure
~~~

Routing must not use:
- current Branch menu selection;
- supplier identity;
- Product label/SKU parsing;
- arbitrary first row ordering;
- customer delivery branch as a hidden substitute for production location.

The production context must be explicit.

## 5. Production Location vs Input / Output Stock Location

v1 distinguishes the operational production location from stock source/destination when necessary.

~~~
Production Location
  = where the work/execution occurs

Input Stock Location
  = where consumed Material Stock is taken from

Output Stock Location
  = where produced Product Stock is posted
~~~

For the simple MVP, Input and Output may be the same as the Production Location.

Central Kitchen example:

~~~
Production Location = Central Kitchen
Input Stock Location = Central Raw Material Store
Output Stock Location = Central Sellable Product Store
~~~

This allows materials to be staged/stored separately without pretending those locations are different production sites.

## 6. Production Item vs Recipe Version

Routing differences do not create new Recipe Versions by themselves.

For v1:

~~~
Production Item
  = production route / definition

Recipe Version
  = exact formula revision for that Production Item
~~~

If the same Product requires materially different formulas at two locations, use separate Production Items:

~~~
Product: Sambal Ijo

PI-A → Central Kitchen
  Recipe V3

PI-B → Branch Kitchen
  Recipe V2
~~~

If the formula is the same and only the location changes, one Production Item may be mapped to multiple locations.

## 7. Location Authorization

Only active, authorized Stock Locations may be used for Production.

At minimum the Production resolver must verify:
- Stock Location exists;
- Stock Location belongs to the same Organization supply network;
- Stock Location is active;
- the actor/request has permission to execute production there;
- Production Item is active and applicable to that location.

Physical location authorization belongs to Core authorization + Inventory/Stock Location rules, not to frontend state.

## 8. Branch and Central Kitchen Behavior

Supported examples:

Branch production:
~~~
Product A
  ↓
Production Item A
  ↓
Branch Kitchen Stock Location
~~~

Central production:
~~~
Product A
  ↓
Production Item A
  ↓
Central Kitchen Stock Location
~~~

Same Product, different production definitions:
~~~
Product A
  ├── Production Item A → Central Kitchen
  └── Production Item B → Branch Kitchen
~~~

The supply topology does not require separate Production domains.

## 9. No Implicit Production Location

Xentra must not infer a production location merely because an Order belongs to a Branch.

For example:

~~~
Customer orders at Branch B
      ≠
automatically produce at Branch B
~~~

A future replenishment or MTO policy may decide that Branch B demand is fulfilled by Central Kitchen, but that decision must explicitly resolve a Production Location before creating the Production Batch.

## 10. Interaction With Replenishment

Production becomes a supply source only after sourcing policy selects `PRODUCE`.

~~~
Replenishment Requirement
        ↓
Sourcing Policy
        ↓
PRODUCE
        ↓
Production Location
        ↓
Product + Production Item
        ↓
Production Batch
~~~

Low stock alone does not select a Production Item.

## 11. Interaction With Central Distribution

Central production does not directly mutate Branch Product Stock.

~~~
Central Production
  ↓
Central Product Stock
  ↓
Inventory Transfer
  ↓
Branch Product Stock
~~~

This preserves Inventory ownership of physical movement.

## 12. Data Integrity Rules

At the target data-model level:
- one Product may have many Production Items;
- one Production Item produces exactly one Product;
- one Production Item may be applicable to many Stock Locations;
- one Product + one Production Stock Location may have only one active Production Item in v1;
- an inactive/archived Production Item cannot be the active route;
- an inactive Stock Location cannot be selected for new Production Batches;
- historical Batches retain their resolved Production Item and Recipe Version references even after those definitions are retired.

## 13. Examples

### A — One Production Item shared by two locations

~~~
Product: Sambal
Production Item: Sambal Standard

Applicable locations:
  Branch A Kitchen
  Branch B Kitchen
~~~

Both locations use the same Recipe Version.

### B — Different recipes by location

~~~
Product: Sambal

Production Item A
  Central Kitchen
  Recipe V3

Production Item B
  Branch Kitchen
  Recipe V2
~~~

Different production definitions justify two Production Items.

### C — Same Product is bought at Branch, produced centrally

~~~
Product: Sambal
  Procurement → Branch demand
  Production Item → Central Kitchen

Central Production
  ↓
Central Product Stock
  ↓
Inventory Transfer
  ↓
Branch Product Stock
~~~

Product identity remains unchanged.

## 14. Audit / Historical Semantics

When a Production Batch is created, it records the resolved:
- production_item_id;
- production_stock_location_id;
- recipe_version_id.

Later route configuration changes must not reinterpret historical batches.

Route changes are future configuration for future batches.

## 15. What Is LOCKED

1. Production is location-aware.
2. Stock Location is the physical production context.
3. Production Item may be applicable to one or more Stock Locations.
4. Production Item ↔ Stock Location applicability is explicit, not inferred.
5. One Product + one Production Stock Location has at most one active Production Item in v1.
6. Production routing must resolve exactly one active Production Item before a batch is executable.
7. Zero eligible routes is an explicit routing failure.
8. Multiple active eligible routes are an integrity error, not a hidden priority selection.
9. Production Location is distinct from input/output Stock Location concepts, although MVP may use the same location.
10. Branch does not implicitly determine Production Location.
11. If formulas differ materially by location, use separate Production Items.
12. If only location differs and formula is the same, one Production Item may serve multiple locations.
13. Central production distributes output through Inventory Transfer.
14. Historical batches retain their resolved Production Item, production location, and Recipe Version.

## 16. Explicitly Open

- advanced route priority when multiple methods must coexist at one location;
- capacity/work-center scheduling;
- alternate production methods selected dynamically;
- subcontracting;
- MTO reservation semantics;
- WIP / multi-step production.

## 17. External Supporting Evidence

ERPNext requires a Work Order to resolve source, WIP, and target warehouses for manufacturing, and its production planning is location-aware. Dynamics 365 determines a valid BOM version using the demand site's site dimension. Odoo uses locations/routes and manufacturing configuration to control where product movement and production-related operations occur. These references support location-aware production routing, while Xentra's one-active-route-per-location rule is a deliberate simplification for v1.

References:
https://docs.frappe.io/erpnext/work-order
https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-plan-bom-version-determined
https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/use_routes.html

## 18. Change Control

Any change to Production Item location applicability, route determinism, implicit location resolution, or multi-route selection requires a new explicit contract revision.

**LOCKED — Production Routing + Stock Location Contract v1.**