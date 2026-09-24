# Xentra — Merchant Shared Catalog Split Implementation v1

**Status:** IMPLEMENTED / ACTIVE  
**Date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## Boundary result

The former mixed `apps/merchant-shared/js/branch-catalog.js` has been removed.

### Shared layer

`apps/merchant-shared/js/catalog-client.js`

Owns reusable transport/data operations for Branch Catalog:

- load branch catalog;
- adopt product;
- update product availability;
- remove product;
- upload branch product image;
- save product override;
- create/update/delete branch category;
- upload branch category image;
- reorder branch categories.

It does not render DOM, own modals, or contain surface-specific hooks.

### Owner surface

`apps/merchant-dashboard/assets/js/branch-catalog-ui.js`

Owns Owner catalog UI:

- branch catalog management modal;
- adopted/available product rendering;
- adoption modal;
- Owner-side branch catalog interactions;
- branch product override UI used by the Owner surface.

### Merchant App surface

`apps/merchant-app/assets/js/branch-catalog-ui.js`

Owns Branch Manager catalog UI:

- inline branch catalog rendering;
- category filtering/reordering UI;
- branch category create/edit/delete UI;
- product override UI;
- Branch Manager availability/remove interactions.

### Consumer namespace migration

- Owner Dashboard uses `window.XentraOwnerBranchCatalog`.
- Merchant App uses `window.XentraMerchantBranchCatalog`.
- `context.js` and `menu.js` no longer consume the deleted `window.XentraBranchCatalog` namespace.
- `merchant-app.js` no longer depends on the deleted shared branch-catalog script.

## Loader order

Both surfaces load:

`shared.js → action-menu.js → crop-editor.js → catalog-client.js → surface-owned branch-catalog-ui.js → surface JS`

The old shared `branch-catalog.js` script is no longer loaded.

## Compatibility / migration

The split deliberately does not preserve the old generic `XentraBranchCatalog` global. Consumers were migrated to their owning surface namespace instead.

Catalog API behavior remains server-authoritative. The split changes code ownership and transport reuse, not endpoint contracts.

## Verification

- Catalog client, Owner UI, Merchant UI and migrated consumers parse successfully.
- Both HTML surfaces load the correct catalog client + surface UI in the correct order.
- No runtime consumer in the migrated merchant surfaces references `window.XentraBranchCatalog`.
- New boundary regression coverage is maintained in `tests/merchantSharedDedup.test.js` and related surface tests.
- Full repository `npm test` was not executed in this pass because this GitHub-connected session does not execute the repository's full runtime test suite.

## Completion state

The Merchant Shared catalog split is structurally complete.

The remaining refactor-program item is no longer this split; after full runtime regression verification, the next stage is POS application implementation/hardening rather than further extraction of this shared catalog boundary.
