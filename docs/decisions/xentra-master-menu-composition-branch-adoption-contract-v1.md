# Xentra Master Menu Composition & Branch Adoption Contract v1

**Status:** 🔒 LOCKED — MASTER MENU ARCHITECTURE / IMPLEMENTATION CONTRACT
**Date:** 2026-09-29
**Scope:** Owner Dashboard, Merchant App, Master Catalog, Branch Catalog, Customer PWA, Order Snapshot

## 1. Core decision

A Xentra menu is one unique Master Product assembled from reusable Owner-managed data.

**Owner creates the data and assembles the menu. Merchant only chooses/adopts which Master Products the Branch sells.**

The Branch does not create a second copy of the menu composition.

~~~
Owner master data
      ↓
Master Product composition
      ↓
Branch adoption
      ↓
Branch classification + operations
      ↓
Resolved Customer PWA menu
      ↓
Immutable order snapshot
~~~

## 2. Ownership

### Owner / Master

Owner owns:

- Master Category values;
- Master Rasa / Flavor values;
- Master Kelengkapan / Complement values;
- Master Level values;
- Master Product composition;
- Master Product image;
- Master price and Pricing Policy;
- Master Product POS sales options under the existing POS contract.

Owner is the only role that creates or changes the Master vocabulary and Master composition.

### Merchant / Branch Manager

Merchant owns only the Branch-side use of the adopted Product:

- adopt/remove Master Products;
- assign adopted Products to Branch Categories;
- reorder Branch Categories;
- operate Branch availability;
- operate Branch stock;
- operate approved Branch-scoped promotions.

The Master Product's menu composition and price are consumed according to Owner-defined data and rules.

Merchant cannot create or edit the Master Rasa, Complement, Level, Master Category, Product composition, Master image/content, or Master-defined price/rules.

## 3. Master Product identity

One Master Product is identified by products.id.

The visible Customer PWA content is derived from relations, not from a concatenated free-text product name.

Example:

~~~
Product P100
  Category      = Ayam Tulang Lunak
  Rasa          = Lombok Ijo
  Kelengkapan   = Nasi, Lalapan, Sambal Terasi
  Level         = Level 1, Level 2, Level 3
~~~

products.id remains the identity.

The combination of component values is not the primary key and is not unique by default.

## 4. Master component model

### 4.1 Master Category

The existing categories table remains brand-owned Master Category authority.

products.category_id references exactly one Master Category.

Customer mapping:

~~~
categories.name → card title
~~~

### 4.2 Rasa / Flavor

New brand-scoped master table:

~~~
menu_flavors
  id
  brand_id
  name
  slug
  sort_order
  is_active
  created_at
  updated_at
~~~

Relation:

~~~
product_flavors
  product_id
  flavor_id
  PRIMARY KEY (product_id, flavor_id)
~~~

Card mapping:

~~~
menu_flavors.name → card subtitle
~~~

A Product has zero or one active Flavor.

### 4.3 Kelengkapan / Complement

New brand-scoped master table:

~~~
menu_complements
  id
  brand_id
  name
  slug
  sort_order
  is_active
  created_at
  updated_at
~~~

Relation:

~~~
product_complements
  product_id
  complement_id
  sort_order
  PRIMARY KEY (product_id, complement_id)
~~~

A Product may have many Complements.

Card mapping:

~~~
menu_complements.name → detail line
~~~

Stored relation order controls display order.

### 4.4 Level

New brand-scoped master table:

~~~
menu_levels
  id
  brand_id
  name
  sort_order
  is_active
  created_at
  updated_at
~~~

Relation:

~~~
product_levels
  product_id
  level_id
  sort_order
  PRIMARY KEY (product_id, level_id)
~~~

A Product may have multiple Levels.

The Customer PWA renders the ordered Level set as its visual level indicator.

## 5. Master data uniqueness

Recommended uniqueness:

~~~
UNIQUE (brand_id, normalized_name)
  menu_flavors
  menu_complements
  menu_levels
~~~

Component relations are unique per Product.

Product identity remains products.id.

Do not use:

~~~
category + flavor + complements + levels
~~~

as the Product key.

## 6. Owner Add Menu flow

Owner first maintains the value library:

~~~
Kategori
Rasa
Kelengkapan
Level
~~~

Then Owner creates a Master Product using selectors:

~~~
Kategori       [ dropdown ]
Rasa           [ dropdown ]
Kelengkapan    [ multi-select ]
Level          [ multi-select ]

Harga
Harga pembanding / coret
Pricing Mode
Range bila berlaku

Foto
~~~

The Customer PWA title, subtitle, detail and level display are generated from those selections.

Customer-facing composition fields are not free-form Merchant text fields.

The existing POS options_config / Variant / Add-on contract remains separate.

## 7. Merchant Adopt flow

Merchant sees Master Products available to the Branch and chooses:

~~~
[ Adopsi ]
~~~

Core creates:

~~~
branch_products
  branch_id
  product_id
  ...
  PRIMARY KEY (branch_id, product_id)
~~~

Adoption does not copy:

- Master Category;
- Rasa;
- Kelengkapan;
- Level;
- Product composition.

It creates the Branch selling relationship to the same Master Product.

## 8. Merchant editing boundary

Merchant can change:

- Branch Category membership;
- Branch Category order;
- Branch availability;
- Branch stock;
- approved promotion assignment/operation.

Merchant cannot change:

- Master Category;
- Rasa;
- Kelengkapan;
- Level;
- Master Product composition;
- Master component names;
- Master component ordering rules;
- Master-defined price or Pricing Policy;
- Master Product image/content as a new Branch-authored composition.

There is no Branch free-text composition editor and no Branch Menu Composition override editor.

## 9. Branch Category

Branch Categories are a separate Branch-owned classification layer.

Example:

~~~
Master Product:
  Ayam Tulang Lunak
  Lombok Ijo
  Nasi + Lalapan
  Level 1,2,3

Branch Categories:
  Menu Favorit
  Paket Hemat
  Promo
~~~

The same Master Product may belong to different Branch Categories at different Branches.

A Branch Category called Promo is only a classification label.

Buy 1 Get 1 and other promotion mechanics remain in the Promotion domain.

## 10. Propagation

Master composition is authoritative for adopted Products.

Therefore:

~~~
Owner changes Master component
        ↓
Adopted Branch resolves the new Master value
        ↓
Customer PWA shows the current Master value
~~~

Merchant does not own a second copy of the composition.

Branch exceptions to composition require a separate future contract and are not part of v1.

## 11. Inactivation

Master component values use soft inactivation.

is_active = 0 means:

- cannot be selected for new Products;
- existing Product relations remain valid;
- existing Products continue resolving the referenced value;
- historical orders are unaffected.

Referenced values must not be hard-deleted.

## 12. Customer PWA read model

Customer PWA consumes a resolved Branch Menu View Model.

Conceptual resolution:

~~~
branch_products
    ↓
products
    ├─ Master Category
    ├─ Rasa
    ├─ Kelengkapan
    └─ Level
~~~

Recommended response shape:

~~~
{
  product_id: "P100",
  title: "Ayam Tulang Lunak",
  subtitle: "Lombok Ijo",
  complements: ["Nasi", "Lalapan", "Sambal Terasi"],
  levels: ["Level 1", "Level 2", "Level 3"],
  price: 25000,
  regular_price: 28000,
  image_url: "..."
}
~~~

Customer PWA renders this resolved data and does not become a Catalog authority.

## 13. Checkout and order snapshot

Checkout sends Product identity and quantity.

Core must resolve:

1. Branch adoption;
2. Branch availability;
3. effective Branch price;
4. current Master Menu Composition.

The client cannot authoritatively submit title, subtitle, complement, level or price strings.

Order Items must preserve the purchased display state independently from future Master edits.

Recommended extension:

~~~
order_items.menu_snapshot JSON
~~~

The snapshot contains the resolved customer-facing composition at purchase time.

Existing modifiers_snapshot remains the POS Variant/Add-on snapshot.

## 14. Existing Xentra reconciliation

Current Xentra has:

- products.category_id;
- products.options_config for POS options;
- branch_products name/description/image override columns;
- branch_product_categories for Branch Category M:N membership.

Under this contract:

- products.category_id remains the Master Category relation;
- product_flavors becomes the Rasa relation;
- product_complements becomes the Kelengkapan relation;
- product_levels becomes the Level relation;
- branch_products remains the adoption boundary;
- branch_product_categories becomes the sole Branch Category membership authority.

The existing Branch name_override, description_override and image_override paths are no longer canonical for the new Customer Menu model. Legacy columns may remain temporarily for migration compatibility.

products.options_config is not repurposed.

## 15. Branch Category canonicalization

The current model contains both:

~~~
branch_products.branch_category_id
branch_product_categories
~~~

The new contract makes branch_product_categories the canonical M:N authority.

Migration:

1. reconcile scalar branch_category_id into the junction table;
2. verify no memberships are lost;
3. switch Branch Catalog queries to the junction table;
4. stop using branch_products.branch_category_id as authority;
5. remove the scalar field only after compatibility cleanup.

## 16. Security and integrity

Core enforces:

- same-brand Product ↔ Branch;
- same-brand Product ↔ Master Component;
- Branch Manager branch scope;
- valid Product cardinality;
- valid Branch Category scope;
- pricing policy;
- availability;
- stock;
- checkout pricing;
- order snapshot;
- audit requirements from existing contracts.

UI selectors do not grant authority over Master data.

## 17. Migration sequence

A. Add Master component tables and Product relation tables.

B. Seed/normalize Owner-managed values.

C. Populate Product relations and validate cardinality.

D. Change Branch Menu resolution to Master composition + Branch adoption.

E. Make Branch Category M:N relation canonical.

F. Change Customer PWA to consume the resolved view model.

G. Add order menu_snapshot.

H. Retire legacy branch content-override resolution after regression verification.

## 18. Non-goals

This contract does not introduce:

- Branch-owned Rasa / Complement / Level libraries;
- free-form Merchant menu composition;
- one Product copy per Branch;
- a second Catalog authority;
- a second Inventory authority;
- BOGO logic inside categories;
- replacement of POS options_config;
- automatic inventory-bearing variants.

## 19. Definition of Done

The model is complete when:

- Owner can create reusable Master vocabulary;
- Owner can assemble a Master Product from structured values;
- Merchant can adopt the Product without copying its composition;
- Merchant cannot edit Master composition;
- Merchant can classify adopted Products with Branch Categories;
- Customer PWA derives title/subtitle/detail/level from structured relations;
- checkout resolves authoritative current data server-side;
- order history stores immutable menu composition;
- legacy Branch content overrides are no longer authoritative;
- POS options remain separate;
- no second Catalog/Inventory/Promotion authority exists.

## 20. Review gate

**PROPOSED — REVIEW BEFORE LOCK / IMPLEMENTATION.**

Review these points before coding:

1. Master Category = Customer card title.
2. Rasa = Customer card subtitle.
3. Kelengkapan = Customer card detail.
4. Level = Customer card level indicator.
5. Master changes propagate to adopted Branches.
6. Merchant does not alter Master composition.
7. Branch Category is separate from Master Menu Composition.
8. Order menu_snapshot is required for historical integrity.
9. Branch Category M:N is canonical.
10. Legacy branch name/description/image overrides are retired from the canonical Menu path.

No production schema/UI migration should start until this proposal is locked.

## 🔒 LOCKED ADDENDUM — Composition Cardinality & Presentation
**Date: 2026-09-29**

The audited interpretation of the Owner-managed structured Menu fields is now:

| Component | Cardinality per Master Product | Customer PWA role |
|---|---:|---|
| Kategori | exactly 1 | title |
| Rasa | 0..1 | subtitle |
| Kelengkapan | 0..N | ordered detail |
| Level | 0..1 | indicator |

The composition values are structured references. They are not free-text Merchant fields.

`products.name` remains the durable Master Product identity/administrative identifier used by Core, search, reporting, and internal references. It is not the new source for the Customer card title when a Master Category is present.

Owner controls Master Product image/content and price policy. Merchant adoption does not create a Branch-authored copy of those fields.

### Customer composition view model

The forward Customer Menu resolver must expose a resolved presentation model equivalent to:

```text
title      <- Master Category.name
subtitle   <- Master Flavor.name (nullable)
detail[]   <- ordered Master Complement.name[]
indicator  <- Master Level.name (nullable)
image      <- Master Product image
price      <- Owner Master Product / Pricing Policy result
```

The raw relation IDs may remain internal. Customer clients consume the resolved DTO.

### Merchant rule

Merchant UI must show the adopted Master Product composition as read-only. Merchant actions are adoption/removal, Branch Category classification, availability, stock, and other explicitly approved Branch operations.

Merchant must not replace a Master component with arbitrary text or a different branch-specific component set.

## 🔒 LOCKED ADDENDUM — Propagation / Inactivation
**Date: 2026-09-29**

Master component edits affect future resolved Branch Menu views because Branch adoption references the Master Product rather than copying the composition.

When a referenced Master component is retired:

- existing Product relations are retained;
- the component becomes inactive for new composition selection;
- existing adopted Products do not lose historical identity merely because the component is inactive;
- customer resolution must follow an explicit safe display rule for an inactive referenced component before that component is physically removed.

Referenced component rows must therefore be **soft-inactivated before any destructive deletion**.

## 🔒 LOCKED ADDENDUM — Pricing Boundary
**Date: 2026-09-29**

For the new Master Menu architecture, **Merchant does not edit Menu price**.

Owner defines the Master Product price and pricing policy. Any existing Branch price override capability is legacy compatibility and is quarantined with the rest of the old Branch Menu Override model.

The existing `PricingPolicyModel` and `branch_products.price` path must not be extended as the new Merchant Menu editor. A later explicit pricing contract may govern legitimate branch pricing for a different business requirement, but that would be a separate decision.

## 8A. Implementation dependency gate

Before runtime migration, the following must exist and pass:

1. Master component schema and tenant/brand scoping.
2. Owner CRUD for Master components.
3. Owner Product Composition API with transactional relation replacement.
4. Merchant adoption API that creates only the Branch Product assignment and Branch Category membership.
5. Customer Menu resolver returning the structured composition DTO.
6. Checkout final verification resolving the same Master composition and authoritative price.
7. Immutable `menu_snapshot` persistence on `order_items`.
8. Legacy compatibility coverage proves old data remains readable during migration.

**No legacy override endpoint or field may be used to satisfy any item above.**

## 20. Contract completion

This contract is now the authoritative forward Menu architecture for the implementation sequence.

The legacy Branch Override/Snapshot model remains quarantined under:
`docs/decisions/xentra-menu-legacy-quarantine-v1.md`.

Any change to ownership, component cardinality, propagation, Merchant authority, pricing boundary, or Customer presentation mapping requires a new explicit contract revision.
