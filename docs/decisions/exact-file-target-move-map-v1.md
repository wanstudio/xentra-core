# Xentra — Exact File → Target Domain/App Move Map v1

**Status:** 🔒 LOCKED IMPLEMENTATION MAP  
**Date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## Scope

This map is based on the latest GitHub source audit on 2026-09-24.

**This step does NOT move production code.** It freezes the intended move boundaries so subsequent refactoring can be performed incrementally and reviewed.

## A. Backend — Files to MOVE

### A1. Dining extraction

| Current | Target | Action | Notes |
|---|---|---|---|
| `domains/pos/services/DiningTableService.js` | `domains/dining/services/DiningTableService.js` | MOVE | Cross-surface table/session authority; not POS-only |
| `domains/pos/services/TableRecommendationService.js` | `domains/dining/services/TableRecommendationService.js` | MOVE | Table recommendation is dining capability |
| `domains/pos/templates/Template01.js` | `domains/dining/templates/Template01.js` | MOVE | Dining/table layout template |

Before deleting the old paths, add compatibility re-exports and migrate consumers.

### A2. Catalog extraction

| Current | Target | Action | Notes |
|---|---|---|---|
| `domains/commerce/services/CatalogService.js` | `domains/catalog/services/CatalogService.js` | MOVE | Owns branch/master catalog resolution |
| `domains/commerce/models/PricingPolicyModel.js` | `domains/catalog/models/PricingPolicyModel.js` | MOVE | Required because CatalogService owns price-resolution logic and currently imports this model |

Moving PricingPolicy together avoids a bad dependency where Catalog depends on Commerce.

## B. Backend — Files that STAY

### B1. POS

These remain POS:

- `domains/pos/services/PosOrderService.js`
- `domains/pos/services/PosShiftService.js`
- `domains/pos/services/OfflineReconciliationService.js`
- `domains/pos/services/PosHardwareRouter.js`
- `domains/pos/services/PosLocalOperationService.js`
- `domains/pos/models/PosShiftModel.js`
- `domains/pos/models/OfflineRiskLimitModel.js`
- `domains/pos/index.js` (updated to export only real POS concerns after migration)

### B2. Commerce

These stay:

- `domains/commerce/services/EligibilityService.js`
- `domains/commerce/services/OrderPlacementService.js`
- `domains/commerce/services/PrePaymentVerificationGate.js`
- `domains/commerce/models/LowStockThresholdModel.js`
- `domains/commerce/index.js` (updated after Catalog extraction)

**Important:** `OrderPlacementService.js` currently contains direct dine-in/table validation through `DiningTableRepository`. During Dining migration, this must be reviewed so Dining business invariants do not exist in two places. Do not blindly change only the import path.

### B3. Shared infrastructure

Keep repositories under `core/data/repositories/` for now:

- `CatalogRepository.js`
- `DiningTableRepository.js`
- `PosOperationalRepository.js`
- `PosOrderRepository.js`
- `PosShiftRepository.js`

These are persistence adapters, not business-domain owners.

### B4. Other domains

No structural move in this pass:

- `domains/banner/`
- `domains/delivery/`
- `domains/inventory/`
- `domains/payment/`
- `domains/promotion/`
- `domains/reporting/`

They already align sufficiently with the target boundary.

### B5. Server / Core

No structural move:

- `core/**`
- `server/app.js`
- `server/services/**`
- `server/routes/api.js`

`server/routes/api.js` is explicitly deferred; it is not a refactoring target merely because it is large.

## C. Dining Consumer Updates Required

After the Dining target exists, update these consumers from the old POS path to the Dining boundary:

- `server/services/AcceptanceTimeoutService.js`
- `domains/payment/services/CashSettlementService.js`
- `domains/payment/services/PaymentGatewayService.js`
- `domains/commerce/services/OrderPlacementService.js` — first remove/centralize duplicated Dining business logic where appropriate
- `domains/pos/index.js` — temporary compatibility export only

Known Dining-related tests to preserve and later mirror under a Dining test folder:

- `tests/domains/dineInSecurityP0.test.js`
- `tests/domains/dineInTableFloorPlan.test.js`
- `tests/domains/diningSessionChannelTracking.test.js`
- `tests/domains/dineInMerchantAcceptanceBaseline.test.js`

Cross-domain tests such as `tests/core/dineInOpenBill.test.js` stay where their test ownership warrants it.

## D. Catalog Consumer Updates Required

After Catalog target exists:

- `domains/commerce/index.js`
- `domains/commerce/services/EligibilityService.js`
- `domains/commerce/services/PrePaymentVerificationGate.js`
- all direct CatalogService test imports/usages

Tests currently identifying Catalog behavior include:

- `tests/domains/catalogModel.test.js`
- `tests/branchMenuOverride.test.js`
- `tests/branchCategoryManagement.test.js`
- `tests/domains/demoBranchesCatalog.test.js`
- `tests/ownerDashboardCatalogPhase1.test.js`
- `tests/apiCatalog.test.js`

Test paths may be reorganized only after runtime imports are stable.

## E. Frontend — NO wholesale moves

### E1. Merchant App

Stay:

`apps/merchant-app/**`

It remains the Branch Manager application.

Do not clone it to create POS.

### E2. POS

Create new application:

`apps/pos-app/**`

Build it independently against Core/domain contracts.

No existing Merchant App screen should be copied as the POS architecture.

### E3. Owner

Stay for now:

`apps/merchant-dashboard/**`

Owner Dashboard extraction to `apps/owner-dashboard/**` remains a later phase.

### E4. Customer / Kitchen

Stay:

- `apps/customer-pwa/**`
- `apps/kitchen-app/**`

## F. Merchant Shared — SPLIT, do not simply MOVE

Current:

`apps/merchant-shared/js/branch-catalog.js`

This file currently mixes transport/data operations with UI rendering, modal management, and surface hooks.

### F1. Eventually extract generic business client/data operations to

`apps/merchant-shared/js/catalog-client.js`

Candidate responsibilities:

- load branch catalog data;
- adopt product;
- remove/unadopt product;
- update branch availability;
- save/clear branch product override;
- create/update/delete branch category;
- reorder category;
- shared request/error handling.

### F2. Move surface-specific UI logic to the owning app

Owner-specific:

`apps/merchant-dashboard/**`

Merchant-specific:

`apps/merchant-app/**`

Functions that are primarily rendering/modal/UI should NOT remain in generic shared merely because both surfaces currently use the same file.

Known UI-heavy functions include:

- `openBranchCatalogModal`
- `closeBranchCatalogModal`
- `renderBranchAdoptedProducts`
- `renderBranchAvailableMasterProducts`
- `openBranchOverrideModal`
- `closeBranchOverrideModal`
- `openAdoptModal`
- `closeAdoptModal`
- `openBranchCategoryCreateModal`
- `openBranchCategoryEditModal`
- `closeBranchCategoryEditModal`
- `initBranchCategoryEditModal`
- `renderInlineCategoriesBar`
- `renderInlineAdoptedProducts`
- `renderInlineAvailableProducts`

Mutation/client helpers such as:

- `toggleBranchProductAvailability`
- `removeBranchProduct`
- `saveBranchProductOverride`
- `clearBranchProductOverride`
- `saveBranchCategoryOrder`
- `deleteBranchCategory`

should be split so the API operation is reusable while UI confirmation/toast/rendering stays in the owning surface.

`branch-catalog.js` must not be deleted until both Owner and Merchant consumers are migrated and tests prove parity.

## G. Generic Frontend Shared

Target:

`shared/frontend/**`

Do not migrate all of `merchant-shared` here.

Generic candidates eventually include:

- auth/session primitives;
- HTTP helpers;
- generic DOM utilities;
- generic UI primitives;
- generic formatting/utilities.

Current `merchant-shared/js/shared.js` remains where it is during this pass.

However, role/surface-specific helpers such as `isBranchManager` are a future extraction candidate and should not spread into the generic layer.

## H. Migration Order

1. Create `domains/dining/` and `domains/catalog/` skeletons.
2. Add compatibility exports/shims.
3. Move Dining services/templates.
4. Migrate Dining consumers.
5. Remove duplicated Dining business validation from Commerce where a Dining authority should own it.
6. Move CatalogService + PricingPolicyModel.
7. Migrate Catalog consumers.
8. Create `apps/pos-app/`.
9. Only then narrow/clean POS index exports.
10. Split `branch-catalog.js` by client/data vs surface UI.
11. Owner Dashboard extraction remains later.

## I. Safety Rules

- Never perform multiple large moves in one release.
- Never delete the old path before consumers and tests are clean.
- Preserve compatibility where required.
- Inspect diff + import graph before each deletion.
- Keep transaction/concurrency semantics unchanged unless the migration explicitly targets them.
- Do not treat folder cleanliness as a reason to change business behavior.
- No authorization decisions move into frontend code.
- No second source of truth is introduced.

## J. Current Audit Conclusion

The most significant structural mismatches found in the current source are:

1. Dining capability living inside `domains/pos`.
2. Catalog capability living inside `domains/commerce`.
3. `branch-catalog.js` mixing reusable client/data operations with Owner/Merchant UI.
4. `OrderPlacementService` containing direct Dining business validation that must be reconciled when Dining becomes an explicit boundary.

These are the structural areas to fix before scale increases, but they should be fixed incrementally rather than rewritten in one cut-over.
