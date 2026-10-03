# Xentra — Taxonomy, Product & Composed Menu Contract v1

**Status:** LOCKED TARGET CONTRACT — IMPLEMENTATION ISOLATED ON PROPOSAL BRANCH
**Audit / reconciliation date:** 2026-10-03
**Branch:** `proposal/xentra-taxonomy-composed-menu-v1`
**Production status:** `main` is unchanged. All construction work remains isolated on `proposal/xentra-taxonomy-composed-menu-v1`.

> This document is the locked target contract for the new Product → Menu → Inventory direction. Older proposal wording that conflicts with this document is superseded. Existing production contracts remain authoritative until final promotion to `main`.

## 1. Executive contract

Xentra uses three deliberately separated concepts:

```text
PRODUCT
= atomic catalog / stock unit

MENU SATUAN
= customer-facing commercial menu backed by exactly 1 Product

MENU PAKET
= customer-facing commercial menu sold as one unit and composed of 2+ Product units
```

The separation is intentional:

- Product owns the stable atomic entity and SKU/stockability.
- Menu owns customer-facing taxonomy, presentation and selling price.
- Inventory owns Branch stock quantity and stock movements.
- A Product may be reused by many Menus without creating another Product or SKU.
- A Menu Paket does not become a stock Product and has no parent stock balance in the current model.

## 2. Authoritative ownership boundaries

### Product

Product is the reusable atomic catalog/stock entity.

Target attributes:

```text
Product ID          immutable technical identity
Brand ID            tenant/brand scope
name                human-readable atomic/internal label
sku                 optional; presence means stock-managed
Description         product/item description
Media               product/item media
Lifecycle Status    draft / active / archived as supported by Product domain
```

The physical column may remain named `name`; its **forward semantic meaning is internal Product name**, not Customer Menu title. The target model adds a real Product SKU field because the current production schema does not yet carry `products.sku`.

Product does **not** own the customer-facing Menu taxonomy.

Product does **not** own the canonical selling price.

Product does not become a different entity merely because it is used in several Menus.

### Menu

Menu is the commercial/customer-facing selling entity.

Target attributes:

```text
Menu ID             immutable technical identity
Brand ID            tenant/brand scope
Menu Type           SINGLE | PACKAGE
Category            Menu taxonomy context
Sub Category        Menu title source / taxonomy
Rasa                Menu presentation / identity input
Level               optional Menu presentation
Selling Price       canonical selling price
Customer Presentation
Status / lifecycle
Composition         Menu → Product references
```

### Inventory

Inventory owns physical Branch stock and the immutable movement ledger.

```text
SKU on Product
    ↓
Product is stock-managed
    ↓
Branch Inventory holds Product stock quantity
    ↓
Sales consume Product stock through Inventory
```

Creating a Product, assigning a SKU, or adopting a Menu never fabricates a stock quantity.

## 3. Product identity and Product reuse

Product identity is the stable Product ID plus its Product-domain attributes. Category, Sub Category, Rasa, Level, customer title and selling price are not Product identity in the new model.

The same Product may back multiple Menus:

```text
Product Nasi [SKU NASI-001]
├─ Menu Satuan: Nasi Putih
├─ Menu Satuan: Nasi Dingin
├─ Menu Paket: Ayam + Nasi
└─ Menu Paket: Ikan + Nasi
```

All of those references resolve to the same Product ID and, when stock-managed, the same Branch stock pool.

This is not duplication.

Product internal names are not required to be globally unique. Product ID is the technical identity. SKU, when present, is unique within the Brand.

## 4. Menu taxonomy

### Category → Sub Category

Category is the parent taxonomy node.

Sub Category belongs to exactly one Category and is Brand-scoped.

Business rules:

- Category name is unique within a Brand after normalization.
- Sub Category name is unique within a Brand after normalization.
- Sub Category uniqueness applies even when two Sub Categories would otherwise have different parent Categories.
- Parent Category is still used to scope selectors and establishes the actual parent-child relationship.
- The same Sub Category name cannot be used under another Category as a workaround.

Therefore:

```text
Ayam → Goreng       ✅
Ikan → Goreng       ❌
```

The second is blocked because `Goreng` is already a Brand-unique Sub Category.

### Rasa

Rasa is reusable Brand Master data.

- Rasa is not a child taxonomy node.
- A Rasa record can be reused by many Menus and many Sub Categories.
- Duplicate normalized Rasa names within one Brand are rejected.
- `Original` is the universal baseline for Menu Satuan.
- `Original` is hidden in the Customer subtitle.
- Non-Original Rasa may be shown as the Customer subtitle.
- No manually maintained Sub Category ↔ Rasa compatibility matrix is required in the current model.
- Contextual availability may be derived from actual Menu usage.

Rasa quick-add must reuse an existing normalized Master Rasa rather than create another record with the same name.

## 5. Menu identity and duplicate prevention

### Menu Satuan identity

For the current food-menu model, **Menu Satuan** has canonical identity:

```text
Sub Category + Rasa
```

Category is not an additional duplicate-bypass dimension. Because Sub Category names are already Brand-unique, a different Category parent cannot produce a second identity.

Examples:

```text
Ayam Bakar + Original
Ayam Bakar + Lombok Ijo
Ayam Goreng + Original
```

are different Menus.

But:

```text
Ayam Bakar + Lombok Ijo
Ayam Bakar + Lombok Ijo
```

is a duplicate and is not allowed.

The blocking UI is exactly:

```text
Menu sudah ada

Menu dengan Sub Kategori dan Rasa tersebut sudah tersedia.

[ Tutup ]
```

The conflict has no Merge, Overwrite, or direct Edit CTA.

### Menu Paket identity

Menu Paket is intentionally **not** forced into the Menu Satuan identity tuple.

A package has its own commercial identity:

```text
Menu ID
+ explicit customer-facing package name/presentation
+ fixed Product composition
+ package price
```

Category, Sub Category and Rasa on a Menu Paket are taxonomy/presentation context, not a rule that collides it with a Menu Satuan.

This is necessary because a package is a separately created commercial offering and may legitimately have a presentation that does not correspond one-to-one with a Satuan Menu identity.

Package names are not used as a substitute for the immutable Menu ID.

## 6. Menu Satuan

A Menu Satuan is a sellable Menu that references exactly one Product.

Canonical invariant:

```text
menu_type = SINGLE
→ exactly 1 menu_items row
→ quantity = 1
→ referenced object must be an atomic Product
```

Example:

```text
Menu Satuan
Nasi Putih
→ Product Nasi [NASI-001]
→ Harga Jual = Rp8.000
```

The same Product can be reused by another Menu Satuan with different customer presentation and price.

A non-SKU Product may technically be sold as a non-stock Menu Satuan. Such a sale creates no inventory movement for that Product.

## 7. Menu Paket

A Menu Paket is an explicitly created fixed composite commercial menu.

It is:

- a Menu subtype, not a Product subtype;
- customer-facing;
- sold as one whole order line;
- priced explicitly by the Owner;
- composed from atomic Products only;
- non-stock at the parent level in the current Xentra model;
- constrained by the stock of its stock-managed components.

### Package composition

The canonical relation is:

```sql
menus
  id
  brand_id
  menu_type
  ...

menu_items
  menu_id
  product_id
  quantity
  sort_order
```

Rules:

- Every component line points to an atomic Product.
- A Product may appear only once in one Menu composition.
- If more than one unit is needed, store one row with `quantity > 1`.
- Component `quantity` is a fixed positive integer.
- Customer/cart quantity changes complete Package units, never component quantities.
- A Menu Paket must contain at least 2 Product units in total.
- A single Product ×1 is Menu Satuan, not Menu Paket.
- A Product ×2 is a valid Menu Paket composition because it represents two Product units.
- Menu Paket may not contain a Menu, another Package, or another selling Menu.

Example:

```text
Paket Keluarga
├─ Ayam     ×2
├─ Nasi     ×2
├─ Sambal   ×2
└─ Es Teh   ×3

Customer Qty = 2

Inventory consumption:
Ayam     -4
Nasi     -4
Sambal   -4
Es Teh   -6
```

The customer never edits the component quantities from Cart.

### Package does not infer from cart or promotion

Only explicit Owner creation produces a Menu Paket.

```text
Product A + Product B + Product C
+ Promotion
→ remains the original Menu lines
→ NOT a Menu Paket
```

No cart-combination heuristic, price arithmetic, or promotion rule is allowed to create a Package implicitly.

## 8. Package stock and availability

A Package has no independent stock balance in the current model.

For each stock-managed component:

```text
component_capacity
= floor(branch_stock / component_quantity)
```

Then:

```text
available_package_qty
= MIN(all stock-managed component capacities)
```

Non-SKU components do not constrain availability through inventory because they are non-stock.

Availability therefore has two independent gates:

```text
Branch Menu adoption / operational availability
AND
resolved Product stock availability where SKU-managed
```

A Package with an invalid component is not silently sold without that component.

If a required component Product is archived, deleted, or otherwise invalid:

```text
Paket remains persisted
→ saleable = false
→ blocking_reason = COMPONENT_UNAVAILABLE
→ Owner repairs composition
→ Core re-validates
```

Temporary out-of-stock is distinct from component invalidity.

Draft or non-standalone-visible Products may be used inside a Draft Package. Adding a Product to a Package does not publish that Product as a standalone customer menu.

## 9. Product Options and add-ons

Product Options is a separate domain.

Rules:

- Product Options is not part of Product identity.
- Product Options is not the Package composition mechanism.
- A separately sellable item is represented as a Product and, when sold, as a Menu.
- Existing POS/Product Options capability remains a separate compatibility domain.
- Detailed option pricing, inventory interaction, UI and order representation are outside this taxonomy lock.

Example:

```text
Ayam Bakar + Sambal Matah
```

If Sambal Matah is independently sold, it is a separate Product/Menu line. It is not an Add-on merely because it appears next to Ayam Bakar.

## 10. Level / Pedas

Level is a generic domain concept.

Food context uses the label **Pedas**.

Current target:

```text
☐ Aktifkan Level Pedas

checked
→ Level defaults to 1
→ four selectable positions are shown

unchecked
→ Level = NULL
→ no Pedas label
→ no Pedas indicator
```

Level is informational in the current customer flow. Customers do not submit a separate spice-level request through this field.

The current four-position UI is a food-context vocabulary and does not constrain future Level domains.

**Ownership correction:** Level belongs to the **Menu**, not the Product.

## 11. Selling price

Canonical selling price belongs to Menu.

```text
Product Nasi [NASI-001]

Menu Satuan: Nasi Putih   → Rp8.000
Menu Satuan: Nasi Dingin → Rp7.000
Menu Paket: Ayam + Nasi  → Rp35.000
```

The same Product can therefore be sold at different prices without duplicating Product or SKU.

Package price is explicit. It is not recomputed by summing current Product prices.

A future Branch price override belongs to the Branch's adopted Menu configuration, not to Product stock identity.

Historical orders store the effective selling price at transaction time.

## 12. Customer Menu View Model

Customer PWA must consume one resolved Menu View Model.

Conceptual result:

```text
Menu ID
Menu Type
Title
Subtitle / Rasa
Level presentation
Media
Selling Price
Availability
Category
Sub Category
Product references
Package component quantities when applicable
```

Resolution rules:

### Menu Satuan

```text
title
→ Sub Category.name

subtitle
→ Rasa.name when Rasa != Original

price
→ Menu selling price / effective Branch Menu price

inventory
→ referenced Product SKU, when Product is stock-managed
```

### Menu Paket

```text
title
→ explicit package presentation/name

subtitle
→ configured Rasa presentation when used

price
→ Menu Paket selling price

inventory
→ resolved component Product SKUs × component quantities
```

Customer code must not reconstruct Menu semantics by joining arbitrary raw legacy Product fields.

Live search operates on this same resolved Menu View Model.

Search behavior:

- title is searchable;
- Rasa/subtitle is searchable;
- Level/Pedas is not searchable in the current concept;
- results update while typing;
- no separate Cari submit button.

## 13. Branch adoption

The new customer-facing adoption boundary is **Menu**.

Conceptually:

```text
Master Product
   ↓
Master Menu
   ↓
Branch adopts Menu
   ↓
Menu resolves Product(s)
   ↓
Branch Inventory manages Product SKU stock
```

Branch does not create or edit Master Product or Master Menu.

### Target Branch Menu state

A future physical branch adoption layer should carry, at minimum:

```text
branch_menus
  branch_id
  menu_id
  is_available
  price_override NULL
  created_at
  updated_at
```

Branch Category membership should attach to adopted Menus, not to atomic Product identity:

```text
branch_menu_categories
  branch_id
  menu_id
  branch_category_id
```

The existing Branch Category M:N concept remains valid and branch-local.

A Product may have stock at a Branch even when no Menu Satuan exposes it directly, because the Product may be required by one or more Menu Pakets.

## 14. Branch name override

The new contract cancels the Branch Product Name Override as an active forward behavior.

Therefore:

```text
branch_products.name_override
```

must not be read by the forward Menu resolver.

Existing values are migration/history input only.

The forward customer title comes from the resolved Menu contract, not a Branch Product name override.

## 15. Inventory and SKU lifecycle

Business rule:

```text
SKU exists → Product is stock-managed
SKU is NULL → Product is non-stock
```

SKU can be system-generated or manually entered. The meaning is the same.

Important technical distinction:

- Product ID is the immutable internal inventory identity.
- SKU is the stock-management identifier/attribute.
- Inventory quantity is owned by Inventory.
- SKU assignment does not fabricate quantity.

### SKU changes

Changing a SKU keeps the same Product ID and Branch stock identity.

The change must be auditable.

Historical inventory movements and transaction snapshots must retain enough evidence to identify the SKU value that applied at that time.

Removing a SKU converts the Product to non-stock and is blocked while any active Branch still has positive stock for that Product.

Old SKU values must not be silently reused when that would make historical references ambiguous.

## 16. Inventory sale resolution

Every sale must first construct a complete Stock Consumption Plan.

```text
Customer/POS sells Menu
        ↓
resolve Menu
        ├─ SINGLE
        │    └─ Product SKU, when stock-managed
        │
        └─ PACKAGE
             └─ component Product SKUs × component quantities
        ↓
validate all required Branch stock atomically
        ↓
apply all stock deductions atomically
        ↓
append inventory movements
        ↓
commit
```

No partial component deduction is allowed.

For current ready-to-sell Product Stock, the existing authoritative production boundary remains:

```text
CHECK
→ ORDER PENDING
→ MERCHANT ACCEPT / CONFIRMED
→ SELLABLE PRODUCT STOCK DECREASES
```

Raw-material/procurement inventory remains a separate domain.

## 17. Orders, payment, receipt and KDS boundary

New sales must become Menu-based commercially, while Product IDs/SKUs remain inventory references.

Target order line semantics:

```text
order_item
  menu_id
  menu_type
  quantity
  unit_price
  immutable menu_snapshot
  immutable component_snapshot
  modifiers_snapshot
```

The transition keeps the legacy `product_id/product_name` columns for compatibility. The proposal implementation adds `order_items.menu_id`, `order_items.menu_type`, and `order_items.component_snapshot` additively; the stored component snapshot is the inventory-consumption evidence for canonical Menu sales.


The existing `product_id` field may remain during migration for compatibility, but it must not remain the authority for Package commercial identity.

Historical order display must use immutable transaction snapshots, not live Product/Menu values.

This keeps the following stable after Menu edits:

- Customer order history;
- Merchant order center;
- receipt text;
- payment line-item description;
- KDS display where used;
- inventory reversal;
- reporting snapshots.

Payment remains the payment domain. KDS remains the operational kitchen domain. Neither gets a second menu/order state machine.

## 18. Historical data and reporting

History is based on the Menu/Product state used at transaction time.

At sale/order commitment, store:

```text
Menu presentation snapshot
Menu ID
Menu type
effective selling price
Rasa / Level presentation used
Product component references
SKU values relevant to stock consumption
component quantities
inventory consumption plan
```

Later changes do not rewrite historical transaction presentation.

Reporting should support two perspectives:

```text
Historical identity view
→ what the customer actually bought at that time

Stable Product ID view
→ lifetime inventory/operational history of the atomic Product
```

A separate Product identity-version table is **not required** merely to preserve order history; immutable order snapshots already solve that requirement. Such a table may still be added later for detailed catalog-audit requirements.

Package revenue belongs to the Package Menu line. Revenue is not automatically allocated to components.

## 19. Taxonomy lifecycle

Taxonomy uses archive-first behavior.

- Populated Category is not hard-deleted.
- Populated Sub Category is not permanently deleted.
- Archive is the normal lifecycle action.
- Archive does not silently migrate Products or Menus.
- Product/Menu migration is explicit.
- Restoration must never silently fabricate or rebind unrelated Products/Menus.

Exact restoration UI is an implementation detail and is not a blocker for the Product/Menu contract.

## 20. Migration from current production model

The current production schema is legacy relative to this proposal.

Observed legacy dependencies include:

```text
products.name
products.category_id
products.price / regular_price
product_flavors
product_complements
product_levels
branch_products
branch_products.name_override
branch_products.price
order_items.product_id
order_items.product_name
menu_snapshot
products.menu_schema_version
product_menu_migrations
```

The migration must be additive and explicitly verified.

### Recommended migration sequence

```text
1. Lock this Product/Menu contract
2. Expand schema
3. Introduce Menu + menu_items
4. Introduce Branch Menu adoption
5. Implement canonical Menu resolver
6. Update Owner Product Editor
7. Update Owner Menu Editor
8. Build deterministic legacy migration planner
9. Migrate legacy Products into atomic Product + Menu Satuan records
10. Repair unresolved legacy cases with Owner review
11. Migrate Branch adoption into Branch Menu adoption
12. Update Order/POS/Payment/Receipt/KDS consumers
13. Update search/reporting/promotions
14. Run full test suite
15. Verify production data
16. Quarantine old title/composition paths
17. Retire legacy columns only after consumer audit passes
```

### Deterministic legacy Product migration

For a legacy Product:

```text
Existing Product ID
→ preserve as atomic Product ID

Existing products.name
→ preserve as internal Product name initially

Existing products.description/media
→ remain Product metadata

Existing SKU, when available
→ preserve as Product SKU / stock-managed state

Legacy Product stock without an existing SKU
→ automatically assign a deterministic generated SKU before or as part of inventory migration
→ preserve the Product as stock-managed

Legacy Product with no stock evidence and no business reason to track inventory
→ may remain SKU NULL / non-stock

Existing price
→ becomes the initial Menu Satuan price
```

To preserve customer-visible identity:

```text
Legacy Product name
→ create/reuse a Sub Category under the legacy Category
→ reuse existing Flavor/Rasa when deterministic
→ otherwise use Original when no legacy Rasa is present
→ create Menu Satuan
→ Menu Satuan references the preserved Product ID
→ Menu Satuan receives the migrated selling price
```

The migration must never guess ambiguous semantics.

Because the current production schema does not contain `products.sku`, the migration must first classify legacy Products by actual inventory evidence. A Product with positive Branch stock or historical stock movements cannot simply become SKU NULL under the new rule; it must receive a deterministic generated SKU or an explicit Owner decision before the new Inventory contract is activated.

Examples of data that require review instead of silent conversion:

- duplicate customer identities;
- ambiguous free-text Flavor/Rasa matches;
- legacy composition whose business meaning cannot be proven to be a Menu Paket;
- legacy Product data with no valid taxonomy mapping.

Legacy `product_complements` / Kelengkapan must **not** automatically become a Menu Paket merely because component rows exist. A Menu Paket is an explicit commercial construct in the new model. Where old data plausibly represents a package, the migration planner should preserve the evidence and mark it for Owner review rather than silently creating a new commercial Menu.

### Branch migration

Legacy Branch Product adoption must be reconciled into Branch Menu adoption.

For an existing adopted legacy Product:

```text
legacy Branch Product adoption
→ locate migrated Menu Satuan
→ create Branch Menu adoption
```

Legacy Branch price:

```text
branch_products.price
→ migrate to Branch Menu price_override
```

Legacy Branch name override:

```text
branch_products.name_override
→ history / migration evidence only
→ NOT an active forward Menu override
```

Physical Product stock remains Product/Inventory-scoped.

## 21. Physical target schema

The minimum target relationship is:

```sql
products
  id
  brand_id
  name              -- internal Product name
  sku NULL
  description
  media ...
  lifecycle ...

menus
  id
  brand_id
  menu_type
  sub_category_id
  rasa_id NULL
  level_id NULL
  package_name NULL
  selling_price
  status
  created_at
  updated_at

Note: Menu does not need a second stored `category_id` when `sub_category_id` already determines its parent Category. Category is resolved through `sub_categories.category_id`. This avoids two base columns becoming inconsistent.

menu_items
  menu_id
  product_id
  quantity
  sort_order

branch_menus
  branch_id
  menu_id
  is_available
  price_override NULL
  created_at
  updated_at

branch_menu_categories
  branch_id
  menu_id
  branch_category_id

branch_product_inventory
  branch_id
  product_id
  stock_qty
  low_stock_threshold
  created_at
  updated_at

inventory_movements
  branch_id
  product_id
  quantity
  previous_stock
  current_stock
  movement_type
  reference_id
  created_at
```

Target integrity:

```text
Menu Satuan
→ exactly one menu_items row
→ quantity = 1
→ rasa_id resolves to a valid Brand Rasa

Menu Paket
→ total component units >= 2
→ each Product appears once
→ quantity is positive integer
→ package_name is required

Menu
→ Sub Category belongs to same Brand
→ Sub Category determines Category
→ Product references belong to same Brand
→ Menu Satuan duplicate identity rejected on (Sub Category, Rasa)
```

The exact physical columns for media, lifecycle timestamps and compatibility fields may be reconciled with the existing schema without changing these ownership rules.

**Important:** Branch Menu adoption and Product inventory are separate authorities. A Product may have Branch stock without a standalone Menu Satuan adoption because it may be used only as a component of one or more Menu Pakets. A missing Branch inventory row for a SKU-managed Product represents zero available stock; it must not be interpreted as unknown stock.

## 22. What is already resolved by this audit

The following no longer need another business-question loop:

- Product vs Menu separation.
- Menu Satuan vs Menu Paket.
- Product reuse across Menus.
- Menu Satuan duplicate identity = Sub Category + Rasa.
- Duplicate across different parent Category is still blocked because Sub Category is Brand-unique.
- Duplicate warning CTA = `Tutup`.
- Rasa is reusable Master data.
- No manual Rasa compatibility matrix in the current model.
- Level belongs to Menu.
- Level is optional and NULL when unset.
- Menu price owns selling price.
- SKU presence determines Product stockability.
- Inventory owns stock quantity.
- Package component quantity is fixed and quantity-bearing.
- Same Product is represented once per Menu composition.
- Package can contain repeated units of the same Product via quantity.
- Package does not nest another Menu/Package.
- Package inventory is component-driven.
- Package revenue belongs to the Package line.
- Package is not inferred from cart combinations or Promotion.
- Branch customer-facing adoption boundary is Menu.
- Branch Product Name Override is cancelled for the new model.
- Historical orders use immutable Menu/Product/SKU snapshots.
- Legacy data is migration input, not the forward source of truth.

## 23. Remaining implementation details — not business blockers

These are engineering decisions that can be solved during implementation/reconciliation and do not require another conceptual discovery loop:

- exact SQLite/Postgres-style normalized-key implementation for Brand-scoped uniqueness;
- exact Product SKU generation format/prefix remains an engineering convention, provided generated SKUs are deterministic/unique within Brand and auditable;
- exact physical migration mechanics for existing SQLite tables;
- exact inventory SKU-history table versus snapshot representation;
- exact media binding for Menu Paket;
- final endpoint naming/versioning;
- exact Branch Menu repository and API shape;
- legacy Product Options adapter shape;
- exact Category/Sub Category restoration UI;
- test fixtures and migration tooling;
- retirement timing of compatibility columns.

The technical design must still be implemented and tested before production promotion.

## 24. Reference cross-check

This proposal was cross-checked against current official documentation from mature systems:

- Odoo documents Bill of Materials with component Products and per-component quantities. This supports a quantity-bearing composition model. https://www.odoo.com/documentation/19.0/id/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html
- WooCommerce Product Bundles supports grouping existing Products, multiple instances of the same Product, per-component quantities, fixed/base bundle pricing, and bundle availability derived from component stock. https://woocommerce.com/document/bundles/ and https://woocommerce.com/document/bundles/bundles-configuration/
- Shopify separates merchandising fields on ProductVariant, including price and SKU, from inventory tracking through InventoryItem/inventory levels. https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariant and https://shopify.dev/docs/api/admin-graphql/latest/objects/inventoryitem

These references validate the architectural patterns only. They do not override Xentra business rules.

## 25. Contract conclusion

The business/domain model is the **locked target contract** for the proposal branch. Implementation still requires reconciliation, runtime testing, consumer migration, and final production verification.

The previous blockers caused by mixed Product/Package/Kelengkapan semantics have been resolved in the proposal:

```text
PRODUCT
  ↓
MENU SATUAN / MENU PAKET
  ↓
BRANCH MENU ADOPTION
  ↓
PRODUCT SKU / INVENTORY
```

The major remaining work is implementation reconciliation against the existing production codebase, especially migration of the current Product schema that has no SKU column and currently stores selling price/category directly on Product. This is implementation reconciliation, not another round of basic concept discovery.

**Production/main must remain unchanged until the final Xentra contract is explicitly promoted.**


## 26. Current implementation status — 2026-10-03

The Product → Menu → Inventory business contract above, including the Promotion Reward Target Contract, is locked. Construction remains isolated on `proposal/xentra-taxonomy-composed-menu-v1`; `main` is unchanged.

Implemented in the proposal branch:

- Product/SKU, Menu Satuan, Menu Paket, Branch Menu and Branch Product Inventory schema foundation;
- Product SKU history plus guarded SKU removal;
- deterministic legacy Product → Menu Satuan migration planner/apply/verify operator;
- canonical Menu customer/master and Branch resolver, including Package stock-capacity math and invalid-component blocking;
- canonical checkout verification, Menu snapshots, and shared-Product stock aggregation;
- canonical inventory repository routing for SKU-managed Products;
- canonical Reporting stock summaries from `branch_product_inventory` and Menu-aware sales/item grouping with legacy order-history fallback;
- canonical POS and Checkout catalog consumers with no silent Product-catalog fallback;
- canonical Merchant Order item presentation from immutable Menu snapshots;
- Promotion rewards now use `target_menu_id` as the canonical commercial target, while `target_product_id` remains legacy compatibility/fulfillment evidence during migration;
- canonical Promotion Reward Resolver resolves Menu → immutable Menu snapshot + component snapshot → Product/SKU inventory;
- legacy promotion reward migration planner auto-maps only an unambiguous active Menu Satuan and marks ambiguous/missing mappings `NEEDS_REVIEW`;
- Branch Menu availability mutation with Branch Manager scope;
- canonical Customer PWA catalog consumption without silent legacy catalog fallback;
- canonical Menu endpoint compatibility envelope for older consumers;
- Admin API surface for Product/Menu/Sub Category/Rasa/SKU/adoption operations;
- contract tests covering canonical inventory and composed Menu/migration behavior.

Still pending before promotion to `main`:

- Owner UI replacement/integration;
- Branch/Merchant adoption UI integration;
- final Customer PWA UI integration and all remaining consumer cleanup;
- Payment, Receipt, KDS, Reporting and remaining POS consumer migration;
- remaining Promotion UI/client cleanup and legacy reward migration execution;
- complete legacy quarantine and retirement of compatibility paths;
- production database migration execution and verification;
- full runtime test-suite execution and production audit.

Verification state:

- Source-level audit has been performed on the modified implementation paths.
- No independent parser/runtime execution was performed in this audit environment.
- GitHub Actions has not produced a workflow run for the current proposal HEAD.
- Therefore the branch is **not** test-verified or merge-ready solely from this audit.

**Do not merge PR #7 to `main` yet.**

## 27. Promotion Reward Target Contract — LOCKED

Promotion rewards follow the same commercial-vs-inventory separation as normal sales.

### Canonical target

```text
Promotion
  ↓
Promotion Reward
  ↓
target_menu_id
  ↓
Menu
  ↓
immutable menu_snapshot + component_snapshot
  ↓
Product / SKU inventory
```

Therefore:

```text
promotion_rewards.target_menu_id
= CANONICAL reward identity

promotion_rewards.target_product_id
= LEGACY compatibility / fulfillment reference
```

The implementation must **not** destructively replace `target_product_id` with `target_menu_id`.

The two fields have different roles. A canonical reward is selected and displayed as a Menu because Menu is the customer-facing commercial identity. Inventory deduction still resolves through the Menu's Product components.

### Why Product-only reward identity is no longer sufficient

Product reuse is explicitly allowed by this contract:

```text
Product P1
├─ Menu Satuan A
├─ Menu Satuan B
└─ Menu Paket C
```

A promotion that stores only `P1` cannot prove which commercial Menu the customer is meant to receive.

Therefore the forward reward contract must not infer:

```text
target_product_id → "some Menu using that Product"
```

That inference is non-deterministic once Product reuse exists.

### Reward configuration invariant

For `freebie_product` rewards:

```text
New / canonical reward
→ target_menu_id required

Legacy reward
→ target_product_id may remain temporarily

Canonical reward
→ must not depend on target_product_id as its commercial identity
```

The Admin Promotion API validates canonical Menu ownership by Brand. A reward with both `target_menu_id` and `target_product_id` is rejected as ambiguous configuration. Migration tooling reports the legacy Product target as evidence, but a successfully migrated canonical row clears `target_product_id`.

### Redemption resolution

The final server-side reward resolution is:

```text
1. authenticate promotion eligibility;
2. resolve target Menu by Brand;
3. verify Menu is ACTIVE;
4. verify all Menu components are valid/active;
5. verify Branch has adopted the Menu and the Menu is operationally available;
6. resolve Menu component snapshot;
7. verify current Product/SKU inventory for the fulfillment Branch;
8. produce one reward order line with:
   - menu_id
   - menu_type
   - immutable menu_snapshot
   - immutable component_snapshot
   - promotion_id
   - is_promo_reward
9. let the existing canonical OrderPlacement/Inventory path consume Product/SKU stock atomically.
```

The client may carry `menu_id` for cart identity, but the server remains authoritative and rejects a reward Menu that differs from the promotion definition.

### Package reward

A Promotion may target a Menu Paket.

The order line still represents one commercial Menu Paket. `product_id` is **not** the commercial identity for the package. Because the existing `order_items.product_id` column remains `NOT NULL` for compatibility, Xentra stores the first component Product as a compatibility pointer only. It must never be used as the package identity or as the package stock quantity authority.

Inventory is deducted from the package component snapshot exactly like any other canonical Menu sale.

### Legacy reward migration

A legacy `target_product_id` is eligible for automatic migration only when there is exactly one ACTIVE Menu Satuan whose only composition is that Product.

```text
exactly one active Menu Satuan
→ SAFE_TO_MIGRATE
→ populate target_menu_id

zero matches
→ NEEDS_REVIEW

multiple matches
→ NEEDS_REVIEW
→ never guess
```

A package-only match is not sufficient evidence for automatic migration because the historical Product-only reward did not identify a commercial Package Menu.

The migration utility is intentionally a planner/apply operation so production data can be reviewed before changing reward identity.

### Compatibility boundary

Legacy consumers may continue reading `target_product_id` only while their contract explicitly remains Product-based.

Forward Customer PWA, checkout verification, promotion redemption, and order placement use the canonical Menu reward resolution path.

The legacy field is not allowed to become a second source of truth for canonical reward identity.

### Reference cross-check

This contract was checked against mature commerce patterns:

- WooCommerce free gift mechanisms select Products/Variations as gift items added to the cart.
- commercetools represents a free gift as a `giftLineItem` whose value identifies a Product/Variant, with inventory validity evaluated for the gift item.
- Shopify's BXGY model explicitly separates the products purchased from the products given for free.

These references support the general distinction between the commercial cart item and its underlying stock/inventory identity; they do not override Xentra's Menu/Product contract.

### Lock state

This promotion reward target contract is now part of the locked Product → Menu → Inventory proposal.

No further business-question loop is required for `target_menu_id` vs `target_product_id`.

Implementation status is still subject to full runtime tests, production-data migration review, and final consumer quarantine before PR #7 can be merged.

> Audit note (2026-10-03): Promotion Reward Target Contract implementation completed on the proposal branch, including DB guards, canonical Menu resolver, legacy migration planner, checkout verification, order-persistence compatibility, and Owner Promotion UI. Runtime suite remains the final verification gate; production reward data migration is not applied automatically.
