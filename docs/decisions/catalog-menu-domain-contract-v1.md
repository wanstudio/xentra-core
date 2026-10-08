# Xentra — Catalog / Master Category / Master Menu Contract v1

**Status:** ⚠️ SUPERSEDED — HISTORICAL  
**Original date:** 2026-10-05  
**Superseded by:** `docs/decisions/catalog-menu-domain-contract-v2.md` (LOCKED, 2026-10-08)

## 1. Historical purpose

This document recorded an earlier Catalog/Menu model during the taxonomy migration.

It is retained for migration history and audit traceability only.

It is **not** an active implementation authority.

## 2. Superseded decisions

The following v1 assumptions are no longer normative:

- Category + Sub Category + Rasa as the universal Menu identity;
- Category/Sub Category as the required Menu title hierarchy;
- Rasa as a universal Menu identity dimension;
- free-text customer title being prohibited;
- a separate Master Rasa/Sub Category taxonomy being required for every Menu;
- Menu authoring that assumes every variation belongs at Menu level.

These assumptions were revised after further F&B stress-testing and Owner UX review.

## 3. Current authority

Use:

- `docs/decisions/catalog-menu-domain-contract-v2.md` for current Catalog/Menu business and Owner authoring semantics.
- `docs/decisions/xentra-menu-item-choice-template-contract-v1.md` for Item Choice scope, Owner-vs-Customer mode, predefined UI templates, renderer policy, and Custom handling.
- `docs/decisions/xentra-domain-vocabulary-boundary-v1.md` for domain ownership and cross-domain vocabulary.
- The existing legacy fields/tables covered by migration contracts remain compatibility material only.

## 4. Migration note

Existing storage such as `sub_category_id`, `rasa_id`, legacy Menu/Product fields, and related tests may remain while migration is in progress.

Their continued presence in the repository does not restore the v1 business model.

Do not resolve a source/document conflict by guessing. Reconcile it against the current v2 contract before implementation.

**SUPERSEDED — retained for historical traceability only.**
