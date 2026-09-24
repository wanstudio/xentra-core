# Xentra — Dining Extraction Implementation Record v1

**Status:** IMPLEMENTED / COMPATIBILITY SHIM RETAINED  
**Date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## Requirement

Move Dining implementation out of the POS domain without changing table, dining-session, reservation, QR, or concurrency behavior.

## Implementation boundary

Authoritative Dining implementation now lives under:

`domains/dining/`

- `services/DiningTableService.js`
- `services/TableRecommendationService.js`
- `templates/Template01.js`
- `index.js`

The old POS paths remain compatibility shims:

- `domains/pos/services/DiningTableService.js`
- `domains/pos/services/TableRecommendationService.js`
- `domains/pos/templates/Template01.js`

The POS domain re-exports the Dining services only for backward compatibility.

## Consumer migration

Runtime consumers now use the Dining boundary directly, including:

- `server/routes/api.js`
- `server/routes/dine-in.js`
- `server/routes/operational-orders.js`
- `server/routes/checkout.js`
- `server/routes/customer-orders.js`
- `domains/commerce/services/OrderPlacementService.js`
- `server/services/AcceptanceTimeoutService.js`
- `domains/payment/services/CashSettlementService.js`
- `domains/payment/services/PaymentGatewayService.js`

Relevant Dine-in test suites were also migrated to the Dining import path, while `tests/domains/diningBoundary.test.js` intentionally keeps legacy imports to verify compatibility-shim identity.

## Invariants preserved

- Dining remains authoritative for table/session/reservation rules.
- POS remains a consumer/executor, not table-state authority.
- Commerce continues to own Order lifecycle while delegating Dining invariants.
- Payment remains distinct from Dining Session completion.
- Core repositories remain the persistence boundary.
- No new reservation persistence model or second state machine was introduced.
- No authorization decision moved into frontend code.

## Verification

- Target Dining modules parse successfully.
- POS compatibility shims parse successfully.
- Known runtime Dining consumers resolve through `domains/dining`.
- `api.js` has no inline route declarations and its Dining dependency injection uses `domains/dining`.
- Existing Dining boundary regression test remains in place.
- Full repository `npm test` has not been executed as part of this implementation pass.

## Completion state

Dining structural extraction and known consumer migration are complete.

Do **not** delete the compatibility shims until the full relevant regression/security/concurrency suite has been executed successfully and no remaining production/test consumer depends on the old paths.
