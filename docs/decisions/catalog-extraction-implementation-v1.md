# Xentra — Catalog Domain Extraction Implementation Record v1

**Status:** IMPLEMENTED / COMPATIBILITY SHIM RETAINED  
**Date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## Implementation

Canonical catalog ownership is implemented under `domains/catalog/`:

- `services/CatalogService.js`
- `models/PricingPolicyModel.js`
- `index.js`

Legacy Commerce paths remain compatibility shims:

- `domains/commerce/services/CatalogService.js`
- `domains/commerce/models/PricingPolicyModel.js`

## Consumer migration

Runtime `api.js` dependencies now resolve CatalogService from `domains/catalog`.

Catalog-focused tests already use the canonical `domains/catalog` path.

## Invariants

- Catalog owns master/branch catalog resolution.
- PricingPolicyModel remains part of Catalog because it owns price-resolution policy.
- Commerce remains responsible for Cart, Checkout and Order lifecycle.
- No second catalog implementation was introduced.
- Compatibility exports remain available until full verification permits removal.

## Verification

- Canonical CatalogService parses successfully.
- Canonical PricingPolicyModel parses successfully.
- Catalog domain index parses successfully.
- `api.js` resolves CatalogService from `domains/catalog`.
- Existing catalog boundary regression test remains in place.
- Full repository `npm test` was not executed in this pass.

## Completion state

Catalog structural extraction and known runtime consumer migration are complete.

Do not remove the Commerce compatibility shims until the complete catalog/domain regression suite has passed and no production/test consumer depends on the legacy paths.
