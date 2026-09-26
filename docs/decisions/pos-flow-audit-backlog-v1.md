# 🔒 Xentra — POS Flow Audit Backlog v1

**Status:** LOCKED / BACKLOG — DO NOT IMPLEMENT YET  
**Decision date:** 2026-09-26  
**Repository:** `wanstudio/xentra-core`  
**Baseline commit:** `f595c04ae41321c9cc1525cd02a7834233b57a77`

## Purpose

Capture the remaining POS flow gaps discovered after locking the contract that a POS cashier Hold immediately materializes into the canonical Commerce Order with `status=pending` and `order_channel=pos_cashier`.

This document is a **problem backlog and discussion anchor**, not an implementation approval. Each item will be discussed and resolved individually before code changes are made.

## 🔒 Architecture prerequisite — Offline POS

**Status:** ✅ RESOLVED / LOCKED ARCHITECTURE BOUNDARY

Before P3/P4 implementation, Xentra has locked the architecture boundary in:

`docs/decisions/pos-offline-architecture-boundary-v1.md`

The boundary establishes that:

- device connectivity, Core reachability, POS presence/lease, local operational state, and server synchronization state are separate conditions;
- Core remains the central business authority;
- browser POS must not claim durable offline transaction safety from RAM or `navigator.onLine` alone;
- the backend offline reconciliation/idempotency engine may be reused, but true browser-local offline execution requires a durable local operational store;
- offline Dine-in table claims are provisional local claims and must not use generic last-write-wins reconciliation;
- offline physical Cash execution may have local operational acceptance, which is distinct from Core synchronization;
- new remote table-based dine-in claims require a server-visible POS presence/staleness mechanism before safe degradation can be enforced.

**Implementation gate:** P3 and P4 remain OPEN, but they must be implemented only after the prerequisite architecture and its dependent contracts are respected. The architecture decision itself does **not** activate IndexedDB or offline Dine-in behavior.

## Locked architectural premise

- `orders` is the canonical commercial order.
- `pos_held_orders` is only the cashier working reference.
- Dining/Core remains authoritative for table/session state and concurrency.
- POS must not create a second table/session state machine.
- Merchant operational acceptance remains a meaningful lifecycle boundary.
- Offline POS local authority is bounded and provisional; it does not replace Core as permanent business authority.
- No new implementation is authorized merely by this audit document.

## Open problems to discuss one by one

### P1 — Split / Merge after Hold materialization
**Status:** ✅ RESOLVED / IMPLEMENTED  
**Severity:** 🔴

Current split/merge logic is still primarily `pos_held_orders`-based.

Potential consequence: cashier working state can diverge from the canonical Commerce Order already visible in Merchant.

Resolution:
- Split/merge operates on a canonical Commerce Order after materialization.
- Split creates an open check under the same Order; it never creates another Order, table, or Dining Session.
- Merge combines open checks under the same Order.
- Dining/table context remains attached to the canonical Order.
- `pos_held_orders` remains only the cashier working reference.
- Payment allocation across multiple methods remains a separate Payment lifecycle concern; split/merge must not create duplicate Orders to simulate payment splitting.
- Implementation contract: `docs/decisions/pos-split-merge-canonical-check-v1.md`.

### P2 — Resume semantics
**Severity:** 🔴

Current `resume` changes the persisted Hold status to `resumed`, while the Hold list only shows `held`.

Potential consequence: a cashier can resume a bill and then lose it from the active Hold list after reload.

Questions to resolve:
- Is resume only a UI/work-session action?
- Should persisted business status remain `held`?
- If a canonical Order already exists, what exactly does Resume reopen/edit?
- What is the authoritative source when resuming?

### P3 — Offline Dine-in table claim
**Severity:** 🔴

Offline POS execution currently records a transaction through the backend offline engine, but the browser POS does not yet have a durable device-local table claim mechanism.

Potential consequence: a browser POS cannot safely preserve a table claim when Core is genuinely unreachable, and Core cannot currently know the POS's stale presence.

Architecture prerequisite is now resolved, but downstream implementation remains open.

Questions to resolve:
- What exact durable local claim record is created?
- What lease/revision metadata is needed?
- How is a provisional claim reconciled into Dining/Core?
- What happens if the same table was taken online while the POS was offline?
- How is the physical table conflict exposed to Manager without deleting the historical sale?

### P4 — Offline sale vs Merchant acceptance
**Severity:** 🔴

Offline POS sale currently behaves as an already-confirmed physical sale, unlike the online POS Hold flow where the canonical order enters Merchant as `pending`.

Architecture now explicitly permits the distinction:

Local Operational Acceptance ≠ Core Synchronization.

However, the browser POS currently cannot safely execute that local transaction path when Core is genuinely unreachable because the existing `/pos/local/sale` path is still server-backed. Durable browser-local persistence and local execution semantics therefore remain implementation work.

Questions to resolve:
- What local operational state is written before sync?
- Which offline actions are accepted immediately by the terminal?
- How is the local state mapped into canonical Order/Dining state during reconciliation?
- When is a Dining Session created or attached?
- How are payment and Shift effects reconciled without duplicate financial effects?
- How is conflict with an existing online Order handled?

### P5 — Merchant acceptance → Dining Session
**Status:** ✅ RESOLVED / IMPLEMENTED  
**Severity:** 🔴

Resolution:
- ACCEPT is the operational boundary for `pending → confirmed`.
- For dine-in, ACCEPT creates/attaches the Active Dining Session exactly once inside the acceptance transaction.
- Payment settlement remains separate from session creation.
- Acceptance is idempotent; repeated identical ACCEPT requests do not recreate the Dining Session.
- Existing Dining holds are converted/rebound to the canonical Order/session context.

### P6 — Table transfer vs canonical Order
**Severity:** 🟠

POS table transfer must keep Dining Session/table assignment and canonical Order table context consistent.

Questions to resolve:
- Does transfer update the canonical `orders.table_number`?
- What happens to linked POS Hold references?
- How are receipts and Merchant UI updated?
- What happens if the target table is concurrently claimed?

### P7 — Customer QR/PWA + POS same-table flow
**Severity:** 🟠

Need end-to-end verification when POS has claimed a table and a customer subsequently scans the same table QR.

Questions to resolve:
- Does the customer order attach to the existing Dining Session?
- Can a second Dining Session accidentally be created?
- Are additional customer items appended to the intended canonical bill/order model?
- How are POS and customer channels represented without creating duplicate table authority?
- How does the flow behave when POS presence is stale/offline?

### P8 — Payment method vs Merchant acceptance lifecycle
**Status:** ✅ RESOLVED / IMPLEMENTED  
**Severity:** 🟠

Resolution:
- Payment settlement is payment-only and never performs `pending → confirmed`.
- Merchant Acceptance remains the exclusive operational acceptance boundary for connected flows.
- Static QRIS/manual verification follows the same rule.
- Pending paid orders remain pending until Merchant acceptance.
- Cash, gateway, and static QRIS respect the same acceptance boundary; only payment mechanics differ.

### P9 — Cancellation after Merchant acceptance
**Severity:** 🟠

Hold cancellation is intentionally limited once the canonical order has progressed beyond `pending`.

Questions to resolve:
- What is the normal cancellation/void path after acceptance?
- How are Dining Session/table release, inventory restoration, and payment reversal coordinated?
- What roles can perform each operation?
- How are partially prepared/fulfilled orders handled?

### P10 — `pos_held_orders` shadow-state risk
**Severity:** 🟠

Several legacy POS methods still treat `pos_held_orders` as a source of truth even though `orders` is now canonical.

Known affected areas:
- splitBill
- mergeBill
- appendItemsToTableBill
- resume
- some table-bill flows

Required architectural question:

**Where exactly is the boundary between a cashier working reference and the canonical transaction after materialization?**

## Implementation rule

Do not fix these items as isolated patches that introduce a third state model.

For each problem:
1. Inspect current code and relevant Notion contracts.
2. State the intended business invariant.
3. Decide the canonical source of truth.
4. Define lifecycle transitions and idempotency.
5. Add regression tests.
6. Implement one problem.
7. Commit to Git.
8. Update this backlog item as resolved/changed.

## Current state

**Architecture prerequisite is RESOLVED / LOCKED. P1, P5, and P8 are RESOLVED / IMPLEMENTED. P2, P3, P4, P6, P7, P9, and P10 remain OPEN.**

P3/P4 implementation is explicitly gated by `docs/decisions/pos-offline-architecture-boundary-v1.md`.

No item is approved for implementation by this backlog alone.
