# Xentra — Vocabulary / Semantics / Fallback Audit — 2026-10-08

**Status:** 🔎 AUDIT / NON-AUTHORITATIVE
**Audit date:** 2026-10-08
**Branch reviewed:** proposal/xentra-taxonomy-composed-menu-v1

## Scope

Recheck the recent Material, Production, Procurement, Inventory Transfer, Costing/HPP, and UOM work against current source code, current decision documents, active Notion architecture pages, legacy compatibility consumers, and current official ERP documentation.

Focus:
1. vocabulary consistency and typos;
2. business-concept separation;
3. redundant or overloaded terminology;
4. fallback and silent-default behavior;
5. source-code leakage of legacy vocabulary;
6. missing semantics between related contracts.

## Findings

### 1. Domain Boundary documentation drift — HIGH

The Domain Boundary contract and its Notion mirror still described some decisions as OPEN after dedicated contracts locked them.

Stale examples:
- Product ↔ Production Item cardinality;
- Recipe / Recipe Version;
- UOM precision/conversion;
- transfer state machine;
- costing/HPP boundary.

This is documentation drift, not a runtime defect.

### 2. Menu Package terminology — HIGH

The active Catalog/Menu v2 contract says there is no separate forward Package entity. A one-item or multi-item composition is still a Menu.

Therefore canonical terminology is:
- Menu;
- Menu Item;
- Menu composition.

Menu Package, Package Menu, SINGLE, and PACKAGE are legacy compatibility vocabulary only.

Current runtime still contains package routes, package fields, type checks, and tests. This is migration debt and must not be reintroduced into new authority.

### 3. Raw Material terminology — MEDIUM

Canonical identity is Material.

Raw Material is acceptable as a descriptive classification for an input/ingredient, but it must not imply another entity or foreign key.

Canonical FK is material_id.

### 4. Recipe versus BoM terminology — MEDIUM

Canonical Xentra business entity is Recipe.

BoM/BOM is an external industry synonym and reference term. Do not create Recipe and BoM as separate entities without a future explicit contract.

### 5. Production Item versus Route terminology — HIGH

Production Item and Production routing are related but not synonymous.

Canonical meanings:
- Production Item = Production-owned production definition for one Product.
- Production Item Location Applicability = explicit eligibility mapping between Production Item and Stock Location.
- Production routing = resolution process that selects the eligible Production Item.

A Production Item is not itself the Route entity.

### 6. Production Batch location gap — HIGH

The routing contract requires an explicit production_stock_location_id.

The Batch contract described input/output Stock Locations but did not consistently retain the Production Stock Location execution context.

The Production Batch contract must retain:
- production_item_id;
- production_stock_location_id;
- recipe_version_id;
- input_stock_location_id;
- output_stock_location_id.

Production Stock Location is a role/use of a Stock Location, not a separate Production Location entity.

### 7. Transfer Request terminology — MEDIUM

Canonical entity is Inventory Transfer.

REQUESTED is a state of that transfer.

Transfer Request may be used as an operational/UI phrase, but not as a separate canonical entity.

### 8. Transit terminology — MEDIUM

Xentra v1 uses DISPATCHED as the persisted in-transit state.

Therefore:
- DISPATCHED = source deduction completed and quantity is in transit;
- In Transit / Dalam Perjalanan = presentation wording;
- IN_TRANSIT is not a separate persisted v1 state;
- Transit Stock Location is not a required v1 balance.

Do not describe IN_TRANSIT as both a status and a Stock Location.

### 9. Stock terminology — MEDIUM

Use qualified target persistence terms:
- Product Stock Balance;
- Material Stock Balance;
- Product Stock Movement;
- Material Stock Movement.

Product Stock and Material Stock remain valid domain-level concepts. Stock Balance and Stock Movement are persistence concepts and must not become generic cross-domain authorities.

### 10. Procurement document terminology — MEDIUM

Canonical term is Purchase Order Line, not generic Purchase Line.

Goods Receipt is the document.

Receiving is the physical/operational process.

Do not collapse document and process into one entity name.

### 11. HPP terminology — HIGH / BUSINESS DECISION REQUIRED

Current Costing/HPP v1 uses Menu HPP for a derived Menu composition cost.

This can be confused with Indonesian accounting/business usage of HPP and with Cost of Goods Sold.

The external ERP terminology separates:
- inventory valuation;
- stock movement cost;
- production cost;
- COGS recognition.

Therefore the current contract has a semantic language risk even though its calculation boundary is internally consistent.

Do not silently rewrite the locked Costing/HPP v1 contract.

A separate v1.1 decision must choose whether:
- Menu HPP becomes an explicitly defined management/theoretical Menu Cost term and accounting COGS is named separately; or
- HPP is redefined to match the intended accounting/business meaning.

### 12. UOM arithmetic implementation risk — HIGH

The UOM contract locks:
- stock quantity precision up to 6 decimals;
- conversion factor precision up to 12 decimals;
- HALF_UP posting rounding;
- no intermediate rounding.

Current runtime has no dedicated decimal arithmetic library and commonly uses JavaScript Number.

Future implementation must therefore choose deterministic decimal representation/arithmetic before wiring UOM into stock, production, procurement, transfer, and costing.

This is an implementation risk, not a contract redesign.

### 13. Legacy costing vocabulary — HIGH

Current runtime still accepts/stores:
- products.cost_price;
- menus.cost_price;
- costPrice service arguments;
- inventory_po_items.unit_cost.

These remain compatibility data.

They must not become the canonical HPP authority.

### 14. Legacy Procurement / Inventory boundary — HIGH

Current PurchaseOrderService still uses:
- branch_id;
- supplier_name;
- product_id;
- unit_cost.

Goods Receipt still mutates Branch/Product stock.

This is legacy compatibility behavior, not the canonical Procurement contract.

### 15. Business fallback audit — PASS WITH EXCEPTIONS

### 16. Master Menu / Menu Title vocabulary collision — HIGH

The active Catalog v2 contract defines `Menu` + direct customer-facing `Title` as the forward model, while current runtime still treats `Master Menu`, `title_id`, `menu_titles`, and legacy `package_name` as operationally meaningful. These names represent a UI scope plus legacy persistence, not additional business entities.

Forward implementation should converge to `Menu` and `Title`. Legacy `menu_titles` may remain as a migration bridge, but new APIs must not introduce it as a second title authority.


The contracts largely reject hidden business fallback for identity or routing. However, the current Catalog runtime still contains legacy fallback paths that can mask missing canonical Menu data. These are migration findings, not new business rules.

Correct target behavior is:
- zero production route → explicit route-not-found failure;
- multiple active routes → integrity failure;
- Branch does not implicitly become Production Location;
- Product does not implicitly become Material;
- unknown cost does not silently become zero;
- transfer failure does not silently become Procurement or Production.

Technical fallbacks such as OSRM → Haversine, node:sqlite → sql.js, and service-worker cache fallback are infrastructure/runtime concerns and must not be confused with business-semantic fallback.

## Canonical terminology dictionary

| Term | Canonical meaning | Do not use as synonym |
|---|---|---|
| Product | Catalog reusable identity | Menu, Material, Production Item |
| Menu | Customer-facing commercial offering | Product, Package, separate “Master Menu” entity |
| Menu Item | Component/reference within a Menu | generic Item entity |
| Item Choice | Choice scoped to one Menu Item | Menu Configuration |
| Material | Physical input identity | Raw Material as separate entity |
| Supplier Material | Supplier relationship to one Material | Material Stock |
| UOM | Measurement unit | Pack |
| Supplier Pack | Commercial packaging representation | UOM |
| Stock Location | Physical inventory custody/location | Branch as physical stock identity |
| Product Stock Balance | Product quantity at a Stock Location | Product master |
| Material Stock Balance | Material quantity at a Stock Location | Material master |
| Production Item | Production definition for one Product | Route |
| Production Item Location Applicability | Eligibility mapping | Production Item itself |
| Recipe | Canonical Xentra production formula | separate BoM entity |
| Recipe Version | Immutable formula revision | Production Item |
| Production Batch | One production execution | SKU, Lot |
| Purchase Request | Internal procurement request/workflow | Purchase Order |
| Purchase Order | Supplier commercial commitment | Stock receipt |
| Purchase Order Line | One sourcing line of a PO | generic Purchase Line |
| Goods Receipt | Supplier receipt document | Receiving process |
| Inventory Transfer | Stock Location to Stock Location movement | Transfer Request entity |
| DISPATCHED | Persisted v1 in-transit state | Transit Location |
| Cost Basis | Unit/value basis used for costing/valuation | Selling Price |
| Menu Composition Cost | Derived cost of effective Menu composition | accounting COGS or unspecified “HPP” authority |
| HPP / COGS | Pending explicit v1.1 terminology decision | interchangeable synonym |
| Replenishment Requirement | Need to replenish Material at a Stock Location | Purchase Order |

## Source-code status

Legacy vocabulary remains in current consumers and tests. This is expected during migration.

Forward authority must use canonical vocabulary.

Compatibility code may use legacy vocabulary only when clearly bounded to compatibility or historical migration.

New domain/API code must not introduce new aliases that recreate the legacy model.

## Required corrections

Safe editorial and contract-alignment corrections:
1. Reconcile stale OPEN lists in Domain Boundary, Material, Production Item/Recipe, Production Batch, Stock Location, lifecycle, and related Notion pages.
2. Clarify Menu Package as legacy-only terminology.
3. Clarify Raw Material as descriptive Material classification.
4. Replace Purchase Line with Purchase Order Line.
5. Separate Goods Receipt document from receiving process.
6. Add Production Stock Location to Production Batch semantics.
7. Clarify Production Item versus routing.
8. Clarify Recipe as canonical Xentra term and BoM/BOM as external synonym.
9. Clarify Transfer Request as state/process wording, not a canonical entity.
10. Keep HPP terminology issue as an explicit unresolved v1.1 business decision.
11. Keep UOM decimal arithmetic as an implementation gate.

## Audit conclusion

**Overall status: PASS WITH CORRECTIONS / RUNTIME LEGACY FINDINGS REMAIN.**

No evidence requires changing the fundamental Xentra domain boundaries.

The highest-priority correction is vocabulary/document synchronization.

One substantive business-language issue remains: the contract currently calls a theoretical/current Menu composition cost “HPP”, which may collide with accounting/COGS terminology. That must be resolved explicitly before a canonical HPP/COGS reporting API is implemented.

**No mass runtime rewrite is authorized by this audit.**
