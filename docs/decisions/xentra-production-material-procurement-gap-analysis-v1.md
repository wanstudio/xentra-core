# Xentra — Production / Material / Procurement Architecture Gap Analysis v1

**Status:** 🔎 ANALYSIS / PROPOSED RESOLUTION  
**Date:** 2026-10-08  
**Authority:** NON-AUTHORITATIVE analysis. No business lock is changed by this document.

## 1. Purpose

This document closes the remaining architecture gaps around the locked lifecycle:

```
Material
  ↓
Replenishment
  ↓
Procurement
  ↓
Goods Receipt
  ↓
Material Stock
  ↓
Production
  ↓
Product Stock
  ↓
Menu / Item Choice
  ↓
Order / Sale
```

The goal is to determine which gaps can be closed by architecture evidence, which require a new explicit Xentra decision, and what the target data model should look like before implementation starts.

## 2. Current Evidence

The current repository already has a forward Catalog/Menu boundary and a canonical ready-to-sell Product stock model. The existing runtime also proves an important behavior:

- a composed Menu is resolved into component Products;
- SKU-bearing components participate in stock availability;
- composed Menu stock requirements are aggregated across the cart;
- stock deduction is atomic at the Product component level;
- legacy Product/Branch tables remain compatibility storage.

The current Inventory repository, however, still models purchasing through legacy `inventory_purchase_orders` / `inventory_po_items` and Product-oriented stock tables. There is no canonical Material / Supplier Material / Recipe / Production Batch persistence model yet.

Therefore the next step is architecture-first target modeling, not direct runtime expansion.

## 3. Gap Classification

### P0 — Must be resolved before Production implementation

1. Stock Location + Stock Identity
2. Product ↔ Production Item relationship
3. Production Output identity
4. Recipe / BoM versioning and applicability
5. Production posting / Inventory mutation boundary
6. UOM + conversion
7. Procurement document model for Materials
8. Menu Item identity for Item Choice integration

### P1 — Must be designed before operational hardening

9. Production yield / variance / waste
10. Lot / batch / expiry traceability
11. Replenishment route policy
12. Transfer lifecycle / in-transit representation
13. Role / approval matrix
14. Production scheduling / capacity
15. HPP / costing / valuation
16. Autonomous purchasing limits

## 4. Proposed Resolution — Stock Location and Stock Identity

### 4.1 Semantic decision

```
Branch
  = organizational / operational scope

Stock Location
  = physical inventory custody

Material
  = material identity

Product
  = canonical catalog / stock identity

Stock Balance
  = quantity of one qualified identity at one Stock Location
```

Do not create one generic `item` stock concept.

### 4.2 Target logical model

```
Organization
  └── Stock Location
        ├── Branch Sellable
        ├── Branch Raw Material
        ├── Central Warehouse
        ├── Central Kitchen
        ├── WIP
        └── Transit (where required)
```

Recommended target records:

- `stock_locations`
- `material_stock_balances`
- `product_stock_balances`
- `material_stock_movements`
- `product_stock_movements`

A single typed Inventory movement ledger is also possible, but only if it enforces mutually-exclusive `material_id` / `product_id` semantics. Separate ledgers are clearer for the first implementation.

### 4.3 Compatibility bridge

The current:

```
branch_product_inventory(branch_id, product_id, stock_qty)
```

should remain a migration-compatible representation of the Branch's default **sellable Product Stock Location**.

It must not become the permanent raw-material inventory table.

This preserves the existing one-shared-sellable-stock-pool behavior for POS/PWA/Dine-in/Delivery while allowing multiple physical stock locations underneath the Branch.

## 5. Proposed Resolution — Product ↔ Production Item

### 5.1 Recommended cardinality

```
Product
  1 ───── 0..N
           Production Item
```

A Production Item is **not another product master**. It is a production-capability / manufacturing definition for producing a canonical Product.

Why 0..N instead of 1:1:

- the same Product can be produced at different production locations;
- different production methods may exist;
- a central kitchen recipe can differ from a Branch recipe;
- a product may be purchasable at one location and manufactured at another;
- recipe versions should not force duplication of Product identity.

### 5.2 Recommended rule

For a given production context, there should be only one active default Production Item / production route unless an explicit routing policy selects another one.

The Production Item references the output Product:

```
production_item.output_product_id → products.id
```

The Production Batch then references the Production Item, not a copied Product definition.

## 6. Proposed Resolution — Product SKU vs Production Batch vs Lot

These are different identities:

```
SKU
  = stable Product identity used for stock management

Production Batch
  = one execution of a production process

Lot / Batch Traceability
  = physical grouping used for traceability of produced/received stock
```

Do not generate a new SKU for every production batch.

Example:

```
Product:
  Sambal Ijo
  SKU: SAMBAL-IJO-001

Production Batch:
  PB-20261008-001
  Output:
    50 units
```

A later traceability enhancement may add a Lot Number to the stock movement/output. The Lot is subordinate to the product identity, not a replacement for it.

## 7. Proposed Resolution — Recipe / BoM Versioning

### 7.1 Separate logical Recipe from Recipe Version

Recommended model:

```
Recipe
  └── Recipe Version
        └── Recipe Components
```

A published Recipe Version should be immutable.

A new recipe change creates a new version.

### 7.2 Minimum fields

Recipe Version should conceptually carry:

- production_item_id
- version identifier
- status
- effective_from
- effective_to (nullable)
- production-location scope (nullable if global)
- yield quantity
- yield UOM
- created_by / approved_by
- created_at

Recipe Component should carry:

- qualified component identity
- quantity
- UOM
- sequence / ordering where useful
- optional loss / waste allowance if the later costing contract requires it

### 7.3 Historical rule

Every Production Batch must store the exact Recipe Version used.

Historical production must never be reinterpreted from today's active Recipe.

## 8. Proposed Resolution — Recipe Scope by Production Location

Recipe selection should consider production context.

Example:

```
Product: Ayam Geprek

Central Kitchen
  → Recipe v3

Branch A Kitchen
  → Recipe v2
```

The product remains one Product identity.

The Recipe Version is selected according to:

```
Production Item
+ Production Location
+ Effective Date
+ Explicit applicability
```

This supports the locked multi-branch / central-kitchen architecture without creating separate Product catalogs.

## 9. Proposed Resolution — Production Execution and Inventory Mutation

### 9.1 Ownership

```
Production
  → defines and records transformation

Inventory
  → records physical stock mutation
```

Production must never maintain a competing quantity ledger.

### 9.2 Minimum execution model

```
DRAFT
  ↓
RELEASED / READY
  ↓
IN_PROGRESS
  ↓
COMPLETED
  ↘
   FAILED / CANCELLED
```

Exact labels may be refined in the Production State Machine Contract.

### 9.3 Posting boundary

A completed/posted Production Batch must apply:

```
Material Stock
  -
Actual Consumption

Product Stock
  +
Actual Output
```

as one atomic business transaction whenever both mutations are in the same persistence boundary.

This prevents:

```
material deducted
BUT
finished product missing
```

or the reverse.

### 9.4 WIP

WIP should be supported by the target model but does not have to be exposed in the first UX version.

Two valid execution levels:

**Simple MVP**
```
Material Stock
  ↓ consume on production posting
Production
  ↓
Product Stock
```

**Physical-stage model**
```
Material Storage
  ↓ issue
WIP / Production Location
  ↓ consume
Production completion
  ↓
Product Stock
```

Because Xentra supports central kitchens and warehouse operations, the target model should not block the second model.

## 10. Proposed Resolution — UOM

Every stock-managed Material should have an authoritative base Stock UOM.

Supplier purchasing may use a different Purchase UOM.

Example:

```
Material:
  Rice
  Stock UOM = kg

Supplier pack:
  Sack
  1 Sack = 25 kg

PO:
  5 Sack

Receipt:
  Accepted = 5 Sack
  Stock mutation = +125 kg
```

### 10.1 Required concepts

- UOM master
- UOM category
- base/reference UOM
- conversion factor
- purchase UOM per Supplier Material
- quantity precision / decimal policy
- transaction-level resolved base quantity

A historical transaction must not need to recalculate its stock quantity from a future-edited conversion rule.

## 11. Proposed Resolution — Supplier Material

Material identity must remain independent from supplier packaging and commercial terms.

Recommended:

```
Material
  ├── Supplier Material A
  ├── Supplier Material B
  └── Supplier Material C
```

Supplier Material should conceptually own:

- supplier_id
- material_id
- supplier item code
- purchase UOM
- pack size / conversion
- vendor price
- currency
- lead time
- minimum order quantity
- active / validity dates

The same Material therefore does not need to be duplicated because Supplier A sells 25 kg sacks and Supplier B sells 50 kg sacks.

## 12. Proposed Resolution — Procurement Document Chain

The authoritative procurement lifecycle should be:

```
Replenishment Requirement
  ↓
Purchase Request
  ↓
Procurement Decision
  ↓
Purchase Order
  ↓
Goods Receipt
  ↓
Material Stock Mutation
```

### 12.1 Shopping List

Recommended interpretation:

> Shopping List is a user-facing planning/read model, not a second source of stock truth.

Where approval is not required, an authorized user may move directly from a replenishment need into procurement according to permission.

### 12.2 Purchase Request

Purchase Request is the operational request/approval object.

Suggested state family:

```
DRAFT → SUBMITTED → APPROVED → SOURCING / CONVERTED
                         ↘ CANCELLED
```

Exact approval depth depends on role policy.

### 12.3 Purchase Order

PO should reference:

- supplier
- destination Stock Location
- PO lines
- ordered quantity
- Purchase UOM
- conversion snapshot
- agreed unit price/currency
- required date
- creator / approver
- status

PO creation must not mutate stock.

### 12.4 Centralized procurement allocation

Because central procurement may consolidate requests from multiple Branches:

```
Branch A request 20 kg
Branch B request 30 kg
Branch C request 50 kg
        ↓
Central PO 100 kg
```

the target model needs traceability between the consolidated PO line and the originating request lines.

Recommended bridge:

```
purchase_order_line_allocations
```

This is not another stock ledger; it is demand-to-procurement traceability.

## 13. Proposed Resolution — Goods Receipt

Goods Receipt is the physical handoff from Procurement into Inventory.

Target behavior:

```
PO ordered = 20 kg
Receipt #1 accepted = 12 kg
Receipt #2 accepted = 6 kg
Outstanding = 2 kg
```

Recommended receipt state:

```
DRAFT
  ↓
POSTED
  ↓
(optional) CANCELLED / REVERSED
```

A receipt line should be able to represent:

- accepted quantity
- rejected quantity
- UOM / conversion snapshot
- destination Stock Location
- PO line reference
- receiver
- received_at

Only accepted quantity becomes available Material Stock.

Rejected or quarantined material must not silently enter usable stock.

## 14. Proposed Resolution — Replenishment Route

The source of a replenishment requirement should be a policy outcome, not a hard-coded Branch rule.

Supported route:

```
BUY
TRANSFER
PRODUCE
```

The selected route depends on the destination Stock Location and applicable policy.

Examples:

```
Branch A rice
  → TRANSFER from Central Warehouse

Branch B oil
  → BUY from Supplier

Branch C sambal
  → PRODUCE at Central Kitchen
```

This is consistent with the already locked multi-branch supply topology.

## 15. Proposed Resolution — Production Yield / Actuals

Production must distinguish planned from actual quantities.

Example:

```
Recipe planned:
  20 portions

Production Batch:
  planned = 20
  actual = 18
```

Actual material consumption must be recorded independently from planned consumption.

This creates the evidence needed later for HPP, waste analysis, and operational variance.

## 16. Proposed Resolution — Waste

A failed or short-yield batch cannot simply disappear.

At minimum Production needs an evidence record for:

- batch
- reason
- material quantity affected
- output quantity actually produced
- actor
- timestamp

Inventory records the physical mutation.

Exact accounting / financial treatment of waste remains part of the future costing contract.

## 17. Proposed Resolution — Lot / Expiry

Lot / expiry support should be designed as an Inventory capability, not embedded in Product SKU identity.

Recommended future relationship:

```
Product / Material
  ↓
Stock Lot
  ↓
Stock Balance / Movement
```

For perishable materials and prepared products, this enables traceability and future FEFO-like operational rules without changing SKU identity.

Lot tracking can be introduced incrementally, but target stock records should leave room for it.

## 18. Proposed Resolution — Menu Item Stable Identity

The current physical `menu_items` shape is:

```
(menu_id, product_id) PRIMARY KEY
```

That is insufficient as the long-term parent identity for Item Choice because the contract says an Item Choice belongs to a specific Menu Item.

Target model should therefore introduce a stable:

```
menu_item_id
```

Then:

```
Menu
  └── Menu Item
        └── Item Choice
              └── Choice Value
```

The current `product_id` remains the referenced Product.

This is especially important if the same Product could ever appear in multiple item contexts or a future composition needs separate choice contexts.

## 19. Proposed Resolution — Choice to Production

The current Item Choice contract correctly keeps the raw-material mutation boundary closed.

The next target should be:

```
Menu Item
  └── Item Choice
        └── Choice Value
              └── optional structured commercial / stock mapping
```

For the current make-to-stock model, a stock-affecting choice should resolve to a Product / stock-managed component when it affects ready-to-sell inventory.

Example:

```
Menu: Ayam Geprek
Item: Ayam
Choice: Sambal
  ├── Sambal Geprek → Product A
  └── Sambal Ijo    → Product B
```

The selling flow then feeds the resolved component requirements into the same atomic Product Stock calculation already used by the current Menu resolver.

A Customer Choice must never directly execute:

```
Customer click
→ raw material stock deduction
```

Any raw-material effect belongs to Production planning/execution.

## 20. Proposed Resolution — Make-to-Stock / Make-to-Order

Current default remains:

```
MAKE-TO-STOCK
Material → Production → Product Stock → Selling
```

The target model should nevertheless carry a production/replenishment policy that can later express:

```
MAKE-TO-ORDER
Customer demand → Production → Fulfillment
```

The key rule is that MTO is a different trigger, not a different domain architecture.

Do not make MTO a hard-coded alternate schema.

## 21. Proposed Resolution — State / Mutation Boundaries

Each document must have a clear posting boundary.

| Object | Owns business state | Stock mutation |
|---|---|---|
| Purchase Request | Procurement workflow | None |
| Purchase Order | Procurement commitment | None |
| Goods Receipt | Receipt verification | + Material Stock |
| Inventory Transfer | Physical movement | Source -, in-transit state, Destination + |
| Production Batch | Transformation execution | Material -, Output + |
| Menu | Commercial definition | None |
| Order | Commercial demand | Current sellable-stock rules |
| Sale / POS | Transaction execution | Sellable Product Stock - |

This prevents document status from being confused with physical stock state.

## 22. Proposed Resolution — Idempotency / Audit

All stock-posting operations should accept a mutation identity/reference that prevents replay.

Required for at least:

- Goods Receipt posting
- Transfer posting
- Production completion
- Sale consumption
- stock adjustment

The domain document may be retried without duplicating the physical mutation.

The existing Inventory movement ledger pattern already provides a foundation for this principle.

## 23. Proposed Resolution — Roles

The role model should remain permission-driven, not hard-coded by topology.

Typical responsibilities:

```
Branch Manager
  → request / approve according to permission

Staff Gudang
  → inspect stock / execute receiving / transfer work according to permission

Buyer
  → sourcing / PO

Receiver
  → Goods Receipt

Production Staff
  → execute Production Batch

Owner
  → policy / approval / oversight
```

The exact role matrix is a separate authorization contract.

## 24. Proposed Resolution — HPP / Costing Boundary

HPP should be derived from:

```
Material cost
  ↓
Actual production consumption
  ↓
Actual yield
  ↓
Production output cost
  ↓
Menu effective composition
  ↓
HPP
```

The following remain business-policy decisions:

- FIFO / weighted average / other valuation;
- waste costing;
- overhead;
- labor;
- packaging;
- conversion loss;
- when HPP is recalculated;
- how branch/location cost is resolved.

Existing Product/Menu `cost_price` fields should not become a parallel cost ledger.

## 25. Important Current-Code Reconciliation

The target model exposes several current implementation residues that should be treated as migration debt:

1. `inventory_purchase_orders` / `inventory_po_items` are Product-oriented and branch-oriented; they cannot be the final Material Procurement model.
2. `branch_product_inventory` is Branch-scoped and Product-scoped; it must become the compatibility bridge for the new Stock Location model.
3. `inventory_movements` currently requires `product_id`; it cannot represent canonical Material Stock mutations.
4. `menus` still contains legacy `sub_category_id`, `rasa_id`, `menu_type`, and related fields; these are not authority for the new Menu model.
5. `menu_items` needs a stable parent identity before Item Choice persistence is finalized.
6. Existing `cost_price` fields must remain clearly subordinate to the future costing contract.
7. Existing legacy tests that assert Product-centric Menu semantics should not be used as business authority for the new Production/Material contracts.

These are migration findings, not permission to perform a mass rewrite.

## 26. External Evidence Check

The proposed structure is consistent with established ERP / supply-chain patterns:

- Odoo separates replenishment rules, supplier purchasing data, inventory locations, inter-warehouse replenishment, and manufacturing routes.
- ERPNext separates Purchase Order, Purchase Receipt, Stock Entry, Work Order, material transfer/consumption, and finished-goods updates.
- Microsoft Dynamics 365 documents Product Receipt as the receipt event against a PO and supports determining a BOM version by site and date/quantity.
- GS1 distinguishes stable trade-item identification from batch/lot traceability.

These references are supporting evidence, not Xentra authority.

## 27. Decisions That Are Strong Enough to Promote to LOCKED Contracts

The following can be promoted with high confidence:

1. Stock Location is the physical stock boundary.
2. Material Stock and Product Stock are separate stock identities.
3. Product SKU is not a Production Batch / Lot identity.
4. Product → 0..N Production Items, with each Production Item producing exactly one Product, and routing resolving one unambiguous active Production Item for the production context.
5. Each Production Item has one logical Recipe in v1; formula revisions use immutable Recipe Versions.
6. Production Batch references an immutable Recipe Version.
7. Production mutation is atomic across input consumption and output posting when persisted in one transaction.
8. Recipe Components reference Material explicitly in v1.
9. Supplier Material is separate from Material identity.
10. PO does not mutate stock; Goods Receipt does.
11. Purchase Request / Shopping work is separate from PO.
12. Partial Goods Receipt is first-class.
13. UOM conversion is explicit and transaction quantities must preserve resolved base quantities.
14. Menu Item needs a stable identity before Choice persistence.
15. Choice-driven stock effects resolve through structured composition, never direct raw-material mutation.
16. Choice Value stock effects are explicit Product mappings using NONE / ADD_PRODUCT / REPLACE_PRODUCT semantics; direct Choice → Production/Material effects remain future.
17. Inventory Transfer uses explicit Stock Location source/destination, Inventory-owned dispatch/receipt boundaries, partial receipt, atomic posting, and idempotency.

Production Item + Recipe / BoM Contract v1 was promoted on 2026-10-08:
docs/decisions/xentra-production-item-recipe-bom-contract-v1.md

Production Batch + Posting / Mutation Contract v1 was promoted on 2026-10-08:
docs/decisions/xentra-production-batch-posting-mutation-contract-v1.md

Procurement Document Contract v1 was promoted on 2026-10-08:
docs/decisions/xentra-procurement-document-contract-v1.md

Menu Item Choice → Stock / Production Integration Contract v1 was promoted on 2026-10-08:
docs/decisions/xentra-menu-item-choice-stock-production-integration-contract-v1.md

Production Routing + Stock Location Contract v1 was promoted on 2026-10-08:
docs/decisions/xentra-production-routing-stock-location-contract-v1.md

Inventory Transfer State Machine Contract v1 was promoted on 2026-10-08:
docs/decisions/xentra-inventory-transfer-state-machine-contract-v1.md

## 28. Decisions That Should Remain Explicitly OPEN

These still require product/business choices:

- exact `production_item_locations` column/effective-date implementation;
- advanced route priority when multiple methods must coexist at one location;
- WIP and multi-step production beyond the v1 direct issue-and-produce flow;
- semi-finished output / sub-assembly model;
- lot/expiry activation timeline;
- exact make-to-order trigger and reservation semantics;
- partial dispatch workflow;
- transfer variance / loss / damage workflow;
- transfer scheduling and reservation;
- exact role approval matrix;
- exact production scheduling/capacity model;
- exact HPP/valuation method;
- exact autonomous purchasing thresholds;
- direct Choice → Production variant / Material recipe override; Product stock-effect mapping is now locked by `docs/decisions/xentra-menu-item-choice-stock-production-integration-contract-v1.md`;
- exact byproduct/sub-product handling.

## 29. Recommended Contract Order

Do not begin by writing all Production tables at once.

Recommended sequence:

```
1. Stock Location + Stock Identity Contract
        ↓
2. Material + Supplier Material Contract
        ↓
3. Production Item + Recipe / BoM Contract
        ↓
4. Production Batch + Posting / Mutation Contract ✅
        ↓
5. Procurement Document Contract ✅
        ↓
6. Menu Item Choice → Stock / Production Integration Contract ✅
        ↓
7. Production Routing + Stock Location Contract ✅
        ↓
8. Inventory Transfer State Machine Contract ✅
        ↓
9. Costing / HPP Contract
        ↓
10. Incremental schema + API implementation
        ↓
11. Compatibility migration
        ↓
12. Legacy quarantine / removal
```

This order resolves identity before transaction flow and transaction flow before costing.

## 30. Final Assessment

The end-to-end lifecycle is now conceptually solid, but the remaining holes are concentrated in **identity, versioning, posting boundaries, and cross-domain mappings**, not in the high-level business sequence.

The most important discovery is that the Production work must not begin with a generic "recipe table".

The correct foundation is:

```
Stock Location
  ↓
Qualified Stock Identity
  ↓
Material / Product
  ↓
Production Item
  ↓
Recipe Version
  ↓
Production Batch
  ↓
Inventory Posting
  ↓
Product Stock
  ↓
Menu Item
  ↓
Item Choice Resolution
  ↓
Sale
```

Production Item + Recipe / BoM, Production Batch + Posting, Procurement Document, dan Menu Item Choice → Stock / Production Integration identity/transaction gates are now locked. Remaining work is limited to explicit operational/policy gates such as routing priority, transfer lifecycle, role approval, lot/expiry, MTO, scheduling, HPP/valuation, and autonomous procurement.

