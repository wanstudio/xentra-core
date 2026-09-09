# Xentra Core — Data Access Migration Status

**Status:** IN PROGRESS
**Decision boundary:** LOCKED by `docs/ENTERPRISE_SAAS_IP_DATA_BOUNDARY.md` and `docs/CORE_CONNECTOR_API_CONTRACT.md`

## Current state

The transitional `core/data/DataAccess` seam is active. Domain-oriented repositories now exist for catalog, promotion, order, payment, and POS/table concerns.

The following service families have been moved off direct imports of `server/database/db` to the approved `DataAccess` seam or repository boundary during incremental migration:

- Commerce catalog / eligibility / payment verification
- Promotion engine
- POS offline reconciliation / shift reporting
- Inventory / delivery / reporting services
- Payment gateway service
- Commerce order placement service persistence dependency

## Important constraint

The large transactional services are intentionally migrated incrementally. No broad rewrite of order/payment business logic is authorized by the architecture decision. Transaction semantics, idempotency, stock concurrency guards, payment state transitions, and fulfillment invariants must remain behaviorally equivalent during extraction.

## Next gate

1. Complete caller migration to domain-oriented repositories where transaction-safe APIs are available.
2. Add boundary tests that reject direct `server/database/db` imports from runtime domain/service code.
3. Define transaction-aware repository operations needed by order/payment settlement before removing the transitional `prepare/exec` seam.
4. Verify tests and production-readiness gates.
5. Only then create the separate `xentra-connector` repository from the locked v1 contract.

## Prohibited shortcut

Do not create the connector by copying or extracting `xentra-core`, and do not expose arbitrary SQL or filesystem operations across the Core ↔ Connector API.