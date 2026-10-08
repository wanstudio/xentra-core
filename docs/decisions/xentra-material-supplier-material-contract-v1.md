# Xentra — Material & Supplier Material Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Material identity, Supplier identity, Supplier Material sourcing, UOM, supplier packaging, lifecycle, and the boundary to Inventory / Procurement / Production.

**Prerequisite authorities:**
- `docs/decisions/xentra-domain-vocabulary-boundary-v1.md`
- `docs/decisions/xentra-production-material-procurement-vocabulary-gate-v1.md`
- `docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md`
- `docs/decisions/xentra-multibranch-supply-stock-topology-contract-v1.md`
- `docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md`

## 1. Decision Summary

Xentra separates three things:

```
Material
  = reusable identity of an input / ingredient

Supplier Material
  = supplier-specific way that a Supplier offers that Material

Material Stock
  = physical quantity of that Material at a Stock Location
```

Therefore:

`Material ≠ Supplier Material ≠ Material Stock`.

Material is Organization-scoped and reusable across Brands, Branches, Production locations, and supplier relationships within that Organization supply network.

Supplier Material is Procurement-owned and may vary by supplier, supplier item code, purchase form, price, minimum order, lead time, and other commercial terms.

Inventory owns all physical Material Stock balances and stock movements. Material and Procurement do not maintain competing quantity ledgers.

## 2. Material Identity

### 2.1 What Material means

Material is the canonical identity of a physical input used for purchasing, storage, preparation, or production.

Examples:

```
Rice Premium
Chicken Breast
Cooking Oil
Red Chili
Tea Leaves
Food Packaging
```

Material identity describes **what the input is**, not how much exists, where it is stored, or which supplier sells it.

### 2.2 Material does not mean

Material is not:
- Product;
- Menu;
- Production Item;
- Supplier Material;
- Stock Balance;
- Purchase Order;
- Packaging transaction record.

### 2.3 Material code

Each Material should have a stable `material_code` unique within its Organization.

`material_code` is not a Product SKU.

Do not introduce `material_sku` merely to mirror Product terminology.

The code identifies the Material master record. Supplier-specific codes belong to Supplier Material.

### 2.4 Material name

Material name is human-readable identity data. It must describe the material/specification sufficiently to distinguish materially different inputs.

Supplier pack size, supplier price, supplier code, and supplier-specific naming must not redefine Material identity.

Example:

```
Material A = Chicken Breast Frozen
Supplier A listing = CHK-BR-25KG
Supplier B listing = CB-FR-10KG
```

Both supplier listings may point to the same Material if they represent the same business material specification.

## 3. Material Scope

Material master is **Organization-scoped**.

```
Organization
  └── Material
        ├── used by Brand A
        ├── used by Brand B
        ├── stocked at Branch A
        └── stocked at Central Warehouse
```

A Branch does not create a new Material merely because it buys locally.

A Brand does not create a duplicate Material merely because its menu differs.

Where the physical/specification identity is materially different, a different Material record is correct.

## 4. Material and Stock

Material defines identity.

Inventory defines physical quantity:

```
Material
   ↓
Material Stock Balance
   ↓
Stock Location
```

The target logical stock identity is:

`(stock_location_id, material_id)`.

Material Stock quantity must support fractional amounts because common food materials are measured in kg, g, L, ml, etc.

Negative Material Stock is not permitted under the existing Inventory invariant.

Material must never contain a mutable `stock_qty` field that becomes a second stock authority.

## 5. Unit of Measure (UOM)

### 5.1 Vocabulary

UOM is the measurement vocabulary used to express quantity.

Examples:

```
kg / g
L / ml
pcs
dozen
meter
```

UOM is **shared reference data**, not a new business domain. A single canonical UOM vocabulary must be reused by Material, Inventory, Procurement, and Production.

Domains own the business constraints for how a UOM is used; they must not create duplicate UOM masters.

### 5.2 Base Stock UOM

Every stock-managed Material has one authoritative `base_uom_id`.

Examples:

```
Rice        → kg
Cooking Oil → L
Egg         → pcs
```

All Material Stock quantities are stored/posted in the Material's Base Stock UOM.

### 5.3 UOM category compatibility

A direct UOM conversion is valid only where the conversion rule is meaningful for that UOM system.

Typical valid examples:

```
1 kg = 1000 g
1 L = 1000 ml
1 dozen = 12 pcs
```

A generic UOM engine must reject nonsensical cross-dimension conversions such as kg → L unless an explicit business-specific conversion model exists.

### 5.4 Who determines the Base Stock UOM?

The **Owner / authorized Material master-data role** selects the Base Stock UOM when creating the Material.

The Owner does **not** invent the UOM vocabulary and does **not** derive the Base UOM from a supplier's pack. The selectable UOM values come from Xentra's canonical shared UOM reference data.

The decision is operational:

> **Base Stock UOM = the unit in which Xentra wants the Material's physical stock to be consistently counted, consumed, replenished, and reported.**

The choice should be based on these factors:

1. **How the business counts the physical stock.**
   Example:
   ```
   Rice        → kg
   Cooking Oil → L
   Eggs        → pcs
   ```

2. **How the Material is consumed by Recipe / Production.**
   If a recipe consumes 150 g of flour, the Material may still use kg as Base Stock UOM:
   ```
   150 g = 0.15 kg
   ```
   Base UOM is not required to be the smallest unit used in a recipe.

3. **Consistency across suppliers and Stock Locations.**
   Supplier A may sell rice in 25 kg bags while Supplier B sells 50 kg bags. The Material can still remain:
   ```
   Rice → Base UOM = kg
   ```
   The supplier's commercial form is handled separately by Supplier Material / Supplier Pack.

4. **Practical precision required by operations.**
   Food materials commonly require fractional quantities, so the chosen Base UOM and quantity precision must be able to represent actual consumption without semantic distortion.

5. **Operational reporting and replenishment.**
   Stock-on-hand, usage, reorder conditions, transfer quantities, and production consumption should be interpretable in the same base measurement for that Material.

### 5.5 Base UOM is Material authority, not Supplier authority

The following are separate decisions:

```
Material
  Rice
  Base UOM = kg
       ↓
Supplier A
  1 bag = 25 kg
       ↓
PO
  4 bags
       ↓
Goods Receipt
  +100 kg
       ↓
Material Stock
  100 kg
```

The supplier's bag, sack, carton, or similar commercial term must not replace the Material Base Stock UOM merely because it is the supplier's selling unit.

Conversely, a supplier may sell directly in a canonical dimensional UOM:

```
Material Base UOM = kg
Supplier Purchase UOM = kg
PO = 100 kg
```

In that case no special pack representation is required.

### 5.6 Stability of Base UOM

Base Stock UOM is part of Material master semantics.

Once a Material has stock, recipes, purchase/receipt history, or other operational references, changing its Base UOM must be treated as a **controlled data migration/change**, not an ordinary display edit.

Historical Purchase Orders, Goods Receipts, stock movements, and production records must not be silently rewritten. Any approved Base UOM change must preserve equivalent quantities and an auditable conversion history.


## 6. Purchase UOM vs Supplier Pack

This distinction is important for engine clarity.

### 6.1 Purchase UOM

A Supplier Material may be purchased using a different UOM from the Material Base Stock UOM when the units are directly convertible.

Example:

```
Material Base UOM = kg
Supplier purchase UOM = g
PO = 5000 g
Inventory quantity = 5 kg
```

### 6.2 Supplier Pack

A Supplier may instead sell the Material in a commercial pack whose content is expressed in the Base Stock UOM.

Example:

```
Material = Rice
Base UOM = kg

Supplier Pack:
1 sack = 25 kg

PO = 4 sacks
Receipt = 100 kg
```

`Sack` is a commercial pack representation, not automatically a new Material and not necessarily a dimensional UOM.

This avoids confusing packaging with measurement.

### 6.3 Multiple packs

One Supplier Material may have multiple active/dated purchasing forms:

```
Supplier A / Rice
  ├── 10 kg bag
  ├── 25 kg bag
  └── 50 kg bag
```

These are not different Materials.

The target model should therefore allow a Supplier Material to have one-to-many purchase pack definitions.

## 7. Supplier

Supplier is the procurement counterparty.

Supplier is Organization-scoped in the Xentra supply-network model.

Recommended identity:

`supplier_id`.

Supplier must not be represented by free text inside future canonical procurement documents.

Existing `supplier_name` fields may remain in compatibility storage during migration.

## 8. Supplier Material

Supplier Material represents a specific supplier relationship/listing for one Material.

Canonical relationship:

```
Supplier
   1
   │
   ├── Supplier Material A ──→ Material X
   ├── Supplier Material B ──→ Material X
   └── Supplier Material C ──→ Material Y
```

One Material may have many Supplier Materials.

One Supplier may offer many Materials.

### 8.1 Supplier Material owns

- `supplier_id`;
- `material_id`;
- supplier item/code/reference;
- current/default purchase form;
- pack definition(s) where applicable;
- current/default purchase price;
- currency;
- minimum order quantity;
- lead time;
- active/inactive state;
- validity dates where the commercial definition is time-bounded.

### 8.2 Supplier Material does not own

- Material identity;
- Material Stock quantity;
- Production Recipe;
- Purchase Order lifecycle;
- Goods Receipt physical stock balance.

## 9. Supplier-Specific Price

Supplier price belongs to the Supplier Material commercial relationship, not to Material.

Example:

```
Material: Rice Premium

Supplier A
  25 kg sack = Rp300.000

Supplier B
  25 kg sack = Rp325.000
```

Both are valid Supplier Material commercial relationships.

The Purchase Order line must snapshot the agreed price and purchase form used at transaction time.

Changing today's Supplier Material price must not rewrite historical Purchase Order or Goods Receipt values.

Advanced vendor price breaks, quotation history, and full price-list versioning remain a later Procurement design concern.

## 10. Supplier Pack / Purchase Form

Target logical child concept:

`supplier_material_packs`.

Conceptual fields:

`id`
`supplier_material_id`
`name`
`purchase_uom_id` nullable
`content_quantity_base`
`content_uom_id`
`minimum_order_quantity`
`unit_price`
`currency`
`effective_from`
`effective_to`
`is_active`

A pack definition is a commercial purchasing representation.

The authoritative stock quantity after receipt is always resolved into the Material Base Stock UOM.

Historical PO and Receipt lines must preserve the actual conversion/content quantity used at that transaction.

## 11. Procurement Boundary

Material domain answers:

> Apa bahan ini?

Procurement answers:

> Dari siapa dibeli, dalam bentuk apa, dengan harga berapa, dan apa yang benar-benar diterima?

Therefore:

```
Material
  ↓ referenced by
Supplier Material
  ↓ selected by
Purchase Order Line
  ↓ physically verified by
Goods Receipt
  ↓ posts through
Inventory
  ↓
Material Stock
```

Purchase Order creation never increases Material Stock.

Only verified Goods Receipt posting may create the procurement-to-inventory stock mutation.

## 12. Branch / Central Procurement

Supplier Material is not Branch-owned by default.

The same Supplier Material can be purchased into different authorized Stock Locations:

```
Supplier A
  └── Rice 25 kg
       ├── PO → Branch A Stock Location
       ├── PO → Branch B Stock Location
       └── PO → Central Warehouse
```

No duplicate Material or Supplier Material is required merely because the destination Stock Location changes.

Branch-specific purchasing terms may be introduced later as an explicit Procurement scope/terms model if required.

## 13. Lifecycle

Material lifecycle:

```
DRAFT
  ↓
ACTIVE
  ↓
ARCHIVED
```

Supplier Material lifecycle:

```
DRAFT
  ↓
ACTIVE
  ↓
INACTIVE / ARCHIVED
```

Archive/deactivate is preferred to destructive deletion after a Material or Supplier Material has transaction history, recipe references, stock references, or supplier transaction references.

A Material with historical references must remain addressable for audit and historical documents.

## 14. Replenishment Interaction

Material itself does not decide when to reorder.

Inventory / planning evaluates Stock Location conditions:

```
Material
  + Stock Location
  + current Material Stock
  + replenishment policy
      ↓
Replenishment Requirement
```

Procurement then decides how to source it.

Potential sourcing types remain:

`BUY | TRANSFER | PRODUCE`.

Supplier Material is therefore one possible BUY source; it is not the replenishment requirement itself.

## 15. Production Interaction

Production Recipe Components should reference Material explicitly:

`recipe_component.material_id`.

Production consumes Material through the Inventory contract.

Material does not know which Menu uses it and does not own Production Batch state.

Example:

```
Material = Chicken Breast
Base UOM = kg

Recipe Component:
Chicken Breast = 0.20 kg / portion
```

## 16. Cross-Domain Invariants

1. One Material identity may have many Supplier Materials.
2. One Supplier Material points to exactly one Material.
3. Supplier pack/price/code must not create a new Material identity.
4. Material has one authoritative Base Stock UOM.
5. Material Stock is always qualified by Stock Location.
6. Purchase UOM / pack quantity is converted to Base Stock UOM before Inventory posting.
7. Purchase Order does not mutate Material Stock.
8. Goods Receipt posting mutates Material Stock by the accepted quantity.
9. Historical transaction lines preserve their resolved quantity/conversion/price snapshot.
10. Material is not Product and must never be addressed with `product_id`.
11. Supplier Material is not Material Stock.
12. Destructive deletion must not remove a Material that is referenced by historical/operational records.
13. New errors and API payloads must use domain-qualified Material/Supplier Material vocabulary.

## 17. Simulation

### Case A — Two suppliers, same Material

```
Material: Rice Premium
Base UOM: kg

Supplier A → 25 kg bag → Rp300.000
Supplier B → 50 kg bag → Rp575.000
```

Result: one Material, two Supplier Materials / purchase forms.

### Case B — Branch-direct purchase

```
Branch A requests 100 kg
→ Procurement selects Supplier A / 25 kg bag
→ PO = 4 bags
→ Goods Receipt = 3 bags accepted
→ Material Stock +75 kg
→ 1 bag outstanding
```

No stock increase occurs when the PO is created.

### Case C — Central procurement

```
Branch A demand = 50 kg
Branch B demand = 75 kg
        ↓
Central Procurement
        ↓
PO = 125 kg
        ↓
Central Warehouse Receipt
        ↓
Central Material Stock +125 kg
        ↓
Inventory Transfer to Branch A / B
```

The Material and Supplier Material identities are unchanged.

### Case D — Supplier price changes after PO

```
PO price = Rp300.000 / bag
Supplier Material current price later becomes Rp315.000
```

Historical PO remains Rp300.000. Current Supplier Material can show Rp315.000 as the current commercial value.

### Case E — UOM conversion

```
Base UOM = kg
Purchase UOM = g
PO = 5.000 g
Receipt = 5 kg
```

Inventory stores/posts the resolved Base UOM quantity.

### Case F — Pack size changes

```
Old Supplier Pack = 25 kg
New Supplier Pack = 30 kg
```

Do not rewrite historical transactions. Create a new/effective Supplier Material Pack definition.

### Case G — Invalid identity

Supplier A changes the commercial name from `Chicken Breast Frozen` to `Premium Chicken Breast` but the physical/specification identity remains the same.

Result: Supplier Material display data may change. Material identity must remain the same.

If the actual material specification changes materially, create a new Material.

## 18. What Is LOCKED

1. Material is the canonical input identity.
2. Material is Organization-scoped.
3. Material is not Stock Balance.
4. Material is not Product.
5. Supplier is a distinct Procurement counterparty.
6. Supplier is Organization-scoped in the supply-network model.
7. Supplier Material is the supplier-specific relationship to one Material.
8. One Material may have many Supplier Materials.
9. Supplier-specific code, price, pack, MOQ, and lead time do not redefine Material identity.
10. Every Material has one Base Stock UOM.
11. Material Stock is posted in Base Stock UOM.
12. Purchase UOM and commercial Pack are distinct vocabulary concepts.
13. Pack contents are explicitly resolved to Base Stock UOM.
14. PO does not mutate stock; Goods Receipt does.
15. Transaction lines preserve price and conversion snapshots.
16. Material and Supplier Material use lifecycle states; archive/inactive is preferred over destructive deletion after reference.
17. Recipe Components reference `material_id`.
18. New backend/API/error vocabulary must remain domain-qualified.

## 19. Still OPEN

These remain separate design gates:
- custom UOMs/localization beyond the locked UOM Master + Precision / Rounding Contract;
- whether `supplier_material_packs` is a child table or a generalized sourcing-offer table;
- advanced supplier price tiers / quotation history;
- branch-specific Supplier Material terms;
- approved supplier workflow;
- Material categorization/classification taxonomy;
- substitutions / alternate Materials;
- allergen / nutrition / regulatory attributes;
- lot/expiry requirements and activation timeline;
- Material costing/valuation method;
- semi-finished Production Output as a Recipe Component;
- autonomous replenishment.

## 20. External Supporting Evidence

Odoo's current documentation separates an inventory UoM from purchase UoM, converts between purchase and inventory units, and separately models packaging. ERPNext documents a Stock UOM with Purchase UOM + conversion factor and posts stock in the item's default Stock UOM. ERPNext also records supplier-specific item prices and minimum quantities separately from the generic item identity.

References:
https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html
https://www.frappe.io/erpnext/purchasing-in-different-unit
https://docs.frappe.io/erpnext/purchase-order
https://docs.frappe.io/erpnext/item-price

These references support the structure; they do not override Xentra business authority.

## 21. Change Control

Any change to Material identity, Supplier Material relationship, Base Stock UOM, purchase representation, or Goods Receipt posting boundary requires a new explicit contract revision.

**LOCKED — Material & Supplier Material Contract v1.**