# Xentra — Legacy Cost Vocabulary Quarantine Matrix v1

**Status:** 🔒 LOCKED / MIGRATION CONTROL  
**Decision date:** 2026-10-08  
**Related:** `xentra-costing-vocabulary-revision-v1.1.md`

## Purpose

Prevent legacy cost vocabulary from becoming new business authority while allowing controlled compatibility during migration.

## Canonical vocabulary

| Legacy vocabulary | Current location / example | Canonical meaning | Treatment |
|---|---|---|---|
| `products.cost_price` | Product persistence | Legacy Product cost field | **Compatibility only**; never promote to Inventory valuation or COGS authority |
| `menus.cost_price` | Menu persistence | Legacy Menu cost field | **Compatibility only**; replace by derived Menu Composition Cost |
| `inventory_po_items.unit_cost` | Procurement/Inventory legacy | Historical PO line unit cost | **Historical procurement evidence only** |
| `costPrice` / `cost_price` | Legacy services/APIs | Generic cost value | **Quarantine**; new APIs must use explicit domain cost term |
| “HPP item terjual” | Merchant dashboard legacy UI | Ambiguous manual Product cost input | **Rename/mark legacy**; not COGS |
| “Menu HPP” | Docs / discussion | Menu Composition Cost | **Replace** |
| “Product HPP” | Docs / discussion | Product/Inventory cost basis or Production Output Unit Cost, depending on context | **Replace with explicit term** |
| “Recipe HPP” | Docs / discussion | Theoretical Recipe cost | **Replace with explicit term** |
| `menu_hpp` | Potential future schema/API name | Ambiguous | **Prohibited** |
| `product_hpp` | Potential future schema/API name | Ambiguous | **Prohibited** |
| `recipe_hpp` | Potential future schema/API name | Ambiguous | **Prohibited** |

## Forward naming rules

Use an explicit term whenever crossing a domain boundary:

```text
Material Unit Cost
Production Actual Material Cost
Production Output Unit Cost
Inventory / Product Stock Cost Basis
Menu Composition Cost
COGS
```

Avoid generic names such as `cost`, `hpp`, `item_cost`, `unit_cost`, or `price` when they can obscure the owning domain or lifecycle boundary.

## UI migration

The legacy dashboard field currently labelled **“HPP item terjual”** is semantically inconsistent with its helper text, which describes an item cost used to estimate a Menu.

Target wording:

**Biaya Produk (legacy)**

Helper:

**Data kompatibilitas lama. Bukan sumber otoritatif HPP Penjualan/COGS atau valuasi stok.**

This is a migration label, not the final Product costing UX.

## Code migration priority

### P0 — prevent new semantic leakage

New code must not:

- use `menu_hpp`, `product_hpp`, or `recipe_hpp`;
- treat Menu Composition Cost as COGS;
- use selling price as a cost fallback;
- return numeric zero when authoritative cost is unavailable;
- silently switch between `ACTUAL_OUTPUT` and `THEORETICAL_RECIPE`.

### P1 — remove legacy Menu authority from customer-facing resolution

Customer/POS presentation must use canonical `menu.title`.

Legacy `package_name`, `menu_type`, and `title_id/menu_titles` may remain inside compatibility/migration paths but must not become a new presentation authority.

### P2 — isolate legacy persistence

Legacy cost fields remain readable only where required for migration/compatibility. New costing reads should go through explicit cost-resolution services.

### P3 — removal

Delete legacy cost fields and package-oriented paths only after all consumers are migrated and verification proves no active dependency remains.

## Evidence

Current runtime still contains legacy `menu_type`, `package_name`, `menu_titles`, and legacy cost fields. These are migration debt, not forward business authority.

Current official ERP references reinforce the distinction between recipe/manufacturing cost, inventory valuation, and cost of goods sold.

**LOCKED — Legacy Cost Vocabulary Quarantine Matrix v1.**