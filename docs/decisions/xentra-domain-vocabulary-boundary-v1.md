# 🔒 CURRENT END-TO-END LIFECYCLE BINDING — 2026-10-08

The domain boundary decision is now connected by the locked lifecycle contract:

`docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md`

Canonical business lifecycle:

```
Material
  ↓
Replenishment Requirement
  ↓
Shopping List / Purchase Request
  ↓
Purchase Order
  ↓
Verified Goods Receipt
  ↓
Material Stock
  ↓
Production / Recipe / BoM
  ↓
Production Batch / Output
  ↓
Sellable Product Stock
  ↓
Menu / Menu Items / Item Choices
  ↓
Order / Sale
  ↓
Sellable Product Stock Consumption
```

The lifecycle is a business boundary, not a mandatory synchronous call chain.

Locked invariants:
- Procurement never owns stock balance.
- Production never owns stock balance.
- Inventory owns physical stock mutation.
- Catalog owns commercial Menu semantics.
- Item Choice changes effective Menu composition but does not directly mutate Material Stock.
- Selling does not automatically replay raw-material Recipe consumption.
- Branch-direct, central, and hybrid supply use the same domain model.
- Make-to-order may be introduced later without creating alternate domains.

Detailed schema, UOM, costing/HPP, Recipe versioning, Product ↔ Production Item cardinality, planning mode, and Choice → Material mapping remain separate OPEN gates.

---

# Xentra — Domain Boundary & Canonical Vocabulary Architecture Decision v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-07  
**Repository:** `wanstudio/xentra-core`  
**Applies to:** Backend domain model, persistence semantics, API contracts, services, repositories, cross-domain references, and future refactoring.

## 1. Decision Summary

Xentra adopts **domain-owned vocabulary as an architectural invariant**.

A business concept is owned by one domain. Its canonical entity name, foreign-key meaning, service/repository ownership, API payload terminology, state/lifecycle semantics, and business rules must remain consistent with that owning domain.

Xentra must not use a generic cross-domain business entity merely because multiple domains refer to the same real-world thing.

This decision establishes the target boundaries for the current Catalog → Production → Material → Inventory → Procurement problem while preserving the existing incremental-refactoring strategy.

**This is a boundary and vocabulary decision. It is not authorization to perform a broad code or database rewrite immediately.**

## 2. Why This Decision Is Required

The current implementation is already in transition from a legacy `Product → Branch Product → Stock` model toward the canonical `Product → Menu → Inventory` model.

The current repository also contains evidence of boundary debt, including:
- catalog-oriented responsibilities still present in Commerce;
- Dining services still physically located under POS;
- Purchase Order persistence/service currently living under Inventory;
- legacy `product_id` references that represent different business meanings during migration.

The new recipe/BOM requirement exposes a further structural distinction:

- a thing being sold is not necessarily the thing being produced;
- a produced/prepared thing is not the same concept as its ingredient/material;
- a material identity is not the same concept as its stock balance;
- a purchasing document is not the same concept as an inventory balance or movement.

The architecture must therefore distinguish these concepts before additional implementation is layered on top of the existing transition.

## 3. Canonical Domain Set

### 3.1 Implemented business domains

The repository currently contains these implemented business domains:

1. **Catalog**
2. **Commerce**
3. **Dining**
4. **POS**
5. **Inventory**
6. **Payment**
7. **Delivery**
8. **Promotion**
9. **Banner / Storefront Content**
10. **Reporting**

### 3.2 New target domains adopted by this decision

This decision adds the following target business domains:

11. **Production**
12. **Material**
13. **Procurement**

These three domains are part of the target architecture even where implementation is not yet present.

### 3.3 Previously locked future domains

The architecture already contains separate future decisions for:

14. **Affiliate**
15. **Internal Client Communication & Notifications**

Those decisions remain independent and are not redefined here.

Therefore:

- **13 business domains are the active target set for current structural planning.**
- **15 business domains are the broader target set including already-locked future domains.**

Core/platform capabilities are not counted as business domains.

Application surfaces are not counted as business domains.

## 4. Core Is Not a Business Domain

The following remain platform/foundation responsibilities:

- identity;
- authentication;
- authorization/RBAC;
- tenant/organization/brand/branch scope;
- audit;
- events;
- configuration;
- media;
- data access;
- integration infrastructure.

Core provides shared authority and infrastructure. It must not absorb business rules merely because multiple domains use the same primitive.

## 5. Application Surface Is Not a Domain

These are application surfaces/workflows, not automatic business domains:

- Customer PWA;
- Merchant App;
- Owner Dashboard;
- POS App;
- Driver App;
- Kitchen App.

A surface may consume one or more domains.

A new application surface must not create a duplicate business model solely because it has a different UI or workflow.

## 6. Domain Ownership Rules

### Catalog owns

Canonical concepts:

- Product;
- Menu;
- Menu Item;
- Menu Package;
- Master catalog taxonomy;
- Branch Menu adoption/configuration;
- customer-facing Menu resolution.

**Product meaning is constrained:**

> Product = atomic reusable Catalog identity.

Product is not a generic synonym for menu, material, recipe, stock, purchase document, or production batch.

A Product may be stock-managed by Inventory when it has a SKU according to the existing Product/Menu/Inventory contract.

### Commerce owns

Canonical concepts:

- Cart;
- Checkout;
- Order;
- Order Item;
- commercial order lifecycle.

Commerce may consume Catalog, Inventory, Payment, Delivery, Promotion, Dining, and other domains through explicit contracts.

Commerce must not become the authority for those domains.

### Production owns

Canonical concepts:

- Production Item;
- Recipe;
- Recipe Component;
- Bill of Materials (BoM);
- Yield;
- Production Batch;
- Production Output;
- production consumption rules;
- production waste/output evidence where applicable.

Production answers:

> How is something prepared or produced, and what inputs/quantities/yield does that production process use?

Production does not own:
- customer-facing Menu semantics;
- raw-material identity;
- stock balances;
- purchase orders;
- payment state.

### Material owns

Canonical concepts:

- Material;
- Raw Material;
- material identity/specification needed by production/procurement.

Material answers:

> What is the material or ingredient?

Material does not own:
- current quantity on hand;
- stock movement ledger;
- purchase order lifecycle;
- production batch lifecycle.

### Inventory owns

Canonical concepts:

- Product Stock;
- Material Stock;
- Stock Balance;
- Stock Movement;
- inventory mutation/ledger authority.

Inventory answers:

> How much stock exists now, and what stock mutations have occurred?

Inventory must remain the authoritative owner of physical stock state.

Inventory must not become the owner of Production recipes or Procurement documents.

### Procurement owns

Canonical concepts:

- Supplier;
- Supplier Material / supplier-specific sourcing definition;
- Purchase Request;
- Purchase Order;
- Purchase Line;
- Goods Receipt / Receiving workflow;
- procurement document lifecycle.

Procurement answers:

> What do we intend to buy, from whom, and what was received?

Procurement must not own the authoritative stock balance.

A verified Goods Receipt may trigger an Inventory mutation through the defined cross-domain contract; Procurement must not maintain a competing stock ledger.

### Dining owns

- Table;
- Table state;
- Dining Session;
- reservation/dining-specific lifecycle and invariants.

POS consumes Dining authority; it does not own Dining state.

### POS owns

- Sale;
- Sale Item;
- Terminal;
- Shift;
- cashier workflow;
- POS offline/local execution mechanics;
- POS hardware boundary.

POS Sale is not Commerce Order.

### Payment owns

- Payment;
- Settlement;
- gateway/payment-provider lifecycle;
- cash settlement according to the payment contract.

Payment is not Order.

### Delivery owns

- Delivery;
- route/tariff/fulfillment delivery calculations;
- dispatch/driver provider boundary;
- delivery lifecycle.

Driver UI does not create a new ownership domain by itself.

### Promotion owns

- Promotion;
- eligibility;
- reward/entitlement behavior;
- promotion conflict/stacking;
- redemption lifecycle.

Promotion does not own Order, Payment, Inventory, or Affiliate ledgers.

### Banner / Storefront Content owns

- Banner Content;
- Banner Assignment / Placement;
- publication/visibility lifecycle for storefront content.

Promotion remains a separate domain.

### Reporting owns

- read models;
- analytical projections;
- reporting queries.

Reporting is never the source mutation authority for business state.

## 7. Canonical Layering for Recipe / BOM / Replenishment

Xentra adopts the following conceptual layering:

```
CATALOG
  Menu / Product
        │
        │ optional production backing
        ▼
PRODUCTION
  Production Item
  Recipe / BoM
  Production Batch
        │
        │ consumes
        ▼
MATERIAL
  Material / Raw Material
        │
        │ held as stock
        ▼
INVENTORY
  Material Stock
  Product Stock
  Stock Balance / Movement
        ▲
        │ verified receipt / replenishment input
        │
PROCUREMENT
  Supplier
  Purchase Request
  Purchase Order
  Purchase Line
  Goods Receipt
```

This diagram represents **ownership and conceptual relationships**, not a mandatory synchronous runtime call chain.

## 8. Critical Semantic Rules

### 8.1 Menu is not Production Item

A Menu is a commercial/customer-facing concept.

A Production Item is a production/preparation concept.

A Menu may have no production backing.

Example:

```
Menu: Es Teh
→ Product: Teh Manis
→ no Recipe required
```

A production-backed case may be:

```
Menu: Ayam Geprek
→ Product: Ayam Geprek / sellable Product identity
→ Production backing
→ Recipe / BoM
→ Material requirements
```

The exact Product ↔ Production Item schema is intentionally **not fully locked by this decision**. The semantic separation is locked; the concrete foreign-key design requires a dedicated implementation design after vocabulary audit.

### 8.2 Product is not Material

A Material is an ingredient/input identity.

A Product is a Catalog atomic identity.

Do not use `product_id` as a generic identifier for materials.

### 8.3 Material is not Stock

Material identity belongs to Material.

Current quantity belongs to Inventory.

Therefore:

```
Material
  ≠
Material Stock Balance
```

### 8.4 Purchase is not Stock

Procurement owns purchase documents.

Inventory owns stock mutation.

A Purchase Order does not itself increase stock.

The existing two-stage principle remains valid:

```
Purchase Order
→ Verified Goods Receipt
→ Inventory Stock Mutation
```

### 8.5 Production is not Inventory

Production records what was produced/consumed.

Inventory records the resulting physical stock mutations.

Production must not maintain a second authoritative stock ledger.

### 8.6 Menu sale is not automatic raw-material deduction

A customer sale must not directly and generically explode into raw-material deductions merely because a Recipe exists.

The production/inventory behavior must respect the actual operational model:

- ready-to-sell Product stock may be consumed by sale according to the existing Inventory contract;
- raw-material consumption belongs to Production/Inventory workflows;
- production may be batch-based, make-to-stock, make-to-order, or otherwise constrained by a later explicit business decision.

This decision does **not** choose one production strategy where the business process has not yet been defined.

## 9. Vocabulary Rules

### 9.1 Generic names are forbidden as cross-domain authority

The following terms require domain qualification when used as backend entities/relations:

- Product;
- Item;
- Stock;
- Purchase;
- Order;
- Sale;
- Payment;
- Batch.

Do not introduce a generic table/entity simply because multiple domains need “an item”.

### 9.2 Foreign keys must state the business meaning

Preferred:

```
menu_item.product_id
recipe_component.material_id
purchase_line.supplier_material_id
material_stock.material_id
product_stock.product_id
order_item.menu_id
sale_item.menu_id
```

Avoid using one generic `product_id` field where the referenced concept could mean Product, Material, Production Item, or another business object.

### 9.3 API terminology follows domain ownership

The same concept must not receive different backend names merely because it is consumed by different UI surfaces.

UI labels may be localized or simplified.

Backend entities and contracts must remain canonical.

## 10. Cross-Domain Dependency Rules

A domain may depend on another domain's **published contract**, but must not reach into another domain's storage semantics as if it owned them.

Preferred:

```
Procurement
  → verified Goods Receipt
  → Inventory mutation contract

Production
  → production consumption/output intent
  → Inventory mutation contract

Commerce
  → Menu resolution
  → Inventory availability/consumption contract
```

Avoid:

```
Procurement → directly edits Inventory tables
Production → directly edits Inventory tables
Commerce → reconstructs raw Material state from SQL joins
POS → maintains its own stock authority
```

The implementation may temporarily use compatibility adapters/repositories during migration. Such seams must be explicit and temporary.

## 11. Current Boundary Debt Identified by Audit

The following are confirmed migration targets, not permission for an immediate rewrite:

### Commerce → Catalog

Current source still contains catalog-oriented responsibilities such as a Commerce-side `CatalogService`.

Target ownership is Catalog.

### POS → Dining

Current source still contains Dining services under `domains/pos/`.

The locked Dining contract already identifies this as migration work.

### Inventory → Procurement

Current source contains:

```
domains/inventory/services/PurchaseOrderService.js
inventory_purchase_orders
inventory_po_items
```

The purchase lifecycle is now designated Procurement-owned.

These observations are evidence for refactoring, not evidence that existing production/runtime behavior should be changed immediately.

## 12. What This Decision Does NOT Lock

The following remain intentionally open until their own audit/design:

- exact database table names for Production;
- exact database table names for Material;
- exact Product ↔ Production Item cardinality;
- exact Recipe/BoM versioning model;
- batch scheduling/planning;
- make-to-stock vs make-to-order policy;
- waste accounting semantics beyond future explicit contracts;
- demand forecasting algorithm;
- reorder quantity algorithm;
- supplier pricing/pack-size normalization details;
- automatic shopping-list generation algorithm;
- exact Goods Receipt entity decomposition;
- whether all Production Items are inventory-stocked;
- whether all Materials are branch-scoped or centrally mastered.

No implementation may infer these as locked from this document.

## 13. Refactoring Strategy

Refactoring must follow the existing Xentra incremental migration baseline.

Sequence:

```
1. Vocabulary audit
      ↓
2. Domain ownership matrix
      ↓
3. Consumer / FK / API impact map
      ↓
4. Target data model design
      ↓
5. Compatibility seams
      ↓
6. Incremental implementation
      ↓
7. Migration + data verification
      ↓
8. Consumer migration
      ↓
9. Legacy quarantine
      ↓
10. Legacy removal only after proof
```

No big-bang rename of `product_id`, no blind table split, and no mass move of services is authorized by this decision.

## 14. Required Vocabulary Audit

Before implementing the Production/Material/Procurement layers, audit each existing business domain for:

- owned entities;
- referenced entities;
- ambiguous terms;
- generic `Item` usage;
- generic `Product` usage;
- `product_id` foreign keys;
- `stock` fields;
- purchase-related terms;
- API payload names;
- repository method names;
- service names;
- business-rule ownership;
- legacy compatibility fields;
- cross-domain SQL access.

The resulting map becomes the implementation basis for refactoring.

## 15. Change Control

Any change to the business ownership defined here requires a new Architecture Decision documenting:

- why the boundary is no longer correct;
- affected domains;
- affected entities/FKs/APIs;
- compatibility/migration strategy;
- data migration impact;
- test impact;
- production-risk impact.

This decision does not supersede unrelated domain contracts unless they conflict specifically on the ownership/vocabulary rules defined here. In a conflict, the contradiction must be explicitly reconciled before implementation.

## 16. CTO Guardrail

**Do not optimize for architectural symmetry. Optimize for semantic correctness.**

The fact that two concepts look similar, share fields, or are both called “items” is not sufficient reason to merge them.

Conversely, separate domains are justified only when they represent distinct business responsibility, lifecycle, authority, or invariants.

This decision intentionally establishes boundaries first and postpones schema mechanics until evidence from the vocabulary/consumer audit is available.

**LOCKED — Architecture Decision v1.**


## 🔒 LOCKED ADDENDUM — Multi-Branch Production / Supply Topology v1 — 2026-10-07

The previously locked future domains are now explicitly included in active Xentra development:
- Affiliate
- Internal Client Communication & Notifications

Their existing domain contracts remain authoritative.

A structured multi-branch simulation establishes the following architecture constraint:

**Xentra must support branch-direct procurement, central procurement/distribution, and hybrid sourcing without creating separate domain models for each topology.**

The topology is operating policy/configuration. The underlying domain capabilities remain shared.

The simulation also exposes a target Inventory requirement:

**Branch is organizational/operational scope; Stock Location is physical inventory custody/location.**

The target Inventory model therefore needs a Stock Location abstraction capable of representing, as business requires:
- Branch stock locations;
- central warehouse;
- central kitchen;
- other authorized inventory locations.

This is a semantic architecture requirement, not a final table/schema decision.

The existing one shared sellable-stock-pool-per-Branch rule remains valid for the current POS/PWA/channel model. Additional physical locations must not become channel-specific stock pools.

Cross-domain implications:
- Material identity is reusable and is not tied to one Branch.
- Inventory owns Product/Material stock balances, stock movements, and inter-location transfers.
- Production has a production location/context and uses explicit Inventory mutation contracts.
- Procurement purchase documents have an explicit receiving/destination location and do not own stock balances.
- Catalog/Menu adoption does not imply that a Branch directly purchases the Menu's materials.

Replenishment default boundary:
**Demand/Stock Condition → Replenishment Requirement → Purchase Request/Shopping List → Procurement Decision → Purchase Order → Goods Receipt → Inventory Mutation.**

A low-stock signal is not automatically a Purchase Order. Autonomous purchasing requires a separate explicit business policy.

The following remain open and require dedicated business decisions before schema implementation:
- Organization vs Brand vs Branch stock ownership;
- stock-location types and hierarchy;
- central warehouse operating model;
- sourcing priority;
- Branch procurement autonomy;
- transfer approval;
- receiving authority;
- Material master scope;
- production planning mode;
- reorder algorithm;
- autonomous purchasing policy.

**No production/procurement implementation may assume central, Branch-direct, or hybrid operation as universal truth before these decisions are resolved.**

**LOCKED — Architecture implication and simulation result.**
