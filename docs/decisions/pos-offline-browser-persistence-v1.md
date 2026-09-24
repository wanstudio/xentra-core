# 🔒 Xentra — POS Offline Browser Persistence v1

**Status: LOCKED — development constraint**  
**Decision date:** 25 September 2026

## Decision

Browser-side durable transaction persistence is intentionally **NOT enabled during the current development/refactor phase**.

The existing Xentra backend offline/reconciliation engine remains part of the architecture and may continue to be audited, tested, and stabilized. However, POS browser code must **not** introduce or depend on an IndexedDB transaction outbox yet.

## Why

Xentra POS is web-based. Browser-local state survives independently from server processes and source deployments. Introducing durable IndexedDB transaction data too early can let stale development state survive reloads and refactors, making local schema changes and debugging harder.

The development environment must not accidentally turn browser-local transaction data into a hidden second source of truth while POS contracts are still changing.

## Current development boundary

- RAM / JavaScript state may be used for normal runtime state.
- Existing localStorage may remain for small identifiers, preferences, and non-transactional cache.
- **Do not add an IndexedDB transaction queue/outbox for POS sales yet.**
- Do not claim browser POS sales are fully durable offline until this decision is revised.
- Existing backend `PosLocalOperationService`, `OfflineReconciliationService`, server sync queue, idempotency, and conflict handling remain valid and may be stabilized independently.

## Future MVP activation

Once the POS API, payment, shift, terminal, inventory, authentication, pricing, and reconciliation contracts are sufficiently stable, a new explicit decision may activate:

```text
POS Browser
   ↓
IndexedDB durable local state
   ↓
Sync Bridge
   ↓
Xentra Core
   ↓
Reconciliation
   ↓
SYNCED / CONFLICT / FAILED
```

IndexedDB will then be a durable browser-local transport/working store only. It will **not** become the authoritative authority for inventory, payment, orders, or RBAC.

## Cache boundary

Service Worker/static-asset cache and application data persistence are separate:

- Service Worker cache → application assets / app shell.
- IndexedDB → future POS durable business-data queue/cache.

Do not mix these mechanisms when diagnosing stale application state.

## Non-goals of this hold

This decision does not remove or disable the existing backend offline/reconciliation code. It only prevents premature browser-side durable transaction persistence during active POS development.

**Any activation of IndexedDB POS transaction persistence requires a new explicit decision/revision.**