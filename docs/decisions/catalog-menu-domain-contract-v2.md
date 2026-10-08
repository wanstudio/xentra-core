# Xentra — Catalog / Menu Domain Contract v2

**Status:** 🔒 LOCKED / AUTHORITATIVE  
**Decision date:** 2026-10-08  
**Supersedes:** `docs/decisions/catalog-menu-domain-contract-v1.md`  
**Related authority:** `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

## 1. Decision Summary

The forward Catalog/Menu model is:

```
Catalog — Owner Master Catalog
├── Menu
└── Category

Menu
├── Category (grouping/classification)
├── Title (customer-facing commercial name)
└── Menu Items
     └── optional Item Choices

“Master Menu” / “Menu Master” is a UI/workspace label for an Owner-managed Menu in this master catalog. It is not a second Menu entity.
```

This contract supersedes the earlier model that treated Category + Sub Category + Rasa as the universal Menu identity.

There is **no universal Category → Sub Category → Rasa hierarchy for Menu identity**.

## 2. Category

Category is a grouping/classification context for Menus.

Rules:
- a Menu belongs to the applicable Category context;
- Category is not the parent of the Menu Title;
- Category does not own Menu composition, Item stock, Recipe, Material, or price;
- Category can be created inline from the Menu Editor using the existing Owner master-data authority.

## 3. Menu Title

Title is the commercial/customer-facing name of the Menu.

The Owner enters the Title directly.

Examples:

- `Ayam Tulang Lunak Geprek + Nasi + Es Teh`
- `Kentang Goreng Balado`
- `Cappuccino`
- `Paket Hemat Ayam Geprek`

The Title is not generated mechanically from Item names.

A Menu has its own immutable `menu_id` technical identity.

## 4. Menu Identity

The authoritative technical identity is `menu_id`.

Business duplicate prevention must use the Menu business fields that are explicitly defined by the current commercial contract; it must **not** assume a universal Sub Category/Rasa composite key.

The following are not universal Menu identity fields:
- Sub Category;
- Rasa;
- Pedas level;
- Item composition;
- Item SKU.

Two Menus may share a Category and may use similar Items but remain separate commercial Menus because their Menu identity/content/title/pricing is different.

Exact duplicate-prevention constraints must be designed against the current Menu identity fields before migration; no legacy unique index may be treated as authoritative by assumption.

## 5. Rasa and Other F&B Dimensions

Rasa is **not** a mandatory third Menu hierarchy level.

Other common F&B dimensions include:
- Sambal;
- Level Pedas;
- Ukuran;
- Suhu;
- Rasa;
- Topping;
- Filling;
- Preparation;
- merchant-specific choices.

When a dimension is needed for a particular Menu Item, it is represented through the **Item Choice contract**.

Rasa may remain as legacy/reference data in the current implementation, but new Menu identity must not depend on `rasa_id`.

## 6. Menu Composition

A Menu is composed from one or more Menu Items:

```
Menu
├── Menu Item A × quantity
├── Menu Item B × quantity
└── Menu Item C × quantity
```

Rules:
- one-Item and multi-Item Menus are valid;
- the same Item is selected once per Menu composition and quantity expresses repetition;
- a Menu with multiple Items may represent a bundle/package commercial offering without requiring a separate Package entity in the forward business model;
- Item composition is separate from Menu Category and Menu Title.

The forward UI term is **Item**; legacy physical `product_id` columns may remain during migration.

## 7. Item Choice Boundary

Menu Item Choice is governed by:

`docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

Core rules:
- Item Choice belongs to one specific Menu Item;
- there is no global Menu-level choice section that duplicates Item input;
- Owner adds the Item once, then optionally adds Item Choices from that Item context;
- Owner may fix a choice value (`Kamu mengatur`);
- or Owner may expose allowed values for Customer selection (`Pelanggan memilih`);
- Owner selects an Xentra-provided choice template before editing labels/values;
- the template determines semantic type, validation, and presentation policy;
- Custom choices use the generic renderer;
- Owner never designs or selects a custom UI renderer.

## 8. Item Choice and Pricing

An Item Choice may have a price adjustment.

Example:

```
Ukuran
Regular      +Rp0
Besar        +Rp5.000
```

Pricing effect is attached to the Item Choice usage in the Menu.

The Menu retains its base selling price authority.

Exact branch-pricing policy and advanced pricing interactions remain separate contracts.

## 9. Item Choice and Assembly / Production

A fixed Owner choice or a selected Customer choice may change the effective Menu composition.

Example:

```
Menu: Ayam Geprek

Menu Items:
- Ayam
- Nasi
- Lalapan

Item Choice on Ayam:
Sambal
- Sambal Geprek
- Sambal Ijo
```

The resolved effective composition may include the selected value and can later be consumed by the Production/Recipe model.

This contract does not lock:
- Recipe schema;
- Material schema;
- Production costing;
- exact option-to-material mapping;
- automatic raw-material deduction timing.

Those belong to the relevant domain contracts.

## 10. Owner Menu Editor

Owner-facing flow:

```
Tambah Menu
  ↓
Foto
  ↓
Category
  ↓
Title
  ↓
Tambah Item
  ↓
[optional] Pilihan Item on a specific Item
  ↓
Menu Composition Cost / cost view
  ↓
Harga Jual
  ↓
Preview
  ↓
Aktifkan / Simpan
```

The UI must preserve the Item scope visually.

Example:

```
Item 1
Ayam Tulang Lunak
Qty 1

Kamu mengatur: Sambal
[ Sambal Geprek ▼ ]

Kamu mengatur: Pedas
[ ● ● ● ● ● ]

+ Pilihan item
```

A different Item can have a different choice:

```
Item 4
Es Teh
Qty 1

Pelanggan memilih: Rasa
○ Manis
○ Tawar
```

The Owner must not be required to re-identify the parent Menu Item when editing its choice.

## 11. Choice Templates

The set of Xentra-provided choice templates is a product/UI capability.

Examples:
- Sambal;
- Level Pedas;
- Ukuran;
- Suhu;
- Rasa;
- Topping;
- Filling;
- Pilihan lainnya.

Template selection is made when the Owner creates an Item Choice.

Template metadata controls rendering; display labels remain editable by Owner.

Business meaning must never be inferred from the edited label.

Example:

```
Template = Level Pedas
Display label = Hot
```

The system still understands the choice as a spice-level choice.

## 12. Custom Choices

Custom means:

> the Owner needs a choice type that is not represented by a standard Xentra template.

Custom does not mean:
- Owner creates UI schema;
- Owner chooses renderer;
- Owner defines application component behavior.

Custom uses a generic selection renderer with Owner-defined name/values and the supported selection rule.

Adding a new reusable template is an Xentra product/design/development change.

## 13. Menu Media

Menu media belongs to the Menu.

The Menu image must not be derived by silently treating the first Item image as the canonical Menu image.

New Menu media uses the canonical Media Engine.

## 14. Menu Composition Cost

Menu Composition Cost is a derived view of the Menu's effective composition and applicable Product cost basis.

The Menu Editor may display Item-level costs for transparency.

This derived cost is not a second inventory or costing authority. It must not be treated as accounting COGS or historical HPP Penjualan. The canonical accounting term is Cost of Goods Sold (COGS); HPP is reserved for the Indonesian reporting label when it means Harga Pokok Penjualan.

The exact cost basis for production-backed and non-production Items is governed by the Costing/HPP contract as terminology-revised by the Costing Vocabulary Revision v1.1 and its still-open valuation/reporting policy.

## 15. Customer PWA

Customer PWA consumes a resolved Menu View Model.

Customer-facing presentation may include:
- Menu Title;
- Category/grouping;
- Menu media;
- base/final selling price;
- effective selected choices where relevant;
- availability;
- other explicitly approved presentation fields.

Customer PWA must not reconstruct Menu semantics from legacy Product fields or raw database columns.

Customer UI should display choices according to the resolved Item Choice presentation policy.

## 16. Branch Adoption

Branch adoption remains Menu-scoped.

```
Owner Master Menu
      ↓
Branch adopts Menu
      ↓
Branch operating context
      ↓
Customer Menu
```

Branch does not create a second composition.

Branch operational availability and stock remain separate from the Menu authoring contract.

The exact Branch price override policy is governed separately.

## 17. Legacy Field Boundary

The following are legacy/migration residue for the forward Menu model:

- `sub_category_id` on Menu;
- `rasa_id` as a Menu identity field;
- legacy `menu_type` / package subtype fields where present;
- `package_name` where present;
- legacy Product-centric Menu composition fields.

Forward Menu create/update must not populate or rely on `sub_category_id` as the canonical identity dimension.

Legacy records may remain until migration evidence proves safe removal.

## 18. Explicit Prohibitions

Do not reintroduce as forward Menu rules:

- Category → Sub Category → Rasa as a mandatory Menu hierarchy;
- Rasa as a universal Menu identity dimension;
- free-text Item names used as a replacement for structured Item references;
- a global Menu Configuration section that duplicates Item Choice input;
- separate Item + Configuration entry of the same component;
- Owner-created custom UI templates;
- renderer selection by display-name keyword guessing;
- Menu identity derived from Item count;
- Menu price stored as Item price;
- Production schema inferred directly from Menu CRUD.

## 19. Precedence

This contract is authoritative for forward Catalog/Menu business and Owner UI semantics.

The Item Choice presentation/interaction details are authoritative in:
`docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

Domain-boundary decisions remain authoritative for Catalog, Production, Material, Inventory, Procurement, and other domain ownership.

Legacy documents are historical unless explicitly marked active.

If a document conflicts with this contract, the conflict must be reconciled before implementation; do not implement the contradiction.

## 20. Change Control

A change to Menu identity, Menu Item scope, Item Choice semantics, template authority, pricing authority, or Owner authoring flow requires an explicit contract revision.

**LOCKED — Catalog / Menu Domain Contract v2.**
