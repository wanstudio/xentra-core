# Xentra — Legacy Vocabulary Quarantine Matrix v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Migration containment for legacy vocabulary that conflicts with the canonical domain model.

## Purpose

This matrix prevents legacy runtime/database terminology from becoming new business authority during incremental migration.

Legacy vocabulary may remain temporarily for:
- backward compatibility;
- historical data;
- migration adapters;
- old API payloads that cannot yet be removed safely;
- tests that explicitly document legacy compatibility.

Legacy vocabulary must not be introduced into new canonical APIs, services, entities, schemas, or business rules.

## Quarantine Matrix

| Legacy term / field | Canonical meaning | Allowed during migration | New-code rule | Removal gate |
|---|---|---|---|---|
| Menu HPP | Menu Composition Cost | compatibility docs/tests only | **PROHIBITED** as new canonical term | all active docs/API/UI use Menu Composition Cost |
| `menu_hpp` / `hpp` | ambiguous; usually Menu Composition Cost or COGS | historical/compat only | **PROHIBITED** without explicit COGS context | no active consumer depends on alias |
| HPP item terjual | ambiguous manual product cost input | legacy UI only | replace with Biaya Produk / source-specific cost label | field semantics mapped and legacy consumer removed |
| Product HPP | Product Inventory Cost Basis or Production Output Unit Cost | documentation compatibility only | **PROHIBITED** | explicit source cost vocabulary adopted |
| Recipe HPP | theoretical Recipe/Production cost | documentation compatibility only | **PROHIBITED** | Recipe cost wording made explicit |
| `products.cost_price` | legacy Product cost field | compatibility/historical | no new business authority | explicit Product/Inventory cost resolver covers all consumers |
| `menus.cost_price` | legacy Menu cost field | compatibility/historical | no new business authority | Menu Composition Cost service covers all consumers |
| `inventory_po_items.unit_cost` | historical PO/receipt procurement unit cost | historical procurement data | do not reuse as universal HPP/COGS | procurement and valuation sources separated |
| Menu Package / Package Menu | Menu with multi-item composition | compatibility routes/tests/UI | **PROHIBITED** as new entity model | forward Menu APIs cover all flows |
| `SINGLE` / `PACKAGE` | legacy Menu type encoding | compatibility persistence | no new business rules based on type | no forward authority depends on menu_type |
| Raw Material | descriptive Material classification | prose/UI where useful | canonical FK/entity remains `material_id` / Material | all data contracts use Material |
| BoM / BOM | external industry synonym for Recipe | external references/docs | no second Xentra entity | Recipe is canonical |
| Production Route / Production Item as Route | routing/process concept | migration wording only | **PROHIBITED** as entity conflation | Production Item + applicability + routing resolution separated |
| Transfer Request | Inventory Transfer in REQUESTED state | operational wording | no second canonical entity | APIs expose Inventory Transfer |
| IN_TRANSIT | presentation wording for dispatched transfer | UI only | not a separate v1 persisted state | all v1 state logic uses DISPATCHED |
| Purchase Line | ambiguous | legacy wording only | canonical **Purchase Order Line** | procurement docs/APIs use canonical name |
| Receiving Document | ambiguous | legacy wording only | canonical document is Goods Receipt | process/document separation complete |
| `title_id` / `menu_titles` | legacy title persistence bridge | compatibility | no second title authority | direct Menu Title model migrated |
| `package_name` fallback | legacy package naming | compatibility read only | no new business fallback | canonical Menu Title present |
| generic `Item` | ambiguous domain concept | local prose only when scoped | new code must qualify Product/Material/Menu Item/etc. | no cross-domain generic Item authority |

## Semantic Fallback Rule

The following fallbacks are prohibited in new business logic:

~~~
missing Menu Title
→ generic "Menu"

missing Production Route
→ Branch / default route

missing cost basis
→ 0

Product
→ implicit Material

Branch
→ implicit Stock Location

Transfer failure
→ implicit Procurement / Purchase Order
~~~

Technical/infrastructure fallbacks remain separate and may be valid when explicitly bounded, such as routing-provider fallback or runtime dependency fallback.

## Cost Vocabulary Rule

For cost-related code:

~~~
MenuCompositionCost
ProductionActualMaterialCost
ProductionOutputUnitCost
InventoryCostBasis
CostOfGoodsSold
~~~

are canonical concepts.

The term `HPP` is only canonical when the context explicitly means:

~~~
Harga Pokok Penjualan = Cost of Goods Sold
~~~

## Verification Gates

Before removing a quarantined term:

1. Search repository source, tests, docs, and active Notion pages.
2. Confirm no new domain/API authority depends on the legacy name.
3. Confirm historical compatibility data remains readable where required.
4. Add/update regression tests for the canonical path.
5. Remove the legacy alias only after production/runtime verification.

**LOCKED — Legacy Vocabulary Quarantine Matrix v1.**
