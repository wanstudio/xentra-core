# 🔒 Xentra — POS Flow Audit Backlog v1

**Status:** LOCKED / BACKLOG — DO NOT IMPLEMENT YET  
**Decision date:** 2026-09-26  
**Repository:** `wanstudio/xentra-core`  
**Baseline commit:** `f595c04ae41321c9cc1525cd02a7834233b57a77`

## Purpose

Capture the remaining POS flow gaps discovered after locking the contract that a POS cashier Hold immediately materializes into the canonical Commerce Order with `status=pending` and `order_channel=pos_cashier`.

This document is a **problem backlog and discussion anchor**, not an implementation approval. Each item will be discussed and resolved individually before code changes are made.

## Locked architectural premise

- `orders` is the canonical commercial order.
- `pos_held_orders` is only the cashier working reference.
- Dining/Core remains authoritative for table/session state and concurrency.
- POS must not create a second table/session state machine.
- Merchant operational acceptance remains a meaningful lifecycle boundary.
- No new implementation is authorized merely by this audit document.

## Open problems to discuss one by one

### P1 — Split / Merge after Hold materialization
**Severity:** 🔴

Current split/merge logic is still primarily `pos_held_orders`-based.

Potential consequence: cashier working state can diverge from the canonical Commerce Order already visible in Merchant.

Questions to resolve:
- Should split/merge operate on the canonical Order after materialization?
- What happens to Dining table/session context during split/merge?
- How are payment references and inventory effects kept consistent?
- Should split/merge be temporarily restricted until canonical-order support is complete?

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

Offline POS sales currently record the transaction locally but do not claim/hold the Dining table centrally.

Potential consequence: offline cashier can sell for a table that Core/Dining still considers available.

Questions to resolve:
- What local table-lock semantics are required offline?
- How is the table claim reconciled when reconnecting?
- What happens if the same table was taken online while the POS was offline?
- Which side wins, and under what explicit conflict rule?

### P4 — Offline sale vs Merchant acceptance
**Severity:** 🔴

Offline POS sale currently behaves as an already-confirmed physical sale, unlike the online POS Hold flow where the canonical order enters Merchant as `pending`.

Questions to resolve:
- Is bypassing Merchant acceptance intentional for offline physical cash sales?
- If yes, what exact reconciliation contract applies?
- When syncing a dine-in offline sale, how is the Dining Session created/attached and the table moved to OCCUPIED?
- How is conflict with an existing online order handled?

### P5 — Merchant acceptance → Dining Session
**Severity:** 🔴

Need verify that Merchant acceptance creates/attaches the Dining Session exactly once for POS dine-in, consistent with the locked Dining contract.

Questions to resolve:
- Does ACCEPT immediately create Active Dining Session?
- Is payment settlement separate from session creation?
- How are retries/idempotency handled?
- Must the Dining hold be converted/rebound at acceptance?

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

### P8 — Payment method vs Merchant acceptance lifecycle
**Severity:** 🟠

Cash, static QRIS, and gateway payments may currently trigger different order/Dining transitions.

Questions to resolve:
- Is the canonical lifecycle always ACCEPT → payment/settlement → completion?
- Can successful payment transition a POS pending order to confirmed before Merchant acceptance?
- Which transitions are allowed for each payment method?
- Must all payment methods converge on the same Dining lifecycle?

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

**All P1–P10 remain OPEN.**

No item is approved for implementation by this document alone.
