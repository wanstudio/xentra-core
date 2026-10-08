# Xentra — Legacy Cost Vocabulary Quarantine Matrix v1

**Status:** 🔒 LOCKED / MIGRATION CONTROL  
**Date:** 2026-10-08  
**Authority:** `docs/decisions/xentra-costing-vocabulary-revision-v1.1.md`

## 1. Purpose

This matrix prevents legacy costing terminology from becoming new domain authority while allowing the current runtime to migrate incrementally.

> **Legacy vocabulary may survive as compatibility data, but new code must use the canonical vocabulary from Costing Vocabulary Revision v1.1.**

## 2. Canonical vs Legacy Matrix

| Legacy term / field | Current role | Canonical replacement | Action |
|---|---|---|---|
| `products.cost_price` | Legacy manual Product cost | Inventory / Product Stock Cost Basis | Keep temporarily; compatibility-only |
| `menus.cost_price` | Legacy manual Menu cost | Menu Composition Cost | Keep temporarily; do not use as canonical COGS |
| `inventory_po_items.unit_cost` | Historical procurement cost evidence | PO Line / Goods Receipt cost snapshot | Keep as historical evidence |
| “HPP item terjual” | Misleading Product editor label | “Biaya Produk (Legacy)” | Rename UI now |
| `hpp` / `menu_hpp` | Ambiguous future naming | Menu Composition Cost or COGS, based on actual context | Do not introduce |
| “Menu HPP” | Ambiguous Menu-cost wording | Menu Composition Cost | Replace in new docs/UI |
| “Product HPP” | Ambiguous Product-cost wording | Product Stock Cost Basis / Production Output Unit Cost | Replace in new docs/UI |
| “Recipe HPP” | Ambiguous Recipe estimate | Theoretical Recipe Cost | Replace in new docs/UI |
| “HPP Penjualan” | Indonesian financial/reporting term | HPP Penjualan (COGS) | Allowed only for COGS context |

## 3. Runtime Quarantine

### Catalog Product

`domains/catalog/services/ComposedProductService.js`

- Legacy `costPrice/cost_price` may remain accepted for compatibility.
- It must not be promoted to Inventory valuation authority.
- Existing zero-normalization is legacy compatibility behavior and must not be copied into new costing services.

### Catalog Menu Repository

`domains/catalog/repositories/ComposedMenuRepository.js`

- Legacy Product/Menu `cost_price` reads remain compatibility reads.
- New canonical costing resolution must not use these fields as authoritative inventory valuation.

### Catalog Menu Resolver

`domains/catalog/services/ComposedMenuResolver.js`

- Legacy `cost_price` may remain in compatibility output while existing consumers migrate.
- A future canonical costing view should expose an explicitly named cost result with explicit availability state.

### Merchant Dashboard

`apps/merchant-dashboard/index.html`

- Existing label “HPP item terjual” is semantically incorrect for its stated purpose.
- Rename it to **“Biaya Produk (Legacy)”**.
- Helper text must state that it is legacy/manual Product-cost data and is not COGS/HPP Penjualan.

### Tests

Existing tests that assert `cost_price` are compatibility tests, not proof of canonical costing architecture.

New costing tests must assert:

1. Menu Composition Cost ≠ COGS.
2. Production Output Unit Cost ≠ COGS.
3. Unknown cost is not coerced to numeric zero.
4. Historical cost evidence remains stable after master-data edits.
5. Cost basis is explicit and never silently switches.

## 4. Prohibited New Vocabulary

Do not introduce new canonical:

```
hpp
menu_hpp
product_hpp
recipe_hpp
hpp_cost
```

unless the field is explicitly documented as legacy compatibility data or the actual domain meaning is COGS and the Indonesian reporting label is intentionally localized.

## 5. Migration Sequence

```
Costing Vocabulary Revision v1.1
        ↓
Quarantine legacy names
        ↓
Introduce explicit costing service/view names
        ↓
Add canonical costing tests
        ↓
Migrate consumers one surface at a time
        ↓
Verify historical compatibility
        ↓
Remove legacy fields only after proof
```

No mass rename is authorized by this matrix.

## 6. Non-Goals

This matrix does not:

- choose FIFO vs Average vs Standard valuation;
- create accounting journals;
- redesign the Menu model;
- remove current legacy database columns;
- rewrite historical data;
- change Product/Menu selling prices.

**LOCKED — Legacy Cost Vocabulary Quarantine Matrix v1.**
