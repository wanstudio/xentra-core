# 🔒 Xentra — Offline POS Architecture Boundary v1

**Status:** LOCKED / ARCHITECTURE BOUNDARY — FOUNDATION IMPLEMENTED; P3/P4 NOT ACTIVATED
**Decision date:** 2026-09-26
**Repository:** wanstudio/xentra-core

## Purpose

Define the architectural boundary for Xentra POS when Xentra-Core is unreachable, before implementing P3 (Offline Dine-in Table Claim) and P4 (Offline Sale vs Merchant Acceptance). The durable browser operational-store foundation is now implemented under a separate explicit decision; this page remains the governing architecture boundary.

This document resolves the architecture. It does not by itself authorize every downstream implementation detail.

## 1. Core decision

Xentra distinguishes five separate conditions:

Device connectivity
≠ Xentra-Core reachability
≠ POS presence / lease
≠ local operational state
≠ server synchronization state

navigator.onLine is only a browser connectivity signal. It is not the business definition of POS availability.

The POS may continue supported operations without Core, but this does not transfer permanent business authority from Core to the device.

Core remains the central business authority and final system of record.

## 2. Offline POS operating model

When Core is unavailable, an authorized POS device may enter an explicitly supported local-operational mode.

The local operating model is:

Last-known valid Branch snapshot
→ Local operational execution
→ Durable local commit
→ Stable local operation identity
→ Pending synchronization
→ Reconnect
→ Ordered reconciliation with Core
→ SYNCED / CONFLICT / FAILED / MANAGER REVIEW

A local operation is a real operational fact, but it is not automatically a final Core-authoritative state until reconciliation succeeds.

## 3. Local authority boundary

POS receives only a bounded operational authority while offline.

### POS may, when explicitly permitted

- continue an authorized Cash transaction;
- use the last-known valid Branch catalog/configuration snapshot;
- consume local cached stock according to the existing offline inventory contract;
- create local sale/order records;
- maintain the current Shift and cash workflow within the offline contract;
- create a provisional local table claim for a dine-in transaction;
- record local operational acceptance for a physical offline transaction where the contract permits it;
- queue all applicable operations for durable synchronization.

### POS must not assume authority over

- tenant/brand/Branch governance;
- workforce/RBAC changes;
- Master Product authority;
- central catalog governance;
- permanent inventory truth;
- provider-confirmed online payments;
- cross-channel business policy;
- permanent table ownership after reconciliation;
- silent conflict resolution.

## 4. Durable browser boundary

A browser-based POS cannot claim full offline transaction safety from RAM state alone.

The backend already contains an offline operational foundation:

- PosLocalOperationService;
- durable server-side sync queue;
- OfflineReconciliationService;
- stable client transaction identity;
- idempotent order ingestion;
- cross-channel inventory conflict records.

At the time this boundary was locked, the browser POS still called /pos/local/sale when navigator.onLine was false, which required a reachable Core. The separate `pos-offline-browser-operational-store-v1` implementation has now added durable device-local operational persistence. P3/P4 remain gated and full offline Dine-in is still not activated.

### Locked activation rule

Full browser offline transaction support requires a durable local POS store before an offline sale can be considered crash/reload safe.

The future activation boundary is:

POS Browser
→ IndexedDB or equivalent durable local operational store
→ Local transaction + table claim + sync metadata
→ Sync bridge
→ Xentra-Core
→ Reconciliation

The local store remains an operational transport/working store. It does not become the authoritative inventory, payment, RBAC, or management authority.

The former browser-persistence development hold has been explicitly superseded by `pos-offline-browser-operational-store-v1`. The durable browser operational-store foundation is implemented and regression-covered; this does not activate Offline Dine-in Table Claim or Local Operational Acceptance.

## 5. Offline Dine-in table claim

For a dine-in transaction, the selected physical table is a business resource and must not depend on payment success to become locally unavailable.

When offline support is activated, the POS may create a provisional local table claim:

TABLE 05
→ LOCAL CLAIM
→ LOCAL STATE = HELD / DIPESAN
→ OFFLINE DINE-IN OPERATION

The local claim must carry enough correlation to reconcile later, including at minimum:

- Branch;
- table identity;
- terminal identity;
- local operation identity;
- local creation timestamp;
- last-known Core/table revision or equivalent snapshot version;
- local order correlation where applicable.

The claim is provisional. It is not permission for POS to permanently overwrite Dining/Core state.

### No last-write-wins for tables

A table conflict is a physical-resource conflict.

Example:

POS offline → local claim TABLE 05
Core meanwhile → TABLE 05 claimed by another online flow

The system must not resolve this with a generic timestamp or last-write-wins rule.

The reconnect result must become an explicit table reconciliation conflict that preserves the historical offline sale and routes the operational consequence through the defined Manager resolution path.

No historical sale may be deleted merely to hide the conflict.

## 6. Offline sale vs Merchant Acceptance

Online Xentra keeps Merchant Acceptance as the operational boundary because Core is available:

POS Hold
→ canonical Order = pending
→ Merchant Accept
→ Active Dining Session

Offline POS cannot wait for a Merchant App action that requires Core.

Therefore the architecture permits a separate offline distinction:

LOCAL OPERATIONAL ACCEPTANCE
≠ CORE SYNCHRONIZATION

For supported physical Cash sales, the local device may record that the Branch operationally accepted/executed the transaction while disconnected.

At reconnect:

offline operational fact
→ Core reconciliation
→ canonical authoritative state

This does not mean offline POS may manufacture provider-confirmed payment, central approval, or arbitrary business policy.

## 7. Local transaction states

Offline operation must keep operational state and synchronization state separate.

Example:

Operational state = ACCEPTED_OFFLINE
Synchronization state = PENDING_SYNC

Possible synchronization states:

- LOCAL_ONLY;
- PENDING_SYNC;
- SYNCING;
- SYNCED;
- CONFLICT;
- FAILED;
- MANAGER_REVIEW.

These statuses must not be collapsed into one Order lifecycle enum.

A locally executed Cash transaction may therefore be operationally complete for the cashier while still awaiting Core synchronization.

## 8. Customer PWA and remote dine-in during POS outage

The system must not assume that Customer PWA can safely continue making new remote table claims while the branch POS is offline.

The architecture therefore requires a server-visible notion of POS presence/staleness:

POS lease / last successful presence
→ Core knows whether POS is currently present
→ Customer dine-in availability policy

The current source does not yet implement a POS heartbeat/lease model.

Until that mechanism and the related customer-channel contract exist, no implementation should silently claim that Core can detect a disconnected POS from the current browser navigator.onLine state.

The safe architectural direction is to degrade or stop new remote table-based dine-in claims when the authoritative POS presence becomes stale, while leaving the exact customer-facing UX and exception handling to the related Customer/P7 decision.

This restriction concerns new remote claims. It does not retroactively invalidate a physical offline POS transaction.

## 9. Reconnect and reconciliation

Reconnect is not simply “POST everything again.”

The queue must preserve stable local identities and ordering where operational ordering matters.

Canonical sequence:

LOCAL_PENDING
→ SYNCING
→ server validation + idempotency
→ SYNCED / CONFLICT / FAILED
→ MANAGER_REVIEW when required

The server must:

- deduplicate by stable client operation identity;
- prevent duplicate Sale/Order creation;
- prevent duplicate stock effects;
- preserve historical transaction records;
- preserve the local-to-server correlation;
- expose conflicts instead of silently rewriting business history.

## 10. Offline payment boundary

Offline Cash is a physical branch-side operation and may be supported.

Provider-verified payments are different.

Cash
→ may be recorded locally

Gateway / provider verification
→ requires Core/provider reachability

The device must never mark a gateway or QRIS payment as provider-confirmed solely because a customer was shown a payment UI while offline.

A local transaction record and a provider-confirmed payment record are separate facts.

## 11. Inventory boundary

The existing one-Branch-one-inventory-pool rule remains unchanged.

Offline POS may consume from its last-known local stock state where the offline risk contract permits it.

When reconnecting:

local stock effect
+
central stock/demand history
→ reconciliation
→ SYNCED or INVENTORY CONFLICT

There is no permanent rule that POS wins over PWA or PWA wins over POS.

Inventory conflicts that require business judgment remain Branch Manager decisions.

## 12. Table/session boundary after reconnect

An offline table claim may later become:

- successfully reconciled into the canonical Dining state; or
- an explicit reconciliation conflict requiring Manager action.

The system must not create a second independent Dining state machine merely because the POS was offline.

The canonical Dining domain remains responsible for final server-authoritative:

- table state;
- Dining Session;
- table/session association;
- concurrency;
- completion/release;
- reassignment.

## 13. Failure safety

The durable local transaction boundary must eventually be atomic across the local operational effect and its sync metadata.

Conceptually:

Create local transaction
→ Persist transaction + items + local operational effects + sync identity/metadata
→ COMMIT LOCAL
→ Crash/reboot/reload
→ Recover PENDING operation
→ Retry safely

A printed receipt proves a local operational action occurred. It does not prove Core synchronization.

## 14. MVP implementation gate

This architecture decision does not authorize immediate implementation of all offline behavior.

Implementation must proceed in this order:

1. Durable browser POS operational store and recovery contract — **RESOLVED / IMPLEMENTED FOUNDATION**.
2. POS presence/lease contract so Core can detect stale terminal presence.
3. Offline table claim contract and reconciliation conflict semantics.
4. Offline sale / local operational acceptance contract.
5. Customer remote dine-in degradation/P7 behavior.
6. Regression tests for crash, retry, duplicate sync, table race, and reconnect conflict.
7. Only then activate full offline dine-in behavior.

The existing backend offline reconciliation foundation can be reused and hardened during these steps.

## 15. Explicit non-goals

This decision does not introduce:

- a second permanent business authority inside POS;
- channel-specific inventory pools;
- last-write-wins table resolution;
- provider-confirmed offline online payments;
- automatic POS-over-PWA or PWA-over-POS business priority;
- a second Dining state machine;
- a requirement for multiple POS terminals per Branch;
- activation of P3/P4 or full offline Dine-in behavior by this decision alone;
- silent conversion of every offline operation into a normal online Merchant Acceptance event.

## 16. Relationship to existing locked decisions

This boundary must be read together with:

- docs/decisions/pos-offline-browser-persistence-v1.md
- docs/POS_OFFLINE_INVENTORY_CONFLICT_CONTRACT.md
- docs/INVENTORY_CHECK_COMMIT_CONSUME_CONTRACT.md
- docs/decisions/pos-cashier-pending-dine-in-table-reservation-v1.md
- docs/decisions/pos-vs-merchant-app-ui-boundary-v1.md
- docs/decisions/pos-readiness-indicator-v1.md
- docs/decisions/pos-flow-audit-backlog-v1.md

This document is the prerequisite architecture boundary for P3 and P4.

## Current source verification

Verified against GitHub main at:

f5d7a66b932e0fb5b066c753c9b2e9d59fbed022

At this source state:

- backend offline reconciliation/idempotency exists;
- browser POS has offline PIN/session/cache support;
- browser POS falls back to /pos/local/sale when navigator.onLine is false;
- browser POS now has a durable IndexedDB operational store and recovery foundation;
- POS table layout is still fetched from Core and there is no local durable table-claim store;
- no POS heartbeat/lease mechanism was found.

Therefore downstream P3/P4 implementation remains gated by this architecture boundary and by their specific contracts.

**Implementation decision:** `docs/decisions/pos-offline-browser-operational-store-v1.md` is the explicit activation revision for the durable browser foundation.
