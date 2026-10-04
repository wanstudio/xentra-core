# Xentra Menu Domain v2 — Locked Contract

Date: 2026-10-05

This document supersedes the previous SINGLE/PACKAGE Menu contract for proposal/xentra-taxonomy-composed-menu-v1.

## Core distinction
- Menu = the commercial/customer-facing thing that is sold and shown in Customer PWA.
- Item = an atomic internal composition/stock unit used by a Menu.
- A Menu may contain one or many Items. Item count does not define a Menu type.
- There is no forward domain entity called Menu Satuan, Menu Paket, or Package Menu.

## Menu authoring
A Menu requires Category, Judul, and Item composition. Rasa is nullable. Selling price is required.

Example:
Category = Ayam
Judul = Paket Hemat Ayam Tulang Lunak Sambal Ijo + Es Teh
Rasa = NULL
Menu ID = MENU-00125

Composition: Ayam Tulang Lunak x1; Nasi x1; Lalapan x1; Sambal Ijo x1; Es Teh Manis x1.

## Catalog masters
Catalog is ordered as Master Menu first, then Master Category. Master Category contains four independent master vocabularies: Category, Judul, Rasa, and Item. These are not a parent-child hierarchy.

### Category
Category is a grouping/filter attribute for Menu. It does not own Judul, Rasa, or Item and does not determine composition.

## Judul
Judul is a reusable master vocabulary used by the Menu editor. It is independent from Category; it is not a child of Category. The Menu editor may recommend Judul values based on existing Menus that already use the selected Category. This recommendation is derived from Menu usage (`menus.category_id` + `menus.title_id`) and does not create a Category→Judul relation. The [+] action creates a Judul master entry.

Judul is not Product, SKU, inventory, or composition. It is the base customer-facing title.

## Rasa
Rasa is reusable Brand Master data and is optional. rasa_id = NULL is valid. It has no inventory quantity, SKU, stock balance, or Product composition relationship.

Examples: Minuman + Es Teh + Manis -> Es Teh Manis. Makanan + Nasi Goreng + NULL -> Nasi Goreng.

## Item and SKU
Item is the atomic internal composition/inventory identity. Item is managed from Master Category → Item. The Item form contains only the Item name and a `Kelola di Stock` toggle. SKU is shown and required only when `Kelola di Stock` is enabled. Item name, stock flag, and SKU are internal and must not be exposed in Customer PWA.

## Menu composition
Menu -> Menu Items -> Item x quantity. `menu_items` is a Menu composition relation, not a Package relation. An Item may appear once per Menu; quantity expresses repeated units.

Selling a Menu deducts the required stock-managed Item quantities at the fulfillment Branch.

## Menu identity
The persisted Menu ID is the commercial identity. Duplicate protection uses Brand + Category + Judul + NULL-safe Rasa.

## Menu vs Promotion
A Menu named Paket Hemat Ayam + Es Teh is still an ordinary Menu if independently listed, priced and purchased. Promotion is a separate domain and may bundle/discount existing Menus without creating a Package Menu entity.

## Branch
Branch adoption is Menu-authoritative. Item inventory is Item-authoritative. Branch Menu adoption does not create Product; Item inventory does not create Menu.

## PWA
Customer PWA receives Menu as the commercial item. PWA must not depend on SINGLE/PACKAGE semantics.

## Forbidden forward concepts
Do not use menu_type=SINGLE, menu_type=PACKAGE, package_name, Menu Satuan, Menu Paket, SINGLE requires exactly 1 Product, or PACKAGE requires 2+ Products as forward business rules. Legacy columns may remain temporarily for migration compatibility only.

## Migration
Legacy data is migration input, not the forward source of truth. Legacy sub_categories may be mapped to menu_titles only when clearly equivalent. Legacy package_name/menu_type must not create a Package entity. Legacy compositions become ordinary menu_items. Ambiguous records require review.

## Implementation order
1. Lock this contract. 2. Introduce menu_titles. 3. Refactor schema/service/repository/resolver. 4. Remove forward SINGLE/PACKAGE semantics. 5. Refactor Owner Menu editor. 6. Refactor Customer PWA. 7. Refactor POS/Checkout/Order/Receipt/Reporting/Promotion. 8. Update migration tooling and fixtures. 9. Quarantine legacy paths. 10. Run full CI and production verification. 11. Promote only after the verification gate.

main must remain unchanged until the proposal branch passes the complete verification gate.