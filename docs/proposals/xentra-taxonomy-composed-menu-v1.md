# Xentra — Taxonomy & Composed Menu Concept v1

**Status:** PROPOSAL — NOT LOCKED  
**Date:** 2026-10-01  
**Scope:** Master Catalog, Owner Product Editor, Master Reference, Customer PWA, Merchant adoption/read model

> This document is a pre-lock architecture proposal. Existing LOCKED decision documents remain authoritative until a later explicit decision supersedes them.

## 1. Purpose

Evaluate a single Xentra-wide product/catalog concept in which:

- **Category** is a parent taxonomy node.
- **Sub Category** is a child taxonomy node of Category.
- **Sub Category name is the primary customer-facing menu title.**
- **Rasa** is a reusable master vocabulary that may be associated with multiple Sub Categories.
- A Product remains a stable catalog entity for pricing, inventory, adoption, orders, reporting, and references.
- No separate Xentra-vs-client product architecture is introduced.

The goal is to validate the concept end-to-end before changing the canonical Xentra contract.

## 2. Human mental model

The Owner should experience the Product Editor as composing a menu item:

```
Category
[ Ayam ▼ ] [+]

Sub Category
[ Ayam Tulang Lunak ▼ ] [+]

Rasa
[ Lombok Ijo ▼ ]

Level
[ Pedas ▼ ]

☐ Aktifkan Kelengkapan
```

Normal Product customer presentation:

```
Ayam Tulang Lunak
Lombok Ijo
Pedas 3
```

When **☐ Aktifkan Kelengkapan** is checked, the editor enters Paket composition mode and reveals the Package composition fields, including the component Product list and Paket price.

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

## 4. Product identity under evaluation

The Product remains an entity with a stable `products.id`.

The new conceptual difference is that Product Name is no longer the primary authored customer title.

Target conceptual mapping:

```
products.id          → Product identity
sub_categories.id    → Product title source
menu_flavors.id      → Product subtitle source (optional)
product_complements  → Product detail
product_levels       → Product indicator
Category             → Product grouping/classification
```

Under the normal Product model, the identity combination is Category + Sub Category + Rasa. Therefore two normal Products must not differ only by Complement while keeping the same identity tuple.

Example:

```
Product A
  Sub Category = Ayam Bakar
  Rasa         = Original

Product B
  Sub Category = Ayam Bakar
  Rasa         = Lombok Ijo
```

They are different Product identities.

Complements are non-identity purchase configuration attached to the Product. A Product may still contain the same or different Complement configuration only where the surrounding Product identity is different.

The product ID remains the stable technical identity for orders, inventory, adoption, promotions, and references.

## 5. Category should not be duplicated on Product without a reason

Under a strict taxonomy model, Sub Category already determines its parent Category.

Therefore the preferred canonical relationship is:

```
products.sub_category_id
        ↓
sub_categories.category_id
        ↓
categories.id
```

Keeping both `products.category_id` and `products.sub_category_id` as independently writable canonical fields would create a consistency risk.

If the existing `products.category_id` column must remain temporarily for compatibility, it should become derived/validated compatibility state during migration rather than a second source of truth.

## 6. Owner Product Editor behavior

Initial state:

```
Category
[ <empty> ▼ ] [+]

Sub Category
[ <empty> ▼ ] [+]

Rasa
[ <empty> ▼ ] [+]

Level
[ <empty> ▼ ]

☐ Aktifkan Kelengkapan

...
```

After Category selection:

```
Category
[ Ayam ▼ ] [+]

Sub Category
[ <empty> ▼ ] [+]
```

The Sub Category selector MUST query only children of the selected Category.

The Sub Category `+` button inherits the selected Category context.

Quick-add flow:

```
Tambah Sub Kategori

Kategori
[ Ayam ]                  ← read-only / fixed context

Sub Kategori
[ __________________ ]

[Simpan]
```

Save payload must carry the parent explicitly:

```json
{
  "category_id": "CATEGORY_AYAM",
  "name": "Ayam Tulang Lunak"
}
```

After successful creation, the selector refreshes and the new Sub Category becomes selected.

## 7. Rasa selector behavior

After Sub Category is selected:

```
Sub Category
[ Ayam Tulang Lunak ▼ ]

Rasa
[ <empty> ▼ ] [+]
```

The Rasa selector SHOULD display Rasa values that have already been used by Products under the selected Sub Category. This relationship is usage-derived; no separate manual "Rasa ↔ Sub Category" management surface is required in the new concept.

Rasa quick-add inherits the selected Sub Category context.

Quick-add flow:

```
Tambah Rasa

Sub Kategori
[ Ayam Tulang Lunak ]      ← read-only / fixed context

Rasa
[ __________________ ]

[Simpan]
```

Save semantics:

1. Check the current Brand Master Rasa vocabulary for the normalized name.
2. If the Rasa does not exist, create one Master Rasa record.
3. If the Rasa already exists, offer contextual reuse for the current Sub Category/Product flow rather than creating a duplicate Master Rasa.
4. Save the Product using the existing/reused Rasa ID.
5. The Product then establishes that Rasa's usage under the selected Sub Category.
6. Refresh the Rasa selector and auto-select the selected Rasa for the current Product draft.

The system must not require the Owner to maintain a separate compatibility matrix just to reuse an existing Rasa.

## 8. Downstream reset rules

Parent changes invalidate downstream selections.

### Category changes

```
Category changes
      ↓
Sub Category reset
      ↓
Rasa reset
```

### Sub Category changes

```
Sub Category changes
      ↓
Rasa reset IF current Rasa is not associated with the new Sub Category
```

The UI must never preserve an impossible combination such as:

```
Category = Minuman
Sub Category = Ayam Geprek
```

or:

```
Sub Category = Ayam Bakar
Rasa = Lombok Ijo
```

when that association has not been authorized.

Backend validation MUST enforce the same rule even when the client is bypassed.

## 9. Taxonomy governance

Owner is the authority for Master taxonomy.

Owner may:

- create Category;
- edit Category;
- deactivate Category;
- create Sub Category under a selected Category;
- edit Sub Category;
- deactivate Sub Category;
- create/reuse Rasa;
- associate Rasa with Sub Category;
- remove a Sub Category ↔ Rasa association.

Master reference management remains separate from Product composition.

The Product Editor may offer contextual `+` quick-add actions but must not become a second unrestricted Master Reference management surface.

## 10. Referential integrity requirements

The engine must reject:

- a Sub Category whose Category belongs to another Brand;
- a Product using a Sub Category from another Brand;
- a Product using a Rasa from another Brand;
- a Product selecting a Rasa that is not associated with its Sub Category;
- duplicate normalized Sub Category names under the same Category;
- duplicate normalized Rasa names within the same Brand;
- duplicate Sub Category ↔ Rasa association rows.

The UI is not the authority. Core validation is the authority.

## 11. Customer read model

Customer PWA must consume one resolved Menu View Model.

Target mapping:

```
title       ← sub_categories.name
subtitle    ← menu_flavors.name (nullable)
detail[]    ← Product-specific detail/option data
indicator   ← Level value/presentation (current food UI label: "Pedas")
image       ← Master Product media
price       ← Master Product / Pricing Policy
availability← Branch operational state
categories[]← Branch Category memberships
options     ← existing Product Options contract
```

Customer code must not reconstruct this model by joining raw database concepts.

## 12. Order and historical behavior

At order commitment, Core must snapshot the resolved customer presentation used by the order.

Future taxonomy or Rasa edits must not rewrite historical order display.

Order identity continues to use `product_id`, not the display title.

## 13. Branch adoption

Branch adoption remains separate from Master taxonomy/composition.

**Locked direction for this new concept:** Branch may adopt approved Master Products and classify them into one or more Branch Categories, but Branch must not rename the Master Product or alter its customer-facing Master identity.

Merchant may adopt approved Master Products and classify them into Branch Categories.

Merchant does not edit:

- Master Category;
- Master Sub Category;
- Master Rasa;
- Sub Category ↔ Rasa compatibility;
- Master Product composition.

**The existing Branch Customer Display Name Override is cancelled for the new concept.** Branch naming must not be an independent Product identity/presentation authority. If a Branch needs a different grouping or merchandising label, it should use Branch Categories or another explicitly scoped Branch presentation mechanism that does not rename the Product identity.

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

- Is Sub Category always the customer title, or can a Product opt out?
- Can two Products intentionally share the same Sub Category + Rasa combination?
- Does Complement compatibility need its own Sub Category association model?
- Does Level need compatibility constraints?
- What happens to existing Products whose current `products.name` does not correspond to any Sub Category?
- Is the existing Branch Customer Display Name Override still required?
- Should Branch override be renamed or retired under the new title model?
- What is the canonical search label: resolved title, title + subtitle, or additional hidden keywords?
- How are legacy Products migrated without losing customer-visible identity?
- How are reports, receipts, payment gateways, promotions, KDS/POS, and historical orders kept stable?

## 19. Current conclusion

The concept is technically feasible and can become the single forward Xentra model.

However, **this document deliberately does not lock it yet**. The critical next step is to validate the human workflow and complete the dependency audit before replacing the current `products.name → Customer title` contract.

Until then, no client-specific MyBangjo fork is required and no Xentra-vs-MyBangjo divergence is being introduced.


## 5A. Product Normal vs Product Paket — Pre-lock Direction

### Product Normal

A normal Product identity is:

```
Category + Sub Category + Rasa
```

Normal Product does not include Paket composition. The editor exposes **☐ Aktifkan Kelengkapan** as the explicit switch into Paket mode. Independently sellable additions remain Products; any other purchase-time options must use the explicit Product Options contract.

### Product Paket

A Paket is itself a sellable Product/bundle identity. Its fixed contents are a composition of references to existing Products:

```
Paket Product
  ├── component_product_id → Product A
  ├── component_product_id → Product B
  ├── component_product_id → Product C
  └── ...
```

The Paket does not copy component names or stock values into independent inventory records.

A Paket is a **named, explicitly priced sellable Product** whose fixed contents reference existing Product IDs. Its price is a property of the Paket Product; it is not automatically recalculated from current component prices.

When the Paket is sold, Core must resolve its component Product IDs and apply the corresponding stock/inventory effects to those underlying Products according to the inventory contract.

The component Product IDs remain the source of truth for item identity, stock, reporting references, and historical traceability. The Paket has its own sellable Product identity so that the bundle can have its own customer presentation, price, availability, and promotion eligibility without duplicating the underlying Products.

A separate Paket composition relation is preferred over encoding the bundle as free text or as reusable Complement records.

**Pre-lock note:** the exact order-snapshot and revenue/reporting treatment of a Paket versus its component Products still requires explicit validation before lock.


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


## 🔒 LOCKED SUB-DECISION — Kelengkapan Checkbox Activates Paket Mode

**Decision date:** 2026-10-02

The Product Editor uses a simple checkbox/toggle to activate **Kelengkapan** for the current Product draft.

```
☐ Aktifkan Kelengkapan
```

Behavior:

- **Unchecked** → the Product is a **Normal Product** and the editor does not show Package composition fields.
- **Checked** → the editor enters **Paket mode** and reveals the Paket composition UI.
- Paket mode shows the component Product list and the explicit Paket price; the Paket also has its own Owner-defined display name as required by the locked Paket subtype contract.
- Each included item is referenced by its own **Product ID**. The component remains a real Product for inventory, reporting traceability, and references.
- Checking the box does not create duplicate Product records for the components.
- Unrelated fields of the normal Product editor are not reinterpreted as "Kelengkapan".
- The checkbox is a UI control for choosing the Product subtype/composition mode; the underlying domain remains **Normal Product** versus **Paket Product**.

Conceptually:

```
☐ Aktifkan Kelengkapan
        │
        ├── unchecked → NORMAL
        │              Category + Sub Category + Rasa
        │              + optional Level
        │
        └── checked   → PACKAGE
                       Paket name
                       Component Product IDs
                       Paket price
```

Inventory remains component-driven:

```
Paket P100 sold × 1
  → component P001 stock -1
  → component P002 stock -1
  → component P003 stock -1
```

This is the canonical UX for activating Paket composition. Detailed lifecycle rules for changing an already-published Product between Normal and Paket remain a separate domain edge case and are not implied by the checkbox alone.

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

## 🔒 LOCKED SUB-DECISION — Paket Product Subtype & Component Inventory

**Decision date:** 2026-10-02

A **Paket is a Product subtype with its own identity model**. It remains a sellable Product, but it is not required to satisfy the normal Product identity tuple of Category + Sub Category + Rasa.

Locked rules:

1. Paket has its own stable **Product ID**, Owner-defined name, explicitly defined component Product IDs, and explicitly defined Paket price.
2. The normal Product identity rule `Category + Sub Category + Rasa` applies to **Normal Products**, not to Paket.
3. Category/Sub Category may still be used to classify a Paket where the catalog UX requires it, but those taxonomy fields are not the Paket identity key.
4. A Paket is an explicitly created catalog entity. It is never inferred from cart combinations or Promotion rules.
5. **Paket has no independent stock balance.** When a Paket is sold, inventory consumption is derived from its referenced component Product IDs and quantities.
6. The inventory engine must therefore be able to trace a Paket sale down to its component Product stock movements.
7. **Paket cannot contain another Paket.** Package composition may reference Normal Products only under this contract.
8. Payment may treat the Paket as one sellable order item at the Paket price; payment processing does not need to reconstruct the component composition.
9. Revenue/reporting allocation beyond the sellable Paket line versus component inventory consumption remains a separate implementation detail to be finalized.

Conceptual model:

```
PRODUCT
├── NORMAL
│   └── Identity = Category + Sub Category + Rasa
│
└── PACKAGE
    ├── Identity = Package Product ID
    ├── Display Name = Owner-defined Paket name
    ├── Price = Owner-defined Paket price
    └── Components = Normal Product ID + Qty
```

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
## 🔒 LOCKED SUB-DECISION — Normal Product Identity

**Decision date:** 2026-10-01

For a normal sellable Product, the canonical business identity is:

```
Category + Sub Category + Rasa
```

Rasa uses **Original** as the default Master Rasa for normal Product creation, so the normal Product identity is not left incomplete because of a missing/NULL Rasa.

The technical Product ID remains stable and is not itself the human-readable identity. Identity uniqueness is enforced within a Brand.

## 🔒 LOCKED SUB-DECISION — Rasa Is Reusable Master Data

**Decision date:** 2026-10-01

Rasa is a reusable Brand-scoped Master Reference. It is **not** a child taxonomy node of Sub Category.

The Product references the Rasa record by ID.

Rasa usage under a Sub Category is learned from actual Product composition; Owners do not maintain a separate compatibility-management UI.

When a Rasa name already exists, the Product flow reuses the existing Master Rasa record instead of creating another identical Master record.

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
2. **Nama Produk required free-text field** → **OVERWRITE**. Product identity is assembled through **Category → Sub Category → Rasa**.
3. **Rasa optional** → **OVERWRITE**. **Original** is the default Rasa, so the normal Product identity is complete.
4. **Branch Customer Display Name Override (branch_products.name_override)** → **OVERWRITE / CANCEL**. Branch must not rename or redefine the Master Product.

The old decisions remain preserved as historical implementation records. They are no longer the target design for the new Xentra model.

Technical reconciliation is still required in schema, resolver, API, migration, reporting/history, tests, and retirement/quarantine of legacy paths before implementation is promoted.
### New decisions discussed here that are NOT yet fully locked

- Exact physical schema for `sub_categories` and Product → Sub Category.
- Exact physical uniqueness key and normalization rules for Category + Sub Category + Rasa.
- Exact implementation of usage-derived Rasa availability without a separate manual compatibility matrix.
- Product ID / identity-history model for long-term reporting after in-place identity edits.
- Reporting semantics when one Product ID has different current identities over time.
- Exact distinction and UI contract for Add-on versus Product Options where both are used by existing Xentra POS contracts.
- Exact Package revenue/reporting allocation and order-snapshot treatment.
- Exact boundary and activation rules for optional Product Options in Normal Product flows.
- Category archive cascade and restoration semantics.
- Complete migration mapping from existing `products.name` values to Sub Categories and Rasa values.
- Compatibility treatment for existing Branch `name_override` data before the old field is retired.

### Decisions already made in this conversation and now recorded in this proposal

- Normal Product identity = Category + Sub Category + Rasa; Original is the default Rasa.
- Level is a generic domain concept; food UI may label it Pedas; presentation/configuration is reusable in Shared.
- Kelengkapan checkbox activates Paket mode; unchecked is Normal Product, checked reveals Package composition and uses component Product IDs.
- Rasa is reusable Master data, not a child taxonomy node.
- Rasa reuse is contextual; no manual Rasa↔Sub Category management UI is required.
- Independently sellable additions such as Sambal Matah are Products, not Add-ons.
- An identity edit is an in-place Product edit when the target identity is unused.
- Category change warns and, after confirmation, resets downstream Sub Category and Rasa in the draft.
- Sub Category rename is allowed but warns about affected Customer titles.
- Populated taxonomy uses archive-first lifecycle; no automatic Product migration.
- Duplicate Product identity opens a conflict modal, then a read-only detail Bottom Sheet; it never opens the target in Edit mode.
- Branch Product rename override is cancelled for the new concept.

### Current source-of-truth rule

Until a final new locked decision explicitly supersedes current production contracts, existing authoritative Notion/Git decisions remain the production reference.

The new proposal is a pre-lock target. It is not permission to implement conflicting semantics.