# Xentra — Material → Procurement → Production → Selling Lifecycle Contract v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-08  
**Simulation evidence:** `docs/decisions/xentra-material-production-selling-lifecycle-simulation-v1.md`
**Related authorities:**
- `docs/decisions/xentra-domain-vocabulary-boundary-v1.md`
- `docs/decisions/xentra-multibranch-supply-stock-topology-contract-v1.md`
- `docs/decisions/catalog-menu-domain-contract-v2.md`
- `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`
- `docs/LOCKED_INVENTORY_MODEL.md`

## 1. Decision Summary

Xentra adopts one end-to-end business lifecycle across Material, Procurement, Production, Inventory, Catalog, Commerce, and POS:

~~~
Material Master
    ↓
Demand / Stock Condition
    ↓
Replenishment Requirement
    ↓
Shopping List / Purchase Request
    ↓
Procurement
    ↓
Purchase Order
    ↓
Verified Goods Receipt
    ↓
Material Stock
    ↓
Production / Recipe / BoM
    ↓
Production Batch
    ↓
Production Output / Sellable Product Stock
    ↓
Menu / Menu Items / Item Choices
    ↓
Order / Sale
    ↓
Sellable Product Stock Consumption
~~~

This is the canonical **make-to-stock lifecycle** for the current Xentra selling model.

Make-to-order is a supported future operational variant, but it requires a separate production execution decision. It must reuse the same domains and must not bypass the ownership boundaries below.

## 2. Ownership

| Stage | Owner | Responsibility |
|---|---|---|
| Material | Material | Material identity/specification |
| Stock | Inventory | Material/Product stock balances and movements |
| Replenishment | Inventory / planning capability | Detect condition and create replenishment requirement |
| Shopping / Purchase Request | Procurement workflow | Operational request to replenish |
| Purchase Order | Procurement | Purchase lifecycle |
| Goods Receipt | Procurement + Inventory contract | Verify receipt and mutate physical stock |
| Recipe / BoM | Production | Transformation definition |
| Production Batch | Production | Execute/record transformation and output |
| Menu | Catalog | Commercial selling entity |
| Order | Commerce | Customer order/checkout lifecycle |
| Sale | POS | Cashier/POS transaction execution |

## 3. Lifecycle Rules

### 3.1 Material

Material is an input identity, not a stock balance.

Example:

~~~
Material: Chicken
~~~

Material may be reused across Branches, Stock Locations, Productions, and Suppliers within the authorized Organization supply network.

### 3.2 Replenishment

Inventory evaluates physical stock against the applicable condition/policy:

~~~
Chicken = 8 kg
Reorder condition = triggered
~~~

Result:

~~~
Replenishment Requirement
~~~

A low-stock signal does not automatically create a Purchase Order by default.

Sourcing may be:

~~~
BUY | TRANSFER | PRODUCE
~~~

### 3.3 Belanja

The operational purchasing work proceeds through:

~~~
Replenishment Requirement
→ Shopping List / Purchase Request
→ Procurement Decision
→ Purchase Order
~~~

Shopping List is operational work; it is not a second stock ledger and not itself a Purchase Order.

Staff Gudang, Buyer, Branch Manager, or another authorized role may execute this work according to permission/scope.

### 3.4 Purchase Order

Purchase Order records purchase intent and commercial commitment.

PO creation does **not** increase Material Stock.

### 3.5 Goods Receipt

Physical stock enters Inventory only after a verified receipt.

Example:

~~~
PO = 20 kg
Verified receipt = 18 kg
→ Material Stock +18 kg
→ 2 kg outstanding
~~~

### 3.6 Production

Production consumes Material according to a Recipe / BoM and produces an output with a defined yield.

Example:

~~~
Production Item: Ayam Geprek
Batch yield: 20 portions

Material consumption:
Chicken 4 kg
Chili 0.6 kg
Oil 0.4 L
~~~

Production owns the transformation record.
Inventory owns the physical material/product stock mutations.

### 3.7 Production Output

A completed production batch may create or increase ready-to-sell Product Stock at the production Stock Location.

Where output is produced centrally, Inventory Transfer may move that output to a Branch Stock Location.

Production does not maintain a second stock ledger.

### 3.8 Menu and Item Choice

The Customer buys a Menu, not a Recipe.

Canonical commercial structure:

~~~
Menu
├── Category → grouping/classification
├── Title → explicit commercial name
└── Menu Items
     └── optional Item Choices
~~~

Item Choice belongs to a specific Menu Item.

Choice can be:
- Owner-fixed (`Kamu mengatur`);
- Customer-selected (`Pelanggan memilih`).

Choice resolution can alter effective commercial composition, but it does not directly mutate Material Stock.

### 3.9 Selling

Selling resolves the authoritative Menu and then uses the active Inventory stock contract.

~~~
Menu resolution
→ availability check
→ Order / Sale
→ acceptance/commit boundary
→ Sellable Product Stock consumption
~~~

Raw materials already consumed by a Production Batch are not consumed again by the later sale.

## 4. Central / Branch / Hybrid Topology

The same lifecycle supports:

### Branch-direct

~~~
Supplier → Branch Procurement → Receiving → Branch Material Stock
→ Branch Production → Branch Product Stock → Selling
~~~

### Central supply / kitchen

~~~
Supplier → Central Procurement → Central Material Stock
→ Central Production → Product Stock → Inventory Transfer
→ Branch Product Stock → Selling
~~~

### Hybrid

Different Materials or production stages may use different sourcing/location policies.

These are policy/configuration variants, not alternate domain models.

## 5. Make-to-Stock vs Make-to-Order

### Current canonical path: Make-to-Stock

~~~
Material
→ Procurement
→ Material Stock
→ Production
→ Product Stock
→ Menu Selling
~~~

This matches the existing ready-to-sell Product Stock contract.

### Future variant: Make-to-Order

~~~
Material Stock
→ Customer Order / production demand
→ Production
→ Production Output
→ Fulfillment / Sale completion
~~~

This is **not** locked as the default operating model.

Make-to-order must still:
- use Production for transformation;
- use Inventory for physical stock;
- keep Menu as the commercial selling entity;
- avoid direct Order → raw Material deduction;
- preserve an auditable production/stock sequence.

## 6. Choice-aware Production

When an Item Choice changes the effective composition, the production system may eventually resolve that choice into production/material demand.

Example:

~~~
Menu Item: Es Teh
Pilihan Item: Rasa
Customer selects: Lemon
~~~

The resolved choice may:
- map to a different stocked Item;
- add a stock-managed Item;
- change production demand;
- have no stock impact.

The exact mapping is deliberately left to the future Production/Material contract.

## 7. Failure Boundaries

- Cancelled PO → no stock mutation.
- Partial receipt → only verified quantity enters Material Stock.
- Failed/lost shipment before receipt → no stock receipt.
- Failed Production Batch → Production records the failure/waste evidence; Inventory records actual physical mutations through its contract.
- Customer choice change → changes Menu resolution only; no automatic raw-material deduction.
- Product Stock unavailable → selling is constrained by the active Menu/Inventory contract.
- Transfer failure → remains an Inventory transfer problem; it is not silently converted into a Purchase Order.

## 8. HPP / Costing Boundary

Conceptual cost path:

~~~
Material cost
→ Material Stock
→ Production consumption + yield
→ Production Output cost
→ effective Product/Menu cost
→ Selling Price
~~~

HPP is a derived business view, not a second inventory ledger.

These are intentionally OPEN:
- valuation method;
- exact UOM master schema/reference-data implementation;
- UOM precision/rounding rules;
- overhead allocation;
- waste costing;
- recipe costing versioning;
- HPP calculation timing.

## 9. Locked Invariants

1. Material identity and Material Stock are different concepts.
2. Purchase Order does not increase stock.
3. Verified Goods Receipt is the purchasing-to-inventory handoff.
4. Production records transformation; Inventory records physical stock mutation.
5. Production does not own a competing stock ledger.
6. Menu is commercial; Recipe/Production is operational transformation.
7. Item Choice is Menu-Item-scoped and does not directly mutate raw-material stock.
8. Selling consumes ready-to-sell Product Stock according to the active Inventory contract.
9. Branch-direct, central, and hybrid sourcing share the same domains.
10. Make-to-order, when later enabled, does not create a second architecture.
11. Core authorization and scope remain authoritative across all stages.

## 10. Explicitly Open

This contract does not lock:
- exact Stock Location schema;
- exact Product ↔ Production Item relationship;
- Recipe/BoM versioning;
- production planning/scheduling;
- output SKU rules;
- exact UOM master schema/reference-data implementation;
- UOM precision/rounding rules;
- costing/valuation/HPP algorithm;
- autonomous purchase limits;
- exact procurement/receiving/production role matrix;
- exact Item Choice → Material/Production mapping.

These decisions require their own contracts.

## 11. Implementation Gate

Production/Material/Procurement implementation must proceed through:

~~~
Vocabulary Audit
    ↓
Domain Ownership / Impact Map
    ↓
Target Data Model
    ↓
Compatibility Seams
    ↓
Incremental Implementation
    ↓
Data + Regression Verification
    ↓
Legacy Quarantine
    ↓
Legacy Removal after proof
~~~

Do not implement the lifecycle by directly editing another domain's tables.

**LOCKED — Xentra Material → Procurement → Production → Selling Lifecycle Contract v1.**