# 🔒 POS Offline Operation, Branch Inventory & Multi-Channel Conflict Contract v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-17  
**Scope:** Xentra POS Android APK, Branch inventory operation, multi-channel order interaction, offline operation, synchronization, failure handling, and Manager resolution.

## 1. Context

Xentra POS is not a standalone inventory-management system and it is not a second source of truth for the business catalog. POS is the operational execution layer for one Branch. Branch management and control remain in Xentra-Core.

The current Xentra model is one POS device per Branch. The POS device must be able to continue supported restaurant operations when connectivity to Xentra-Core is unavailable. To make this possible, the device maintains durable local operational state and a synchronization queue. When connectivity returns, locally created transactions and permitted operational actions are synchronized and reconciled with Core.

Offline mode exists for operational continuity. It does not transfer business ownership from Core to the device. Core remains the central management authority and final system of record for centrally managed business state.

## 2. Catalog and product authority

Products shown in POS originate from the existing Xentra catalog model and Branch-scoped Branch Product state. POS does not create a second Master Product catalog.

Canonical relationship:

```text
Master Product
     ↓
Branch Product
     ↓
Xentra-Core
     ↓
Xentra POS APK
```

The POS device receives a Branch-scoped product snapshot/cache sufficient for normal operation. That local snapshot is operational data for the device, not a new product authority.

Branch Product availability remains Branch-scoped. An authorized manager may temporarily make a Branch Product unavailable/sold out, including from POS while offline where the offline contract permits it. Such a local mutation must later synchronize to Core.

## 3. One Branch = one inventory pool

Inventory is not partitioned by sales channel, order type, fulfillment mode, or instrument.

If a Branch has five Ayam available, the business quantity is simply:

```text
Ayam stock = 5
```

Xentra must not model separate quantities such as:

```text
Dine-in stock = 5
Online stock  = 10
```

There is no separate POS stock, PWA stock, WhatsApp stock, or marketplace stock. POS sales and orders originating from PWA, WhatsApp, or integrated external channels consume from the same Branch inventory pool.

Channel-specific inventory buckets are explicitly out of scope unless a future decision creates them.

## 4. Low-stock warning

Low-stock warning is an operational signal calculated from the single Branch stock quantity and a configurable Branch-level threshold.

Example only:

```text
Stock = 2
Low-stock threshold = 3
→ LOW STOCK warning
```

The number `3` is illustrative, not a fixed business rule. The actual threshold is configurable under the existing Branch configuration/authority contract. Xentra may provide a recommended starting value, but the configured Branch value is what the system evaluates.

A low-stock warning means attention is required. It does not automatically create a purchase order, perform an arbitrary stock adjustment, or silently disable the product.

When connected, the same Branch state can be surfaced in POS and the Branch Manager Operational Center. When offline, POS must still be able to evaluate and show the warning using its last valid local stock/configuration snapshot.

## 5. Low-stock operational response

When stock reaches or falls below the configured threshold, POS may present an operational action to an authorized manager, for example:

```text
⚠️ Stok Menipis
Ayam Geprek
Sisa 2

[ Tetap Jual ]
[ Nonaktifkan Sementara ]
```

The system must not automatically disable the product simply because the warning threshold was reached.

If an authorized manager chooses `Nonaktifkan Sementara` while POS is offline, the local Branch Product availability state changes immediately for continued device operation. The mutation is persisted durably and placed in the synchronization queue. Once connectivity returns, Core receives the operation and updates the server-authoritative Branch state, subject to normal authorization and reconciliation rules.

## 6. Multi-channel order ecosystem

Xentra-Core manages the broader order ecosystem. Orders/transactions may originate from multiple sources, including:

- POS
- Customer PWA / client website
- WhatsApp through an integration
- Integrated online-store or marketplace channels
- Future integrations

The source/channel identifies where the transaction originated. It does not create a separate inventory pool.

Conceptually:

```text
POS APK ------------------------┐
Customer PWA -------------------┤
WhatsApp integration ----------┤→ Xentra-Core → Order Management
External marketplace ----------┘              ↓
                                             Branch Inventory
```

POS is therefore an operational entry point. Xentra-Core is the central management and coordination layer.

The existing distinction remains important: Commerce `Order` and POS `Sale` are not silently collapsed into one object merely because both participate in branch operations.

## 7. Offline POS operating model

When the POS device loses connectivity to Xentra-Core, the application enters an operational offline state. Connectivity loss must not by itself erase or invalidate the previously authorized Branch, Terminal, or current Shift state.

The local device maintains durable state sufficient for its explicitly supported offline scope. This includes, as applicable:

- latest valid Branch Product snapshot;
- latest applicable inventory snapshot/state;
- applicable configuration/rules required for offline operation;
- current Terminal and Shift state;
- locally created Sale records;
- cash/payment state that is legitimately supported offline;
- pending synchronization operations;
- synchronization metadata and local correlation identities.

This data must survive process restart, normal application crash, and device reboot. RAM-only transaction state is not sufficient.

Canonical offline flow:

```text
POS connected
     ↓
Connectivity lost
     ↓
OFFLINE operation
     ↓
Permitted Sale / operational action
     ↓
Durable local commit
     ↓
Stable local event/idempotency identity
     ↓
Sync queue = PENDING
     ↓
Connectivity restored
     ↓
Sync + reconciliation with Core
     ↓
Server-authoritative result stored locally
```

## 8. Core authority boundary

Offline support does not turn the POS APK into a permanent business authority.

Core remains authoritative for centrally managed state and management actions, including tenant/brand/Branch scope, workforce authorization, catalog authority, synchronized Branch Product state, centralized reporting, cross-channel order management, and final reconciliation of synchronized operations.

The POS device may make local operational decisions only where the contract explicitly permits continued offline execution from a last-known valid state.

## 9. Accepted multi-channel inventory conflict

A known and accepted failure scenario exists when POS is offline while online channels remain connected to Core.

Example:

```text
Branch stock for Ayam = 5

PWA receives Order #WEB-001 → Qty 3
POS is offline and records Sale #POS-001 → Qty 3
```

Both transactions can be locally valid from the state each side knew at the time. The combined demand is six units against a stock pool of five.

Xentra must not invent an automatic permanent priority rule merely to force the numbers to reconcile. There is no rule that POS always wins, online always wins, or that each channel owns a reserved stock bucket.

The conflict is surfaced to the authorized Branch Manager when Core has the relevant synchronized state. The Manager makes the business decision according to the restaurant's operational needs.

For the example, the Manager may choose to prioritize the POS/dine-in demand. The affected online Order is then handled through the applicable reject, partial-fulfillment, return, refund, or customer-remediation flow defined by the Order/payment contract.

The original Sale and Order remain historical records. A conflict resolution must not delete or rewrite them simply to hide the inconsistency.

## 10. Conflict resolution flow

```text
PWA / online channel
      ↓
Order #WEB-001 Qty 3

POS offline
      ↓
Sale #POS-001 Qty 3
      ↓
POS reconnects
      ↓
POS syncs local Sale
      ↓
Core reconciles Branch inventory + synchronized demand
      ↓
Conflict detected
      ↓
Branch Manager is notified
      ↓
Manager chooses business resolution
      ↓
Core records decision + audit/business evidence
      ↓
Affected Order/Sale state is updated through the correct domain flow
      ↓
Reporting reflects both the original transactions and the resolution
```

The Manager's decision is a business action. The system may enforce the allowed resolution options and authorization boundaries, but it must not fabricate a business policy that the owner/manager never configured or selected.

## 11. Business log vs system log

Xentra must distinguish business decision records from technical/system events.

### Business log

A business log answers: **what business decision happened, by whom, and why?**

For an inventory conflict, preserve as applicable:

- Branch;
- affected product/item;
- relevant stock state;
- affected POS Sale identifier;
- affected online Order identifier(s);
- competing quantities/demand;
- Manager identity and role;
- selected resolution/priority;
- reason/comment where required;
- timestamp;
- resulting business outcome.

Example:

```text
INVENTORY_CONFLICT_RESOLVED
Branch: Bangjo Timur
Product: Ayam
Available stock: 5
POS demand: 3
Online demand: 3
Decision: Prioritize POS / dine-in
Affected online order: WEB-001
Resolution: Apply applicable online reject/return/refund flow
Resolved by: Branch Manager
```

### System log

A system log answers: **what happened to the device, network, application, or synchronization pipeline?**

Representative events:

```text
POS_OFFLINE_DETECTED
POS_OFFLINE_TRANSACTION_CREATED
POS_RECONNECTED
POS_RESYNC_STARTED
POS_RESYNC_COMPLETED
POS_RESYNC_FAILED
POS_SYNC_RETRY
POS_SYNC_IDEMPOTENCY_MATCH
INVENTORY_CONFLICT_DETECTED
```

Connectivity events should preserve enough structured context to reconstruct the timeline. A typical record includes event identity, timestamp, Branch, device/Terminal identity, local transaction identity where relevant, connectivity state, sync state, and server transaction identity once established.

Example:

```text
Event: POS_OFFLINE_DETECTED
Branch: Bangjo Timur
Terminal: POS-BT-01
Detected at: 2026-09-17 09:41:23 WIB
Last successful connection: 2026-09-17 09:40:58 WIB
State: OFFLINE
```

Reconnect example:

```text
Event: POS_RECONNECTED
Branch: Bangjo Timur
Terminal: POS-BT-01
Disconnected at: 2026-09-17 09:41:23 WIB
Reconnected at: 2026-09-17 09:57:42 WIB
Offline duration: 16m 19s
```

Resync example:

```text
Event: POS_RESYNC_COMPLETED
Pending operations: 4
Synced: 4
Conflicts: 1
Status: MANAGER_REVIEW_REQUIRED
```

The human-readable UI may summarize this as a message such as `POS tidak terhubung pada ... dan kembali terhubung pada ...; sinkronisasi dilanjutkan ...`, but the structured system events remain the authoritative technical evidence.

## 12. Synchronization and idempotency

Offline operations must be synchronized idempotently. A timeout, reconnect, app restart, or uncertain network delivery must never create a duplicate Sale or duplicate business mutation.

Every offline-created transaction or actionable mutation receives a stable local identity. After Core accepts the operation, the server identity is associated with the local record.

If the same operation is submitted again with the same idempotency identity, Core must reuse/return the already-established result rather than create a second business record.

Pending operations are durable and retryable. A failed synchronization attempt must not cause a locally successful transaction to disappear. Until a final server result is known, the operation remains pending/retryable or moves to an explicit manager-review/error state defined by the sync contract.

Where business ordering matters, the synchronization process must preserve the relevant ordering metadata so Core can reconstruct the local operational sequence before applying business reconciliation.

## 13. Configuration divergence while offline

Because Core remains the management authority, the POS may temporarily operate from its last-known configuration while disconnected.

Example:

```text
Core threshold = 5
POS last known threshold = 3
POS offline
```

The POS may evaluate low-stock using its last valid threshold during the outage. Core may simultaneously have a newer threshold. This temporary divergence is expected under offline operation and is not automatically data corruption.

On reconnect, POS must retrieve/synchronize the current authoritative configuration/version from Core. The device must be able to identify that it was operating from a stale snapshot and must not silently continue indefinitely on obsolete rules once current state is available.

## 14. Core changes while POS is offline

If the Manager changes Branch Product availability, operational configuration, or another branch-managed state in Core while POS is offline, the device cannot know the change until synchronization.

The system must not retroactively delete or falsify a valid offline Sale simply because a later Core state differs. Instead, synchronization reconciles the later Core state with the offline operation and surfaces a business/system conflict when the two states cannot coexist without a decision.

## 15. Payment boundary

Offline support does not mean every payment method becomes available offline.

Cash is compatible with offline POS operation because the physical payment can be handled by the Branch.

An online/provider-verified payment must not be represented as provider-confirmed merely because a local device recorded a Sale while offline. The system must distinguish local operational transaction state from external payment confirmation.

This preserves the existing payment authority boundary.

## 16. Device crash/power-loss safety

If the device crashes after a Sale is committed locally but before synchronization, the Sale must remain in the durable local store and be recoverable after application restart.

The intended safety boundary is:

```text
Create Sale
    ↓
Atomically persist Sale + items + local operational effect + sync metadata
    ↓
Crash / reboot / app restart
    ↓
Recover pending operation
    ↓
Resume synchronization when possible
```

A printed receipt is evidence of a local operational action, not proof that Core has already ingested the transaction. The local Sale identity remains the correlation key for later reconciliation.

## 17. No automatic channel priority

There is intentionally no permanent rule saying:

```text
POS > PWA
PWA > POS
Dine-in > Online
Online > Dine-in
```

The inventory pool is shared, and exceptional cross-channel conflicts are resolved by the authorized human decision-maker when business policy cannot be safely inferred.

Future automation may be introduced only through a separate explicit business decision that states the policy, scope, precedence, and failure behavior.

## 18. Explicit non-goals

This contract does not introduce:

- channel-specific inventory pools;
- multiple simultaneous POS devices per Branch;
- a separate POS master catalog;
- permanent automatic channel priority;
- an Inventory authority inside the POS APK;
- silent automatic business conflict resolution where human judgment is required;
- a separate Web POS product;
- transfer of Branch management authority from Core to POS.

## 19. Canonical end-to-end model

```text
                         XENTRA-CORE
                  Management / Authority
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
      Catalog           Inventory       Order Management
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
                    Branch-scoped state
                           │
                           ▼
                     XENTRA POS APK
                     Operational Device
                           │
             ┌─────────────┼─────────────┐
             │             │             │
            Sale          Shift         Cash
             │             │             │
             └─────────────┼─────────────┘
                           │
                  Durable Local Store
                           │
                      Offline mode
                           │
                        Reconnect
                           │
                           ▼
                         Sync
                           │
                           ▼
                     XENTRA-CORE
                           │
             reconcile / validate / log
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
      Manager resolution          Reporting / audit
       when conflict
```

## 20. AI-worker implementation guardrails

Any AI worker implementing POS/offline/inventory behavior must treat the following as locked invariants:

1. One Branch has one POS device in the current Xentra model.
2. One Branch has one shared inventory pool; never invent channel-specific stock buckets.
3. POS products come from Branch-scoped Xentra catalog/Branch Product authority; POS is not a second catalog authority.
4. Local POS state is durable and survives restart/crash/reboot.
5. Offline transactions/actions have stable local identities and idempotent synchronization.
6. Core remains the management and central business authority.
7. Business conflicts requiring policy judgment are surfaced to the authorized Branch Manager.
8. Business logs and system logs are distinct and preserve enough evidence for reconstruction.
9. Historical Sale/Order records are never deleted or rewritten merely to hide an offline conflict.
10. Provider-confirmed online payment state is never fabricated while disconnected.
11. Low-stock threshold is configurable; example values are not hard-coded policy.
12. POS, PWA, WhatsApp, and integrated external channels operate against the same Branch stock quantity.
13. No second Web POS product is implied by this contract.
14. No new domain authority may be invented inside the APK to compensate for an unclear Core contract; report a contract gap instead.

## Related Xentra contracts

- `Branch Manager Operational Center — Business Contract v1`
- `01 — Architecture Decision Log`
- `02 — Domain Blueprint`
- `Xentra — Canonical Architecture & Product Library v2`

## Notion source of truth

Locked companion decision:
`POS Offline Operation, Branch Inventory & Multi-Channel Conflict Contract v1`

The Notion contract and this Git document must remain aligned. Future changes require an explicit new decision/revision rather than silent behavioral drift.
