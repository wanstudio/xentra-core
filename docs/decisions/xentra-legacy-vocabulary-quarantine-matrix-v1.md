# Xentra — Legacy Vocabulary Quarantine Matrix v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-08  
**Scope:** Legacy terminology and compatibility fields across Catalog, Commerce, POS, Promotion, Reporting, Inventory, and migration code.

## 1. Purpose

This matrix prevents legacy vocabulary from silently becoming new business authority.

Every legacy term falls into one of four states:

- **CANONICAL** — required for new code and new contracts.
- **COMPATIBILITY** — may be read/emitted only where required to preserve existing transactions or integrations.
- **MIGRATION** — retained while data/consumers are being reconciled; must not drive new business decisions.
- **REMOVE** — forbidden in new code/UI and removable after consumer/data verification.

The matrix governs semantics, not immediate physical deletion.

## 2. Canonical Vocabulary

| Concept | Canonical term | Owner |
|---|---|---|
| Sellable atomic catalog identity | Product | Catalog |
| Commercial selling entity | Menu | Catalog |
| Component of a Menu | Menu Item | Catalog |
| Customer/Owner selection | Item Choice / Choice Value | Catalog |
| Ingredient/input identity | Material | Material |
| Production definition | Production Item | Production |
| Production formula | Recipe | Production |
| Immutable formula revision | Recipe Version | Production |
| Actual execution record | Production Batch | Production |
| Physical product quantity | Product Stock | Inventory |
| Physical material quantity | Material Stock | Inventory |
| Material cost per base stock UOM | Material Unit Cost | Inventory/Costing |
| Actual direct material cost of a batch | Production Actual Material Cost | Production/Costing |
| Actual cost per produced Product unit | Production Output Unit Cost | Production/Costing |
| Cost basis attached to Product Stock | Inventory / Product Stock Cost Basis | Inventory/Costing |
| Derived current menu composition cost | Menu Composition Cost | Costing |
| Cost recognized for sold inventory | Cost of Goods Sold (COGS) | Selling/accounting |
| Indonesian reporting label for COGS | HPP Penjualan (COGS) | Reporting/UI |

## 3. Legacy / Compatibility Matrix

| Legacy vocabulary / field | Status | Allowed use | Forbidden use | Removal condition |
|---|---|---|---|---|
| `products.cost_price` | MIGRATION | Historical/legacy read where required | Product master as authoritative inventory/production cost; new costing calculations | All readers migrated to Costing/Inventory authority |
| `menus.cost_price` | MIGRATION | Historical/legacy read where required | Menu Composition Cost authority; manual HPP ledger | All menu-cost readers migrated |
| `inventory_po_items.unit_cost` | COMPATIBILITY / HISTORICAL | Preserve agreed PO line price and historical procurement evidence | Universal current inventory cost or COGS authority | Goods Receipt/valuation stores historical cost evidence independently |
| `menu_type` | COMPATIBILITY | Historical order snapshot, legacy migration, bounded promotion/backfill compatibility | Menu identity, composition routing, stock logic, customer/POS business decisions | All canonical consumers stop branching on SINGLE/PACKAGE semantics |
| `SINGLE` / `PACKAGE` | COMPATIBILITY | Historical transaction/migration evidence only | New Menu subtype/entity model | No active consumer requires subtype semantics |
| `package_name` | COMPATIBILITY | Historical rows, migration, bounded legacy promotion/reporting reconstruction | Customer Menu identity or title fallback | Historical consumers migrated or snapshots proven sufficient |
| `sub_category_id` | MIGRATION | Legacy catalog reconciliation and migration tooling | New Menu identity authority | All canonical Menu creation/read paths no longer depend on it |
| `sub_category_name` | MIGRATION | Legacy migration/read compatibility | Customer Menu identity fallback | All canonical Menu title consumers use canonical Title |
| `menu_titles` / `title_id` | CANONICAL CATALOG (current) | Current Menu title master/reference | Treating it as legacy-only without a separate Catalog decision | Requires explicit Catalog decision to retire |
| `Menu HPP` | REMOVE | Historical documentation only when explicitly marked legacy | New engineering/API/UI term | Active docs migrated |
| `Recipe HPP` | REMOVE | Historical documentation only when explicitly marked legacy | New engineering/API/UI term | Active docs migrated |
| `Product HPP` | REMOVE | Historical documentation only when explicitly marked legacy | New engineering/API/UI term | Active docs migrated |
| `HPP item terjual` | REMOVE | Historical UI/documentation reference only | Current Product/Menu cost input label | UI field removed/replaced with explicit cost term |
| bare `HPP` | REMOVE / AMBIGUOUS | Indonesian prose only when the context explicitly means HPP Penjualan | Canonical code/database/service/entity name for other cost meanings | New codebase vocabulary migrated |
| `branch_products.stock` | MIGRATION | Legacy Product stock compatibility during inventory migration | New Material Stock authority; independent new Product Stock authority | Canonical Product Stock migration verified |
| `inventory_movements` | MIGRATION | Legacy Product-oriented ledger compatibility/reporting | Raw-material ledger or universal polymorphic stock authority | Explicit Product/Material stock movement models verified |
| legacy procurement `product_id` | MIGRATION | Historical compatibility for old purchase flow | New Material procurement identity | Procurement/Material flow migrated |
| Catalog → Material direct reference | REMOVE | None in canonical model | New Catalog business logic | Never introduce; isolate any old path |
| generic unqualified `Item` | REMOVE | Local prose only when explicitly scoped | New cross-domain entity/FK authority | Replaced with Product, Material, Menu Item, etc. |

## 4. Important Correction: Title Vocabulary

Current branch source still enforces `title_id` as part of the canonical Menu creation/read path and joins `menu_titles` as the title authority.

Therefore this matrix deliberately classifies:

```
menu_titles / title_id
→ CANONICAL CATALOG (current)
```

It must **not** be quarantined merely because older Catalog models also contained title/sub-category concepts.

A future retirement requires a separate Catalog contract; this costing migration does not authorize it.

## 5. Semantic Fallback Rules

Canonical values must never be synthesized from retired vocabulary.

Forbidden:

```
Menu title
  ↓ empty
package_name
  ↓ empty
sub_category
  ↓
"Menu"
```

Required:

```
canonical title unavailable
        ↓
MENU_TITLE_UNAVAILABLE
or explicit unavailable result
```

Likewise:

```
cost unavailable
    ↓
0
```

is forbidden.

Required cost states:

```
AVAILABLE
ESTIMATED
UNAVAILABLE
```

Zero is valid only when the underlying business input is explicitly zero.

## 6. menu_type Rule

`menu_type` may remain as a bounded compatibility representation in historical transaction, migration, and compatibility surfaces.

It must not be used as the canonical rule for:

- Menu identity;
- Menu composition cardinality;
- Product selection;
- Product Stock logic;
- Customer-facing Menu presentation;
- POS Menu routing.

Canonical composition is resolved from:

```
Menu
  ↓
Menu Items
  ↓
Item Choices / Choice Values
  ↓
Effective Product Composition
```

## 7. package_name Rule

`package_name` is not a fallback title.

Historical rows may retain it, and bounded migration/reporting logic may read it when reconstructing historical evidence.

New canonical Menu consumers must use canonical Menu title data.

## 8. Cost Vocabulary Rule

Keep these distinct:

```
PO line price
≠
Material Unit Cost
≠
Production Actual Material Cost
≠
Production Output Unit Cost
≠
Inventory / Product Stock Cost Basis
≠
Menu Composition Cost
≠
COGS
```

No rename-only migration is sufficient.

For example:

```
menus.cost_price
→ product_cost
```

does not make the field authoritative.

## 9. Migration Strategy

```
Quarantine
   ↓
Remove semantic fallback
   ↓
Add regression guard
   ↓
Migrate consumers
   ↓
Verify data/runtime
   ↓
Remove legacy storage
```

Legacy physical columns/tables are removed only after their consumers, data dependencies, and historical requirements are proven safe to remove.

**LOCKED — Legacy Vocabulary Quarantine Matrix v1.**
