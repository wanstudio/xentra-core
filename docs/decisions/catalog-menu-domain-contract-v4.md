
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
- Modal
- Media
- Menu Items
- lifecycle/status

---

## 3. Menu Creation and Menu ID

There is only one forward Menu entity.

The Owner creates a Menu by filling the Menu fields and Menu Items:

~~~text
Category  → required
Judul     → required
Rasa      → optional / NULL
Harga
Modal
Media
Menu Items → Product × quantity
~~~

When the Menu is saved, Core creates/persists its own Menu ID (id_menu).

Example:

~~~text
Create Menu
    ↓
save
    ↓
MENU-001
~~~

id_menu identifies the created Menu entity.

Category, Judul, and Rasa are data attached to the Menu. This contract does not define a composite Menu ID generated from taxonomy values.

Do not introduce a separate identity for Menu Satuan, Menu Paket, or any other Menu subtype.

---

## 4. No Menu Satuan / Menu Paket

There is exactly one forward Menu entity.

The Menu creation domain does not define:

~~~text
Menu Satuan
Menu Paket
SINGLE
PACKAGE
SINGLE_MENU
PACKAGE_MENU
MENU_TYPE
~~~

The number of Products in Menu Items does not create a different Menu entity or subtype.

~~~text
1 Product  → Menu
5 Products → Menu
20 Products → Menu
~~~

All are simply Menus with different Menu Items.

---

## 5. “Paket” Has Two Different Meanings

The boundary is **not the word “Paket”**.

### 5.1 Paket as a permanent catalog Menu

When the merchant wants a combination to exist as its own sellable catalog item, it is simply a Menu.

Example:

~~~text
Paket Hemat Ayam Tulang Lunak + Es Teh
Rp25.000
~~~

If the customer can see it as one catalog item, open it as one item, add it to Cart as one item, and the Menu has its own price/media, then it is a normal Menu.

It is not:

~~~text
Menu Paket
PACKAGE
menu_type = PACKAGE
~~~

Example:

~~~text
menus
id         = MENU-00125
category   = AYAM
judul      = "Paket Hemat Ayam Tulang Lunak Sambal Ijo + Es Teh"
rasa       = NULL
harga      = 25000
~~~

with:

~~~text
menu_items

MENU-00125 → AYAM-TL       ×1
MENU-00125 → NASI          ×1
MENU-00125 → LALAPAN       ×1
MENU-00125 → SAMBAL-IJO    ×1
MENU-00125 → ES-TEH-MANIS  ×1
~~~

This remains one ordinary Menu.

### 5.2 Paket as a promotional mechanism

When existing Menus are offered together under a promotional rule, no new Menu is required.

Example:

~~~text
Menu A = Ayam Tulang Lunak
Rp20.000

Menu B = Es Teh Manis
Rp5.000
~~~

Promo may define:

~~~text
Beli Menu A + Menu B
→ Rp22.000
~~~

This is a Promo rule against existing Menus.

Do not create a third Menu solely to represent this promotional combination.

The Promo domain is outside this Menu-creation contract. This contract defines only the boundary:

~~~text
Catalog Menu
→ creates sellable Menus

Promo
→ applies promotional / bundling rules to existing Menus
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

## 9. Menu Price and Modal

Harga and Modal are both Menu fields.

~~~text
Menu
├── Harga
└── Modal
~~~

**Harga** is the customer-facing selling price.

**Modal** is the Menu's modal/cost value.

They are independent Menu fields.

Product composition does not define either field automatically.

The Master Menu editor must therefore expose both:

~~~text
harga
[ Rp 25.000 ]

modal
[ Rp 15.000 ]
~~~

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

## 11. Pedas

Pedas is an optional attribute of Menu.

Default state:

~~~text
☐ Level Pedas
~~~

When the checkbox is unchecked:

~~~text
spice_enabled = false
spice_level = NULL
scale hidden/disabled
~~~

When the checkbox is checked:

~~~text
☑ Level Pedas

[●] [●] [●] [○]
~~~

The control is horizontal and has four positions.

The selected position is visually active, for example:

~~~text
[●] [●] [●] [○]
~~~

The selected value represents one of the four visual positions on the scale. The exact internal encoding of the selected position is an implementation detail; it is not a named Master Level and must not be assigned invented business meanings.

The Pedas control is **not a dropdown**.

There is no Master Level Pedas domain.

When Pedas is disabled again:

~~~text
spice_enabled = false
spice_level = NULL
~~~

---

## 12. Inventory Boundary

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

## 13. Master Category Areas

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

## 14. Master Menu Editor

The Owner Master Menu editor represents one Menu.

Fields/concepts:

~~~text
Category  → required
Judul     → required
Rasa      → optional / NULL
Harga     → Menu selling price
Modal     → Menu cost
Media     → Menu media
Menu Items → Product × quantity
Status
~~~

The editor must not require:

~~~text
Menu Type
SINGLE / PACKAGE selector
Package Name as structural type
Product count as Menu type
~~~

Judul is the required Menu name and customer-facing base name.

The Judul selector may use the current Category as deterministic UI context to filter/order available Judul choices. This is UI selection context only; it does not make Category the owner of Judul and does not require a `category_id` on Judul.

---

## 15. Customer Presentation

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

Modal is an internal Menu value and is not a required Customer presentation field.


Customer-facing Menu identity is Judul.

Do not generate Customer Menu identity from Category + Rasa or Category + Judul + Rasa.

Menu Items remain internal composition/inventory relationships.

Customer does not need internal Product/SKU composition to identify the Menu.

---

## 16. Menu vs Product Boundary

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

## 17. Lifecycle / Referential Integrity

For master data that is already referenced:

~~~text
Referenced
→ Archive / Nonaktif
~~~

The UI must not expose destructive Delete where the database relationship makes the operation predictably invalid.

Archive preserves the existing reference.

---

## 18. Legacy Boundary

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

## 19. Migration Rules

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

## 20. Required Test Contract

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
- a permanent catalog item named with “Paket” is an ordinary Menu;
- a promotional bundle over existing Menus does not require a new Menu;
- Paket does not create a Package Menu type.

### Lifecycle

Assert:

- referenced masters use Archive/Nonaktif behavior;
- impossible FK-delete actions are not exposed.

---

## 21. Explicit Prohibitions

~~~text
❌ Composite Menu identity = Category + Judul + Rasa
❌ Composite Menu identity = Category + Rasa
❌ Sub Category as a separate forward concept
❌ Judul as a child/owner-owned child of Category
❌ Judul.category_id as a required ownership relation
❌ SINGLE Menu type
❌ PACKAGE Menu type
❌ Menu Type selector
❌ Package Name as structural Menu semantics
❌ Product count determining Menu type
❌ “Paket” becoming a separate Menu domain entity
❌ Creating a new Menu solely to represent a Promo bundle of existing Menus
❌ Product becoming the customer-facing commercial Menu identity
❌ Menu media being defined as the first Product image
❌ Menu editor directly inventing Inventory stock
❌ Promo bundling being implemented as a Menu subtype
❌ legacy fields silently becoming forward authority
~~~

---

## 22. Package Boundary

The Menu domain determines whether something is a catalog Menu by **commercial existence**, not by naming.

~~~text
Permanent catalog item
→ Menu
→ has id_menu
→ own Judul/Harga/Modal/Media
→ own Menu Items
→ can be shown and purchased as one catalog item

Promotional combination of existing Menus
→ Promo
→ no new Menu required
~~~

The word “Paket” may appear in Judul in either case. The word itself does not determine the domain.

---

## 23. Governance

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

## 24. Status

**v4 = reconstructed contract from the confirmed core model.**

This revision explicitly locks the following clarified points:
- Judul is independent Master data, not a Category child.
- Category is only contextual for deterministic Judul selection/filtering/ordering.
- + Judul creates a Master Judul, not a Category child.
- Judul does not require `category_id`.
- Pedas is an optional Menu attribute controlled by a checkbox and a four-position horizontal selector.
- Pedas is not a dropdown, uses four visual positions, and does not use a Master Level catalog.
- Menu contains both Harga and Modal as separate fields.

The canonical core is:

~~~text
CATEGORY
  └── MENU
       ├── Judul        required
       ├── Rasa         nullable
       ├── Harga
       ├── Modal
       ├── Media
       └── Menu Items
            ├── Product × qty
            ├── Product × qty
            └── Product × qty
~~~

Critical rules:

- Menu is one sellable entity.
- Saving a Menu produces its stable id_menu.
- Category is required.
- Judul is required.
- Rasa is nullable.
- Product is the composition/inventory unit.
- Menu Items connect Menu to Product with quantity.
- Product count does not create a Menu type.
- There is no Menu Satuan or Menu Paket domain in Menu creation.
- “Paket” in a Menu Judul does not create a Menu subtype.
- A permanent catalog combination is still a normal Menu.
- A promotional bundle is a Promo rule over existing Menus; this contract does not create a separate Menu for it.
- Promo is outside this Menu-creation contract.

