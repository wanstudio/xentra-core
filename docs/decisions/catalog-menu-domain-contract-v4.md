
# Xentra — Catalog, Master Menu & Master Category Contract v4

**Status:** PROPOSED — RECONSTRUCTED FROM CONFIRMED CORE CONTRACT  
**Decision date:** 2026-10-05  
**Scope:** Catalog IA, Master Menu, Master Category, Category, Judul, Rasa, Product, Menu Items, pricing, media, inventory/composition boundaries

> This is a new contract. It is reconstructed from the confirmed core contract supplied in the conversation. It does not modify the previous v2/v3 contract files.

---

## 1. Canonical Catalog Information Architecture

The Catalog structure is exactly:

~~~text
Catalog
├── Master Menu
└── Master Category
    ├── Category
    ├── Judul
    ├── Rasa
    └── Item
~~~

There are exactly two top-level Catalog areas:

- Master Menu
- Master Category

Master Category contains exactly four areas:

- Category
- Judul
- Rasa
- Item

No additional top-level Catalog area is implied by this contract.

---

## 2. Core Domain Model

The core Menu relationship is:

~~~text
CATEGORY
  └── MENU
       ├── Judul        required
       ├── Rasa         nullable
       ├── Harga
       ├── Media
       └── Menu Items
            ├── Product × qty
            ├── Product × qty
            └── Product × qty
~~~

This is the canonical forward model.

### 2.1 Category

Category is required.

Its responsibility is the primary grouping/classification of Menus.

A Menu cannot exist in the forward model without a Category.

### 2.2 Judul

Judul is required on Menu.

Judul is a standalone Master Judul record under Master Category.

Judul is the Menu's base/customer-facing name.

A Menu must reference a Judul.

Judul is **not a child of Category** and Category does not own Judul.

There is no `category_id` ownership relation on Judul.

The former Sub Category concept is replaced by Judul; do not recreate a separate Sub Category entity.

### 2.3 Rasa

Rasa is optional.

A Menu may have a Rasa or NULL.

Rasa is an additional descriptor only. Rasa presence or absence does not create a Menu subtype.

### 2.4 Menu

Menu is one sellable commercial entity.

Each Menu has its own stable Menu ID.

Example:

~~~text
MENU-001
~~~

Menu owns:

- required Category
- required Judul
- optional Rasa
- Harga
- Media
- Menu Items
- lifecycle/status

---

## 3. Menu Identity

The forward contract does NOT define Menu identity as a composite formula such as:

~~~text
Category + Judul + Rasa
~~~

or:

~~~text
Category + Rasa
~~~

The Menu is its own entity with a stable Menu ID.

Category, Judul, and Rasa are attributes/relationships of that Menu:

~~~text
Menu
├── Category  required
├── Judul     required
└── Rasa      nullable
~~~

Do not introduce a uniqueness rule based on concatenating Category, Judul, and Rasa unless a separate business decision explicitly requires it.

---

## 4. No SINGLE / PACKAGE Menu Type

There is exactly one forward Menu entity.

Do not create a forward Menu type named:

~~~text
SINGLE
PACKAGE
SINGLE_MENU
PACKAGE_MENU
MENU_TYPE
~~~

The number of Products in Menu Items does not determine Menu type.

~~~text
1 Product  → Menu
5 Products → Menu
20 Products → Menu
~~~

All remain the same Menu entity.

---

## 5. “Paket” Is Not a Menu Domain Type

The word Paket may appear inside a Menu Judul.

Canonical example:

~~~text
Judul
Paket Hemat Ayam Tulang Lunak Sambal Ijo + Es Teh
~~~

This remains an ordinary Menu.

It does not create a Package Menu entity and does not create a PACKAGE Menu Type.

Bundling, discount, and promotional rules belong to the Promo domain.

Promo is separate from Menu.

~~~text
Menu
→ sellable entity

Promo
→ bundling / discount / promotional rules
~~~

---

## 6. Product

Product is the unit referenced by Menu Items.

A Product may have:

~~~text
SKU
or
no SKU
~~~

Product participates in Menu composition and inventory.

A Product is referenced by Menu through Menu Items.

~~~text
Menu
→ what Customer buys

Product
→ composition / inventory unit
~~~

---

## 7. Menu Items

Menu Items define:

~~~text
Menu
  ↓
Menu Items
  ↓
Product + quantity
~~~

Each Menu Item represents a Product reference and quantity.

Example:

~~~text
MENU-001

Menu Items
├── Ayam Tulang Lunak × 1
├── Nasi              × 1
├── Lalapan           × 1
├── Sambal Ijo        × 1
└── Es Teh Manis      × 1
~~~

### 7.1 Quantity

Quantity belongs to the Menu → Product relationship.

Repeated Products are represented by quantity.

~~~text
Product A × 2
~~~

is still ordinary Menu composition.

The number of Products does not create a Menu type.

---

## 8. Final Canonical Example

The confirmed example is:

~~~text
Category
  Ayam

Judul
  Paket Hemat Ayam Tulang Lunak Sambal Ijo + Es Teh

Rasa
  NULL

        ↓

MENU-001

        ↓

Menu Items
  Ayam Tulang Lunak × 1
  Nasi              × 1
  Lalapan           × 1
  Sambal Ijo        × 1
  Es Teh Manis      × 1
~~~

This is one normal Menu.

There is no Package entity.

There is no Menu Type.

There is no identity formula Category + Judul + Rasa.

---

## 9. Menu Price

Harga belongs to Menu.

~~~text
Menu
└── Harga
~~~

Customer-facing selling price is the Menu price.

Product composition does not define the Menu's commercial price.

---

## 10. Menu Media

Media belongs to Menu.

~~~text
Menu
└── Media
~~~

Menu media is independent from Product media.

It is not defined as the first Product image and Product image is not an automatic substitute for Menu media authority.

New image upload continues to use the canonical Xentra Media Engine.

---

## 11. Inventory Boundary

Product is the unit that participates in inventory/composition.

If a Product has a SKU, it is stock-managed.

If a Product has no SKU, it is non-SKU.

Example:

~~~text
Ayam      → non-SKU
Nasi      → SKU NASI-001
Lalapan   → non-SKU
Es Teh    → SKU ES-TEH-001
~~~

A Menu may contain both SKU and non-SKU Products.

When a Menu is sold:

~~~text
Menu quantity × Menu Item quantity
→ consume required SKU-managed Product stock
~~~

Non-SKU Products do not require fabricated stock quantities merely because they participate in a Menu.

Inventory quantity remains an Inventory concern.

Menu editing must not directly invent or mutate stock quantity.

---

## 12. Master Category Areas

Master Category contains four peer areas:

~~~text
Master Category
├── Category
├── Judul
├── Rasa
└── Item
~~~

### 12.1 Category

Category master data used for primary Menu grouping.

### 12.2 Judul

Judul is independent Master data used as the required Menu base/customer-facing name.

Judul is not a child of Category.

Category is only contextual when selecting Judul in the Menu editor:

```text
Category
→ context for filtering / ordering available Judul choices
→ not owner of Judul
```

The **+ Judul** action creates a Master Judul.

It does not create a child of the selected Category.

A Judul record does not require a `category_id` field.

### 12.3 Rasa

Reusable optional Rasa master data.

### 12.4 Item

Item is a Catalog UI area under Master Category.

The Menu composition contract remains explicitly:

~~~text
Menu Items
└── Product + quantity
~~~

Do not create a second commercial identity merely because the Catalog UI area is named Item.

---

## 13. Master Menu Editor

The Owner Master Menu editor represents one Menu.

Fields/concepts:

~~~text
Category  → required
Judul     → required
Rasa      → optional / NULL
Harga     → Menu selling price
Media     → Menu media
Menu Items
Status
~~~

The editor must not require:

~~~text
Menu Type
SINGLE / PACKAGE selector
Package Name as structural type
Product count as Menu type
~~~

Judul is the required Menu name.

The Judul selector may use the current Category as deterministic UI context to filter/order choices, but that context must not become a stored Judul → Category ownership relation.

---

## 14. Customer Presentation

Customer sees the Menu as the commercial entity.

At minimum:

~~~text
Category
Judul
Rasa (when present)
Harga
Media
availability
~~~

Customer-facing Menu identity is Judul.

Do not generate Customer Menu identity from Category + Rasa or Category + Judul + Rasa.

Menu Items remain internal composition/inventory relationships.

Customer does not need internal Product/SKU composition to identify the Menu.

---

## 15. Menu vs Product Boundary

The mandatory distinction is:

~~~text
Menu
→ what Customer buys

Product
→ composition / inventory unit

Menu Item
→ Menu → Product + quantity
~~~

One Product may participate in multiple Menus.

One Menu may contain one or many Products.

Multiple Products do not create a Package Menu type.

---

## 16. Lifecycle / Referential Integrity

For master data that is already referenced:

~~~text
Referenced
→ Archive / Nonaktif
~~~

The UI must not expose destructive Delete where the database relationship makes the operation predictably invalid.

Archive preserves the existing reference.

---

## 17. Legacy Boundary

Legacy implementation may still contain concepts such as:

~~~text
Sub Category
menu_type
SINGLE
PACKAGE
package_name
legacy Product-centric Menu logic
~~~

Forward rules are:

~~~text
Sub Category
→ replaced by Judul

SINGLE / PACKAGE
→ not a forward Menu type

package_name
→ not structural Menu semantics

Product
→ composition / inventory unit

Menu
→ commercial sellable entity
~~~

Legacy physical fields may remain during migration, but they are not permission to restore obsolete forward semantics.

---

## 18. Migration Rules

Migration must:

1. preserve valid existing data;
2. avoid silently merging distinct Menus;
3. avoid deriving a Menu type from legacy menu_type;
4. avoid deriving Menu identity from Product IDs;
5. map the former Sub Category concept to Judul only as an explicit data migration;
6. preserve historical order evidence;
7. keep legacy compatibility fields non-authoritative;
8. be idempotent.

Ambiguous legacy mappings must become explicit review cases.

---

## 19. Required Test Contract

### Catalog IA

Assert:

- Catalog has exactly Master Menu and Master Category at the top level;
- Master Category contains Category, Judul, Rasa, Item;
- no extra top-level Catalog node is introduced.

### Menu Core

Assert:

- Category is required;
- Judul is required;
- Rasa is nullable;
- Menu is one commercial entity;
- Menu has stable Menu ID;
- no Menu Type is required;
- no SINGLE/PACKAGE semantics exist;
- Product count does not determine Menu type.

### Menu Items

Assert:

- Menu Items reference Product;
- quantity is part of the relationship;
- one Product is valid;
- many Products are valid;
- repeated Product uses quantity.

### Pricing

Assert:

- selling price belongs to Menu.

### Media

Assert:

- media belongs to Menu;
- first Product image is not the Menu media authority.

### Inventory

Assert:

- Product can be SKU or non-SKU;
- SKU Product is stock-managed;
- non-SKU Product does not require fabricated stock;
- Menu composition resolves required SKU consumption.

### Promo

Assert:

- Promo is separate from Menu;
- Paket in Judul does not create a Package Menu type.

### Lifecycle

Assert:

- referenced masters use Archive/Nonaktif behavior;
- impossible FK-delete actions are not exposed.

---

## 20. Explicit Prohibitions

~~~text
❌ Menu identity = Category + Judul + Rasa
❌ Menu identity = Category + Rasa
❌ Sub Category as a separate forward concept
❌ Judul as a child/owner-owned child of Category
❌ Judul.category_id as a required ownership relation
❌ SINGLE Menu type
❌ PACKAGE Menu type
❌ Menu Type selector
❌ Package Name as structural Menu semantics
❌ Product count determining Menu type
❌ “Paket” becoming a separate Menu domain entity
❌ Product becoming the customer-facing commercial Menu identity
❌ Menu media being defined as the first Product image
❌ Menu editor directly inventing Inventory stock
❌ Promo bundling being implemented as a Menu subtype
❌ legacy fields silently becoming forward authority
~~~

---

## 21. Governance

Before changing Catalog/Menu code, implementation must identify:

~~~text
Category
Judul
Rasa
Menu
Product
Menu Item
Promo
Inventory
~~~

and verify that the requested behavior is explicitly covered.

When it is not covered:

~~~text
STOP
→ report the gap
→ do not invent a replacement business rule
~~~

---

## 22. Status

**v4 = reconstructed contract from the confirmed core model.**

This revision explicitly locks the following clarified points:
- Judul is independent Master data, not a Category child.
- Category is only contextual for deterministic Judul selection/filtering/ordering.
- + Judul creates a Master Judul, not a Category child.
- Judul does not require `category_id`.
- Pedas is an optional Menu attribute controlled by a checkbox and a horizontal 0..4 five-position scale.
- Pedas is not a dropdown and does not use a Master Level catalog.

The canonical core is:

~~~text
CATEGORY
  └── MENU
       ├── Judul        required
       ├── Rasa         nullable
       ├── Harga
       ├── Media
       └── Menu Items
            ├── Product × qty
            ├── Product × qty
            └── Product × qty
~~~

Critical rules:

- Menu is one sellable entity.
- Category is required.
- Judul is required.
- Rasa is nullable.
- Product is the composition/inventory unit.
- Menu Items connect Menu to Product with quantity.
- Product count does not determine Menu type.
- Paket is not a Menu domain type.
- Promo owns bundling/discount/promotional rules.
- There is no canonical composite identity formula Category + Judul + Rasa.

