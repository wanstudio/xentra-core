# Xentra — Catalog, Master Menu & Master Category Contract v3

**Status:** PROPOSED — RECONCILIATION DRAFT  
**Decision date:** 2026-10-05  
**Scope:** Catalog, Master Menu, Master Category, Category, Judul, Rasa, Item/SKU, Branch adoption, Customer Menu resolution, Inventory boundary, migration

> This document is a **new contract**, created from the latest confirmed decisions in the Xentra conversation. It does not edit or reinterpret the previous contract.
>
> **Important:** `catalog-menu-domain-contract-v2.md` is historical/invalid for forward implementation because it omitted **Judul** from Master Category. This v3 document restores the confirmed structure.

---

## 1. Canonical Catalog information architecture

The Catalog top-level structure is exactly:

```text
Catalog
├── Master Menu
└── Master Category
    ├── Category
    ├── Judul
    ├── Rasa
    └── Item
```

This is the canonical forward structure for the Owner Catalog.

### 1.1 Master Menu

`Master Menu` is a top-level Catalog area.

Its responsibility is to create and maintain the brand's sellable Menu definitions.

### 1.2 Master Category

`Master Category` is a top-level Catalog area containing exactly four master areas:

```text
Category
Judul
Rasa
Item
```

These are peers under Master Category in the Catalog IA.


### 1.3 No additional Catalog top-level area

The following must not be introduced as additional forward Catalog areas:

```text
Produk Master
Menu Cabang
Bundle / Composite as a separate top-level menu
Kelengkapan as a separate top-level Catalog area
Master Level as a separate top-level Catalog area
```

Legacy screens, routes, controllers, tables, or compatibility code may still contain old terminology during migration. They do not define the forward IA.

---

## 2. Source-of-truth rule

The forward contract hierarchy is:

```text
Explicit business decision
        ↓
This domain contract
        ↓
API / data contract
        ↓
Implementation
        ↓
UI presentation
```

Existing code, stale tests, old documentation, and legacy database names must not silently redefine this contract.

When a current implementation conflicts with this contract:

1. identify the implementation as legacy or current;
2. preserve data unless a migration decision explicitly requires transformation;
3. reconcile the implementation to the forward contract;
4. do not invent a new synonym to avoid the conflict.

---

## 3. Canonical terminology

### 3.1 Menu

`Menu` is the forward commercial/sellable entity.

A Menu has its own identity and customer-facing commercial attributes.

### 3.2 Item

`Item` is the forward UI/business term for the atomic reusable component that can participate in Menu composition and, when SKU-managed, inventory.

Legacy physical storage may still use `products` or `product_id`. That physical naming does not make Product the forward commercial Menu identity.

### 3.3 SKU

SKU is attached to an Item when that Item is stock-managed.

Canonical stockability rule:

```text
SKU exists → Item is stock-managed
SKU NULL   → Item is non-stock
```

The existence of a SKU does **not** invent an initial stock quantity.

### 3.4 Master Category

Master Category is the Owner/Brand catalog master workspace containing:

- Category;
- Judul;
- Rasa;
- Item.

### 3.5 Branch Menu

Branch Menu is the branch operational/adoption layer for a Master Menu.

It is not a separate master identity and it is not another Master Category area.

---

## 4. Category

### 4.1 Category

Category is brand-owned master classification.

### 4.2 Category deletion

Referential integrity is part of the domain contract.

Where a Category is referenced, the normal forward lifecycle is:

```text
Referenced
→ Archive / Nonaktif
```

The UI must not expose a destructive Delete action that the backend is guaranteed to reject through a foreign-key constraint.

---

## 5. Judul

**Judul is a first-class Master Category area in the forward Catalog IA.**

It is explicitly present here:

```text
Master Category
├── Category
├── Judul
├── Rasa
└── Item
```

### 5.1 What is locked

The following is locked by this contract:

- Judul exists as a first-class Master Category area.
- Judul is the forward replacement for the former Sub Category concept.
- Judul must not be removed from the forward Catalog IA.
- Implementation must not recreate a separate Sub Category concept alongside Judul.

### 5.2 Judul role

Judul replaces the former Sub Category concept in the forward model.

Therefore:

```text
Category
Judul
```

Category and Judul are peer master areas under Master Category. Judul is a first-class master reference used by Menu identity.

An implementation worker must not introduce a separate Sub Category entity or field beside Judul.

---

## 6. Rasa

Rasa is a reusable Brand-scoped master area under Master Category.

Rules:

1. Rasa is managed by Owner/Brand.
2. One Rasa may be reused by multiple Menus.
3. Rasa is separate from Category and Item.
4. Rasa is not a Menu subtype.
5. Customer presentation of Rasa must follow the separately confirmed Menu presentation mapping when that mapping is implemented.
6. Do not introduce a second free-text Rasa authority inside Menu if a Master Rasa reference is already used.

### 6.1 Original

Where `Original` is used as the baseline Rasa presentation, existing confirmed presentation behavior remains:

```text
Rasa = Original
→ no Rasa subtitle presentation

Rasa = another value
→ Rasa may be presented as subtitle
```

This rule must not be implemented by duplicating Rasa into free-text Menu data.

---

## 7. Menu identity

The established Menu identity is:

```text
Category + Judul + Rasa
```

Operationally, storage may use:

```text
Category reference
+
Judul reference
+
optional Rasa reference
```

### 7.1 Identity invariants

1. The same active identity must not create duplicate active Master Menus for the same Brand.
2. Duplicate creation must be rejected explicitly.
3. Duplicate creation must not silently overwrite another Menu.
4. Rasa may be optional where the forward model permits a Menu without Rasa.
5. Do not create a second Menu identity based on legacy Product IDs.


---

## 8. Master Menu

Master Menu is Owner/Brand-owned.

A Master Menu contains, at minimum, the forward concepts required for:

```text
Menu identity
Menu composition
Selling price
Menu media
Pedas configuration
Lifecycle/status
```

### 8.1 Menu composition

A Menu consists of one or more Items:

```text
Menu
├── Item A × 1
├── Item B × 1
└── Item C × 2
```

Rules:

1. Cardinality is 1..N.
2. One Item is valid.
3. Multiple Items are valid.
4. An Item may be repeated by using quantity > 1.
5. Quantity must be a positive integer.
6. Composition references Items, not free-form Product text.
7. Composition is owned by the Master Menu.
8. Branch cannot modify Master Menu composition.
9. Composition persistence must be atomic.
10. Menu composition does not itself mutate inventory quantity.

### 8.2 No forward Menu subtype

The forward Menu model does not require:

```text
SINGLE
PACKAGE
MENU_TYPE
package_name
```

as business semantics.

A Menu with multiple Items is simply a Menu with multiple composition rows.

Legacy fields may remain in physical storage temporarily for compatibility, but forward services must not depend on them as authoritative Menu semantics.

---

## 9. Menu media

Menu owns its own media.

The Master Menu editor must have a real Menu media boundary.

Canonical distinction:

```text
Menu media
≠ Item media
≠ legacy Product image fallback
```

An Item may have media for Item/master-data purposes.

That does not make the Item's first image the canonical Menu image.

### 9.1 Customer Menu media

Customer Menu resolution uses the Menu's own media.

A missing Menu image must not silently redefine the Menu media authority as an Item image merely to make the UI appear populated.

### 9.2 Media engine

All new image uploads continue to use the canonical Xentra Media Engine and its existing compression/cropping boundary.

---

## 10. Selling price

Selling price belongs to Menu.

```text
Item / SKU
→ identity / inventory

Menu
→ selling price
```

Therefore:

- one Item can participate in multiple Menus;
- different Menus may have different selling prices;
- creating an Item/SKU does not create a Menu price;
- Item/Product price is not the canonical Customer Menu selling price.

Any branch pricing override must follow its own explicit Branch Menu/pricing contract and must not create a second unrelated price authority.

---

## 11. Pedas

Pedas is a Menu-level configuration.

Owner UI:

```text
☐ Level Pedas
```

Default:

```text
unchecked
```

### 11.1 Disabled

When unchecked:

```text
spice_enabled = false
spice_level = NULL
scale hidden/disabled
no active Pedas indicator
```

### 11.2 Enabled

When checked:

```text
spice_enabled = true
four-position horizontal scale active
```

The control is a horizontal selector/scale, not a dropdown.

Do not invent business labels such as:

```text
Level 1 = tidak pedas
Level 2 = ...
```

unless those semantics are separately decided.

### 11.3 Master Level

There is no forward requirement for a separate Master Level catalog to own Pedas semantics.

Existing `level_id`, `menu_levels`, or similar legacy structures may remain as migration compatibility only.

---

## 12. Item master

Master Category → Item is the Owner surface for atomic reusable Items.

An Item may have:

```text
stable ID
name
optional SKU
description / internal metadata
media
lifecycle/status
```

An Item does not own:

```text
Menu identity
Menu selling price
Menu Pedas configuration
Branch availability
Menu composition as a commercial entity
```

### 12.1 SKU and Stock discovery

When an Item becomes SKU-managed:

```text
Item gets SKU
→ Item is stock-managed
→ Item becomes eligible for Stock / Inventory management
```

The Stock domain must not require a second manually-created "stock product" master for the same SKU Item.

Stock quantity is still entered/managed in the Inventory domain.

---

## 13. Inventory boundary

Inventory owns physical stock quantity.

```text
SKU Item
→ Branch Inventory
→ stock quantity / movement ledger
```

Example:

```text
Ayam      → SKU NULL
Nasi      → SKU NASI-001
Lalapan   → SKU NULL
```

A composed Menu may be:

```text
Ayam + Nasi + Lalapan
```

When sold:

```text
Menu quantity × Item composition quantity
→ consume only SKU-managed Items
```

Therefore:

- non-SKU Items do not create stock deduction;
- SKU Items do create stock deduction;
- Menu editing never fabricates stock quantity;
- inventory mutation belongs to the Inventory boundary;
- sale deduction must be atomic;
- inventory history remains auditable.

---

## 14. Owner Master Menu editor

The Owner Master Menu editor must be Menu-first.

The editor represents the commercial Menu being created, rather than a Product editor with hidden Menu fields.

The confirmed forward editor concepts are:

```text
Category
Judul
Rasa
Pedas configuration
Item composition
Selling price
Menu media
Status
```

Judul is a Master Category area and is the Menu title/identity reference.

### 14.1 Composition editor

The composition section must support:

```text
+ Tambah Item

Item A × quantity
Item B × quantity
Item C × quantity
```

Selecting an Item must use the Master Item authority.

The UI must not require Product-specific legacy identifiers as a substitute for Item semantics.

### 14.2 No legacy Menu builder

Do not expose forward controls for:

```text
Menu Type = SINGLE / PACKAGE
Package Name
Master Level selector
Kelengkapan builder
Product as commercial Menu identity
```

unless a later explicit contract reintroduces them.

---

## 15. Master Category UI

The Owner Master Category IA is:

```text
Master Category

[ Category ]
[ Judul ]
[ Rasa ]
[ Item ]
```

Category, Judul, Rasa, and Item are four peer master areas under Master Category.

The UI must not collapse these into one generic "Product" editor.

---

## 16. Branch adoption

The forward flow is:

```text
Owner
  ↓
Master Menu
  ↓
Branch adopts/selects Menu
  ↓
Branch Menu operational state
```

Branch adoption is separate from Master Menu identity.

Branch may operate the adopted Menu within the authority granted to the Branch surface, including applicable Branch Category membership and availability/sold-out controls.

Branch must not:

- mutate Master Menu composition;
- mutate Master Category;
- mutate Master Rasa;
- mutate Master Item/SKU identity;
- create an independent commercial Menu identity merely by changing branch presentation.

### 16.1 Menu Cabang

`Menu Cabang` is an operational concept, not a new top-level Catalog IA node.

---

## 17. Branch Category

Branch Category is branch-local merchandising/grouping.

```text
Master Category
→ brand-wide master taxonomy

Branch Category
→ branch-local grouping
```

Branch Category does not change Master Menu identity.

Where the Branch contract supports M:N membership:

```text
Branch Menu / adopted assortment
↔ Branch Category
```

remains branch-local classification rather than Master Category mutation.

---

## 18. Customer PWA boundary

Customer PWA must consume a resolved Customer Menu View Model.

Conceptually:

```text
menu_id
category
title
subtitle
media
selling_price
pedas
availability
```

The Customer surface must not reconstruct Menu semantics from legacy Product rows.

### 18.1 Customer presentation

Where the established presentation mapping is used:

```text
Category     → grouping context
Title        → Judul.name
Subtitle     → Rasa presentation where applicable
Media        → Menu media
Price        → Menu selling price
Pedas        → Menu Pedas configuration
Availability → Branch operational resolution
```

Customer title is resolved from the Master Judul reference. Do not fall back to a legacy Product name as the forward Menu title authority.

### 18.2 Internal composition is not Customer presentation

Customer responses must not expose internal inventory/master details such as:

```text
Item ID
SKU
stock-management flag
composition quantity
raw Product ID
legacy menu_type
legacy package_name
legacy level_id
migration metadata
```

The server may use Item composition internally to resolve stock and fulfillment.

---

## 19. Search boundary

Customer search operates on the resolved Customer Menu representation.

At minimum, search should use the customer-facing Menu identity/presentation fields that are explicitly defined by the Menu contract.

Do not turn these internal fields into Customer search vocabulary merely because they are present in the database:

```text
SKU
Item internal ID
raw Product ID
inventory movement data
migration columns
```

Search behavior such as live-update while typing remains a UI implementation concern and must not change the underlying business identity.

---

## 20. Checkout, Order and POS boundary

The commercial transaction identity is Menu-based.

Canonical flow:

```text
Cart Menu
  ↓
re-resolve current Menu
  ↓
validate Branch/Menu availability
  ↓
resolve Item composition
  ↓
validate required SKU stock
  ↓
create immutable order/sale snapshot
```

Historical transaction data must remain stable after later edits to Menu, Item, Category, Rasa, or other master data.

The transaction snapshot should preserve enough Menu/composition evidence to reconstruct what was sold without depending on a later mutable master record.

POS sells Menu identity.

Inventory consumes Item/SKU identity.

These are different boundaries.

---

## 21. Promotion boundary

Promotion eligibility that targets a sellable commercial object must use the Menu identity where the promotion is Menu-scoped.

Do not infer a commercial Menu from an Item/Product ID when one Item can participate in multiple Menus.

---

## 22. Delete vs Archive

UI lifecycle must agree with database referential integrity.

Canonical behavior:

```text
Referenced master
→ Archive / Nonaktif

Unreferenced master
→ destructive delete only when explicitly permitted
```

Examples:

```text
Category referenced by Menu
→ Archive

Rasa referenced by Menu
→ Archive

Item referenced by Menu/Inventory/history
→ Archive

Menu referenced by Branch/order/history
→ lifecycle / deactivation according to the owning contract
```

A UI must not advertise Delete when Core will predictably reject the operation because of a foreign-key constraint.

---

## 23. Legacy compatibility boundary

The physical database may continue to contain older structures while migration is staged, including examples such as:

```text
products
product/category legacy relations
menus.menu_type
menus.package_name
menus.level_id
menu_titles
menu_levels
product_flavors
product_complements
product_levels
branch_products
legacy Product-centric endpoints
legacy Product-centric Customer resolver
```

These are compatibility/migration material.

They do not authorize the forward system to recreate:

```text
Product as commercial Menu identity
SINGLE/PACKAGE as required Menu subtype
package_name as canonical Menu identity
Master Level as the Pedas authority
Product price as canonical Menu price
Product image as automatic Menu media
legacy Product composition as the canonical Menu composition
```

Do not physically delete legacy columns only to make the new contract look clean. Remove/quarantine them after consumer audit and migration verification.

---

## 24. Migration strategy

Migration follows:

```text
Expand
  ↓
Reconcile
  ↓
Migrate consumers
  ↓
Verify
  ↓
Quarantine / retire legacy
```

Rules:

1. Preserve existing valid data.
2. Do not silently merge ambiguous identities.
3. Do not silently fabricate additional Judul behavior outside this contract.
4. Do not infer new Menu subtype semantics from old `menu_type`.
5. Preserve historical order evidence.
6. Treat ambiguous legacy rows as review cases.
7. Make migration idempotent.
8. Never let compatibility fields become forward business authority.

---

## 25. Required consumer audit

The following consumers must be audited before the new Menu model is considered fully migrated:

```text
Owner Master Menu UI
Owner Master Category UI
Category UI
Judul UI
Rasa UI
Item UI
Merchant Branch Menu UI
Customer PWA
Customer search
Cart / Checkout
POS
Orders
Payment description
Receipt
Promotion
Inventory / Stock
Reporting
KDS integration boundary
```

A consumer is considered migrated only when its forward behavior follows the current Menu/Category/Judul/Rasa/Item boundaries and it does not depend on stale Product/SINGLE/PACKAGE semantics.

---

## 26. Test contract

### 26.1 Catalog IA

Tests must assert:

- Catalog has exactly two top-level areas: Master Menu and Master Category;
- Master Category has exactly four areas: Category, Judul, Rasa, Item;
- Judul replaces the former Sub Category concept and is a peer Master Category area;
- Judul is not removed from Master Category;
- Menu Cabang is not a top-level Catalog node;
- Product Master is not a competing forward commercial Menu surface.

### 26.2 Menu identity

Tests must assert:

- Menu identity follows Category + Judul + Rasa under the current contract;
- duplicate active identity is rejected;
- Menu identity is not based on legacy Product ID;
- Judul does not silently change the Menu identity until explicitly contracted.

### 26.3 Composition

Tests must assert:

- one Item composition is valid;
- multiple Item composition is valid;
- repeated Item uses quantity;
- quantity is positive;
- composition is atomic;
- no required SINGLE/PACKAGE forward subtype exists;
- package_name is not a forward invariant.

### 26.4 Media

Tests must assert:

- Menu has its own media boundary;
- Menu media is not defined as the first Item image;
- legacy Product image is not an automatic new authority.

### 26.5 Pedas

Tests must assert:

- default disabled;
- spice_level is NULL when disabled;
- four-position horizontal scale when enabled;
- no dropdown;
- no invented numeric business vocabulary.

### 26.6 Inventory

Tests must assert:

- SKU determines stockability;
- SKU Items are discoverable by Stock/Inventory;
- SKU assignment does not invent stock quantity;
- Menu editing never directly mutates stock;
- sale consumption deducts only SKU-managed Items;
- deduction is atomic.

### 26.7 Lifecycle

Tests must assert:

- referenced masters can be archived/nonactive;
- UI does not expose impossible FK-delete actions;
- archive does not silently rebind references to unrelated records.

---

## 27. Definition of Done

This contract is ready for explicit lock only when the following are reconciled against implementation:

- Catalog IA exactly matches:

```text
Catalog
├── Master Menu
└── Master Category
    ├── Category
    ├── Judul
    ├── Rasa
    └── Item
```

- Judul replaces the former Sub Category concept.
- Judul exists as a first-class Master Category area.
- Master Menu is a separate top-level Catalog area.
- Master Menu is the commercial Menu authority.
- Menu identity is Category + Judul + Rasa under the current confirmed model.
- A Menu can contain one or more Items.
- Item is the atomic reusable forward concept.
- SKU presence determines stockability.
- Inventory owns stock quantity.
- Menu owns selling price.
- Menu owns its own media.
- Pedas is a checkbox + four-position horizontal scale.
- No forward SINGLE/PACKAGE requirement exists.
- Branch adoption is separate from Master Menu identity.
- Customer PWA consumes resolved Menu data rather than reconstructing it from legacy Product rows.
- Transaction records preserve immutable historical evidence.
- Delete/Archive behavior matches referential integrity.
- Legacy fields remain compatibility-only until migration is verified.
- **Workers must not recreate a separate Sub Category concept beside Judul.**

---

## 28. Explicit prohibitions

The following are prohibited unless superseded by a newer explicit business decision:

```text
❌ Removing Judul from Master Category
❌ Treating Judul as legacy-only
❌ Inventing additional Judul behavior not covered by a decision
❌ Adding Product Master as a competing forward commercial Menu authority
❌ Adding Menu Cabang as a top-level Catalog node
❌ Making SINGLE/PACKAGE a required forward Menu subtype
❌ Making package_name the canonical Menu identity
❌ Making Master Level the Pedas authority
❌ Replacing Menu media with the first Item image as an authority
❌ Using Product/Item price as canonical Menu selling price
❌ Exposing Item/SKU/composition internals in Customer presentation
❌ Letting Branch mutate Master Menu composition
❌ Letting Menu editor mutate Inventory stock quantity
❌ Showing destructive Delete for references guaranteed to fail FK validation
❌ Silently resolving a business gap with a new synonym or legacy fallback
```

---

## 29. Open Contract Gaps

The following are implementation details, not alternate business semantics:

1. Exact physical table/column names for Judul.
2. Exact API request/response shape for Judul.
3. UI interaction details that do not change the locked business meaning.

These details must follow the business model in this contract and must not create a separate Sub Category concept.

---

## 30. Governance

Before any worker changes Catalog/Menu code, the worker must verify:

```text
What concept is being changed?
What is its scope?
Who owns it?
What is the authoritative data source?
Is the concept Master or Branch?
Is the code legacy or forward?
Does the change alter Menu identity?
Does the change alter Item/SKU inventory semantics?
Does the change alter Customer presentation?
Does the change alter Category ↔ Judul ↔ Rasa Menu identity?
Is there an existing contract that already answers the question?
```

When the answer is not covered:

```text
STOP
→ report the Open Contract Gap
→ do not invent business semantics
```

---

## 31. Status and supersession

**v3 is the new reconciliation draft.**

**Critical correction in v3:** the former `Sub Category` concept is replaced by `Judul`; `Judul` is not an extra field alongside Sub Category.

It supersedes the previous `catalog-menu-domain-contract-v2.md` for forward Catalog/Menu work because v2 omitted the confirmed `Judul` area.

It does **not** silently rewrite unrelated Xentra contracts.

Once explicitly approved, this file becomes the Catalog/Menu implementation source of truth and affected Notion/Git documents must be reconciled to it.

