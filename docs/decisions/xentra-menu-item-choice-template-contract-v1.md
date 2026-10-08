# Xentra — Menu Item Choice & UI Template Contract v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-08  
**Scope:** Owner Menu Editor, Menu Item composition, Item-level choices/options, Customer choice presentation, pricing effects, future Recipe/Material integration.

## 1. Decision Summary

Xentra uses a single Owner mental model:

`Menu → Menu Items → optional Item Choices`

The Owner creates one commercial Menu, adds the Items that form that Menu, and may optionally add choices to a specific Menu Item.

There is **no separate global "Menu Configuration" section** for Item choices.

An Item Choice is always scoped to the Menu Item from which it was created.

The Owner does not enter the same Item twice in separate "Item" and "Configuration" areas.

## 2. Owner Mental Model

From the Owner perspective:

- **Menu** = the thing being sold.
- **Menu Item** = one component/slot used by that Menu.
- **Item Choice** = an optional choice attached to that specific Menu Item.
- **"Kamu mengatur"** = the Owner fixes the value while creating the Menu.
- **"Pelanggan memilih"** = the Customer chooses the value during ordering.

The UI must not require the Owner to understand technical concepts such as renderer, schema, semantic type, cardinality, or configuration object.

## 3. Menu Composition

Canonical conceptual structure:

```
Menu
├── Menu Item A
│   └── optional Item Choice
├── Menu Item B
│   └── optional Item Choice
└── Menu Item C
    └── optional Item Choice
```

Examples:

```
Ayam Geprek + Nasi + Es Teh
├── Ayam Tulang Lunak
│   └── Sambal
├── Nasi Putih
├── Lalapan
└── Es Teh
    └── Rasa
```

The scope of a choice is therefore unambiguous.

## 4. No Universal Category → Title → Rasa Hierarchy

Category is a grouping/classification mechanism.

Menu Title is the human-facing commercial name entered by the Owner.

Rasa is **not** a mandatory third taxonomy level and is not part of the universal Menu hierarchy.

Other common F&B dimensions include:
- sambal;
- level pedas;
- ukuran;
- suhu;
- rasa;
- topping;
- filling;
- preparation;
- and merchant-specific choices.

These are handled as Item Choices when a customer/owner needs a choice at a specific Menu Item.

## 5. Menu Title

The Owner enters the Menu title directly.

Examples:

- `Ayam Geprek + Nasi + Es Teh`
- `Kentang Goreng Balado`
- `Cappuccino`
- `Paket Hemat Ayam Geprek`

The title is not mechanically generated from Item names.

The Owner may choose a fixed commercial name even when the composition contains multiple Items.

A Menu retains its own immutable `menu_id` as the canonical technical identity.

Category does not become the parent entity of the Menu Title.

## 6. Adding an Item

The primary Menu Editor workflow is:

```
+ Tambah Item
    ↓
Choose Item
    ↓
Set quantity
    ↓
Optional: + Pilihan item
```

The Item is selected once.

If that Item needs a choice, the choice is created from that Item's own context.

There is no second step that asks the Owner to re-add the same Item to a separate configuration list.

## 7. Item Choice

An Item Choice is defined only inside the context of a Menu Item.

Example:

```
Menu
└── Ayam
    └── Pilihan Item
        └── Sambal
            ├── Sambal Geprek
            └── Sambal Ijo
```

Another example:

```
Menu
└── Es Teh
    └── Pilihan Item
        └── Rasa
            ├── Manis
            └── Tawar
```

A choice must not appear as an unattached global configuration belonging to the whole Menu.

## 8. Owner Mode vs Customer Mode

Each Item Choice has one of two interaction modes.

### 8.1 Kamu mengatur

The Owner fixes one value while authoring the Menu.

Example:

```
Item: Ayam
Kamu mengatur: Sambal
[ Sambal Geprek ▼ ]
```

Customer sees the resulting Menu as already configured. Customer does not choose that value.

### 8.2 Pelanggan memilih

The Owner provides allowed values and the Customer chooses during ordering.

Example:

```
Item: Es Teh
Pelanggan memilih: Rasa
○ Manis
○ Tawar
```

The two modes use the same Item Choice concept. The difference is who supplies the final value.

## 9. Choice Template Decision

When the Owner adds a new Item Choice, the Owner first selects an Xentra-provided **choice template**.

Example templates:

- Sambal
- Level Pedas
- Ukuran
- Suhu
- Rasa
- Topping
- Filling
- Pilihan lainnya

The Owner does **not** choose the UI renderer manually.

The selected template determines:
- semantic meaning understood by Xentra;
- allowed interaction model;
- default presentation style;
- validation rules appropriate to that choice type.

After selecting a template, the Owner may edit the customer-facing name and the available values.

## 10. Template vs Label

The visible label is Owner-controlled.

The business meaning comes from the selected template.

Example:

```
Template: Level Pedas
Customer-facing label: Hot
Values: Mild / Hot / Extra Hot
```

Xentra still understands the choice as `SPICE_LEVEL`.

The system must **not infer business meaning from the text label**.

Therefore:

```
"Hot" ≠ automatically Temperature
"Cheese" ≠ automatically Topping
"Chicken" ≠ automatically Filling
"Large" ≠ automatically Size
```

Meaning is established by template selection, not by keyword guessing.

## 11. Custom Choice

The Owner may select **Pilihan lainnya** when no predefined template fits.

Custom does **not** mean custom UI development.

The Owner enters:
- the customer-facing choice name;
- the choice values;
- whether the customer selects one or multiple values where supported.

Xentra renders the Custom choice using a generic selection component.

There is **no Owner-facing editor for creating a new UI component/template**.

This prevents the Owner from spending time designing application behavior instead of creating menus.

## 12. Presentation Rendering

Xentra uses a data-driven renderer registry.

Conceptually:

```
Template / Choice Definition
        ↓
Presentation Policy
        ↓
Shared UI Renderer
```

Examples:

```
Level Pedas    → scale
Sambal         → select
Ukuran         → segmented / choice
Suhu           → segmented / choice
Rasa           → choice
Topping        → multi-select
Pilihan lainnya→ generic choice
```

The exact renderer may evolve based on UX testing and available option counts, but the Owner does not manually configure renderer types.

Renderer selection must never be hard-coded from display names.

## 13. UI Location

In the Owner Menu Editor, Item Choice controls live inside the related Menu Item card.

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

For an Item without choices:

```
Item 2
Nasi Putih
Qty 1

[ Atur item ]
```

Opening the Item editor establishes scope automatically.

The UI must not require the Owner to re-identify which Menu Item a choice belongs to.

## 14. Pricing

An Item Choice may have a price adjustment.

Example:

```
Ukuran
Regular       +Rp0
Besar         +Rp5.000
```

This is a pricing effect of the choice used in the Menu, not a requirement to create a second sellable Menu entity.

The authoritative Menu selling price remains the Menu's base price plus any applicable choice/add-on adjustments according to the future pricing contract.

A choice may have no price effect.

## 15. Item, Choice, Assembly, and Production

The same business Item may participate in different roles.

Example:

```
Menu Item:
Ayam
    ↓
Item Choice:
Sambal Ijo
```

After the Customer chooses or the Owner fixes the value, the resolved Menu composition can include:

```
Ayam
Nasi
Lalapan
Sambal Ijo
```

This resolved composition may later drive Recipe / Production / Material requirements.

However:
- this decision does not define the final Production schema;
- it does not define the final Material schema;
- it does not authorize direct SQL coupling from Catalog into Inventory;
- the future Production ↔ Inventory contract remains separately designed.

## 16. HPP Boundary

HPP is derived from the authoritative cost of the Menu's effective composition.

For a fixed Owner choice, the selected Item can contribute directly to the effective Menu composition.

For a Customer choice, the final composition may depend on the selected value.

The exact HPP timing/calculation contract remains subject to the Pricing + Production/Material implementation design.

The UI must not invent a second cost ledger.

## 17. Package Menu

A package is still a Menu composed of multiple Menu Items.

Example:

```
Paket Hemat
├── Ayam Geprek
├── Nasi
└── Es Teh
    └── Pelanggan memilih: Rasa
```

Package behavior does not require a separate "Package Configuration" editor.

The same Item → Item Choice mechanism is reused inside the package.

## 18. UX Language

Owner-facing terms:

- `Menu items`
- `Pilihan item`
- `Kamu mengatur`
- `Pelanggan memilih`
- `Tambah item`
- `Atur item`

Avoid exposing these terms in normal Owner UI:

- Variant
- Configuration
- Renderer
- Semantic Type
- Cardinality
- Schema
- Option Engine

Technical vocabulary may exist in backend code and documentation where necessary.

## 19. Governance

### Locked business/UI decisions

The following are locked by this contract:
1. Menu Editor uses Menu → Menu Items → optional Item Choices.
2. Choice scope is the specific Menu Item.
3. Owner selects an Xentra-provided choice template before editing the choice.
4. Template determines semantic type and default UI presentation.
5. Owner may edit customer-facing labels/values after selecting a template.
6. Custom uses a generic renderer; there is no Owner-facing custom-template editor.
7. Owner mode and Customer mode are two uses of the same Item Choice concept.
8. Choice values may affect Menu price through explicit price adjustments.
9. Display renderer is data-driven and must not infer semantics from labels.
10. Menu title is explicit Owner input and is not generated from Item names.
11. Category is grouping/classification and is not a parent of Menu Title.
12. Rasa is not a mandatory Menu hierarchy level.

### Explicitly not locked here

The following remain separate design gates:
- exact database schema/table names for Item Choices;
- exact template registry storage;
- exact option-to-recipe/material relationship;
- exact HPP timing and production costing;
- branch-level price policy;
- advanced multi-select limits and inventory allocation edge cases.

## 20. Change Control

A future change to:
- who selects the value;
- choice scope;
- template semantics;
- renderer authority;
- pricing authority;
- Menu identity;
- Menu → Item relationship;

requires a new explicit contract revision.

Discussion, experiments, UI mockups, and rejected alternatives must be recorded as **NON-AUTHORITATIVE** material and must not be mixed into this locked contract.

**LOCKED — Menu Item Choice & UI Template Contract v1.**
