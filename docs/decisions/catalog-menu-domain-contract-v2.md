
# Xentra — Catalog, Master Menu & Master Category Contract v2

**Status:** 🔒 LOCKED — AUTHORITATIVE  
**Decision date:** 2026-10-05  
**Scope:** Owner Catalog, Master Menu, Master Category, Item/SKU, Branch Menu, Customer PWA, Inventory

This is a new contract rebuilt from the decisions and corrections in the Xentra conversation. It is a new document and does not edit the earlier contract files.

> **Supersession:** For the forward Catalog/Menu model, this document is the source of truth. Older proposals, UI assumptions, tests, and legacy schema fields are compatibility/migration material unless a newer explicit contract changes a specific rule.

---

## 1. Core model

~~~
MASTER CATEGORY
  ├── Category
  │     └── Sub Category
  ├── Rasa
  └── Item

MASTER MENU
  ├── identity: Category + Sub Category + optional Rasa
  ├── composition: 1..N Item
  ├── selling price
  ├── Menu media
  ├── Pedas configuration
  └── lifecycle/status

BRANCH MENU
  ├── adoption of Master Menu
  ├── Branch Category membership
  └── branch operational availability

INVENTORY
  └── Item/SKU stock and immutable movements
~~~

Menu is the customer-facing commercial entity.

Item is the atomic reusable composition/stock entity.

They are different responsibilities and must not be collapsed into one concept.

---

## 2. Catalog Information Architecture

The Catalog top level is exactly:

~~~
Catalog
├── Master Menu
└── Master Category
    ├── Category
    ├── Rasa
    └── Item
~~~

### Master Menu
Owner workspace for creating and maintaining commercial Menus.

### Master Category
Owner workspace for reusable master data with exactly three areas:

~~~
Category | Rasa | Item
~~~

### Sub Category
Sub Category is managed inside Category:

~~~
Category
└── Sub Category[]
~~~

It is not a fourth Master Category tab and not a separate top-level Catalog node.

### Not forward Catalog nodes

Do not create these as forward Catalog areas:

~~~
Produk Master
Menu Cabang
Judul
Kelengkapan
Master Level
Menu Satuan
Menu Paket
SINGLE / PACKAGE
~~~

Legacy code or storage with those names may remain during migration but must not become forward business authority.

---

## 3. Terminology

### Item
Forward UI/business term for the atomic reusable component.

An Item may have:

- stable internal ID;
- name;
- optional SKU;
- internal description;
- media;
- lifecycle/status.

Legacy physical storage may still use the table name products. That does not make Product the forward commercial identity.

### SKU

~~~
SKU exists → Item is stock-managed
SKU NULL   → Item is non-stock
~~~

SKU presence determines stockability. Creating/assigning a SKU never fabricates a stock quantity.

### Menu

Menu owns:

- taxonomy identity;
- customer presentation;
- selling price;
- Menu media;
- Pedas configuration;
- Item composition;
- lifecycle/status.

Menu does not own physical stock.

### Judul

There is no standalone Master Judul entity or Catalog Judul tab.

Default Customer title:

~~~
Sub Category.name
~~~

Therefore no free-text Nama Menu/Judul field is allowed to replace the taxonomy identity.

Legacy menu_titles/title_id are compatibility/migration material only.

---

## 4. Category and Sub Category

Category is Master grouping/classification.

Sub Category belongs to exactly one Category.

Rules:

1. Sub Category always resolves to one parent Category.
2. Menu uses Sub Category as its default customer title source.
3. Category is derived through the Sub Category relationship.
4. Forward code must not maintain two conflicting parent-category authorities.
5. Category/Sub Category are Owner/Brand Master data.
6. Branches do not edit Master Category/Sub Category.
7. Referenced records use Archive/Nonaktif lifecycle rather than impossible destructive deletion.

Customer presentation:

~~~
Category.name     → category/grouping context
Sub Category.name → default Menu title
~~~

---

## 5. Rasa

Rasa is reusable Brand-scoped Master data.

Rules:

- Menu may have zero or one Rasa.
- One Rasa may be reused by many Menus.
- Rasa is separate from Category.
- Rasa is not a Menu subtype.
- Rasa is not a free-text Menu value.
- Owner manages Rasa from Master Category → Rasa.
- Quick-add uses the same Master Rasa authority and prevents duplicate normalized records.

### Original

Original is the baseline Rasa presentation when used.

~~~
Rasa = Original
→ hide Customer subtitle

Rasa = another value
→ may be shown as Customer subtitle
~~~

A Menu may also have no Rasa. Old legacy rules requiring Rasa for every SINGLE Menu do not apply to the forward model.

---

## 6. Menu identity

Business identity:

~~~
Category + Sub Category + optional Rasa
~~~

Storage may use the stable Sub Category reference plus the optional Rasa reference because Sub Category already resolves its parent Category.

Examples:

~~~
Sub Category A + Original
Sub Category A + Pedas
Sub Category B + Original
~~~

are distinct identities.

The same identity must not produce two active Master Menus within one Brand.

A duplicate create operation must reject; it must never silently overwrite an existing Menu.

---

## 7. Menu composition

Every Master Menu has one or more Items.

~~~
Menu
├── Item A × 1
├── Item B × 1
└── Item C × 2
~~~

Rules:

1. Cardinality is 1..N.
2. Every row references an atomic Item.
3. Quantity is a positive integer.
4. Repeated use of an Item is represented by quantity > 1.
5. One Item is a valid Menu.
6. Multiple Items are valid.
7. There is no minimum-two-Item rule.
8. Owner controls composition.
9. Branches cannot edit composition.
10. Composition save is atomic and validated.

### No Menu subtype

The forward model does not use:

~~~
SINGLE
PACKAGE / PAKET
Menu Type
package_name
~~~

as business semantics.

Existing menu_type/package_name fields may remain nullable for compatibility. Forward services must not depend on them.

---

## 8. Menu media

Menu owns its own media.

The Owner Master Menu editor must contain a real Menu media field.

The forward rule is:

~~~
Menu media
≠ first Item media
≠ automatic Product image fallback
~~~

An Item may have its own image/media for Item/stock/master-data purposes.

The Customer Menu resolver uses Menu media.

Media processing should reuse the existing Xentra media engine/compression boundary.

---

## 9. Selling price

Selling price belongs to Menu.

~~~
Item / SKU → stock identity
Menu       → selling price
~~~

Therefore:

- one Item may be reused by many Menus;
- different Menus may have different selling prices;
- Item/SKU creation does not create a selling price;
- Item/Product price is not the forward Customer Menu price.

Existing Product price fields are migration/compatibility storage.

Branch pricing must not become a second pricing authority without an explicit pricing contract.

---

## 10. Pedas

Pedas is a Menu configuration/presentation capability.

Owner UI:

~~~
☐ Level Pedas
~~~

Default:

~~~
unchecked
~~~

Unchecked:

~~~
spice_enabled = false
spice_level = NULL
scale hidden/disabled
no Customer Pedas indicator
~~~

Checked:

~~~
spice_enabled = true
horizontal four-position scale active
~~~

The control is not a dropdown.

The numeric position is an internal scalar. Do not assign business meanings such as “1 = tidak pedas, 2 = pedas” without a separate business decision.

spice_enabled is authoritative.

### Master Level

There is no forward Master Level catalog for Pedas.

Legacy level_id/menu_levels may remain temporarily but are not the forward Pedas authority.

---

## 11. Owner Master Menu Editor

The editor represents the Menu directly:

~~~
Category
Sub Category
Rasa (optional)

[✓] Level Pedas
    ────────────────○

Item composition
    Item A × quantity
    Item B × quantity
    ...
    + Tambah Item

Harga Jual
Media Menu
Status
~~~

Do not expose:

- free-text Nama Menu/Judul replacing Sub Category;
- Menu Type;
- SINGLE/PACKAGE selector;
- Package Name;
- Master Level selector;
- Kelengkapan as a separate Menu master;
- Product as the forward commercial Menu identity.

Inline quick-add may create:

~~~
Category
Sub Category
Rasa
Item
~~~

and must refresh/select the new Master record from the same authority.

---

## 12. Item editor

Master Category → Item is the Owner surface for atomic reusable Items.

Item may contain:

~~~
Name
SKU (optional)
Internal description
Media
Lifecycle/status
~~~

Item does not own:

~~~
Menu selling price
Menu taxonomy identity
Menu Pedas state
Branch availability
Menu identity
~~~

When an Item receives a SKU, it enters the stock-managed universe and becomes discoverable by Stock/Inventory without requiring a duplicate stock master.

This does not set an arbitrary initial quantity.

---

## 13. Inventory boundary

Inventory owns physical stock.

~~~
SKU exists
→ stock-managed Item
→ Branch Inventory tracks quantity
~~~

Menu editing never directly changes stock quantity.

Example:

~~~
Item Ayam    SKU AYAM-001
Item Nasi    SKU NASI-001
Item Lalapan SKU NULL

Menu Ayam + Nasi + Lalapan
  Ayam    ×1
  Nasi    ×1
  Lalapan ×1
~~~

Sale consumption:

~~~
ordered Menu quantity × composition quantity
→ consume only SKU-managed Items
→ atomic validation + deduction
→ immutable inventory movement
~~~

No partial composition deduction is allowed.

---

## 14. Branch Menu adoption

Master Menu and Branch Menu are separate layers.

~~~
Owner
  ↓
Master Menu
  ↓
Branch adopts Menu
  ↓
Branch Menu
~~~

Branch Manager may:

- adopt an approved Master Menu;
- remove/unadopt it where allowed;
- assign it to Branch Categories;
- operate Branch availability/sold-out.

Branch Manager may not:

- create Master Menu;
- edit Menu composition;
- edit Master Category/Sub Category/Rasa;
- edit Master Item/SKU;
- change Master Menu price unless a separate explicit pricing contract allows it.

### Menu Cabang

Menu Cabang is a Branch operational concept.

It is not a Catalog navigation node.

---

## 15. Branch Category

Branch Category is branch-local merchandising/classification.

~~~
Master Category → brand-wide taxonomy
Branch Category → branch-local presentation/grouping
~~~

Branch Category does not change Menu identity.

Where the existing Branch Category contract supports M:N membership, a Branch Menu may belong to multiple Branch Categories.

---

## 16. Branch display override

A narrow Branch-scoped Customer display override may exist where already supported by the Branch Menu contract.

Rules:

- presentation-only;
- Branch-scoped;
- does not change Menu identity;
- does not change Category/Sub Category/Rasa;
- does not change composition;
- does not change Item/SKU identity;
- does not create another Master Menu.

Default title remains Sub Category.name.

---

## 17. Customer PWA boundary

Customer PWA consumes a resolved Customer Menu View Model.

Conceptual fields:

~~~
menu_id
category
title
subtitle
media
selling_price
pedas
availability
~~~

Resolution:

~~~
title         → Sub Category.name
subtitle      → Rasa.name except Original
category      → Category.name
media         → Menu media
selling_price → Menu selling price
pedas         → spice_enabled + spice_level
availability  → Branch Menu state + required stock checks
~~~

Customer PWA must not reconstruct Menu semantics from raw Item/Product rows.

### Never expose internal composition

Customer responses must not expose:

~~~
Item ID
SKU
Item stock flag
Item quantity
raw Product ID
menu_type
package_name
level_id
migration fields
~~~

Item composition is internal fulfillment/inventory data.

### Search

Search uses the resolved Customer Menu View Model.

Searchable:

~~~
Title / Sub Category
Rasa / Subtitle
~~~

Not searchable in the current model:

~~~
Item name
SKU
internal Item/Product ID
numeric Pedas position
~~~

Search updates while typing.

---

## 18. Checkout and orders

Commercial order identity is Menu-based.

At checkout:

~~~
Cart Menu ID
  ↓
Core re-resolves current Master Menu
  ↓
resolve taxonomy + presentation
  ↓
resolve Item composition
  ↓
validate Branch availability
  ↓
validate required SKU stock atomically
  ↓
persist immutable order snapshots
~~~

Order history must remain stable after later Menu/Item edits.

Forward order evidence should retain:

- Menu identity;
- effective selling price;
- customer-facing Menu snapshot;
- Item/component snapshot;
- inventory consumption evidence.

Legacy Product order columns may remain for migration but are not the commercial authority.

---

## 19. Promotion / POS / Receipt / KDS

### Promotion
Customer-facing promotions use Menu identity. Do not infer a commercial Menu from an Item/Product ID when one Item can back multiple Menus.

### POS
POS sells Menu identity. Item/SKU is used for stock resolution.

### Receipt and history
Use immutable Menu/order snapshots.

### KDS
KDS consumes the resolved order/Menu snapshot it needs for kitchen execution. KDS is not a Catalog/Menu master.

---

## 20. Delete vs Archive

UI and backend referential behavior must agree.

~~~
Referenced record
→ Archive / Nonaktif

Unreferenced record
→ destructive delete only if backend permits it
~~~

Examples:

~~~
Category referenced by Sub Category/Menu → Archive
Rasa referenced by Menu                → Archive
Item referenced by Menu/Inventory/history → Archive
Menu referenced by Branch/history      → lifecycle/deactivation
~~~

Never show a destructive Delete button for a record Core will predictably reject because of a foreign key.

Archive must not silently rebind data to another unrelated record.

---

## 21. Legacy compatibility boundary

Legacy structures may remain physically during migration:

~~~
products
products.category_id
products.price
products.regular_price

menus.menu_type
menus.package_name
menus.level_id
menus.title_id
menu_titles
menu_levels

product_flavors
product_complements
product_levels

branch_products
legacy Product adoption/override routes
legacy Product-centric Customer catalog routes
~~~

These structures are not permission to reintroduce:

~~~
SINGLE/PACKAGE
Package Name
Master Level as Pedas authority
free-text Menu Title
Product as commercial Menu identity
Product price as canonical Menu price
Product image as automatic Menu image
Kelengkapan as a new standalone forward master
~~~

Compatibility storage may remain nullable.

---

## 22. Forward schema semantics

The forward semantic model is:

~~~
Category
  └── Sub Category

Rasa

Item
  └── optional SKU

Menu
  ├── Sub Category
  ├── optional Rasa
  ├── spice_enabled
  ├── optional spice_level
  ├── selling_price
  ├── Menu media
  └── menu_items[]
        ├── Item reference
        └── quantity

Branch Menu
  ├── branch
  ├── Menu
  └── branch operational state

Branch Menu Category
  ├── branch
  ├── Menu
  └── Branch Category

Inventory
  ├── branch
  ├── Item
  └── stock/movements
~~~

The exact physical table/column names may remain legacy during migration.

---

## 23. Current SQLite forward boundary

The schema direction is:

~~~
menus.menu_type
  → nullable compatibility storage

menus.package_name
  → nullable compatibility storage

menus.level_id
  → nullable compatibility storage

spice_enabled + spice_level
  → forward Pedas authority

Menu identity uniqueness
  → Brand + Sub Category + optional Rasa, NULL-safe
~~~

If existing legacy data prevents a forward uniqueness constraint, report/review the conflict. Do not arbitrarily rewrite data just to make an index pass.

---

## 24. Migration principles

Migration is:

~~~
Expand
  ↓
Reconcile
  ↓
Switch forward consumers
  ↓
Verify
  ↓
Quarantine/retire legacy
~~~

Rules:

1. Preserve existing data.
2. Never invent ambiguous identity.
3. Never silently merge Menus.
4. Never rewrite historical customer-facing data.
5. Never infer a Menu subtype from legacy fields.
6. Ambiguous legacy rows become review cases.
7. Destructive cleanup happens only after consumer audit and verification.
8. Startup/migration is idempotent.
9. Compatibility storage does not become business authority.

---

## 25. Required consumer audit

At minimum audit:

~~~
Owner Master Menu UI
Owner Master Category UI
Merchant Branch Menu UI
Customer PWA
POS
Checkout
Orders
Payment descriptions
Receipt
KDS
Promotion
Reporting
Search
Inventory
~~~

A consumer is migrated only when it uses the forward Menu/Item boundaries and no longer relies on legacy Menu/Product semantics as its forward authority.

---

## 26. Test contract

Tests must assert:

### Catalog
- exactly Master Menu + Master Category at Catalog top level;
- Master Category contains Category, Rasa, Item;
- Sub Category is inside Category;
- no Catalog Judul node/tab;
- no Catalog Menu Cabang.

### Menu identity
- title defaults to Sub Category;
- Rasa is optional;
- Original is hidden as subtitle;
- duplicate identity is rejected;
- no free-text Menu title is required.

### Composition
- 1..N Items is valid;
- one Item is valid;
- quantity must be positive;
- repeated Item uses quantity;
- no SINGLE/PACKAGE forward subtype;
- no package_name invariant.

### Media
- Menu has independent media;
- first Item media is not the Menu media authority.

### Pedas
- default disabled;
- scale hidden/disabled until enabled;
- horizontal four-position scale;
- no dropdown;
- disabled means spice_level is non-authoritative/NULL.

### Inventory
- SKU determines stockability;
- SKU Items are discoverable by Stock;
- Menu editing never fabricates quantity;
- sale consumes required Item/SKU stock atomically.

### Customer
- Customer receives resolved Menu presentation only;
- Item/SKU/internal composition details stay server-side;
- search uses Title/Rasa.

### Lifecycle
- referenced data uses Archive/Nonaktif;
- impossible FK-delete actions are not presented by UI.

---

## 27. Definition of Done

The forward model is complete only when:

- Catalog IA exactly matches the two-area structure;
- Master Category exactly contains Category, Rasa and Item;
- Sub Category is inside Category;
- Master Menu is the forward commercial editor;
- Menu identity is Category + Sub Category + optional Rasa;
- default Customer title is Sub Category;
- Original Rasa is hidden as subtitle;
- Menu owns its own media;
- Menu supports one or more Items with quantity;
- no forward SINGLE/PACKAGE subtype exists;
- no package_name business rule exists;
- SKU presence determines Item stockability;
- Inventory owns stock quantity;
- Pedas uses checkbox + horizontal scale;
- Master Level is not a forward Pedas dependency;
- Menu Cabang is outside Catalog;
- Branch cannot change Master composition;
- Customer PWA does not receive internal Item/SKU/composition details;
- orders preserve immutable Menu state;
- Delete/Archive behavior matches FK/lifecycle rules;
- legacy consumers are migrated or explicitly quarantined;
- full tests and runtime verification pass before completion is claimed.

---

## 28. Explicit prohibitions

~~~
❌ Catalog > Menu Cabang
❌ Catalog > Produk Master as separate commercial Menu authority
❌ Master Category > Judul
❌ free-text Nama Menu replacing Sub Category
❌ Menu Type = SINGLE/PACKAGE
❌ package_name as canonical Menu identity
❌ Master Level as Pedas authority
❌ Pedas dropdown
❌ invented Pedas business meanings
❌ Menu image defined as first Item image
❌ Product/Item price as canonical Menu price
❌ Item SKU/stock data exposed to Customer PWA
❌ Item quantity exposed as Customer Menu presentation
❌ Branch editing Master Menu composition
❌ Menu save directly mutating Inventory
❌ UI Delete where FK guarantees rejection
❌ two competing forward authorities for the same Menu
~~~

---

## 29. Source-of-truth rule

When implementation conflicts:

~~~
this contract
    ↓
forward business model

legacy code/schema/test
    ↓
compatibility / migration input
~~~

A contradiction is resolved by reconciling implementation to this contract, not by adding an ad-hoc concept.

Changes to Menu identity, Category/Sub Category/Rasa semantics, Item/Menu ownership, composition cardinality, price ownership, media ownership, Pedas behavior, Branch authority, Customer exposure, or Inventory ownership require a new contract revision.

---

**LOCKED — New Xentra Catalog / Master Menu / Master Category forward contract v2.**
