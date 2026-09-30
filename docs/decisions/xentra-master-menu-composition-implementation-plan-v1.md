# Xentra — Master Menu Composition Implementation Plan v1

**Status:** 🔒 LOCKED — EXECUTION PLAN  
**Date:** 2026-09-29  
**Authority:** `docs/decisions/xentra-master-menu-composition-branch-adoption-contract-v1.md`  
**Legacy boundary:** `docs/decisions/xentra-menu-legacy-quarantine-v1.md`

## 1. Goal

Migrate Xentra Menu from the legacy Branch Override/Snapshot model to one coherent architecture:

```
Owner Master Data
  ↓
Master Product Composition
  ↓
Branch Adoption
  ↓
Branch Category Classification + Operations
  ↓
Customer Menu View
  ↓
Checkout Verification
  ↓
Immutable Order Menu Snapshot
```

The migration is intentionally staged. Legacy data remains readable during the compatibility window; it is not silently deleted.

## 2. Audit completed before implementation

The repository audit found:

### Existing foundations that can be reused

- `categories` and `products` already provide Master Catalog identity.
- `branch_products` already represents Product → Branch adoption.
- `branch_product_categories` already supports Branch M:N category membership.
- `ProductOptionsModel` + `products.options_config` are an established, separate POS Variant/Add-on contract.
- `PricingPolicyModel`, Inventory, Order, RBAC, and audit boundaries already exist and should remain separate.

### Legacy paths that conflict with the new Menu model

- `branch_products.name_override`
- `branch_products.description_override`
- `branch_products.image_override`
- `branch_products.product_name`
- `branch_products.product_description`
- `branch_products.product_image_url`
- `branch_products.price` for branch-authored Menu pricing
- `PATCH /admin/branches/:id/products/:productId/override`
- legacy Branch Product Override editor UI
- `branch_products.branch_category_id` as a parallel category authority
- Customer `CatalogService` currently resolves legacy overrides
- current catalog tests contain explicit legacy override expectations

These paths are now quarantined. They may be touched only for compatibility/migration work.

## 3. Locked business/data interpretation

Per the forward contract:

| Field | Cardinality | Source | Customer presentation |
|---|---:|---|---|
| Kategori | exactly 1 | Owner Master Category | title |
| Rasa | 0..1 | Owner Master Flavor | subtitle |
| Kelengkapan | 0..N | Owner Master Complement | ordered detail |
| Level | 0..1 | Owner Master Level | indicator |

All four are structured relations. Merchant does not type them.

`products.name` remains the durable internal Master Product identity; it is not the new Customer card title source when a Master Category exists.

## 4. Target data model

```
categories
   ↑
products
   ├── product_flavors ───── menu_flavors
   ├── product_complements ─ menu_complements
   └── product_levels ────── menu_levels

branches
   └── branch_products
          └── branch_product_categories
                 └── branch_categories

orders
   └── order_items
          ├── menu_snapshot
          └── modifiers_snapshot   (existing POS contract)
```

### Target constraints

- all Master component rows have Brand scope;
- component names/slugs are unique within a Brand;
- Product/component relations cannot cross Brands;
- Product/Branch adoption cannot cross Brands;
- Branch Category membership cannot cross Branches;
- Product → Master Category is single-valued;
- Product → Flavor is 0..1;
- Product → Complement is 0..N with explicit display order;
- Product → Level is 0..1.

## 5. Phase 1 — Expand schema safely

### 1A. Master vocabulary tables

Add:

- `menu_flavors`
- `menu_complements`
- `menu_levels`

Add indexes/uniqueness appropriate to Brand scope.

### 1B. Product relations

Add:

- `product_flavors`
- `product_complements`
- `product_levels`

Use transactional replacement when editing a Product's composition.

### 1C. Order history

Add nullable `order_items.menu_snapshot`.

Do not replace or merge it with `modifiers_snapshot`.

### 1D. Branch compatibility shape

Keep legacy columns during migration.

The new DB initialization default for physical stock is now `NULL` so a fresh catalog adoption cannot manufacture inventory.

**Important:** changing the CREATE TABLE default does not retroactively alter an existing SQLite table created earlier. Existing production data must therefore be handled by an explicit migration/reconciliation step, not assumed fixed by initialization code.

**Exit:** schema exists, existing data remains readable, and no legacy destructive action has occurred.

## 6. Phase 2 — Master Component APIs / domain service

Create one Owner-authoritative service for:

- list Master Flavors;
- create/edit/inactivate Master Flavors;
- list Master Complements;
- create/edit/inactivate Master Complements;
- list Master Levels;
- create/edit/inactivate Master Levels.

Do not duplicate this logic across UI routes.

Validation:

- trusted Brand scope comes from authenticated context;
- active/inactive rules are server enforced;
- cross-Brand IDs reject explicitly;
- destructive deletion is not allowed while referenced.

## 7. Phase 3 — Master Product Composition API

Create a single application/domain boundary for Product composition.

Input concept:

```text
product_id
category_id
flavor_id?
complement_ids[]
level_id?
```

Behavior:

1. authorize Owner/Brand scope;
2. validate Master Category;
3. validate Flavor belongs to the Brand and is active when selecting;
4. validate every Complement belongs to the Brand and is active when selecting;
5. validate Level belongs to the Brand and is active when selecting;
6. replace relation rows atomically;
7. return the complete resolved composition DTO.

Do not store a duplicated concatenated composition string as authority.

## 8. Phase 4 — Master Menu Resolver

Create a canonical catalog resolver for Master composition.

The resolver owns the mapping:

```
category → title
flavor   → subtitle
complements[] → ordered detail
level    → indicator
product image → image
master price → price
```

It must produce explicit DTO fields rather than forcing every client to know the physical relation layout.

This resolver becomes the dependency for:

- Owner preview;
- Merchant read-only adoption display;
- Customer PWA catalog;
- checkout final verification.

## 9. Phase 5 — Branch Adoption

Refactor adoption so it does only Branch concerns:

```
Master Product
   ↓
Branch adoption
   ↓
Branch Category membership
   ↓
Branch availability
   ↓
Inventory
```

The adoption API must not:

- create composition copies;
- populate legacy snapshot text as new authority;
- create name/description/image overrides;
- create branch pricing as part of Menu adoption.

Branch category assignment may remain M:N and must use `branch_product_categories` as canonical.

## 10. Phase 6 — Merchant App

Replace the legacy Branch Menu editor with:

```
Menu
  ↓
Master Menu Library
  ↓
Select Master Menu
  ↓
Read-only composition preview
  ↓
Select Branch Categories
  ↓
Adopt
```

After adoption:

- composition is read-only;
- category membership remains editable at Branch scope;
- availability remains editable;
- stock remains an Inventory operation;
- no legacy override editor is reachable from the new Menu path.

The existing Merchant shell, sheets, action menu, toast, toggle, and other mature primitives remain the first reuse candidates.

### Locked composition control UX

- Kategori, Rasa, and Kelengkapan use touch-friendly choice chips.
- Level Pedas is **not a dropdown** and is **not exposed as a tab under Master Kategori**.
- Level Pedas uses a compact progressive selector: `[ Level Pedas ] [ ■ ] [ ■ ] [ ■ ] [ □ ]`, with one selected level and filled segments up to that level.
- The existing `level_id` relation and canonical composition API remain unchanged; this is presentation-only.
## 11. Phase 7 — Owner Dashboard

Owner receives the Master-side configuration experience:

### Master data

```
Kategori
Rasa
Kelengkapan
Level
```

### Master Menu

```
Tambah Menu
  ↓
Kategori
Rasa
Kelengkapan
Level
Harga
Foto
  ↓
Preview Customer Card
  ↓
Save
```

Owner editing is authoritative for composition.

POS Variant/Add-on remains in its existing separate options editor.

## 12. Phase 8 — Customer PWA

Switch Customer catalog reads to the new resolved DTO.

Do not make Customer reconstruct the composition from:

- legacy override fields;
- arbitrary free text;
- branch-specific composition fields.

Branch-specific concerns remain:

- Branch availability;
- Branch Category classification;
- Branch inventory state.

The Customer card should render:

```
[TITLE]      Master Category
[SUBTITLE]   Rasa
[DETAIL]     Kelengkapan
[INDICATOR]  Level
```

with appropriate omission when optional values are absent.

## 13. Phase 9 — Checkout verification

At final checkout verification:

1. resolve the authoritative Branch;
2. resolve the Master Product composition again;
3. verify current availability;
4. verify authoritative price;
5. resolve valid Product Options;
6. create the immutable order item snapshot.

The browser's previously rendered composition is never authoritative.

## 14. Phase 10 — Order menu snapshot

When the order item is committed, persist the resolved Customer Menu presentation in `menu_snapshot`.

Purpose:

- future Master edits do not change historical receipts/order views;
- support/audit can reproduce what the customer bought;
- subsequent edits to Master vocabulary do not rewrite history.

`menu_snapshot` is historical evidence. It is not a live catalog source.

## 15. Phase 11 — Legacy reconciliation

Only after the new read/write path is functioning:

### Legacy data classification

For every adopted Branch Product:

1. compare legacy fields with current Master Product;
2. identify whether legacy differences represent meaningful historical information;
3. map any recoverable structured information into new Master data only when deterministic and approved;
4. never invent component values from arbitrary text;
5. keep unresolved legacy data flagged for manual review/retention.

Do not automatically convert free text into structured Master values merely because the strings look similar.

### Branch category reconciliation

- migrate/verify all meaningful assignments into `branch_product_categories`;
- detect orphan rows;
- preserve valid M:N relationships;
- stop using `branch_products.branch_category_id` as authority.

## 16. Phase 12 — Legacy contract

After migration verification:

1. remove active UI entry points;
2. stop new writes to legacy override fields;
3. make legacy endpoint compatibility-only or reject new writes;
4. prove no active consumer remains;
5. archive/remove legacy test expectations that only protect superseded behavior;
6. remove legacy columns in a separate destructive migration.

Do not combine destructive cleanup with the first implementation release.

## 17. Tests required by phase

### Schema/data

- Brand isolation;
- FK integrity;
- unique Master component vocabulary;
- Product composition cardinality;
- M:N complement ordering;
- inactive component protection;
- no fabricated stock.

### Owner

- CRUD Master components;
- compose Product;
- reject cross-Brand relations;
- reject inactive component selection;
- edit propagation.

### Merchant

- adopt Master Product;
- read-only composition;
- Branch Category M:N;
- no Master mutation;
- no legacy override mutation through new UI;
- Branch scope denial.

### Customer

- exact title/subtitle/detail/indicator mapping;
- optional fields omitted safely;
- Branch availability separate from composition;
- legacy overrides cannot alter the new DTO.

### Checkout / Order

- fresh composition resolution;
- authoritative price;
- immutable `menu_snapshot`;
- `modifiers_snapshot` remains independent.

### Migration

- idempotent rerun;
- no duplicate relation rows;
- no orphan Master component references;
- no meaningful legacy data silently lost;
- rollback/compatibility behavior documented.

## 18. Rollout rule

Use:

**Expand → Dual/compatibility read where needed → Switch canonical writes/reads → Reconcile → Verify → Contract**

Do not use:

**Delete old schema → build new code → hope old data still works**

Mixed-version safety is required during any deployment window in which old and new application code can overlap.

## 19. Commit boundaries

Keep commits separable by boundary:

1. contract/docs;
2. schema expand;
3. Master component domain/API;
4. Product composition domain/API;
5. resolver;
6. Owner UI;
7. Merchant adoption/read-only UI;
8. Customer PWA;
9. checkout/order snapshot;
10. migration/reconciliation;
11. legacy contract removal.

This makes rollback and review practical.

## 🔒 UX NOTE — Master Product Assembly Workspace
**29 September 2026**

Owner has one Catalog assembly workspace: **Produk Master**.

There is no separate Owner navigation surface for `Kategori` or `Kategori & Rasa`. Master Category and Master Flavor remain Core authorities and are created progressively from the Product editor through contextual `+` actions:

- `Kategori ▼ +` → quick-create Master Category.
- `Rasa ▼ +` → quick-create Master Flavor.

After creation, the same Product editor refreshes its selector and selects the new value. The action never creates a duplicate vocabulary or branch-local master.

The technical Master Menu Composition contract remains unchanged. This is a UX/progressive-disclosure decision only.

## 20. Current status

### Completed in this planning pass

- Forward Master Menu contract locked.
- Legacy Menu Override/Snapshot architecture quarantined.
- Contradictory Branch Catalog documentation marked superseded.
- Branch Manager Menu contract reconciled.
- Legacy Branch Menu edit actions removed from active Owner/Merchant card action menus.
- Legacy compatibility comments added to affected runtime paths/tests.
- Fresh schema stock default changed from fabricated `100` to `NULL` for new databases.

### Next implementation stage

**Phase 1 — Schema Expand**, followed by Master Component domain/API.

No legacy column deletion is authorized in Phase 1.

## 21. Stop conditions

Stop and resolve a contract issue before coding onward when:

- a requested UI needs Merchant to modify Master composition;
- a field has ambiguous ownership;
- an inactive Master component has no safe customer display behavior;
- migration cannot deterministically preserve existing meaning;
- the same concept is being introduced a second time under another name;
- a new feature requires changing Pricing, Promotion, Inventory, POS Options, or Order authority beyond this contract.

**This plan is subordinate to the locked Master Menu Composition contract and the repository migration skill.**


## 🔒 EXECUTION UPDATE — 2026-09-29

### Completed forward cutover foundations

- Schema expansion is present.
- Master Component CRUD/service is present.
- Master Product Composition save/read is present.
- Canonical Master Menu resolver is present.
- Customer branch catalog read path now resolves structured Master Menu Composition.
- Checkout final verification resolves structured Master Menu Composition and ignores legacy Branch Menu price overrides for the forward path.
- Order item persistence already accepts and stores `menu_snapshot`.
- Merchant/Owner Branch Menu clients now use the canonical `/admin/branches/:id/menu` read model.
- Legacy Branch Menu edit actions are removed from active card actions.

### Compatibility remains intentional

Legacy physical columns, legacy override API, and legacy CatalogService code remain because historical data and compatibility paths may still exist.

They are not forward authorities.

### Current next phase

**Legacy reconciliation / readiness audit**, with no automatic interpretation of arbitrary legacy free text.

Deterministic reconciliation candidates:

1. Branch Category scalar → M:N membership where the M:N row is missing.
2. Branch price divergence → audit/report for explicit pricing decision; do not silently rewrite.
3. Name/description/image overrides → report for manual retention/review; do not infer Master components from free text.
4. Existing historical orders → do not fabricate historical `menu_snapshot` from current Master data.

Only after reconciliation evidence is clean should destructive legacy cleanup be considered.

### Production safety gate

The forward resolver/read/write paths must remain compatible with existing data while the readiness audit is being completed. Legacy column removal is **not authorized** in this phase.


## 🔧 IMPLEMENTATION UPDATE — Owner Master Product Composition UI
**29 September 2026**
The Owner Master Menu UI step is now implemented on the existing Owner Catalog surface.

Implemented:
- Master Product editor uses structured controls for **Kategori, Rasa, Kelengkapan, Level**.
- Customer-facing mapping is explicit: **Kategori → title, Rasa → subtitle, Kelengkapan → ordered detail, Level → indicator**.
- Added a live **Customer PWA preview card** in the Master Product editor; category, flavor, complements, level, price, and product image update the preview without creating a second presentation model.
- Composition persistence uses `PUT /admin/products/:id/composition` and the existing Master Menu Composition API.
- Inactive Master components are excluded from new selection choices but preserved as visible (Nonaktif) relations when already attached, allowing explicit replacement/removal.
- No legacy Branch Override fields are introduced into the new Master Product flow.

Git implementation commits:
- 8bfc13cad5de2f75b903acd1e06af47548ca56a7 — repair composition preview markup.
- d78b3d24ebcf0a7959ac361fa5bda6775afcddb0 — structured selector/inactive component handling.
- 1f3276d74ef973a2ff08123c6a9561ae8d77eba5 — Customer PWA preview styling.
- ee82bdcdd60f3922f05897283fa51391702cc213 — Owner UI regression contract.

Verification gate remaining:
1. Run the repository test suite on the normal Node 24 runtime.
2. Exercise Owner → Master Product → composition save on VPS.
3. Verify the adopted Branch menu and Customer PWA render the same structured composition.
4. Only after those checks, proceed to any further UI refinement or legacy reconciliation.


## 🔒 UX UPDATE — Category Management Surface
**29 September 2026**

The Owner Catalog navigation is now:

```
Kategori
Produk Master
```

**Kategori** is a management page for existing Master Categories. It is not a product assembly surface. **Produk Master** remains the single assembly workspace. The Product editor's `+` button remains a quick-add entry point to the same Category authority.



## UX UPDATE — Category Management Tabs
**30 September 2026**

The Owner Kategori route is the master-reference management surface with four tabs: Kategori, Rasa, Kelengkapan, and Level. Lists use compact card rows with overflow actions Edit / Hapus. This surface is separate from the Product assembly workspace but shares the same Core master authorities.

Kelengkapan is a reusable 0..N vocabulary rendered as multi-select checkboxes in Product Master composition. Level is a reusable 0..1 vocabulary rendered as a single dropdown in Product Master composition. When a brand has no Level rows, the Owner surface idempotently provisions the standard values 1 — Tidak Pedas, 2 — Pedas Sedang, and 3 — Pedas Banget.
## UX UPDATE — Native Master Composition Choice Chips
**30 September 2026**

The Product Master composition editor now uses one consistent native-style choice surface for all structured references:
- Kategori — single select
- Rasa — optional single select
- Kelengkapan — multi-select
- Level — optional single select

Visible controls are touch-friendly selectable chips. Selected state uses the product accent lime treatment; unselected state remains white with a light border. Kelengkapan keeps the existing complement_ids[] array contract. Level remains a single level_id. The underlying native selects remain hidden as compatibility/state controls only; they are not the primary presentation.

The visible surface also exposes a + Tambah chip that opens the existing Master Reference quick-add flow, so creation does not require returning to another page. This supersedes the previous visible checkbox/select presentation without changing the canonical composition API or database model.
