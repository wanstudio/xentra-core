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
- **Original is the universal baseline Rasa for Normal Products.** A new Sub Category can always use `Original` without requiring prior usage of that Rasa. **Original is not displayed in Customer UI; non-Original Rasa values remain visible as the Product subtitle.**
- **Rasa** is a reusable master vocabulary that may be associated with multiple Sub Categories.
- A Product remains a stable catalog entity for pricing, inventory, adoption, orders, reporting, and references.
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
- duplicate normalized Category names within the same Brand;
- duplicate normalized Sub Category names within the same Brand, including across different parent Categories;
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

- Does Complement compatibility need its own Sub Category association model?
- Does Level need compatibility constraints?
- What happens to existing Products whose current `products.name` does not correspond to any Sub Category?
- What is the canonical search label: resolved title, title + subtitle, or additional hidden keywords?
- How are legacy Products migrated without losing customer-visible identity?
- How are reports, receipts, payment gateways, promotions, KDS/POS, and historical orders kept stable?
- What is the exact physical uniqueness constraint/normalization implementation for Category names, Sub Category names, and Normal Product identity?

## 19. Current conclusion

The concept is technically feasible and can become the single forward Xentra model.

However, **this document deliberately does not lock it yet**. The critical next step is to validate the human workflow and complete the dependency audit before replacing the current `products.name → Customer title` contract.

Until then, no client-specific MyBangjo fork is required and no Xentra-vs-MyBangjo divergence is being introduced.


## 5A. Product Normal vs Product Paket — Pre-lock Direction

### Product Normal

A Normal Product is one sellable Product identity:

```
Category + Sub Category + Rasa
```

A Normal Product may optionally have **Kelengkapan**. Kelengkapan is an included/composition relationship and does **not** change the Product subtype.

Inventory behavior is determined by the Product's SKU/stock authority, not by the mere existence of components. See the dedicated pre-lock inventory contract below.

### Product Paket

A Paket is a separate sellable Product subtype. Its fixed contents are references to existing Products:

```
Paket Product
  ├── component_product_id → Product A
  ├── component_product_id → Product B
  ├── component_product_id → Product C
  └── ...
```

A Paket is an explicit commercial bundle. It is not inferred from a Normal Product merely because that Product has several components.

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

## 🔒 LOCKED SUB-DECISION — Customer Search Uses Resolved Product Presentation

**Decision date:** 2026-10-02

Customer search must operate on the resolved customer-facing Product presentation, not only the primary title.

Rules:

1. **Title** is searchable.
2. **Subtitle / Rasa** is searchable.
3. Search should resolve against the same Customer Menu View Model used for customer presentation rather than making the Customer PWA reconstruct search fields from raw database tables.
4. A query matching Rasa must be able to find the corresponding Product. Example:
   `"lombok"` finds **Ayam Bakar / Lombok Ijo**.
5. Level/Pedas is not a searchable field for the current concept.
6. Search is discovery, not a second Product identity model. It must not alter the canonical Product identity `Category + Sub Category + Rasa`.
7. Customer search UI uses live search behavior: results update while the customer types; no separate **Cari** submit button is required for this concept.

Conceptually:

```
Product
  title    = Ayam Bakar
  subtitle = Lombok Ijo

resolved search text
  = Ayam Bakar Lombok Ijo

"lombok"
  → Ayam Bakar / Lombok Ijo
```

## 🔒 LOCKED SUB-DECISION — Paket Is Sold as One Whole Unit

**Decision date:** 2026-10-02

For the current Xentra customer/cart model, a Paket is one whole sellable unit. Customer quantity changes the number of complete Paket units purchased.

Rules:

1. One Paket in the cart represents **one complete Paket**, with its fixed composition.
2. Customer/cart control `Qty` changes the **quantity of complete Paket units**, not the quantity of individual component Products.
3. Example:

```
Paket Special Semar
Qty = 3

= 3 complete Paket units
```

4. The Customer UI must not expose component-level quantity controls for a Paket sale.
5. Inventory consumption is derived from the Paket composition for each Paket unit, multiplied by the number of Paket units sold.
6. **Each component listed in a Paket represents one unit per one complete Paket.** The current Paket model does not expose or configure a component Qty field. If the composition contains Ayam Bakar, Nasi, and Es Teh, one Paket contains exactly one of each. Customer Qty is the only quantity control in the current Paket sale model.
7. **Future extension:** component quantity greater than one is considered a valid future capability candidate, but it is not part of the current Paket contract and must be designed separately with its own inventory, reporting, pricing/cost, and UI implications.

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

**Decision date:** 2026-10-02

The human meaning of "Paket" (a combined offering, often perceived as a value/discounted deal) is different from the system meaning. Xentra uses the system definition for persistence and business rules.

Rules:

1. A Paket exists only when the Owner explicitly creates a Product as `PACKAGE`. The system must not infer Paket status merely from multiple Products being sold together, the name containing "Paket", or a lower price/promotion.
2. A Paket is one sellable Product entity with its own Product ID, customer-facing name, and explicit Paket price.
3. The Paket contains a fixed composition of existing Product IDs. The components remain separate Product entities and retain their own identities/data.
4. **Current Xentra inventory contract: a Paket does not have its own SKU or stock balance.** Its stock effect is derived from the stock authority of its referenced component Products.
5. A component Product with a SKU is a stock-managed unit and is consumed according to the Package composition.
6. A component Product without a SKU is non-stock and creates no inventory movement by itself.
7. If a referenced Normal Product without a SKU has its own composition, the inventory resolver may continue through that composition until it reaches stock-managed Products, subject to cycle prevention and validity rules.
8. A Package cannot contain another Package under the current contract.
9. A Paket may optionally participate in a Promotion; Promotion does not create or change Paket identity.
10. The current Package model does not support customer-side reconfiguration of components at purchase time.

Reference alignment: Shopify, WooCommerce, Square, Odoo, and Toast demonstrate fixed bundles/kits and recipe/composition-based stock depletion as established patterns. The Xentra contract intentionally chooses one simplified rule: **Package itself is virtual/non-stock in the current scope; stock authority lives in the referenced Product composition.**

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

## 🔒 LOCKED SUB-DECISION — Historical Reporting Uses Identity at Time of Sale

**Decision date:** 2026-10-02

When a stable Product ID remains the same while its current identity/presentation changes, historical sales reporting must preserve the Product identity/presentation that existed at the time of each transaction.

Rules:

1. Historical sales views group/display the Product using its **identity/presentation at time of sale**, not the Product's current title or current taxonomy.
2. Order history therefore remains stable even when the Product is later edited in place.
3. The stable **Product ID** remains available as a separate analytical dimension, so lifetime or cross-identity analysis can aggregate transactions belonging to the same Product ID.
4. The reporting model must support both perspectives without rewriting historical transaction data:
   - **Historical identity view** → what was sold at that time.
   - **Stable Product ID view** → what the technical Product entity has sold across its lifetime.
5. This does not require changing the Product ID when Category, Sub Category, or Rasa changes, provided the target identity is unique and the edit follows the locked in-place identity-change rule.
6. Historical order/menu snapshots remain authoritative for historical customer-facing presentation; reports must not reconstruct historical names from the current Product record.

Conceptually:

```
P001 current
  → Ayam Bakar / Lombok Ijo

Historical sales
  Jan → Ayam Bakar / Original   100
  Feb → Ayam Bakar / Lombok Ijo 80

Historical identity view
  → Original 100
  → Lombok Ijo 80

Stable Product ID view
  → P001 total 180
```

This is a reporting/history contract. Exact physical reporting schema and identity-version storage remain implementation details to be finalized during the technical reconciliation phase.

## 🔒 LOCKED SUB-DECISION — Level Pedas Is Informational, Not a Customer Request

**Decision date:** 2026-10-02

For the current Xentra food-menu concept, Level/Pedas is a Product presentation attribute that communicates the menu's configured level. It is not a customer customization/request field.

Rules:

1. The Owner sets the Product's Level Pedas value in Master Product data.
2. Customer PWA displays that value as information when Level Pedas is enabled.
3. Level Pedas does not create a customer selection step in the current order flow.
4. A customer's ad-hoc offline request for a different spice level than the configured Product value is handled operationally by people and is not represented as a separate system request in the current Xentra model.
5. The current Level Pedas value remains part of the Product's resolved presentation/history according to the existing snapshot rules.

## 🔒 LOCKED SUB-DECISION — Current Level Pedas Product Editor UI

**Decision date:** 2026-10-02

For the current Xentra food-menu concept, Level Pedas is activated directly from the Product Editor by checkbox rather than through a preset/range configuration sheet.

Rules:

1. Product Editor shows Category → Sub Category → Rasa → **☐ Aktifkan Level Pedas** → **☐ Aktifkan Kelengkapan**.
2. When **Aktifkan Level Pedas** is checked, the Level Pedas control appears directly underneath.
3. First activation defaults to **Level 1**.
4. While active, Level Pedas cannot be empty.
5. The current food UI uses four selectable positions for Level Pedas.
6. Unchecking the checkbox sets Level to **NULL** and hides the Level Pedas control.
7. The four positions are current food UI behavior only; they do not constrain the generic Level domain or future menu contexts.
8. Variant/Variation remains a separate future domain discussion covering pricing, SKU, inventory, cart, order, payment, POS, and reporting.

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

## 🧭 PRE-LOCK — Product / Composition / Package / Inventory Contract

**Decision status:** PROPOSED / PRE-LOCK — 2026-10-02

This section reconciles the new Product/Package concept with the existing authoritative Xentra Inventory model (`branch_products.stock` + immutable `inventory_movements`) and with patterns documented by Toast, Odoo, Shopify, WooCommerce, and Square.

### 1. Core principle

For the Xentra concept, the simplest durable rule is:

> **A Product with a SKU is a stock-managed whole. A Product without a SKU is not a stock-managed whole.**

SKU assignment may be manual or generated by the system. The source of the SKU does not change its business meaning.

```
Product
  ├── SKU exists
  │    → Product itself is stock-managed
  │    → branch stock can be maintained for that Product
  │
  └── SKU is NULL
       → Product itself is non-stock
       → stock, if any, must come from its composition
```

This is a **Xentra business rule**, not a claim that all SaaS products universally use SKU existence as the stock-tracking switch. Existing SaaS references expose separate inventory controls; Xentra intentionally simplifies that relationship for this product model.

### 2. Product without composition

```
Nasi
SKU = NASI-001

→ stock authority = Nasi
→ Branch stock = whole ready-to-sell units
```

Sale of 1:

```
NASI-001 -1
```

### 3. Normal Product with Kelengkapan

Kelengkapan does not create Package semantics.

#### A. Parent Product has SKU

```
Ayam Bakar Komplit
SKU = AYKOM-001

Kelengkapan:
- Ayam
- Nasi
- Lalapan
```

The parent is a stock-managed whole:

```
Sale ×1
→ AYKOM-001 -1
```

Component references describe the Product's included content. Their presence must **not** cause an automatic second stock deduction, otherwise the same sale would consume both the finished Product and its components.

This is the **whole-stock mode**.

#### B. Parent Product has no SKU

```
Ayam Bakar Komplit
SKU = NULL

Kelengkapan:
- Ayam        [SKU AYAM-001]
- Nasi        [SKU NASI-001]
- Lalapan     [no SKU]
```

The parent is non-stock. Inventory consumption is resolved through its composition:

```
Sale ×1
→ AYAM-001 -1
→ NASI-001 -1
→ Lalapan = no inventory movement
```

The rule is not that Xentra prioritizes one component over another; **only components that are explicitly stock-managed (SKU exists) can affect inventory**. If Ayam must be counted as stock, Ayam must itself be represented as a stock-managed Product with a SKU.

This is the **composition/recipe stock mode**.

### 4. Package

Current Xentra Package is a **virtual fixed composite**:

```
Paket Super Hemat
SKU = NULL

Components:
- Ayam       [SKU AYAM-001]
- Nasi       [SKU NASI-001]
- Es Teh     [SKU ESTE-001]
```

The Package has no stock balance of its own.

A sale of one Package resolves to:

```
AYAM-001 -1
NASI-001 -1
ESTE-001 -1
```

The Package itself is still one commercial order line and one customer quantity unit.

### 5. "SKU di dalam SKU"

A composition can reference Product records that themselves have SKUs. Therefore a stock-managed Product can structurally be a component of another Product/Package.

However, **stock authority is singular per sold layer**:

```
Parent has SKU
→ parent is the stock authority
→ do not also deplete child stock for that same parent sale

Parent has no SKU
→ resolve component composition
→ deplete stock-managed descendants
```

This prevents double deduction.

The current Package does not need a parent SKU. A future "finished/assembled Package stock" workflow could introduce a stockable parent SKU, but that would be a separate Production/Assembly capability rather than an implicit feature of Package creation.

### 6. Recursive resolution and cycle prevention

The inventory engine should resolve a sellable Product into a **Stock Consumption Plan** before writing any inventory movement.

```
Sale Product
  ↓
Is Product SKU-managed?
  ├── YES → consume parent SKU only
  └── NO  → inspect composition
             ├── child SKU → consume child SKU
             ├── child non-SKU + composition → recurse
             └── child non-SKU + no composition → no stock effect
```

The resolver must reject composition cycles:

```
A → B → A
```

and must produce a deterministic flattened plan:

```
{ product_id, sku, branch_id, quantity, source_path }
```

Before mutation, aggregate duplicate SKU/Product references so one sale cannot create contradictory movements for the same stock identity.

### 7. Physical database target

The proposal should use **one Product composition engine** for both Normal Product Kelengkapan and Package composition. Creating separate `product_components` and `package_components` tables would duplicate structural logic and force the inventory resolver to understand two parallel composition systems.

Target model:

```sql
products
  id
  brand_id
  product_type        -- NORMAL | PACKAGE
  ...
  sku NULL
```

with a **Brand-unique normalized SKU** when non-NULL.

Shared composition relation:

```sql
product_compositions
  parent_product_id
  component_product_id
  quantity
  sort_order
```

Semantics come from the **parent Product type**, not from a second table:

```
parent.product_type = NORMAL
→ composition = Kelengkapan / included components

parent.product_type = PACKAGE
→ composition = fixed Paket components
```

This gives one structural path:

```
Product
  ↓
Product Composition
  ↓
Component Product
```

while preserving different domain meaning at the Product subtype level.

Current UI/business constraints:

- Normal Product may have zero or more composition rows when Kelengkapan is enabled.
- Package composition contains existing Product IDs only.
- Package cannot contain another Package under the current contract.
- Current Package component quantity is one unit per Package; the physical relation may keep a `quantity` field, but current Package creation does not expose a component-quantity editor and Core should enforce `quantity = 1` for PACKAGE until a future decision expands this.
- Composition cycles must be rejected.

Existing `branch_products.stock` remains the Branch-level stock balance for SKU-managed Products. Non-SKU Products should not receive a stock balance.

The inventory ledger continues to record the actual Product/SKU stock identity that moved:

```text
inventory_movements.product_id = stock-managed Product
inventory_movements.quantity = signed movement
inventory_movements.reference_id = source order / transfer / etc.
```

The Package itself does not get an inventory ledger entry in the current virtual-package model.

This shared composition structure means the inventory engine only needs **one resolver**:

```
Sale
 ↓
resolve Product
 ↓
if parent has SKU → consume parent only
if parent has no SKU → walk product_compositions
 ↓
consume descendant SKU authorities
```

The resolver therefore remains generic across Normal Product Kelengkapan and Package without creating separate inventory engines.

### 8. Creation and adoption lifecycle

Creating a Product does **not** fabricate Branch stock.

```
Create Master Product
      ↓
SKU?
├── no  → Product exists, non-stock
└── yes → Product is stockable
            ↓
       Branch adopts product
            ↓
       Inventory stock can be initialized/received/adjusted
```

This preserves the existing Xentra boundary that **Branch assignment is not itself an inventory mutation** and stock is owned by the Inventory domain.

For a non-SKU Product, `branch_products.stock` remains NULL/non-stock semantics rather than an arbitrary quantity.

### 9. Sale transaction contract

At the inventory-consumption boundary:

```
Order reaches accepted/confirmed stock boundary
      ↓
Build Stock Consumption Plan
      ↓
Validate all required stock balances atomically
      ↓
Apply all stock deductions in one transaction
      ↓
Append inventory_movements for every actual stock movement
      ↓
Commit
```

No partial success is allowed.

If any required stock-managed Product lacks sufficient Branch stock, the transaction must fail as an inventory conflict rather than decrementing only some components.

For Xentra's current ready-to-sell model, this remains aligned with the existing acceptance → sellable stock decrease boundary.

### 10. Availability contract

For a Product with parent SKU:

```
availability = parent Branch stock / operational availability
```

For a non-SKU Product with composition:

```
availability = all required stock-managed descendants are sufficiently stocked
```

For a Package:

```
availability = all required component stock authorities are sufficiently stocked
```

A non-SKU component that has no stock authority never makes a Product unavailable due to inventory quantity, because Xentra does not track it as stock.

### 11. Critical invariants

The inventory engine must enforce:

1. **SKU is nullable.**
2. **Non-NULL SKU = stock-managed Product.**
3. **NULL SKU = non-stock Product.**
4. A Product cannot simultaneously use parent-stock and child-stock depletion for the same sale.
5. Package has no stock balance in the current contract.
6. Package composition cannot contain another Package.
7. Composition cycles are rejected.
8. A stock movement must reference a stock-managed Product/SKU.
9. Product creation/adoption does not itself invent stock quantity.
10. Sale-time stock mutations are atomic and idempotent.
11. Historical orders keep their own snapshots and are not rewritten by later Product/composition edits.

### 12. Explicit examples

```
A. Nasi
   SKU NASI-001
   → whole stock item

B. Ayam Bakar Komplit
   SKU AYKOM-001
   Components: Ayam, Nasi, Lalapan
   → stock whole = AYKOM-001

C. Ayam Bakar Komplit
   no SKU
   Components: Ayam[SKU], Nasi[SKU], Lalapan[no SKU]
   → stock = AYAM-001 + NASI-001

D. Paket Super Hemat
   no SKU
   Components: Ayam[SKU], Nasi[SKU], Es Teh[SKU]
   → stock = AYAM-001 + NASI-001 + ESTE-001
```

### 13. Reference cross-check

- Toast Inventory documents recipe-driven stock depletion and notes that stock can be held at ingredient or prep-item level.
- Odoo Kit documentation allows a sellable kit to be represented as a product with component Products and a configurable inventory treatment.
- Shopify/WooCommerce/Square document fixed bundles/kit-style relationships in which a sellable bundle can coexist with component-level inventory tracking.

These references support the architectural distinction between a sellable composite, whole-stock Product, and component-driven stock depletion; they do not force Xentra to copy any vendor's exact UI or data model.

### 14. Status

This is a **pre-lock target model**. It supersedes contradictory inventory statements elsewhere in this proposal, but it does not yet supersede the authoritative production inventory contract on `main`.

Final lock should happen only after the complete Product/Package/Inventory dependency audit is reconciled across Catalog, Branch adoption, POS, Order, Reporting, Purchasing, and any future Production/Recipe domain.

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
- Detailed Product Options domain contract: option values, add-on pricing, inventory interaction, UI, and order representation.
- Category archive cascade and restoration semantics.
- Complete migration mapping from existing `products.name` values to Sub Categories and Rasa values.
- Compatibility treatment for existing Branch `name_override` data before the old field is retired.

### Decisions already made in this conversation and now recorded in this proposal

- Normal Product identity = Category + Sub Category + Rasa; Original is the default Rasa.
- Level is a generic domain concept; food UI may label it Pedas; presentation/configuration is reusable in Shared.
- Kelengkapan checkbox activates Paket mode; unchecked is Normal Product, checked reveals Package composition and uses component Product IDs.
- Product Options remains a separate domain; its pricing/add-on and operational rules are intentionally deferred.
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