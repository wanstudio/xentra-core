# Xentra — Branch Category Active State & Customer Visibility v1

**Status:** SUPERSEDED — OPERATIONAL DETAIL RETAINED FOR HISTORY
**Date:** 2026-09-30
**Superseded by:** `docs/proposals/xentra-taxonomy-composed-menu-v1.md` (LOCKED TARGET CONTRACT, 2026-10-03)
**Scope:** Merchant App, Branch Category operational state, Customer PWA visibility

**Parent contract:** `docs/proposals/xentra-taxonomy-composed-menu-v1.md`

## 1. Why this historical detail exists

> This document records the Branch Category active/inactive behavior from the 2026-09-30 implementation decision. The operational concept remains useful, but all Product-vs-Menu and Branch adoption authority is now governed by the 2026-10-03 Product → Menu → Inventory contract.

The parent contract §19 states that a change to **Customer presentation mapping** requires an
explicit revision. Deactivating a Branch Category changes what the Customer Menu contains, so the
rule below is recorded here as that approval rather than left implicit in code.

This document **adds** an operational capability to Branch Category. It does not change ownership,
cardinality, pricing authority, or snapshot semantics for Master Menu Composition.

## 2. Decision

`branch_categories` gains an `is_active` state.

- `is_active = 1` (or `NULL`, for rows created before this column existed) → the category is
  **active**.
- `is_active = 0` → the category is **deactivated**.

Deactivation is a **Merchant/Branch-scoped operational control**, consistent with the parent
contract §8, which already grants Merchant the ability to classify adopted Products into Branch
Categories and to operate other Branch-scoped operational controls.

Branch Category remains a **separate classification layer**, exactly as stated in the parent
contract §9. It is **not** part of Master Menu Composition, and
`docs/decisions/xentra-menu-legacy-quarantine-v1.md` §4 continues to list "Branch Category
ownership" as valid and **not** quarantined.

## 3. Customer Menu resolution rule

For the canonical Customer Menu path (`GET /api/v1/catalog/composed-menu?branch_id=`, resolved by
`ComposedMenuResolver.resolveBranchMenu`):

| Case | Customer Menu result |
|---|---|
| Category active | Category is returned; its products are shown |
| Category deactivated | Category is **not** returned |
| Product grouped **only** under deactivated categories | Product is **not** shown |
| Product also grouped under at least one active category | Product **is** shown |
| Product with **no** Branch Category at all | Product **is** shown |

The last row matters: an uncategorised product is not a deactivated product. Deactivation must
never be inferred from the absence of a category.

`NULL` is treated as active by every read, so pre-existing rows keep behaving as they did before
this change.

## 4. Management surfaces keep seeing everything

Deactivation removes an offering from the Customer Menu. It does **not** erase the category from
the management surfaces.

- Merchant App menu (`GET /admin/branches/:id/menu`) resolves with
  `includeInactiveCategories: true`, so the category bar can list deactivated categories and the
  Merchant can reactivate them.
- Branch catalog administration (`GET /admin/branches/:id/catalog`) returns `is_active` for every
  category.

A deactivated category that could no longer be listed or reactivated would be a dead end, so this
asymmetry is intentional: **deactivation is a visibility decision for customers, not a deletion.**

## 5. What this does NOT do

- It does **not** change Master Menu Composition or Branch Category membership authority.
- `branch_products.name_override` is legacy compatibility data and is not a canonical Customer Menu override in the current contract.
- `description_override`, `image_override`, the legacy `PATCH /admin/branches/:id/products/:productId/override`
  path for those fields, and legacy snapshot columns remain quarantined.
The status control added here is a Branch Category operational control, not a Menu composition editor.
- It does **not** create a second catalogue authority, a second Composition editor, a second
  Inventory authority, or a second Promotion engine.
- It does **not** delete data. Deactivation is reversible; the category and its memberships are
  retained. Physical deletion stays a separate, explicit action.
- It does **not** change Master Product active state (`products.is_active`), which remains the
  Owner-controlled sellable-universe gate described in the parent contract's locked addendum.

## 6. Inventory note (recorded deliberately)

Adopting a Master Product into a Branch now writes `branch_products.stock = NULL` explicitly,
meaning **physical stock is not managed yet**. This is to stop an implicit `0` from being read as
"out of stock". It does not introduce a stock value, a second inventory pool, or an availability
decision — Branch availability remains `branch_products.is_available`, and stock remains owned by
the Inventory domain.

## 7. Implementation surface

| Layer | Change |
|---|---|
| Schema | `branch_categories.is_active INTEGER DEFAULT 1` + idempotent `ALTER TABLE` migration |
| Customer resolution | `ComposedMenuResolver.resolveBranchMenu` (`activeOnly`), `findBranchProductCategoryMemberships` (returns `is_active`), `MasterMenuResolver.resolveBranchMenu` |
| Support repository | `CatalogRepository.findBranchCategories` (`activeOnly`) |
| API | `PATCH /admin/branches/:id/categories/:catId` accepts partial `name` and/or `is_active`; `GET /admin/branches/:id/catalog` returns `is_active` |
| Merchant UI | Aktif/Nonaktif control in the Branch Category modal; status filter dropdown in the Merchant App menu |
