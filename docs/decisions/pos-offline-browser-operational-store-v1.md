# POS Durable Browser Operational Store & Recovery Contract v1

**Status:** LOCKED / IMPLEMENTED FOUNDATION  
**Decision date:** 26 September 2026  
**Repository:** wanstudio/xentra-core

## Purpose

Mengaktifkan durable browser-local storage sebagai prerequisite implementation dari **Offline POS Architecture Boundary v1**.

Scope dokumen ini sengaja lebih sempit daripada P3/P4:
- durable local POS operational record;
- stable local operation identity;
- recovery setelah reload/crash;
- pemisahan operational state dan synchronization state;
- branch + terminal scoping;
- persistence untuk last-known snapshot boundary;
- regression tests untuk duplicate/reload-safe recovery.

Dokumen ini **belum** mengaktifkan offline table claim atau local Merchant Acceptance.

## 1. Storage boundary

Production browser menggunakan native IndexedDB melalui:

`apps/pos-app/assets/js/PosOfflineStore.js`

Database:
- name: `xentra_pos_operational_v1`
- version: `1`

Object stores:
- `operations` — durable local POS operations;
- `effects` — local operational-effect evidence/intents linked to an operation;
- `snapshots` — branch/terminal-scoped last-known configuration snapshots;
- `meta` — store schema marker.

IndexedDB adalah **operational working store**, bukan pengganti Core.

## 2. Operation identity

Untuk offline sales:
- `operation_id` = `client_transaction_id`;
- identity harus stabil sampai reconciliation selesai;
- retry/reload tidak boleh membuat identity baru;
- server tetap menjadi final authority dan melakukan deduplication berdasarkan branch-scoped transaction identity.

Ini menjaga satu local operation tetap dapat dikorelasikan dengan satu canonical server transaction.

## 3. State separation

Local operation fields dipisahkan menjadi:

**Operational state**
- `LOCAL_RECORDED`

**Synchronization state**
- `LOCAL_ONLY`
- `PENDING_SYNC`
- `SYNCING`
- `SYNCED`
- `CONFLICT`
- `FAILED`
- `MANAGER_REVIEW`

Store tidak mengubah Order lifecycle dan tidak menciptakan Dining state machine kedua.

## 4. Crash/reload recovery

Local write boundary:

`Create operation + declared effects → IndexedDB transaction COMMIT`

Setelah commit, reload/crash tetap dapat menemukan operation.

Jika process mati ketika operation berada pada `SYNCING`, recovery mengubahnya kembali menjadi `PENDING_SYNC` dengan:
`recovery_reason = PROCESS_RESTART_DURING_SYNC`.

Retry aman karena `operation_id` / `client_transaction_id` tidak berubah.

## 5. Branch and terminal scope

Every operational record is scoped by:
- `branch_id`;
- `terminal_id`;
- `shift_id` for sale operations;
- optional `cashier_id`.

A POS terminal must never load or reconcile another branch's local operations.

## 6. Last-known snapshot boundary

Store menyediakan snapshot API yang dapat dipakai untuk menyimpan:
- last-known branch configuration;
- catalog/configuration revision;
- future local table/layout revision.

Snapshot data is read/cached state. It is not an authority override.

Offline table claims are explicitly out of scope for this implementation.

## 7. Offline sale integration boundary

When the POS is truly disconnected from Core:
- payment remains cash-only;
- browser now creates a durable local operation instead of claiming that a server-backed `/pos/local/sale` write is local;
- local operation is left `PENDING_SYNC`;
- reconnect/sync bridge can replay the exact same payload with the exact same operation identity.

When Core is available again, the existing server-side offline reconciliation/idempotency path remains the authority.

This implementation does **not** silently convert the local record into a normal online Merchant Acceptance event.

## 8. Failure behavior

If IndexedDB is unsupported or unavailable, POS must not claim successful durable offline persistence.

Network/business failures during later synchronization are classified separately:
- transient connectivity → keep/requeue `PENDING_SYNC`;
- server conflict → `CONFLICT`;
- terminal/business validation failure → `FAILED`;
- manager decision required → `MANAGER_REVIEW`.

No local operation is deleted merely to hide a conflict.

## 9. Explicit non-goals

This change does not implement:
- P3 Offline Dine-in Table Claim;
- POS presence/lease;
- P4 Local Operational Acceptance semantics;
- automatic customer-channel degradation;
- offline provider/gateway confirmation;
- a second permanent inventory/order authority;
- last-write-wins table reconciliation;
- multi-terminal branch semantics.

## 10. Verification

Dedicated regression:
`tests/posOfflineBrowserPersistence.test.js`

Verified behaviors:
- store script loads before POS runtime;
- offline sale path uses durable local store;
- operation identity remains stable;
- interrupted `SYNCING` is recovered to `PENDING_SYNC`;
- pending operation remains available after recovery;
- branch + terminal scoped stats are preserved.

**Next gate:** POS presence/lease contract, then Offline Dine-in Table Claim, then P4 Offline Sale vs Merchant Acceptance.
