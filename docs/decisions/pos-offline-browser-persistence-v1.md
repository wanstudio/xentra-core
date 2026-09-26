# POS Offline Browser Persistence v1

**Status:** SUPERSEDED / DEVELOPMENT HOLD RETIRED  
**Superseded by:** `docs/decisions/pos-offline-browser-operational-store-v1.md`  
**Date superseded:** 26 September 2026

## Decision

The former development hold that prohibited browser-side durable POS transaction persistence is now retired.

The explicit implementation decision **POS Durable Browser Operational Store & Recovery v1** activates the browser-local persistence foundation using native IndexedDB.

This does **not** activate the full offline POS business model.

## Current boundary

Browser POS now has a durable operational working store for:
- local POS operation records;
- stable `client_transaction_id` / operation identity;
- synchronization metadata and lifecycle;
- recovery of interrupted synchronization;
- branch/terminal-scoped last-known snapshots;
- local operational-effect evidence/intents.

The store is not an authoritative replacement for Xentra Core.

Core remains authoritative for:
- Order system of record;
- Inventory authority;
- Payment/provider verification;
- RBAC/authentication and authorization;
- Dining table/session ownership;
- final reconciliation and conflict governance.

## Explicitly not activated

The following remain separate implementation gates:
- POS presence / lease;
- Offline Dine-in Table Claim;
- Local Operational Acceptance semantics;
- customer-channel degradation when POS presence is stale;
- provider-confirmed online payment while offline;
- multi-terminal branch semantics;
- automatic last-write-wins table reconciliation.

P3 and P4 from the POS Flow Audit Backlog remain gated by these contracts.

## Important distinction

The browser-local store is a durable transport/working layer.

`operational_state` and `sync_state` remain separate.

Example:
- Operational state = `LOCAL_RECORDED`
- Sync state = `PENDING_SYNC`

An interrupted `SYNCING` operation is recovered to `PENDING_SYNC` without creating a new transaction identity. Server replay remains safe because the same `client_transaction_id` is preserved.

## Relationship to prior hold

The prior hold existed to prevent premature hidden local transaction state while the POS contracts were still moving.

The architecture contract has now been made explicit, the durable store schema/recovery boundary has been implemented and regression-tested, and the activation has therefore been intentionally revised.

**Git source of truth:**  
`docs/decisions/pos-offline-browser-operational-store-v1.md`
