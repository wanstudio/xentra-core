# Xentra — Taxonomy & Composed Menu Concept v1

**Status:** PROPOSAL — NOT LOCKED  
**Date:** 2026-10-01  
**Scope:** Master Catalog, Owner Product Editor, Master Reference, Customer PWA, Merchant adoption/read model

> This document is a pre-lock architecture proposal. Existing LOCKED decision documents remain authoritative until a later explicit decision supersedes them.

## 1. Purpose

Evaluate a single Xentra-wide product/catalog concept in which:

- **Product** is the atomic catalog/stock unit (e.g. Ayam, Nasi, Sambal Ijo, Lalapan, Es Teh, Kopi Americano).
- **Menu Satuan** is a sellable menu entry backed by exactly one Product.
- **Menu Paket** is a sellable menu entry composed of two or more existing Products.
- **Category** and **Sub Category** are customer-facing menu taxonomy; Sub Category remains the primary title source for a Menu.
- **Rasa** is reusable menu vocabulary and is part of Menu presentation/identity, not Product stock identity.
- **SKU** marks a Product as stock-managed under the Xentra inventory rule.
- A Product remains a stable atomic entity for inventory, adoption, and references; a Menu remains the customer-facing commercial selling entity.
- No separate Xentra-vs-client product architecture is introduced.

The goal is to validate the concept end-to-end before changing the canonical Xentra contract.
## 2. Human mental model

The Owner should experience the Product Editor as composing one sellable menu item and, where needed, attaching included components. **Kelengkapan is not Package mode.** It describes the contents/included components of a Product. Package is a separate Product subtype with its own fixed bundle semantics.

Normal Product editor:

```
Category
[ Ayam ▼ ] [+]

Sub Category
[ Ayam Tulang Lunak ▼ ] [+]

Rasa
[ Lombok Ijo ▼ ]

☐ Aktifkan Level Pedas
☐ Aktifkan Kelengkapan
```

When **☐ Aktifkan Kelengkapan** is checked, the editor reveals the included component list while the item remains a **Normal Product**:

```
Kelengkapan

[ + Tambah Product ]

Nasi        ×
Lalapan     ×
Sambal      ×
```

This does not turn the Product into a Package.

A separate Package flow creates an explicit fixed composite:

```
Paket
[ ... ]

Isi Paket

[ + Tambah Product ]

Ayam Bakar   ×
Nasi         ×
Es Teh       ×

Harga Paket
[ ... ]
```

The exact Product Editor entry/navigation pattern for Package remains a UX implementation choice, but its semantic distinction from Normal Product + Kelengkapan is mandatory.

UI labels must describe the semantic role honestly. The Product Editor must not pretend that a free-text Product Name exists if the primary customer title is actually resolved from Sub Category.

## 3. Canonical domain relationships under evaluation

### Category → Sub Category

One Category has many Sub Categories.

```
Category 1 ─── N Sub Category
```

A Sub Category MUST have exactly one parent Category.

Target data shape:

```
categories
  id
  brand_id
  name

sub_categories
  id
  brand_id
  category_id
  name
  slug
  sort_order
  is_active
  created_at
  updated_at
```

Same-brand and parent-child integrity must be enforced.

### Sub Category ↔ Rasa — PRE-LOCK DESIGN POINT

Rasa is NOT a child taxonomy node. It is a reusable vocabulary.

Two models remain under evaluation before lock:

**Model A — Compatibility association**

```
Sub Category N ─── N Rasa
```

Target association:

```
sub_category_flavors
  sub_category_id
  flavor_id
  PRIMARY KEY (sub_category_id, flavor_id)
```

Master Rasa remains brand-scoped:

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

A Product may select zero or one Rasa. The selected Rasa MUST be associated with the Product's selected Sub Category.

This gives:

```
Sub Category: Ayam Tulang Lunak
  ├── Original
  ├── Lombok Ijo
  └── Rica-Rica

Sub Category: Ayam Bakar
  ├── Original
  ├── Rica-Rica
  └── BBQ
```

The same Rasa record may be reused by many Sub Categories.

This model enables the Rasa selector to show only values explicitly allowed for the selected Sub Category. It also introduces a new management problem: an Owner must be able to connect an existing Rasa to another Sub Category without creating a duplicate. The Master Reference UX therefore needs an explicit association-management path if Model A is adopted.

**Model B — Product-level Rasa only**

```text
Category 1 ─── N Sub Category
Product ─── 0..1 Rasa
Rasa remains brand-scoped and reusable.
```

Under Model B, the Rasa selector is filtered only by Brand, and the Sub Category does not own a compatibility list. This is simpler but does not prevent a semantically unsuitable Rasa from being selected.

**Pre-lock rule:** do not implement either model as canonical until the usability and business-domain check decides whether compatibility restriction is actually valuable enough to justify the additional relationship-management UX.

## 4. Product and Menu identity

The earlier model that treated **Category + Sub Category + Rasa** as the identity of a Normal Product is superseded.

### Product identity

Product is the atomic catalog/stock entity:

```
Product
├─ Ayam
├─ Nasi
├─ Sambal Ijo
├─ Lalapan
├─ Es Teh
├─ Kopi Americano
└─ ...
```

The Product identity is its stable Product ID plus its own Product attributes, including SKU when stock-managed. Product does not inherit customer-facing menu taxonomy merely because a Menu later references it.

### Menu identity

Menu is the customer-facing commercial selling entity.

```
Menu
├─ type = SINGLE | PACKAGE
├─ Category
├─ Sub Category
├─ Rasa
├─ customer presentation
├─ price
└─ Product references
```

For **Menu Satuan**, the Menu references exactly one Product.

For **Menu Paket**, the Menu references two or more existing Products.

Thus:

```
PRODUCT
= atomic item

MENU
= commercial/customer-facing selling configuration

MENU SATUAN
= Menu → 1 Product

MENU PAKET
= Menu → N Products
```

The Sub Category remains the customer-facing title source for the Menu. Rasa remains the customer-facing subtitle source according to the existing Original/non-Original presentation rule. Level/Pedas is a Menu presentation attribute in the current food context.

Historical orders must snapshot the resolved Menu presentation and the Product references needed for inventory reversal/audit so later Menu edits do not rewrite historical transactions.
## 5. Menu Taxonomy: Category → Sub Category → Rasa

Category, Sub Category, and Rasa belong to the **Menu** layer, not the atomic Product layer.

Canonical relationship:

```text
Menu
  ├─ Category
  ├─ Sub Category
  └─ Rasa
```

Sub Category determines its parent Category:

```text
Menu.sub_category_id
        ↓
sub_categories.category_id
        ↓
categories.id
```

Product does not carry independent Category/Sub Category/Rasa identity in the new model.

Category and Sub Category names remain Brand-unique. Sub Category remains the primary customer-facing title source for the Menu. Rasa remains reusable Brand Master data; `Original` is the universal baseline and is hidden in customer subtitle presentation.

A Menu may reference Product(s) independently of the Product's stock identity. The same Product may be reused by many Menus.
## 6. Owner Product and Menu Editor behavior

Product and Menu are created as separate semantic entities.

### Product Editor

Product Editor creates the atomic Product/stock unit:

```text
Foto
Nama internal / label Product (non-customer Menu title)
SKU
Deskripsi
Status
```

SKU behavior:

```text
SKU kosong → Product non-stock
SKU ada    → Product stock-managed
```

The Product Editor does not select Category, Sub Category, Rasa, Level/Pedas, or customer selling price as Product identity. Those belong to Menu.

### Menu Editor

Menu Editor creates the customer-facing selling entity:

```text
Jenis Menu
○ Satuan
○ Paket

Category
[ Pilih Category ▼ ] [+]

Sub Category
[ Pilih Sub Category ▼ ] [+]

Rasa
[ Original ▼ ] [+]

Level Pedas
[ optional ]

Product(s)
[ pilih Product ]

Harga Jual
[ ... ]

Status
[ ... ]
```

For **Menu Satuan**, exactly one Product is selected.

For **Menu Paket**, two or more Products are selected.

Sub Category selector is parent-scoped to the chosen Category.

Quick-add Sub Category inherits the selected Category as fixed/read-only context.

Menu Editor should resolve the Customer preview from the same fields used by Customer Menu View Model.

Product may exist without any Menu Satuan because it can be used as a component of Menu Paket.
## 7. Rasa selector behavior

Rasa is selected in **Menu Editor**, after Category/Sub Category context is known.

After Sub Category is selected:

```text
Sub Category
[ Ayam Bakar ▼ ]

Rasa
[ Original ▼ ] [+]
```

Rasa is reusable Brand Master data. The selector may show Rasa values already used by Menus under the selected Sub Category, while `Original` is always available as the baseline.

Rasa quick-add inherits the selected Sub Category context.

Save semantics:

1. Normalize the entered Brand Rasa name.
2. Reuse an existing Master Rasa when the normalized name already exists.
3. Otherwise create the Brand Master Rasa.
4. Save the Menu with the resulting Rasa ID.

No separate manual Rasa ↔ Sub Category compatibility matrix is required in the current concept.
## 8. Downstream reset rules

Parent changes invalidate downstream **Menu** selections.

### Category changes

```text
Category changes
      ↓
Sub Category reset
      ↓
Rasa reset
```

### Sub Category changes

Changing Sub Category must revalidate the current Rasa. If the current Rasa is not available/used for the new Menu context, the Menu Editor resets Rasa to the applicable baseline state (`Original`).

The UI must never preserve impossible taxonomy combinations.

Core must enforce the same validation server-side. Draft UI state is mutated first; persistence occurs only on Menu save.
## 9. Taxonomy governance

Owner is the authority for Master taxonomy and Master Menu definitions.

Owner may:

- create/edit/archive Category;
- create/edit/archive Sub Category under a Category;
- create/reuse Rasa;
- create/edit/archive Menu Satuan;
- create/edit/archive Menu Paket;
- assign Product(s) to a Menu;
- set Menu presentation and selling price.

Branch adopts approved Menus for customer-facing sale and does not edit Master Product or Master Menu definitions.

Master taxonomy management remains separate from Product creation and from Branch merchandising.
## 10. Referential integrity requirements

The engine must reject:

- a Sub Category whose Category belongs to another Brand;
- a Menu using Category/Sub Category/Rasa from another Brand;
- a Menu whose Sub Category does not belong to its selected Category;
- a Menu Satuan with zero or more than one Product reference;
- a Menu Paket with fewer than two Product references;
- a Menu referencing a Product from another Brand;
- a Menu Paket referencing another Package/Menu rather than an atomic Product;
- duplicate normalized Category names within the same Brand;
- duplicate normalized Sub Category names within the same Brand, including across different parent Categories;
- duplicate normalized Rasa names within the same Brand;
- duplicate normalized Product SKU values within the same Brand when SKU is non-NULL;
- duplicate Menu identity (Sub Category + Rasa) within the same Brand;
- creation of a Menu whose Sub Category + Rasa combination already exists in the same Brand;
- composition references that violate Menu type rules or create cycles;
- stock movements against a Product that has no SKU.

The UI is not the authority. Core validation is the authority.

## 11. Customer read model

Customer PWA must consume one resolved **Menu View Model**.

Target mapping:

```text
title        ← Menu.Sub Category.name
subtitle     ← Menu.Rasa.name when Rasa != Original; otherwise hidden
level        ← Menu Level/Pedas presentation when configured
image        ← Menu/Product media according to the approved media source
price        ← Menu selling price / Branch Menu price policy
availability ← Branch operational state + Product SKU stock where relevant
product_refs ← Menu Product reference(s)
category     ← Menu.Category
```

Customer code must not reconstruct menu semantics by directly joining arbitrary raw Product, Category, or Rasa tables.
## 12. Order and historical behavior

At order commitment, Core must snapshot the resolved Menu presentation and the Product reference(s) needed for inventory and historical audit.

Future Menu edits must not rewrite historical order display.

Historical inventory reversal must use the Menu composition/stock-resolution snapshot that governed the original sale rather than today's Menu definition.

Commercial order identity is Menu-based, while Product IDs/SKUs remain the inventory identities used by the stock engine.
## 13. Branch adoption

The new Product/Menu separation changes the adoption boundary:

**Branch adopts Menus for customer-facing sales; Branch inventory manages the underlying Products.**

Conceptually:

```text
Master Product
   ↓
Master Menu
   ↓
Branch adopts Menu
   ↓
Menu resolves to Product(s)
   ↓
Branch Inventory holds stock per Product SKU
```

### Menu Satuan

Branch adoption of a Menu Satuan makes that Menu available for sale at the Branch, subject to Branch operational availability.

```text
Menu Satuan: Nasi
→ Product Nasi [SKU NASI-001]
→ Branch stock = NASI-001
```

### Menu Paket

Branch adoption of a Menu Paket makes the Paket sellable at the Branch, subject to the availability of all required Product stock authorities.

```text
Menu Paket: Ayam + Sambal + Nasi
→ Ayam [SKU]
→ Sambal [SKU]
→ Nasi [SKU]
```

The Branch does not create or edit Master Products or Master Menus. Branch Category remains a branch-local merchandising grouping for adopted Menus.

A Product may exist in Branch Inventory even when it is not currently exposed as a standalone Menu Satuan, because the same Product can be required by one or more Menu Pakets.

**Important:** the existing production contract currently treats `branch_products.product_id` as the adoption/inventory boundary. This proposal supersedes that target semantics for the future Product/Menu model; technical migration must reconcile the physical schema later rather than silently changing production behavior now.
## 14. Major UX risks to validate before lock

1. **Terminology learning curve** — first-time Owner may ask where "Nama Produk" is.
2. **Taxonomy authoring burden** — a user must select a Category before creating a Sub Category.
3. **Taxonomy quality** — poorly governed categories can create clutter.
4. **Shared Rasa expectations** — users may expect all Rasa values to appear everywhere unless compatibility is explained.
5. **Duplicate titles** — multiple Products can intentionally resolve to the same title/subtitle.
6. **Context changes** — changing Category/Sub Category must make downstream resets obvious.
7. **Title propagation** — renaming a Sub Category would rename the Customer title for every Product using that Sub Category. The system must make the blast radius visible before save.
8. **Rasa reuse** — if compatibility mode is used, an existing Rasa must be attachable to another Sub Category without creating duplicate master records.

These are validation targets, not reasons to reject the model.

## 15. Required usability validation

Before locking, test at minimum:

```
Task A  — Create a new Category.
Task B  — Create a Sub Category from its [ + ].
Task C  — Understand why Category is fixed inside the Sub Category sheet.
Task D  — Select a Rasa for a Sub Category.
Task E  — Create a new Rasa from its [ + ].
Task F  — Change Category and observe downstream reset.
Task G  — Create two Products with the same Sub Category but different Rasa.
Task H  — Find and edit an existing Sub Category from Master Reference.
```

Observe:

- first-attempt understanding;
- time-to-completion;
- incorrect parent selection attempts;
- attempts to search for a "Nama Produk" field;
- mistaken expectations around Rasa;
- recovery after Category/Sub Category changes;
- duplicate creation attempts.

## 16. Technical impact audit required before implementation

Before changing the canonical contract, audit every current dependency on:

- `products.name` as Customer title;
- `products.name` as search/reporting label;
- `product_name` snapshots;
- promotion reward display names;
- POS payment line-item names;
- KDS/receipt names;
- Merchant App product search/display;
- Owner Product Editor payload/preview;
- Master Menu resolver;
- Branch display-name override;
- Product Menu migration;
- tests asserting Product Name semantics.

Current repository code already has explicit contracts around `products.name`, including the locked Product Name decision and multiple regression tests. This proposal must replace those semantics coherently, not through isolated UI changes.

## 17. Migration principle

Do not immediately mutate or delete the existing Product Name contract.

Preferred sequence:

```
1. Validate concept
2. Lock taxonomy/composed-menu contract
3. Expand schema
4. Build repositories/domain services
5. Build resolver/read model
6. Build Owner Master Reference flows
7. Build Product Editor context flow
8. Migrate existing Products deterministically
9. Update dependent domains
10. Update tests
11. Run full suite
12. Verify production data
13. Only then quarantine old title semantics
```

## 18. Pre-lock questions

These must be answered explicitly before the document can become LOCKED:

- Does Complement compatibility need its own Sub Category association model?
- Does Level need compatibility constraints?
- What happens to existing Products whose current `products.name` does not correspond to any Sub Category?
- What is the canonical search label: resolved title, title + subtitle, or additional hidden keywords?
- How are legacy Products migrated without losing customer-visible identity?
- How are reports, receipts, payment gateways, promotions, KDS/POS, and historical orders kept stable?
- What is the exact physical uniqueness constraint/normalization implementation for Category names, Sub Category names, and Normal Product identity?

## 19. Current conclusion

The concept is technically feasible and can become the single forward Xentra model. The current canonical direction is: **Product = atomic stock/catalog unit; Menu Satuan = one Product for sale; Menu Paket = multiple Products for sale as one commercial offering; Inventory quantity is owned by Inventory, not Menu.**

However, **this document deliberately does not lock it yet**. The critical next step is to validate the human workflow and complete the dependency audit before replacing the current `products.name → Customer title` contract.

Until then, no client-specific MyBangjo fork is required and no Xentra-vs-MyBangjo divergence is being introduced.


## 🔒 LOCKED SUB-DECISION — Product vs Menu: Satuan and Paket

**Decision date:** 2026-10-02

Xentra separates the atomic **Product** from the customer-facing **Menu** structure.

### Product

Product is the atomic catalog/stock unit:

```text
Product
├─ Ayam
├─ Nasi
├─ Sambal Ijo
├─ Lalapan
├─ Es Teh
├─ Kopi Americano
└─ ...
```

A Product may have a SKU. Under the Xentra inventory rule, a Product with a SKU is stock-managed; a Product without a SKU is non-stock.

Product does not represent a combined commercial menu merely because it may be used together with other Products.

### Menu Satuan

Menu Satuan is a sellable menu entry backed by exactly **one Product**.

```text
Menu Satuan
→ Product Nasi [SKU NASI-001]
```

When sold, the Product's SKU is the stock authority.

### Menu Paket

Menu Paket is a sellable menu entry composed of **two or more existing Products**.

```text
Menu Paket
"Ayam Bakar Sambal Ijo + Nasi"
├─ Ayam       [SKU AYAM-001]
├─ Sambal Ijo [SKU SAMBAL-001]
├─ Nasi       [SKU NASI-001]
└─ Lalapan    [SKU LALAPAN-001]
```

The Paket is one commercial order line and one customer quantity unit, but it does not need its own SKU or stock balance in the current Xentra model.

When one Paket unit is sold, the inventory engine consumes each component Product SKU according to the package composition.

```text
Qty Paket = 2
→ AYAM-001      -2
→ SAMBAL-001    -2
→ NASI-001      -2
→ LALAPAN-001   -2
```

### Boundary

```text
PRODUCT
= atomic item / stock unit

MENU SATUAN
= sells 1 Product

MENU PAKET
= sells multiple Products as one commercial offering
```

`Kelengkapan` is not a separate Product subtype or Package mode in this model. The earlier proposal wording that used Kelengkapan as a mechanism for turning a Normal Product into a Package is superseded.
## 🔒 LOCKED SUB-DECISION — Product Reuse Across Menus — 2026-10-02

The same Product may be referenced by multiple Menus without duplicating the Product or its inventory identity.

```text
Product Nasi [SKU NASI-001]
├─ Menu Satuan: Nasi Putih
├─ Menu Paket: Ayam + Nasi
└─ Menu Paket: Ikan + Nasi
```

All three Menus reference the same Product and therefore the same Branch stock pool for `NASI-001`.

Product duplication is not permitted merely because the Product is used in another Menu. Menu-specific customer presentation, price, and composition belong to Menu; stock identity remains on Product.

**Status:** LOCKED SUB-DECISION for the proposal only. Production/main remains unchanged until final promotion.
## 5B. Paket vs Promotion — Pre-lock Boundary

A Paket and a Promotion are different concepts.

**Paket**
- is a named, sellable Product created by Owner;
- has a fixed, explicitly defined component Product list;
- has its own explicit Paket price;
- has its own Product identity and can be adopted by Branches;
- consumes stock from its referenced component Products when sold.

**Promotion / discount**
- does not create or convert the cart into a Paket;
- may apply a lower effective price when the cart contains qualifying normal Products;
- keeps the original Product IDs in the order/cart;
- remains governed by the Promotion domain and its own eligibility/discount rules.

Example:

```
Product 1 + Product 2 + Product 3 + eligible Promotion
→ discounted cart
→ still three separate Product IDs
→ NOT automatically a Paket
```

This boundary is required to avoid treating arbitrary product combinations as a new Product or Paket.


## 🔒 LOCKED SUB-DECISION — Product Options Is a Separate Domain

**Decision date:** 2026-10-02

**Product Options** remains a separate domain from Normal Product identity and from Paket/Kelengkapan.

Rules:

1. Product Options is not part of the Normal Product identity tuple.
2. Product Options is not the mechanism for composing Paket components.
3. Product Options may have its own option values, pricing, and add-on charges where that domain requires them.
4. The detailed Product Options business rules, pricing behavior, inventory interaction, UI, and order representation are **intentionally out of scope for this lock**.
5. The current Xentra Product Options capability may remain as an existing domain contract/capability; this taxonomy decision does not redesign it.
6. The new taxonomy/product concept must not invent Product Options behavior merely to fill the current Product Editor.

## 🔄 SUPERSEDED SUB-DECISION — Kelengkapan Is Not Paket Mode

The earlier proposal text that treated **Kelengkapan** as a switch into Paket mode is superseded by the current concept.

Current target semantics:

1. `Kelengkapan` belongs to a **Normal Product**.
2. It describes included/composed component Products.
3. It does **not** change the Product subtype to PACKAGE.
4. A `Paket` is created explicitly as the separate PACKAGE Product subtype.
5. Inventory effect is determined by the SKU/stock authority rules in the dedicated pre-lock inventory contract.
6. No implementation on `main` is implied by this supersession.

## 🔒 LOCKED SUB-DECISION — Customer Search Uses Resolved Menu Presentation

**Decision date:** 2026-10-02

Customer search operates on the resolved customer-facing **Menu presentation**, not on the atomic Product record alone.

Rules:

1. **Menu title** is searchable.
2. **Menu subtitle / Rasa** is searchable.
3. Search resolves against the same Customer Menu View Model used for presentation.
4. A query matching Rasa must find the corresponding Menu. Example: "lombok" finds **Ayam Bakar / Lombok Ijo**.
5. Level/Pedas is not a searchable field for the current concept.
6. Search does not create or alter Product or Menu identity.
7. Customer search uses live behavior: results update while typing; no separate **Cari** submit button is required.

Conceptually:

```
Menu
  title    = Ayam Bakar
  subtitle = Lombok Ijo
  product  = AYAM-001

"lombok"
  → Ayam Bakar / Lombok Ijo
```
## 🔄 SUPERSEDED SUB-DECISION — Paket Is Sold as One Whole Unit

The earlier rule that each Package component is exactly one unit per Package is superseded by the quantity-enabled Package model.

Current rules:

1. A Paket remains one whole commercial order line.
2. Customer/cart Qty controls the number of complete Paket units.
3. Each Package component has a fixed **positive integer component quantity**.
4. Inventory consumption is `package_sale_qty × component_qty` for each stock-managed component.
5. Customer cannot change component quantities from the cart; they are defined by the Menu Paket.
6. The same Product can be represented once with `quantity > 1`; duplicated Product records are not required.
7. Zero or negative component quantities are rejected. Decimal/UoM quantities are outside the current MVP contract.

Example:

```text
Paket Keluarga
├─ Ayam     ×2
├─ Nasi     ×2
├─ Sambal   ×2
└─ Es Teh   ×3

Customer Qty = 2

Inventory:
AYAM     -4
NASI     -4
SAMBAL   -4
ES TEH   -6
```

## 🔒 LOCKED SUB-DECISION — Paket Component Invalidity Blocks Sale

**Decision date:** 2026-10-02

A Paket remains a persistent Product entity when one of its referenced component Products becomes unavailable or invalid. The Paket is not deleted and its Product identity/history are preserved, but it must not remain sellable while a required component is invalid.

Rules:

1. If a required component Product is archived, deleted, or otherwise invalid for sale, the Paket remains stored with its existing Product ID and historical records.
2. The Paket becomes **not sellable / unavailable** because of the invalid component; it is not silently sold without that component.
3. The Paket is not automatically converted to Draft merely because a component became invalid. Draft means the Paket itself is not finished; component invalidity is a sale-eligibility problem.
4. Core must expose the blocking reason, e.g. `COMPONENT_UNAVAILABLE`, so Owner/Merchant surfaces can explain why the Paket cannot be sold.
5. The Owner must be able to repair the Paket by replacing/removing the invalid component according to the Package composition rules, after which Core can re-evaluate sale eligibility.
6. Historical orders remain unchanged and the Paket Product identity is not rewritten by this lifecycle event.
7. A component being temporarily out of stock is a separate availability condition from the component Product itself becoming invalid/archived; both can make the Paket unavailable, but they must remain distinguishable.

Conceptually:

```
Component Product archived/invalid
        ↓
Paket remains persisted
        ↓
saleable = false
blocking_reason = COMPONENT_UNAVAILABLE
        ↓
Owner repairs Package composition
        ↓
Core re-validates
        ↓
Paket can become saleable again
```

## 🔒 LOCKED SUB-DECISION — Paket Components May Be Non-Published Products

**Decision date:** 2026-10-02

A valid Master Product does not need to be published as a standalone Customer PWA menu item before it can be used as a Paket component.

Rules:

1. A Product may be a valid Paket component even when it is not currently published/visible as a standalone Customer menu item.
2. A Product in **Draft** status may be referenced by a **Draft Paket** while the Owner is assembling the catalog.
3. A Paket may become publishable/sellable only after Core validates that all referenced components satisfy the minimum Product validity required for sale.
4. Adding a Product to a Paket does not automatically publish that Product as a standalone Customer menu item.
5. Component selection is Brand-scoped and may use valid Products that are Published, hidden/not standalone, or Draft according to the Paket lifecycle rules.
6. Archived/deleted or otherwise invalid Products cannot be newly selected as Paket components.
7. Customer visibility and Product existence are separate concerns.

Conceptually:

```
Master Product
    ↓
can exist independently of standalone Customer visibility

Paket Draft
    ├── Published Product      ✅
    ├── Hidden Product         ✅
    └── Draft Product          ✅

Publish/Sell Paket
    ↓
all components must pass Core validity checks
```

## 🔒 LOCKED SUB-DECISION — Paket Is an Explicit Fixed Composite Sellable Product

**Decision date:** 2026-10-03

The human meaning of "Paket" (a combined offering, often perceived as a value/deal) is different from the system meaning. Xentra uses the system definition for persistence and business rules.

Rules:

1. A Paket exists only when the Owner explicitly creates a **Menu Paket**. It is not inferred from a cart combination, menu name, or Promotion.
2. A Menu Paket is one customer-facing commercial selling entity with its own name, presentation, selling price, and fixed Product composition.
3. The Paket composition references existing atomic Products; it never duplicates Product records.
4. Each component line has a fixed **positive integer quantity**.
5. The same Product may appear once with quantity greater than one. Duplicate Product records are never created to represent quantity.
6. A Paket must represent more than one Product unit in total. A single Product ×1 is a Menu Satuan, not a Paket.
7. The Menu Paket itself has **no SKU and no stock balance** in the current Xentra model.
8. A component Product with a SKU contributes inventory consumption equal to `component_qty × package_sale_qty`.
9. A component Product without a SKU is non-stock and creates no inventory movement.
10. Package availability is constrained by all required stock-managed components.
11. Package components are atomic Products only; a Package/Menu cannot contain another Menu or Package.
12. Customer-side component quantity changes or reconfiguration are not supported. The fixed quantities are part of the Menu Paket definition.

Reference cross-check: Odoo BoMs explicitly store component quantities and sell kits as a single sales line; WooCommerce Product Bundles supports per-component quantities and multiple instances of the same product; Square bundles expose a Quantity field per component. citeturn277241search0turn277241search13turn277241search10

## 🔒 LOCKED SUB-DECISION — Paket Revenue Belongs to the Paket

**Decision date:** 2026-10-02

For the current Xentra Package model, a sold Paket is one sellable transaction line at the explicit Paket price. Revenue is not automatically allocated back to component Products.

Rules:

1. The Paket carries the transaction sales identity and explicit Paket price.
2. Payment/order/revenue records use the Paket sale as the primary commercial line.
3. Component Products remain the source of inventory consumption according to Paket composition and quantity.
4. Component-level sales attribution may be used for analytics/reporting later, but it does not change the primary transaction revenue allocation.
5. Formal revenue allocation/accounting treatment is outside the current Paket contract and may be introduced later as a separate accounting/reporting domain.

Conceptually:

```
Paket Ayam Komplit
Harga Paket = Rp45.000

Transaction revenue
→ Paket = Rp45.000

Inventory effect
→ Ayam Bakar -1
→ Nasi       -1
→ Es Teh     -1
```

## 🔄 SUPERSEDED SUB-DECISION — Historical Reporting Uses Identity at Time of Sale

The earlier Product-identity framing is superseded.

Current target: historical records preserve the **Menu identity/presentation and Product SKU references used by the transaction**.

Product remains an atomic inventory identity; Menu remains the commercial/customer-facing identity. Historical orders must retain the Menu presentation and the Product/SKU stock consumption snapshot that applied at transaction time.
## 🔒 LOCKED SUB-DECISION — Level Pedas Is Informational, Not a Customer Request

**Decision date:** 2026-10-02

For the current Xentra food-menu concept, Level/Pedas is a Product presentation attribute that communicates the menu's configured level. It is not a customer customization/request field.

Rules:

1. The Owner sets the Product's Level Pedas value in Master Product data.
2. Customer PWA displays that value as information when Level Pedas is enabled.
3. Level Pedas does not create a customer selection step in the current order flow.
4. A customer's ad-hoc offline request for a different spice level than the configured Product value is handled operationally by people and is not represented as a separate system request in the current Xentra model.
5. The current Level Pedas value remains part of the Product's resolved presentation/history according to the existing snapshot rules.

## 🔄 SUPERSEDED SUB-DECISION — Current Level Pedas Product Editor UI

The earlier wording placed Level/Pedas inside Product Editor. It is superseded.

Current target: **Level/Pedas is configured in Menu Editor**, because it is a customer-facing Menu attribute.

Food context:

```text
☐ Aktifkan Level Pedas

when enabled → four selectable positions, default Level 1
when disabled → Level = NULL; no Pedas label/indicator in Customer UI
```

Level remains a generic domain concept; "Pedas" is contextual food UI naming.
## 🔒 LOCKED SUB-DECISION — Level Is Optional and NULL When Unset

**Decision date:** 2026-10-02

Level is optional for a Normal Product.

Rules:

1. A Normal Product may have no Level value.
2. When Level is not set, the stored value is **NULL**.
3. When Level is NULL, the Customer UI must show **neither the Level label nor the Level indicator**.
4. The absence of a Level is not interpreted as the lowest Level value.
5. When a Level is set, the contextual UI may present its label (for food, **Pedas**) and indicator/value according to the active context.

Conceptually:

```
Level = NULL
→ no "Pedas" label
→ no Pedas indicator

Level = 3
→ "Pedas"
→ indicator for Level 3
```

## 🔒 LOCKED SUB-DECISION — Level Is Generic, UI Label Is Contextual

**Decision date:** 2026-10-02

**Level** remains the generic domain concept. The current food-menu UI may present the field as **Pedas**, but that is a contextual UI label, not a change to the underlying domain field.

Rules:

1. Core/data contracts continue to use **Level** as the semantic field/concept.
2. In a food context, the UI label may be **Pedas**.
3. Future menu contexts may reuse the same Level concept with a different UI label and value presentation without renaming or forking the underlying domain field.
4. The Level UI pattern is a candidate for the **Shared** layer; context-specific naming/configuration is supplied by the consuming feature.
5. The exact value vocabulary and compatibility rules for Level are not assumed globally and remain subject to the requirements of each menu context.

Conceptually:

```
Shared Level Component
        ↓
context label = "Pedas"   (food)
context label = other     (future menu)
        ↓
same underlying Level domain
```

## 🔄 SUPERSEDED SUB-DECISION — Paket Product Subtype & Component Inventory

The earlier wording that simply made every Paket consume component Product stock is retained only where it agrees with the more precise stock-authority model below and is otherwise superseded.

A Paket remains a Product subtype with its own Product ID and fixed component Product references. The current Xentra target is that a Package is a **virtual composite sellable Product** and therefore does not have its own stock balance in the current contract.

The exact inventory effect of the Paket is now governed by:

```
PACKAGE
  → no parent stock in current contract
  → resolve component Product stock authority
  → consume the resulting component SKU stock
```

The dedicated pre-lock inventory contract below is the authoritative target for this proposal.

## 🔒 LOCKED SUB-DECISION — Paket ≠ Promotion

**Decision date:** 2026-10-01

This sub-decision is locked for the new Xentra concept, while the overall document remains **PROPOSAL / NOT LOCKED**.

1. **Paket is an explicitly created sellable Product/bundle.** It has its own Product identity, Owner-defined name, explicitly defined fixed component Product list, and explicitly defined Paket price.
2. **A cart containing multiple normal Products is not automatically a Paket.**
3. **Promotion/discount never converts a cart combination into a Paket.** The cart continues to contain the original Product IDs and the Promotion domain only changes the effective transaction price according to its rules.
4. **Paket and Promotion therefore remain separate domain concepts, reporting concepts, and persistence concepts.**
5. **Inventory effect of a Paket** is derived from its referenced component Product IDs; the Paket does not create duplicate component inventory records.
6. **Do not infer Paket creation from price arithmetic, matching cart composition, or promotion eligibility.** A Paket exists only when an Owner explicitly creates it as such.

Canonical examples:

```
Explicitly created:
Paket A
  ├── Product 1
  ├── Product 2
  └── Product 3
  Harga Paket = explicit Owner-defined price

Normal cart:
Product 1 + Product 2 + Product 3
  + Promotion
  → discounted cart
  → remains Product 1 + Product 2 + Product 3
  → NOT a Paket
```


## 🔒 LOCKED SUB-DECISION — Identity Change Is In-place When Unique

**Decision date:** 2026-10-01

For an existing Product, changing an Identity component (Category, Sub Category, or Rasa) is still presented as a normal **Edit Product** action.

If the target identity is not already used by another Product, Core updates the same Product record in place.

Conceptually:

\`\`\`
P001
Ayam / Ayam Bakar / Original

Owner edits Rasa:
Original → Lombok Ijo

if target identity is unused:

P001
Ayam / Ayam Bakar / Lombok Ijo
\`\`\`

Non-identity data stays attached to the same Product ID:

- image;
- description;
- price;
- complements;
- level;
- POS configuration;
- other approved Product fields.

Historical orders remain unchanged because the order stores the authoritative historical menu snapshot used at purchase time.

If the target identity is already used by another Product, the edit must not mutate either Product and must enter the locked duplicate-identity recovery flow below.

This means the UX mental model and the Product ID remain aligned: **an edit is an edit** when the requested identity is available.

## 🔒 LOCKED SUB-DECISION — Duplicate Identity Recovery UI

**Decision date:** 2026-10-01

When an Owner edits a Product Identity component and the target identity already exists, Core must not mutate the current Product into that identity.

The Product Editor presents a modal overlay:

\`\`\`
Produk sudah ada

Produk dengan kombinasi tersebut sudah tersedia.

[Buka Produk yang Sudah Ada]   [Batal]
                              ×
\`\`\`

Behavior:

- **Buka Produk yang Sudah Ada** → close the modal and open the target Product in a **read-only detail Bottom Sheet**.
- **Batal** → close the modal and keep the current Product Editor state unchanged.
- **×** → same dismissal semantics as Batal.
- The detail Bottom Sheet has **no Edit CTA**.
- The user must deliberately leave the conflict flow and choose the existing Product from the normal Product management surface when they intentionally want to edit it.
- The system must not silently merge Products.
- The system must not silently overwrite the existing target Product.

The principle is:

> **Conflict → inspect, not edit.**



## 🔒 LOCKED SUB-DECISION — Category Change Warning & Downstream Reset

**Decision date:** 2026-10-01

When an Owner changes the Category of an existing Product during Product Edit, the UI must warn before applying the downstream reset.

The warning exists to prevent accidental "data disappearance" surprises when a user is only experimenting with the selector.

Conceptual behavior:

\`\`\`
Current:
Category      Ayam
Sub Category  Ayam Bakar
Rasa          Original

User selects:
Category → Minuman
\`\`\`

Show confirmation:

\`\`\`
Kategori diubah

Mengubah Kategori akan mengosongkan Sub Kategori dan Rasa yang sekarang dipilih.

[ Batal ] [ Lanjutkan ]
                         ×
\`\`\`

If the user continues:

\`\`\`
Category      Minuman
Sub Category  <empty>
Rasa          <empty>
\`\`\`

If the user cancels or closes the warning:

- keep the previous Category;
- keep the previous Sub Category;
- keep the previous Rasa;
- do not mutate the Product draft.

The reset occurs at the **draft/UI state** first. Persistence happens only when the Owner saves the Product.

The same rule applies when the Category is changed from one valid parent to another; the system must not attempt to preserve Sub Category/Rasa by matching names.


## 🔒 LOCKED SUB-DECISION — Sub Category Rename Warning & Propagation

**Decision date:** 2026-10-01

An Owner may rename a Master Sub Category.

Because Sub Category is the Customer-facing title source, the rename propagates to the current title of every Product using that Sub Category.

Before saving the rename, the UI must warn with the actual usage count.

Conceptual behavior:

\`\`\`
Ubah Sub Kategori

Ayam Bakar → Ayam Bakar Premium

Sub Kategori ini digunakan oleh 20 menu.
Perubahan nama akan mengubah judul menu tersebut di Customer PWA.

[ Batal ] [ Simpan Perubahan ]
                         ×
\`\`\`

Rules:

- Rename is allowed.
- The warning is mandatory when the Sub Category is used by one or more Products.
- Cancel / \`×\` leaves the existing Sub Category name unchanged.
- Save updates the Master Sub Category name; Products continue referencing the same Sub Category ID.
- Customer-facing titles resolve from the updated Sub Category name.
- Historical orders remain unchanged because they use the historical order/menu snapshot.
- Before commit, Core must validate that the resulting Product identities remain unique under the new Sub Category identity context. If the rename would create duplicate Product identities, the rename must be blocked with a conflict message rather than silently creating/merging Products.


## 🔒 LOCKED SUB-DECISION — Archive-First Taxonomy Lifecycle

**Decision date:** 2026-10-01

For the new Xentra taxonomy UX, Master Category and its direct taxonomy descendants use an **archive-first lifecycle**.

UI rules:

- A Category that is not empty is **not deletable**.
- The primary destructive lifecycle action for a populated Category is **Archive**, not Delete.
- Archiving a Category also archives its descendant Sub Categories as part of the same taxonomy lifecycle action.
- A Category may be permanently deleted only when it is empty according to the current dependency rules.
- No automatic Product migration is triggered by Archive.
- This is a UX/lifecycle decision only at this stage; no production implementation is implied by this document.

Product records are not themselves considered descendants for purposes of automatic deletion. Product lifecycle remains governed by the Product domain.
## 🔒 LOCKED SUB-DECISION — Category and Sub Category Names Are Brand-Unique

**Decision date:** 2026-10-02

Within one Brand, both **Category name** and **Sub Category name** must be unique.

Rules:

1. Two Categories in the same Brand may not share the same normalized name.
2. Two Sub Categories in the same Brand may not share the same normalized name, even when their parent Categories are different.
3. Parent Category still determines which Sub Categories are shown in the Product Editor, but parent context does not permit duplicate Sub Category titles.
4. The system must warn on duplicate entry before save and Core must enforce the same uniqueness constraint server-side.
5. The purpose is to keep the customer-facing Sub Category title unambiguous and prevent visually duplicated menu items such as:
   - Ayam → Goreng
   - Ikan → Goreng
6. This is a **name uniqueness rule**, separate from Normal Product identity uniqueness.

## 🔄 SUPERSEDED SUB-DECISION — Normal Product Identity and Menu Uniqueness

The earlier decision that defined a normal Product identity as **Category + Sub Category + Rasa** is superseded by the Product/Menu separation.

Current canonical target:

- **Product** = atomic catalog/stock entity.
- **Menu Satuan** = customer-facing selling entity referencing exactly one Product.
- **Menu Paket** = customer-facing selling entity referencing two or more Products.
- **Menu identity/uniqueness** is evaluated at the customer-facing Menu layer.

### Menu identity

For the current food-menu model, the canonical Menu identity is:

```text
Sub Category + Rasa
```

Category is taxonomy context/parentage, not a second identity dimension for duplicate detection. The same identity combination must not be created again even if a user attempts to place it under another Category.

Because Sub Category names are already Brand-unique, a different parent Category cannot be used to bypass Menu identity uniqueness.

Rasa remains reusable across different Sub Categories. Therefore these are different Menus:

```text
Ayam Bakar + Original
Ayam Goreng + Original
Ayam Bakar + Lombok Ijo
```

but this is a duplicate:

```text
Ayam Bakar + Lombok Ijo
Ayam Bakar + Lombok Ijo
```

When the Owner attempts to create a duplicate Menu identity, Core blocks creation and the UI shows a warning with one dismissal CTA:

```text
Menu sudah ada

Menu dengan Sub Kategori dan Rasa tersebut sudah tersedia.

[ Tutup ]
```

The system must not merge, overwrite, or open the existing Menu for editing from this conflict. The Owner can find the existing Menu through the normal Menu management surface.

Status: the old Product identity conflict flow is historical and superseded for this new Product/Menu model.

## 🔒 LOCKED SUB-DECISION — Rasa Is Reusable Master Data

**Decision date:** 2026-10-03

Rasa is reusable Brand-scoped Master data used by **Menus**. It is not a child taxonomy node and it is not part of the atomic Product identity.

Rules:
1. Menu references a Rasa record by ID.
2. `Original` is always available as the baseline/default Rasa for Menu Satuan and applicable Menu Paket presentation.
3. `Original` is hidden in the customer subtitle; non-Original Rasa may be shown as subtitle.
4. The same Rasa may be reused by many Menus with different Sub Categories.
5. Duplicate Master Rasa records with the same normalized Brand name are not created.
6. No manual Sub Category ↔ Rasa compatibility matrix is required in the current concept; Menu usage establishes contextual availability.

**Status:** LOCKED SUB-DECISION for proposal only. `main` remains unchanged.

## 🔒 LOCKED SUB-DECISION — Add-on vs Standalone Product

**Decision date:** 2026-10-01

An independently sellable menu item remains a Product.

Example:

```
Ayam Bakar Original
+
Sambal Matah
```

If Sambal Matah is sold independently, it is a separate Product ID in the cart/order. It is not merely an Add-on because it was purchased alongside another Product.

Add-on/optional configuration remains reserved for values that are attached to a Product at purchase time under the approved Product Options contract and are not themselves independent sellable Products.

## 🔒 LOCKED SUB-DECISION — Rasa Reuse Conflict Messaging

**Decision date:** 2026-10-01

When an Owner enters a Rasa name that already exists in the Brand Master vocabulary and is being reused in a different menu context, the contextual confirmation keeps normal CTA hierarchy:

```
Rasa "Cheesecake" sudah digunakan di menu lain.
Lihat detail

[ Batal ]   [ Tambahkan ]
```

`Lihat detail` is an inline text link, not a third CTA button.

The detail interaction may show where the Rasa is already used. The primary decision remains **Tambahkan** or **Batal**.

## 🔒 LOCKED SUB-DECISION — Sub Category Archive-First Lifecycle

**Decision date:** 2026-10-01

A Sub Category that still has Product dependencies is not permanently deletable.

For populated taxonomy:

- archive is the normal lifecycle action;
- permanent Delete is available only when the Sub Category is empty under current dependency rules;
- Archive must not silently migrate Products to another Sub Category;
- any future Product migration is an explicit Owner action, not an automatic side effect of archive.

## 🔒 LOCKED SUB-DECISION — Product → Menu → Inventory Model

**Decision date:** 2026-10-02

The previous Product + Kelengkapan + Package inventory model is superseded by a simpler two-level selling model: **Menu Satuan** and **Menu Paket**.

### 1. Product is atomic

Product represents one atomic catalog/stock unit:

```text
Ayam
Nasi
Sambal Ijo
Lalapan
Es Teh
Kopi Americano
...
```

Each Product is independent and reusable across multiple menus.

### 2. SKU determines Product stock management

> **Product with SKU = stock-managed Product. Product without SKU = non-stock Product.**

SKU can be generated by Core or entered manually. The business meaning is the same.

```text
Product
  ├─ SKU exists → stock-managed
  └─ SKU NULL   → non-stock
```

Stock is still Branch-scoped through the existing Xentra Inventory boundary. Creating a Product or adopting it to a Branch does not fabricate stock quantity.

### 3. Menu Satuan

Menu Satuan references exactly one Product:

```text
Menu Satuan: Nasi
→ Product Nasi [SKU NASI-001]
```

Sale of 1 Menu Satuan:

```text
NASI-001 -1
```

A non-SKU Product can technically be sold as a non-stock Menu Satuan; such a sale creates no inventory movement.

### 4. Menu Paket

Menu Paket is an explicitly created commercial grouping of existing Products.

```text
Menu Paket
"Ayam Bakar Sambal Ijo + Nasi"
├─ Ayam       [SKU AYAM-001]
├─ Sambal Ijo [SKU SAMBAL-001]
├─ Nasi       [SKU NASI-001]
└─ Lalapan    [SKU LALAPAN-001]
```

Current rule: the Menu Paket itself has **no SKU and no stock balance**.

One Paket unit sold consumes its component Product stock:

```text
AYAM-001      -1
SAMBAL-001    -1
NASI-001      -1
LALAPAN-001   -1
```

Customer Qty controls complete Paket units. Each Menu Paket component has its own fixed positive integer quantity, and inventory consumption multiplies that component quantity by the ordered Paket Qty.

### 5. Product reuse

The same Product can appear in many Menu Satuan and Menu Paket definitions, while its Branch stock remains one shared stock pool for that Product.

```text
Nasi [NASI-001]
├─ Menu Satuan: Nasi
├─ Menu Paket: Ayam + Nasi
└─ Menu Paket: Ayam + Sambal + Nasi
```

All sales consume the same Branch inventory identity `NASI-001`.

### 6. Package availability

A Menu Paket is sellable only when all stock-managed component Products required for one complete Paket unit are available, subject to normal operational availability.

For component quantities of one:

```text
available_paket = minimum(component_stock)
```

If a component Product is non-SKU, inventory does not limit Package availability for that component because it is not stock-managed.

### 7. One stock authority per sale path

For Menu Satuan:

```text
Menu Satuan → Product SKU → Branch stock
```

For Menu Paket:

```text
Menu Paket → component Products → component SKUs → Branch stock
```

The Menu Paket itself is never decremented as inventory in the current model, so parent + child double deduction does not occur.

### 8. Package history

At sale/order commitment, the Menu Paket composition used by the transaction must be snapshotted or otherwise made historically immutable for inventory reversal, audit, and reporting. Later edits to the Package definition must not rewrite historical transactions.

### 9. Target persistence shape

Keep Product and Menu concerns separate:

```sql
products
  id
  brand_id
  ...
  sku NULL

menus
  id
  brand_id
  menu_type       -- SINGLE | PACKAGE
  ...

menu_items
  menu_id
  product_id
  quantity
  sort_order
```

`menu_items` is the composition relation for Menu Paket. Menu Satuan has exactly one `menu_items` row under the current conceptual model.

`menus.menu_type = SINGLE` means one Product; `menus.menu_type = PACKAGE` means two or more Products.

The exact physical schema may be adjusted during technical reconciliation, but the domain separation is now the canonical target.

### 10. Cycle/recursion boundary

Menu Paket components reference **Products only**. A Menu cannot contain another Menu, so there is no recursive Package → Package composition in the current model.

### 11. Transaction flow

```text
Customer/POS sells Menu
        ↓
resolve Menu type
        ├─ SINGLE → Product SKU (if any)
        └─ PACKAGE → component Product SKUs
        ↓
build stock consumption plan
        ↓
validate all required Branch stock atomically
        ↓
apply deductions
        ↓
append inventory movements
        ↓
commit
```

No partial component deduction is allowed.

### 12. Status

This is now a **LOCKED SUB-DECISION in the proposal**, not a production implementation. It supersedes the earlier `Kelengkapan`-driven Product composition model for this new concept. Existing authoritative production inventory contracts on `main` remain unchanged until the final Xentra Product/Menu contract is explicitly promoted.
## 🔒 LOCKED SUB-DECISION — Menu Paket Component Quantity — 2026-10-03

Menu Paket component quantity is part of the Menu Paket definition.

Rules:
1. Each component line stores a fixed positive integer `quantity`.
2. The same Product may be used with quantity greater than 1; duplicate Product records are not created.
3. Customer/cart Qty changes the number of complete Package units and never edits component quantities.
4. Inventory consumption for a component is `package_sale_qty × component_qty`.
5. Package availability is calculated from component stock divided by required component quantity; the limiting component determines the maximum complete Package units available.
6. A Package with only one Product unit is treated as Menu Satuan, not Menu Paket.
7. Quantity changes to an existing Menu Paket affect future sales only. Historical orders keep the component quantities that applied at the transaction.

Reference alignment: Odoo Kit/BoM explicitly records component quantities and scales them for the sold kit quantity; WooCommerce Product Bundles supports per-component quantities and multiple instances of the same product; Square exposes component Quantity in bundle editing. citeturn277241search0turn277241search13turn277241search10

**Status:** LOCKED SUB-DECISION for proposal only. `main` remains unchanged.

## 🔒 LOCKED SUB-DECISION — Inventory Quantity Belongs to Inventory Domain — 2026-10-03

The **quantity of stock on hand is an Inventory-domain value**, not a Menu-domain value.

Rules:

1. Product creation establishes the Product identity and, when SKU is present, that the Product is stock-managed.
2. Creating or assigning a SKU does **not** create a stock quantity.
3. Menu Satuan and Menu Paket define **selling composition/quantity**, not Branch stock on hand.
4. Branch stock quantities are entered, received, counted, adjusted, transferred, or otherwise mutated through the **Inventory domain**.
5. The physical stock remains Branch-scoped. The existing Xentra production contract uses `branch_products.stock` as the physical stock boundary owned by Inventory; the future schema may normalize this further without changing the domain ownership.
6. Menu Paket component quantity is a commercial composition quantity (for example `Nasi ×2` inside a Package). It must never be confused with `Nasi stock = 2`.

Conceptually:

```text
MENU DOMAIN
  Paket Keluarga
  └─ Nasi ×2          ← composition quantity

INVENTORY DOMAIN
  Branch A
  └─ Nasi SKU NASI-001
     Stock on hand = 87  ← inventory quantity
```

### SKU lifecycle

SKU is a Product attribute and may be generated or manually assigned.

Current target behavior:

- Assign SKU → Product becomes stock-managed; no stock quantity is fabricated.
- Edit SKU → allowed while retaining the same Product ID and Branch stock identity; the change must be auditable.
- Historical inventory movements and transaction snapshots must remain identifiable after an SKU change. A future physical implementation should preserve prior SKU values through an SKU history/audit record or equivalent immutable snapshot.
- Remove SKU → changes the Product from stock-managed to non-stock. To avoid orphaning physical stock, Core must block SKU removal while any active Branch holds positive stock for that Product. After stock reaches zero and no blocking inventory operation remains, SKU removal may proceed as an audited Product change.
- A removed/old SKU must not be silently reassigned to another Product while historical references would become ambiguous; exact SKU reuse policy is a technical reconciliation detail.

The purpose is to keep the semantic contract simple:

```text
SKU      → Product stockability / stock identity
Stock Qty → Inventory domain
Menu Qty  → Menu composition or customer order quantity
```

Reference cross-check: Shopify allows SKU edits on existing products/variants and maintains inventory adjustment history separately; Square likewise treats stock quantities as inventory operations on stock-tracked item variations. These references support separating identifier management from stock quantity management; Xentra intentionally makes that separation stricter by assigning stock-quantity ownership to Inventory. citeturn487219search4turn487219search1turn487219search2

**Status:** LOCKED SUB-DECISION for the proposal only. `main` remains unchanged.
## 🔒 LOCKED SUB-DECISION — Menu Price Ownership

**Decision date:** 2026-10-03

The canonical **selling price belongs to the Menu layer**, not the atomic Product layer.

Rules:

1. Product is the atomic catalog/stock unit and does not carry the canonical customer selling price.
2. Menu Satuan has its own selling price.
3. Menu Paket has its own explicit package selling price.
4. The same Product may be referenced by multiple Menus with different selling prices without duplicating the Product or SKU.
5. Package price is never inferred by summing current Product selling prices; the Owner explicitly defines the Menu Paket price.
6. Any future Branch-specific price override must attach to the Branch's adopted Menu/selling configuration, not mutate the Product's stock identity.
7. Historical orders snapshot the effective selling price and Menu presentation at transaction time.

Example:

```text
Product Nasi [SKU NASI-001]
│
├─ Menu Satuan: Nasi Putih       Rp8.000
├─ Menu Satuan: Nasi Dingin      Rp7.000
└─ Menu Paket: Ayam + Nasi       Rp35.000
```

All three can consume the same `NASI-001` stock when Nasi is a stock-managed Product.

Reference alignment: Toast supports menu-specific pricing for the same menu item and Square models price on the sellable item variation while inventory is tracked separately. These patterns support keeping customer selling price with the sellable menu/variation layer rather than using stock identity as the price authority. citeturn201158search1turn201158search2

**Status:** LOCKED SUB-DECISION for the proposal only. `main` remains unchanged.

## 🔒 LOCKED SUB-DECISION — Product Internal Name

**Decision date:** 2026-10-03

Product remains a human-manageable atomic entity and therefore requires an internal Product name/label for Owner, Inventory, Menu selection, reporting, and operational interfaces.

Rules:
1. Product name is an **internal/catalog identity label**, not the customer-facing Menu title.
2. Product name may be simple and atomic, for example `Ayam`, `Nasi`, `Sambal Ijo`, `Lalapan`, `Es Teh`, `Kopi Americano`.
3. Product name is independent from Menu Category, Sub Category, Rasa, Level/Pedas, customer title, and selling price.
4. The same Product name/SKU may be referenced by multiple Menus.
5. Menu-specific customer presentation must never be reconstructed by exposing the Product internal name as the canonical Menu title when the Menu has its own presentation.
6. Product internal name remains stable enough for administrative selection, while Product ID is the immutable technical identity.

Conceptually:

```text
PRODUCT
Nasi
SKU NASI-001

MENU SATUAN
Nasi Putih
→ Product Nasi

MENU PAKET
Ayam Bakar Sambal Ijo + Nasi
→ Product Nasi
```

The earlier statement that the free-text Product Name is removed is therefore interpreted as: **removed as the customer-facing Menu title source, not removed as the internal atomic Product label.**

**Status:** LOCKED SUB-DECISION for proposal only. `main` remains unchanged.

## 🔎 PRE-LOCK AUDIT — Decisions vs Existing Notion/Git

**Audit date:** 2026-10-01

This section records what is already locked in current Xentra documentation, what can be carried forward, what conflicts with the new concept, and what is still open.

### Existing locks that are compatible and should be carried forward

- Master Product is Owner/Brand-owned; Branch only adopts approved Master Products.
- Branch Product ↔ Branch Category is branch-local many-to-many; one adopted Product may appear in multiple Branch Categories.
- Branch Manager may create/rename/reorder/delete its own Branch Categories subject to dependency/integrity rules.
- Branch does not create Branch-owned Products or Bundles.
- Inventory is the authority for sellable Product stock and movement history.
- Product media uses the canonical Media Engine; Product and Category remain separate semantic media types; Branch Product Photo Override is not an active delivery authority.
- Package/Bundle is an Owner/Master Catalog capability; Branch adopts it and does not create branch-owned bundles.
- Promotion remains a separate domain from Bundle/Package.
- Shared UI shells/primitives and contextual Bottom Sheet/Modal patterns remain part of the Xentra UI architecture.

### Existing locks that are being OVERWRITTEN by the new Xentra concept

The following legacy semantics are explicitly overwritten for the new Xentra direction:

1. **products.name → Customer title** → **OVERWRITE**. Customer title now comes from **Sub Category**.
2. **Nama Produk required free-text field** → **OVERWRITE** as the customer-facing Menu title. Product retains an internal atomic name/label; Menu owns customer-facing taxonomy and presentation.
3. **Rasa optional** → **OVERWRITE** at the old Product-identity layer. Rasa now belongs to Menu identity/presentation; `Original` is the default Menu Rasa baseline.
4. **Branch Customer Display Name Override (branch_products.name_override)** → **OVERWRITE / CANCEL**. Branch must not rename or redefine the Master Product.

The old decisions remain preserved as historical implementation records. They are no longer the target design for the new Xentra model.

Technical reconciliation is still required in schema, resolver, API, migration, reporting/history, tests, and retirement/quarantine of legacy paths before implementation is promoted.
### New decisions discussed here that are NOT yet fully locked

- Exact physical schema for `sub_categories` and Product → Sub Category.
- Exact physical uniqueness key and normalization rules for Menu identity: Sub Category + Rasa.
- Exact implementation of usage-derived Rasa availability without a separate manual compatibility matrix.
- Product ID / identity-history model for long-term reporting after in-place identity edits.
- Reporting semantics when one Product ID has different current identities over time.
- Exact distinction and UI contract for Add-on versus Product Options where both are used by existing Xentra POS contracts.
- Exact Package revenue/reporting allocation and order-snapshot treatment.
- Detailed Product Options domain contract: option values, add-on pricing, inventory interaction, UI, and order representation.
- Category archive cascade and restoration semantics.
- Complete migration mapping from existing `products.name` values to internal Product names and Menu Sub Category/Rasa values.
- Compatibility treatment for existing Branch `name_override` data before the old field is retired.

### Decisions already made in this conversation and now recorded in this proposal

- Product/Menu separation: Product is atomic; Menu Satuan references 1 Product; Menu Paket references 2+ Products; Category + Sub Category + Rasa belong to Menu, with Menu uniqueness defined by Sub Category + Rasa.
- Duplicate Menu identity is based on Sub Category + Rasa within Brand, regardless of Category parent; duplicate creation shows a blocking warning with CTA [ Tutup ].
- The same Product may be reused by multiple Menus; Branch adopts Menus for sales while Inventory remains Product/SKU-based.
- Level is a generic domain concept; food UI may label it Pedas; presentation/configuration is reusable in Shared.
- The earlier `Kelengkapan → Paket mode` concept is superseded. Current model uses Menu Satuan vs Menu Paket; Product remains atomic.
- Product Options remains a separate domain; its pricing/add-on and operational rules are intentionally deferred.
- Rasa is reusable Master data, not a child taxonomy node.
- Rasa reuse is contextual at the Menu layer; no manual Rasa↔Sub Category compatibility matrix is required.
- Independently sellable additions such as Sambal Matah are Products, not Add-ons.
- Menu identity edits are handled at the Menu layer; the old Product identity-edit rule is superseded.
- Changing Menu Category warns and, after confirmation, resets downstream Menu Sub Category and Rasa in the draft.
- Sub Category rename remains allowed but its impact is on Menus using that Sub Category; affected customer titles are warned before save.
- Populated taxonomy uses archive-first lifecycle; no automatic Product migration.
- Duplicate Menu identity is blocked with the single-CTA `[ Tutup ]` warning; there is no direct Edit CTA from the warning.
- Branch Product rename override is cancelled for the new concept.

### Current source-of-truth rule

Until a final new locked decision explicitly supersedes current production contracts, existing authoritative Notion/Git decisions remain the production reference.

The new proposal is a pre-lock target. It is not permission to implement conflicting semantics.