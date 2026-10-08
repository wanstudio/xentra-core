# Xentra — UOM Master + Precision / Rounding Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Canonical UOM reference data, UOM categories, Base Stock UOM, conversion factors, quantity precision, rounding, and the boundary between UOM and Supplier Pack.

**Prerequisite authorities:**
- xentra-material-supplier-material-contract-v1.md
- xentra-stock-location-stock-identity-target-data-model-v1.md
- xentra-procurement-document-contract-v1.md
- xentra-production-batch-posting-mutation-contract-v1.md
- xentra-costing-hpp-contract-v1.md

## 1. Decision Summary

Xentra uses a canonical UOM reference model.

UOM means a measurement unit such as:

~~~text
kg
g
L
ml
pcs
dozen
~~~

A Supplier Pack is not automatically a UOM.

~~~text
1 sack = 25 kg

sack
  = Supplier Pack representation

kg
  = UOM
~~~

Owner selects UOM from the canonical Xentra UOM reference data. Owner does not invent or change the meaning of a canonical UOM.

## 2. UOM Ownership

UOM reference data is a **platform/shared reference capability**.

Xentra owns:
- UOM code;
- UOM name;
- UOM category;
- reference UOM;
- conversion factor;
- fraction policy;
- canonical meaning.

Business users consume this vocabulary.

v1 does not allow a Merchant/Branch user to redefine the meaning or conversion of a canonical UOM.

A later custom-UOM capability would require a separate contract.

## 3. UOM Category

Every UOM belongs to exactly one UOM Category.

Examples:

~~~text
MASS
  reference UOM = kg
  kg
  g
  mg

VOLUME
  reference UOM = L
  L
  ml

COUNT
  reference UOM = pcs
  pcs
  dozen
~~~

Conversions are only allowed within the same UOM Category.

This prevents invalid conversions such as:

~~~text
kg → L
pcs → kg
~~~

## 4. Reference UOM

Each UOM Category has exactly one reference UOM.

Each UOM stores a conversion factor relative to that reference UOM.

Canonical meaning:

~~~text
1 UOM = conversion_factor × reference UOM
~~~

Examples:

~~~text
Mass reference = kg

kg
  factor = 1

g
  factor = 0.001

mg
  factor = 0.000001
~~~

Therefore conversion is derived:

~~~text
quantity_in_target
  =
quantity_in_source
× source_factor
÷ target_factor
~~~

Do not maintain multiple contradictory pairwise conversion authorities for the same UOM category.

## 5. Base Stock UOM

A stock-managed Material must have exactly one Base Stock UOM.

A stock-managed Product must also have exactly one Product Stock UOM.

The Base Stock UOM is the unit used to:
- store stock quantity;
- consume stock;
- transfer stock;
- report stock;
- replenish stock;
- resolve Recipe quantities;
- calculate cost per stock unit.

For Material, the Base Stock UOM is stored on Material.

For Product, the Product Stock UOM is stored on the stock-managed Product definition.

The Base Stock UOM must belong to the UOM Category appropriate for the Material/Product.

## 6. Choosing Base Stock UOM

The Owner or authorized master-data role selects the Base Stock UOM according to how the organization wants the physical quantity counted.

Selection criteria:
- physical counting practice;
- production consumption unit;
- replenishment clarity;
- supplier comparability;
- reporting usefulness;
- required measurement precision.

Do not choose Base Stock UOM from supplier packaging alone.

Example:

~~~text
Material = Flour
Base Stock UOM = kg

Supplier A
  pack = 25 kg sack

Supplier B
  pack = 50 kg sack
~~~

Material remains one identity with Base Stock UOM = kg.

## 7. Purchase UOM

A Purchase UOM is a normal UOM used to express a purchasing quantity.

Example:

~~~text
Base Stock UOM = kg
Purchase UOM = g

PO
  5,000 g
  ↓
5 kg Base Stock quantity
~~~

Purchase UOM must belong to the same UOM Category as the Material Base Stock UOM.

## 8. Supplier Pack

Supplier Pack is modeled separately from UOM.

Example:

~~~text
Supplier Pack
  name = Sack 25 kg
  content_quantity = 25
  content_uom = kg

PO
  quantity = 4 packs

Resolved Base quantity
  = 100 kg
~~~

A pack may represent:
- sack;
- bag;
- carton;
- case;
- bundle;

without making that packaging word the canonical Material UOM.

Different suppliers can use different packs for the same Material.

## 9. Quantity Precision

Quantity precision is separate from display formatting.

Each canonical UOM has a declared quantity precision policy.

v1 operational rule:

~~~text
Stock quantity storage precision
  = up to 6 decimal places

Conversion factor precision
  = up to 12 decimal places
~~~

Examples:

~~~text
pcs
  precision = 0

kg
  precision = 6

L
  precision = 6
~~~

A UOM may allow whole numbers only when fractional quantity has no physical meaning for that UOM.

The canonical UOM master therefore carries:
- allows_fraction;
- quantity_precision.

The exact UI display format may use fewer decimals without changing the stored quantity.

## 10. Why Six Decimal Places

Restaurant materials often use:
- kg with gram or sub-gram consumption;
- L with ml consumption;
- small spice quantities.

Six decimal places in the Base Stock UOM is enough for:

~~~text
0.000001 kg = 0.001 g = 1 mg
0.000001 L  = 0.001 ml
~~~

This is a v1 operational precision policy, not a claim about every future industry.

Higher precision would require a later contract revision.

## 11. Conversion Precision

Conversion factors are stored at higher precision than normal quantity display.

Example:

~~~text
1 inch = 0.0254 m
~~~

The factor is retained precisely enough for repeated conversion without prematurely rounding the factor itself.

Conversion must use the canonical factor, not a user-entered rounded substitute.

Historical transactions snapshot the actual factor/content used at posting.

## 12. Rounding Rule

Xentra must not round intermediate calculation steps.

Process:

~~~text
source quantity
  ↓ exact conversion
normalized Base quantity
  ↓
round once at the transaction posting boundary
~~~

For v1:

> **Rounding mode = HALF_UP**

Examples:

~~~text
2.3456
  → precision 3
  → 2.346

2.3444
  → precision 3
  → 2.344
~~~

Do not use display rounding as the stock-posting rule.

The same normalized quantity must be used by:
- stock posting;
- Recipe consumption;
- transfer;
- production cost calculation;
- HPP calculation.

## 13. Whole-Number UOM

If a UOM does not allow fractions:

~~~text
pcs
  precision = 0
  allows_fraction = false
~~~

then 1.5 pcs is invalid.

The system must reject the transaction rather than silently round it to 2 or 1.

This is important because rounding a whole-unit stock transaction changes the physical quantity.

ERPNext likewise distinguishes UOMs that allow fractional quantities from UOMs that require whole numbers.

## 14. Cross-UOM Conversion Boundary

A conversion is valid only when:

~~~text
source UOM category
  =
target UOM category
~~~

Examples:

~~~text
kg → g      valid
L → ml      valid
pcs → dozen valid

kg → L      invalid
pcs → kg    invalid
~~~

A user cannot bypass the category rule by manually entering an arbitrary factor during a transaction.

## 15. Material Example

~~~text
Material = Rice
Base UOM = kg

Recipe requirement
  0.15 kg

Supplier Pack
  1 sack = 25 kg

PO
  5 sacks

Purchase resolution
  125 kg

Material Stock
  +125 kg
~~~

All physical quantity authority is normalized to kg.

## 16. Production Example

~~~text
Material Base UOM = kg

Recipe Version:
  Flour = 0.150 kg
  Sugar = 0.050 kg

Production Batch:
  planned output = 100 pcs

Actual consumption:
  Flour = 15.200 kg
  Sugar = 4.900 kg
~~~

Production uses the normalized Base quantities.

Costing uses:

~~~text
actual quantity × resolved Material unit cost
~~~

No supplier pack conversion is repeated during production.

## 17. Costing Integration

Cost per stock unit is always expressed using the stock-managed identity's authoritative stock UOM.

For Material:

~~~text
Material Unit Cost
  = cost per one Base Stock UOM
~~~

For Product:

~~~text
Product Unit Cost
  = cost per one Product Stock UOM
~~~

This aligns the UOM contract with the Costing/HPP contract.

A cost record must not mix:
- purchase pack quantity;
- purchase UOM;
- Base Stock UOM

without an explicit conversion.

## 18. Historical Snapshot Rule

When a transaction is posted, preserve:

~~~text
source UOM
source quantity
conversion factor / pack content
resolved Base quantity
precision / rounding outcome
~~~

Later changes to the UOM master or Supplier Pack definition must not rewrite the historical transaction.

Historical stock quantity is the posted normalized quantity, not a future recalculation.

## 19. Changing Base Stock UOM

Changing Base Stock UOM is **not an ordinary editable Material/Product field** after operational transactions exist.

Before first stock transaction:
- change may be allowed subject to master-data validation.

After operational references exist:
- change requires a controlled migration/reconciliation;
- historical quantities remain unchanged;
- historical conversion snapshots remain unchanged;
- future transactions use the new Base Stock UOM only after the migration boundary is explicitly posted.

Do not silently rewrite historical stock by changing the Material/Product Base UOM.

## 20. UOM vs Pack Boundary

Never use:
- sack;
- bag;
- carton;
- case

as a substitute for Base Stock UOM merely because a supplier sells that way.

The correct model is:

~~~text
Material
  Base UOM = kg

Supplier Material
  Pack A = 25 kg sack
  Pack B = 50 kg sack

Inventory
  always normalized to kg
~~~

## 21. Current Runtime / Migration Boundary

Repository audit found no canonical UOM master, conversion table, or Base UOM authority in the current Xentra runtime.

The current target documents mention UOM conceptually, but exact persisted UOM semantics have not yet been implemented.

Therefore this contract does not authorize immediate mass edits to Product, Material, Recipe, PO, or Inventory tables.

The implementation must introduce UOM as shared reference data and connect domain-specific entities to it through explicit, domain-qualified fields.

## 22. External Supporting Evidence

Odoo documents an Inventory UoM as the unit used to track inventory and internal transfers, with Purchase UoM converted into that inventory UoM. Odoo also keeps Packagings separate from the inventory UoM concept.

ERPNext similarly requires a Stock UOM, stores conversion factors separately, and posts stock quantities in the Stock UOM regardless of the purchasing UOM. ERPNext also distinguishes whole-number UOM behavior and quantity precision.

These references support the separation of Stock UOM, Purchase UOM, Pack, conversion, and precision. They do not override Xentra business authority.

## 23. What Is LOCKED

1. UOM is canonical shared reference data.
2. Every UOM belongs to exactly one UOM Category.
3. Each UOM Category has one Reference UOM.
4. Conversion is derived from the UOM's factor to the Reference UOM.
5. Cross-category conversion is invalid.
6. Stock-managed Material has one Base Stock UOM.
7. Stock-managed Product has one Product Stock UOM.
8. Purchase UOM is separate from Base Stock UOM.
9. Supplier Pack is separate from UOM.
10. Stock quantities are normalized to the authoritative stock UOM.
11. v1 storage precision allows up to 6 decimal places for stock quantity.
12. Conversion factor precision is up to 12 decimal places.
13. Each UOM declares whether fractions are allowed and its quantity precision.
14. Intermediate conversion steps are not rounded.
15. v1 posting rounding mode is HALF_UP.
16. Whole-number UOM transactions reject fractional quantities; they do not silently round.
17. Historical transactions snapshot source quantity, conversion/pack content, resolved Base quantity, and posting result.
18. Base Stock UOM must not be casually changed after operational references exist.
19. UOM meaning is not redefined by Branch/merchant users in v1.
20. Higher precision or custom UOM requires a later contract revision.

## 24. Explicitly Open for Later Contracts

- custom merchant UOMs;
- localized UOM vocabulary;
- imperial/metric display preferences;
- per-field display formatting;
- maximum technical decimal precision above v1;
- currency/FX precision;
- quantity tolerance rules;
- conversion-factor effective dating beyond transaction snapshots;
- UOM-specific costing exceptions;
- sales UOM and customer-facing packaging/pricing rules;
- advanced package/handling-unit hierarchy.

## 25. Change Control

Any change to:
- Base Stock UOM semantics;
- Reference UOM structure;
- cross-category conversion;
- quantity precision;
- rounding mode;
- Supplier Pack boundary;
- historical UOM snapshot rules

requires a new explicit contract revision.

**LOCKED — UOM Master + Precision / Rounding Contract v1.**
