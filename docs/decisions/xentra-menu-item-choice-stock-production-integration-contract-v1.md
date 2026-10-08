# Xentra — Menu Item Choice → Stock / Production Integration Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** How an Item Choice Value affects effective Menu composition, Product Stock availability, order snapshots, and the boundary to Production. This contract extends the locked Menu Item Choice UI/semantic contract without changing its owner/customer interaction model.

**Prerequisite authorities:**
- docs/decisions/xentra-menu-item-choice-template-contract-v1.md
- docs/decisions/xentra-production-item-recipe-bom-contract-v1.md
- docs/decisions/xentra-production-batch-posting-mutation-contract-v1.md
- docs/LOCKED_INVENTORY_MODEL.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md

## 1. Decision Summary

Item Choice remains a Catalog concept.

Catalog may describe a choice's **stock effect through Product references**, but Catalog must not reference Material Stock or execute Production/Inventory mutations directly.

The canonical flow is:

~~~
Menu
  ↓
Menu Item
  ↓
Item Choice
  ↓
Selected Choice Value
  ↓
Effective Product Composition
  ↓
Commerce / POS
  ↓
Product Stock
~~~

Production is downstream of Product supply. A Product reached through a Choice may be produced through its own Production Item, but the Choice does not directly select or execute a Production Item.

Therefore:

**Choice → Product is allowed in v1. Choice → Material / Choice → Production is not a direct Catalog contract in v1.**

## 2. Stable Identity Requirement

Item Choice integration requires:
- menu_item_id;
- item_choice_id;
- item_choice_value_id.

Choice Value must belong to one specific Item Choice, and Item Choice must belong to one specific Menu Item.

Do not persist Choice effects using display labels as identity.

## 3. Choice Value Stock Effect

Each Choice Value may have one explicit stock-effect mode:

~~~
NONE
ADD_PRODUCT
REPLACE_PRODUCT
~~~

### NONE

The choice changes presentation and/or price only.

Example:
~~~
Level Pedas
Extra Pedas
price +Rp2.000
stock effect = NONE
~~~

No Product Stock quantity is added or removed because of the choice itself.

### ADD_PRODUCT

The selected Choice Value adds one Product to the effective Menu composition.

Example:
~~~
Menu Item: Ayam
Choice: Topping
Value: Keju

Effect:
+ Product Keju × 1
~~~

The base Menu Item remains in the effective composition.

### REPLACE_PRODUCT

The selected Choice Value replaces the base Product of its Menu Item for the purpose of effective commercial composition and stock resolution.

Example:
~~~
Menu Item base Product = Teh
Choice = Ukuran

Value Regular → Product Teh Regular
Value Large   → Product Teh Large
~~~

The Menu Item itself remains the same catalog slot. The selected Product is the resolved stock identity.

REPLACE_PRODUCT is valid only for a single-select choice because two simultaneous replacements would be ambiguous.

## 4. Choice Effect Cardinality

For v1, one Choice Value has at most one stock-effect Product.

That means:

~~~
Choice Value
  → NONE
  OR
  → ADD_PRODUCT → one Product
  OR
  → REPLACE_PRODUCT → one Product
~~~

Multiple products from one selected value are intentionally outside v1.

Multiple-select choices can still produce multiple Product effects because each selected Choice Value resolves independently.

## 5. Quantity Semantics

ADD_PRODUCT has an explicit resolved quantity, defaulting to 1 when the business definition is one unit.

REPLACE_PRODUCT inherits the Menu Item's effective quantity in v1 unless a future quantity transformation contract explicitly changes that rule.

Example:
~~~
Menu Item quantity = 2
REPLACE_PRODUCT selected
→ resolved Product quantity = 2
~~~

A Choice Value does not silently change quantity merely because its label implies a size.

Any quantity difference must be represented by an explicit Product mapping or future quantity-effect contract.

## 6. Price vs Stock Effect

Price adjustment and stock effect are separate dimensions.

A Choice Value can be:

~~~
price +Rp5.000
stock effect = NONE
~~~

or:

~~~
price +Rp5.000
stock effect = ADD_PRODUCT
mapped Product = Keju
~~~

Price behavior must not be used to infer Inventory behavior.

Stock behavior must not be inferred from the choice display label.

## 7. Owner-fixed vs Customer-selected

The same resolution contract applies to both interaction modes already locked in the Item Choice contract.

### Owner-fixed

The Owner-selected Choice Value is part of the Menu's effective composition before the customer orders.

### Customer-selected

The customer supplies the final Choice Value during ordering.

The backend must validate that the selected value belongs to the active Item Choice and is permitted by its selection rules.

Client-provided text alone is never sufficient authority.

## 8. Effective Menu Composition

At order verification time, Xentra resolves:

~~~
Menu Item base Product
        +
selected Choice Values
        ↓
Effective Product Composition
~~~

Example:
~~~
Menu: Ayam Geprek

Base Menu Items:
  Ayam
  Nasi

Choice:
  Topping → Keju

Effective Product Composition:
  Ayam ×1
  Nasi ×1
  Keju ×1
~~~

The effective composition becomes the input to the existing Product Stock availability / consumption calculation.

## 9. Availability Rules

Stock-affecting Choice Values participate in availability.

### Customer-selected choice

Each unavailable Product-mapped Choice Value is unavailable for selection.

The Menu may remain purchasable through another valid Choice Value when the business choice is optional and another valid selection exists.

### Owner-fixed choice

If the fixed Choice Value maps to unavailable Product Stock, the effective Menu becomes unavailable unless the future business policy explicitly permits backorder/substitution.

These rules prevent the UI from showing a selectable value that the stock engine cannot fulfill.

## 10. Order Snapshot

When the Order is accepted/created under the canonical Menu flow, preserve an immutable snapshot containing at minimum:
- menu_id;
- menu_item_id;
- item_choice_id;
- selected item_choice_value_id;
- resolved Product id(s);
- resolved quantities;
- price adjustment/effective price data.

The snapshot is historical evidence of what the customer or Owner actually selected at transaction time.

Later changes to the Menu Choice definition must not rewrite historical Orders.

## 11. No Direct Material Mutation

This contract explicitly forbids:

~~~
Customer selects Choice
  ↓
Catalog
  ↓
Material Stock − quantity
~~~

Any raw-material effect belongs to Production / Inventory through their own contracts.

A Choice Value may map to a Product. If that Product needs production, the Product's Production Item / Recipe / Production Batch lifecycle handles it separately.

## 12. Production Relationship

v1 does not allow Catalog Item Choice to reference production_item_id directly.

The relationship is indirect:

~~~
Choice Value
  ↓
Product mapping
  ↓
Product
  ↓
Production Item
  ↓
Recipe Version
  ↓
Production Batch
  ↓
Material Stock mutation
~~~

This means the same Product can be supplied by BUY, TRANSFER, or PRODUCE without changing the Menu Choice contract.

## 13. Examples

### A — Spicy level only affects price

~~~
Choice: Level Pedas
Value: Extra
Price: +Rp2.000
Effect: NONE
~~~

No additional stock Product is consumed.

### B — Topping adds stock

~~~
Choice: Topping
Value: Keju
Price: +Rp5.000
Effect: ADD_PRODUCT
Product: Keju ×1
~~~

Order resolution includes Keju and Product Stock is consumed according to the normal stock contract.

### C — Size replaces Product

~~~
Menu Item: Teh
Base Product: Teh Regular

Choice: Ukuran
Regular → REPLACE_PRODUCT → Teh Regular
Besar   → REPLACE_PRODUCT → Teh Besar
~~~

The chosen Product is the stock identity used for availability and sale.

### D — Choice maps to a produced Product

~~~
Choice: Sambal
Value: Sambal Ijo
Effect: ADD_PRODUCT
Product: Sambal Ijo

Sambal Ijo has a Production Item.
Production handles how Sambal Ijo is made.
Catalog does not call Production directly.
~~~

## 14. Legacy Compatibility Boundary

Existing POS options_config, modifiers, and legacy option payloads may remain as compatibility representations during migration.

They must not become the new business authority for Item Choice.

Canonical new code must use Menu Item → Item Choice → Choice Value vocabulary and explicit Product effect mapping.

## 15. What Is LOCKED

1. Item Choice remains owned by Catalog.
2. Stable Menu Item / Item Choice / Choice Value identities are required.
3. A Choice Value may have NONE, ADD_PRODUCT, or REPLACE_PRODUCT stock effect.
4. Stock effect references Product, not Material.
5. ADD_PRODUCT adds an explicit Product quantity.
6. REPLACE_PRODUCT replaces the Menu Item base Product and is single-select only.
7. A Choice Value has at most one mapped Product in v1.
8. Multiple selected values may resolve multiple Product effects.
9. Price adjustment is separate from stock effect.
10. Selected Choice Values are backend-validated and stored in the transaction snapshot.
11. Stock-affecting choices participate in Product Stock availability.
12. Catalog never directly mutates Material Stock or Product Stock.
13. Catalog does not directly reference Production Item in v1.
14. Production is reached indirectly through the mapped Product's own production lifecycle.
15. Legacy POS option representations remain compatibility-only.

## 16. Explicitly Open for Later Contracts

- choice effect with multiple mapped Products from one value;
- direct Choice → Production variant semantics;
- direct Choice → Material recipe overrides;
- choice-driven quantity transformations;
- option-specific production scheduling/reservation;
- choice-specific HPP/costing;
- advanced substitution/backorder behavior;
- branch-specific Choice Product mappings if required.

## 17. External Supporting Evidence

Established ERP patterns keep manufacturing definitions separate from commercial selling choices and resolve physical stock through Product/Inventory transactions. Odoo and ERPNext both allow manufacturing and procurement to operate through product identities while manufacturing/receipt transactions update inventory. This supports using Product as the Catalog-to-stock integration boundary rather than allowing Catalog to mutate raw materials directly.

References:
https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/manufacturing/basic_setup/configure_manufacturing_product.html
https://docs.frappe.io/erpnext/work-order
https://docs.frappe.io/erpnext/stock-entry

These references support the boundary; they do not override Xentra business authority.

## 18. Change Control

Any change to Choice Value stock-effect modes, Product mapping authority, or the no-direct-raw-material mutation boundary requires a new explicit contract revision.

**LOCKED — Menu Item Choice → Stock / Production Integration Contract v1.**