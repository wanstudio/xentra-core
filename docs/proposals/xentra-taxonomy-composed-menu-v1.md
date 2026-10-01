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
[ Lombok Ijo ▼ ] [+]

Kelengkapan
[ Sambal ▼ ] [+]
```

Customer presentation:

```
Ayam Tulang Lunak
Lombok Ijo
Sambal
```

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

A Product may therefore share the same resolved title as another Product when other structured composition differs.

Example:

```
Product A
  Sub Category = Ayam Bakar
  Rasa         = Original
  Complement   = Nasi

Product B
  Sub Category = Ayam Bakar
  Rasa         = Original
  Complement   = Kentang
```

Both may legitimately resolve to the same title/subtitle while remaining different Product entities.

The product ID, not the displayed title, remains the stable identity for orders, inventory, adoption, promotions, and references.

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

Kelengkapan
[ <empty> ▼ ] [+]

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

The Rasa selector MUST display only Rasa values associated with that Sub Category.

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

1. Create or reuse a brand-scoped Rasa master record.
2. Create the Sub Category ↔ Rasa association.
3. Return the Rasa ID.
4. Refresh the Rasa selector.
5. Auto-select the new Rasa for the current Product draft.

Duplicate creation must be prevented through normalized uniqueness within the Brand.

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
detail[]    ← ordered menu_complements.name[]
indicator   ← menu_levels.name / structured level value
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

**Pre-lock direction:** Branch may adopt approved Master Products and classify them into Branch Categories, but Branch must not rename the Master Product or alter its customer-facing Master identity.

Merchant may adopt approved Master Products and classify them into Branch Categories.

Merchant does not edit:

- Master Category;
- Master Sub Category;
- Master Rasa;
- Sub Category ↔ Rasa compatibility;
- Master Product composition.

**The existing Branch Customer Display Name Override is proposed for cancellation under this new concept.** Branch naming must not be an independent Product identity/presentation authority. If a Branch needs a different grouping or merchandising label, it should use Branch Categories or another explicitly scoped Branch presentation mechanism that does not rename the Product identity.

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

Add-ons are optional purchase-time additions and are not part of the Product identity.

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


## 🔒 LOCKED SUB-DECISION — Identity Change Does Not Auto-Deactivate the Original Product

**Decision date:** 2026-10-01

When an Owner changes a Product Identity component and the new target identity does not yet exist, the system creates the new Product identity with copied non-identity data, but **the original Product remains active and unchanged**.

The identity-change workflow does not imply deletion, deactivation, replacement, or merge.

Example:

\`\`\`
P001 = Ayam / Ayam Bakar / Original
P002 = Ayam / Ayam Bakar / Lombok Ijo
\`\`\`

After the edit-as-new-identity operation, both Products may remain active.

Product lifecycle remains controlled by the existing explicit Product actions:

- Delete, subject to current integrity/lifecycle rules.
- Active / inactive toggle.

This preserves the existing Owner mental model that changing one identity dimension does not silently remove an existing menu. The Owner explicitly decides whether the original Product should remain available.


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
