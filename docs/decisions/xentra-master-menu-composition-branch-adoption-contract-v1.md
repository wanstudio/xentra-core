# Xentra — Master Menu Composition & Branch Adoption Contract v1

**Status:** 🔒 LOCKED — MASTER MENU ARCHITECTURE / IMPLEMENTATION CONTRACT  
**Date:** 2026-09-29  
**Scope:** Owner Dashboard, Merchant App, Master Catalog, Branch Catalog, Customer PWA, Checkout, Orders

## 1. Core decision

A Xentra Menu is a **Master Product assembled by Owner from reusable structured Master data**.

**Owner creates the Master data and composes the Master Product. Merchant only chooses/adopts which Master Products the Branch sells.**

Merchant does not create a second Menu composition and does not replace Master composition fields with branch-authored free text.

```
Owner Master Data
      ↓
Master Product Composition
      ↓
Branch Adoption
      ↓
Branch Category Classification + Branch Operations
      ↓
Resolved Customer Menu View
      ↓
Immutable Order Menu Snapshot
```

## 2. Ownership boundary

### Owner / Brand

Owner is authoritative for:

- Master Categories;
- Master Rasa / Flavor values;
- Master Kelengkapan / Complement values;
- Master Level values;
- Master Product composition;
- Master Product identity/content/image;
- Master Product price and Pricing Policy;
- Master Product POS Variant/Add-on configuration under the existing POS contract.

### Merchant / Branch Manager

Merchant is authoritative only for Branch-side use of an adopted Master Product:

- adopt/remove the Master Product for the current Branch;
- classify adopted Products into Branch Categories;
- reorder Branch Categories;
- operate Branch availability/sold-out;
- operate Branch stock through Inventory;
- operate other explicitly approved Branch-scoped operational controls.

Merchant **cannot**:

- create/edit/delete Master Category;
- create/edit/delete Rasa, Kelengkapan, or Level master values;
- alter Master Product composition;
- replace composition values with free text;
- create a Branch-specific second composition for the same Master Product;
- change Master Product image/content/price as a Menu composition override;
- modify another Branch's assortment or configuration.

## 3. Master Product identity vs Menu presentation

One Master Product remains identified by `products.id`.

`products.name` remains the durable internal/administrative product identity used by Core, search, reporting, references, and compatibility surfaces.

It is **not** the authoritative Customer card title for the new composition model when a Master Category is present.

The composition values are structured references. The combination of values is not a Product primary key.

## 4. Master component model

### 4.1 Kategori / Master Category

Existing `categories` remains the Owner/Brand Master Category authority.

Relationship:

```
products.category_id → categories.id
```

Card presentation:

```
categories.name → Customer card title
```

A Master Product has **exactly one Master Category**.

### 4.2 Rasa / Flavor

New brand-scoped master vocabulary:

```
menu_flavors
  id
  brand_id
  name
  slug
  sort_order
  is_active
  created_at
  updated_at
```

Relationship:

```
product_flavors
  product_id
  flavor_id
  PRIMARY KEY (product_id, flavor_id)
```

A Master Product has **zero or one active Flavor**.

Card presentation:

```
menu_flavors.name → Customer card subtitle
```

### 4.3 Kelengkapan / Complement

New brand-scoped master vocabulary:

```
menu_complements
  id
  brand_id
  name
  slug
  sort_order
  is_active
  created_at
  updated_at
```

Relationship:

```
product_complements
  product_id
  complement_id
  sort_order
  PRIMARY KEY (product_id, complement_id)
```

A Master Product has **zero or many Complements**.

The relation `sort_order` controls Customer display order.

Card presentation:

```
menu_complements.name[] → Customer card detail
```

### 4.4 Level

New brand-scoped master vocabulary:

```
menu_levels
  id
  brand_id
  name
  sort_order
  is_active
  created_at
  updated_at
```

Relationship:

```
product_levels
  product_id
  level_id
  PRIMARY KEY (product_id, level_id)
```

A Master Product has **zero or one active Level**.

Card presentation:

```
menu_levels.name → Customer card indicator
```

## 5. Master vocabulary rules

Master component values are **data records**, not arbitrary strings entered by Merchant.

For each component vocabulary:

- records are brand-scoped;
- names/slugs must be unique within the Brand;
- active records may be selected by Owner for new compositions;
- referenced records are soft-inactivated before any destructive deletion;
- existing Product relations are retained while the record is inactivated;
- no new Product composition may select an inactive record.

The implementation must not silently substitute an inactive/missing Master component with Merchant-authored text.

## 6. Owner composition flow

Owner first maintains the reusable vocabulary:

```
Kategori
Rasa
Kelengkapan
Level
```

Owner then creates/edits a Master Product using selectors:

```
Kategori        [ single select ]
Rasa            [ single select / optional ]
Kelengkapan     [ multi select ]
Level           [ single select / optional ]

Harga
Harga pembanding / coret
Pricing Mode / Pricing Policy
Foto
```

The selector values persist as relations.

The Owner UI must not serialize the Menu composition as a single free-text field.

The existing POS `options_config` Variant/Add-on model remains a **separate contract**. It must not be silently merged with Rasa/Kelengkapan/Level.

## 7. Merchant adoption flow

Merchant discovers the approved Master Product library and chooses:

```
Cari Master Menu
      ↓
Pilih Menu
      ↓
Lihat komposisi Master (read-only)
      ↓
Pilih Branch Category
      ↓
Adopsi
```

Adoption creates the Branch Product assignment only.

The adoption operation does **not** copy the Master composition into Branch-owned text fields.

Merchant may later remove/unadopt the Product where the current Branch adoption rules permit it.

## 8. Merchant editing boundary

After adoption, Merchant may change:

- Branch Category membership;
- Branch Category order;
- Branch availability;
- Branch stock;
- other explicitly approved Branch operational controls.

Merchant may not change:

- Master Category;
- Rasa;
- Kelengkapan;
- Level;
- Master Product composition;
- Master Product image/content;
- Master Product price or Pricing Policy.

There is no canonical Branch Menu Composition editor.

There is no canonical `name_override`, `description_override`, or `image_override` path in the new Menu architecture.

## 9. Branch Category is a separate classification layer

Branch Category is not part of Master Menu Composition.

A Branch may create and organize categories such as:

- Menu Favorit;
- Paket Hemat;
- Promo.

These categories classify adopted Products for that Branch.

Promotion mechanics such as **Buy 1 Get 1** belong to the Promotion domain. A Branch Category must not become a second Promotion engine.

Canonical membership authority:

```
branch_product_categories
```

The legacy scalar `branch_products.branch_category_id` is not the canonical M:N membership authority.

## 10. Master → Branch propagation

Branch adoption references the Master Product. It does not create an independent Menu composition.

Therefore:

- Owner changes to Master composition propagate to the resolved Branch Menu view;
- Owner updates Master component display values propagate to adopted Branches;
- Owner changing Master image/content changes the resolved Branch Menu where that Master field is consumed;
- Merchant does not need to re-edit adopted Products to receive Master composition changes.

Master deactivation and Branch availability remain separate:

```
Master Product lifecycle ≠ Branch Product availability ≠ Inventory stock
```

A Master Product being inactive must follow an explicit Core selling/visibility rule; it must not be implemented by silently writing a Branch override.

## 11. Customer PWA read model

Customer PWA consumes a **resolved Branch Menu View Model**, not raw Branch-authored composition strings.

Forward DTO concept:

```text
product_id
title
subtitle
detail[]
indicator
image
price
availability
categories[]
options
```

Resolution:

```
title      ← Master Category.name
subtitle   ← Master Flavor.name (nullable)
detail[]   ← ordered Master Complement.name[]
indicator  ← Master Level.name (nullable)
image      ← Master Product image
price      ← Owner Master Product / approved Pricing Policy result
availability ← Branch operational state
categories[] ← Branch Category memberships
options    ← existing Product Options contract
```

The Customer client only renders the resolved DTO. It does not reconstruct composition by joining arbitrary raw fields itself.

## 12. Checkout and order snapshot

Before order/payment commitment, Core must resolve the authoritative current Branch Menu state again.

At order-item creation, the system stores an immutable `menu_snapshot` representing the exact Master Menu composition used for that sale.

Conceptual snapshot:

```json
{
  "product_id": "…",
  "title": "…",
  "subtitle": "…",
  "detail": ["…"],
  "indicator": "…",
  "image": "…",
  "master_version_context": "…"
}
```

The exact version identifier may use an existing revision mechanism or an explicit snapshot timestamp/context, but the historical display must not depend on future Master edits.

The existing `modifiers_snapshot` remains separate and continues to represent POS/Product Options selections.

## 13. Pricing boundary

For this new Menu architecture:

**Merchant does not edit Menu price.**

Owner controls Master Product price and Pricing Policy.

The existing `branch_products.price` / `PricingPolicyModel` branch-price capability is legacy compatibility for this Menu migration and must not be exposed as the canonical Merchant Menu editor.

A future legitimate branch-pricing business rule requires its own explicit architecture decision.

## 14. Data model target

Target schema:

```
categories
      ↑
products
  ├── product_flavors ─── menu_flavors
  ├── product_complements ─── menu_complements
  └── product_levels ─── menu_levels

branches
      └── branch_products
              └── branch_product_categories ─── branch_categories

orders
      └── order_items
              ├── menu_snapshot
              └── modifiers_snapshot
```

Requirements:

- all Master component rows are Brand-scoped;
- all Product/component relationships enforce same-Brand integrity;
- Branch adoption remains Branch-scoped;
- Branch Category membership remains Branch-scoped;
- foreign keys and uniqueness constraints must prevent cross-tenant/cross-branch corruption.

## 15. Legacy boundary

The following are legacy/quarantined for Menu:

- `branch_products.name_override`;
- `branch_products.description_override`;
- `branch_products.image_override`;
- legacy snapshot fields `product_name`, `product_description`, `product_image_url`;
- `PATCH /admin/branches/:id/products/:productId/override`;
- Branch Product Override editor UI;
- `branch_products.branch_category_id` as a parallel category authority.

These may remain temporarily for compatibility and migration.

They must not be extended, reused as the new DTO source, or used to satisfy new Menu feature requirements.

The existing POS `options_config` contract is explicitly **not** legacy.

## 16. Migration sequence

Migration follows the repository migration skill:

```
A. Expand
   ↓
B. Seed Master component vocabulary
   ↓
C. Add Product ↔ component relations
   ↓
D. Build new Master composition resolver
   ↓
E. Switch Merchant adoption/read model
   ↓
F. Switch Customer PWA read model
   ↓
G. Add immutable order menu_snapshot
   ↓
H. Reconcile legacy data
   ↓
I. Verify
   ↓
J. Contract/remove legacy paths
```

Rules:

- preserve existing data;
- maintain mixed-version safety where rollout requires it;
- make migration idempotent;
- verify old/new reads during the compatibility window;
- do not drop legacy columns before reconciliation is proven;
- do not make destructive legacy cleanup part of an unrelated feature commit.

## 17. Security and integrity invariants

Core must enforce:

- Owner authority for Master vocabulary/composition;
- Merchant Branch scope;
- same-Brand Product/component relationships;
- Branch Category scope;
- no client-authored composition authority;
- no client-authored price authority;
- no cross-Branch adoption;
- no second inventory authority;
- no second Promotion engine;
- no second POS options authority.

UI visibility never substitutes for authorization.

## 18. Non-goals

This contract does not introduce:

- Merchant-authored Menu composition;
- branch-specific copies of Master composition;
- a free-text composition editor;
- a second catalog authority;
- a second inventory pool;
- a second Promotion engine;
- a new POS Variant/Add-on system;
- automatic KDS;
- a second Order state machine.

## 19. Implementation dependency gate

The implementation may proceed only in this order:

1. schema + migrations;
2. Master component CRUD;
3. Master Product composition API;
4. Owner Master Menu UI;
5. Branch adoption resolver/API;
6. Merchant read-only composition UI;
7. Customer PWA resolved DTO;
8. checkout verification + `menu_snapshot`;
9. legacy migration;
10. legacy path removal.

Each stage requires affected tests and end-to-end contract verification before the next destructive stage.

## 20. Definition of Done

The new Menu architecture is complete when:

- Owner can maintain Master Kategori/Rasa/Kelengkapan/Level;
- Owner can compose Master Products using structured selectors;
- Merchant can only adopt/classify/operate adopted Products;
- Merchant cannot alter Master composition;
- Customer PWA renders the resolved structured composition;
- checkout uses the same authoritative composition;
- order history contains immutable `menu_snapshot`;
- Branch Category M:N is the single Branch category membership authority;
- legacy override UI/API has no active new consumer;
- migration evidence proves no meaningful legacy Menu data was silently lost;
- destructive legacy removal is separately verified and committed.

**Any change to ownership, cardinality, propagation, pricing authority, Customer presentation mapping, or snapshot semantics requires a new contract revision.**
