# Xentra — POS Payment Group / Multi-Table Settlement v1

Status: **LOCKED / ACTIVE**

## Problem

A single customer group can occupy multiple tables at the same time. Xentra keeps the invariant that each table/order remains an independent transaction, but the group may request one combined settlement at the end of the visit.

Example:

- Meja 1 → Order #101 → Rp100.000
- Meja 2 → Order #102 → Rp150.000
- Meja 3 → Order #103 → Rp200.000
- One physical Cash payment → Rp450.000

## Contract

1. **One table = one Commerce Order** remains authoritative.
2. Combining bills does **not** merge, clone, move, or replace the member Orders.
3. Combining bills does **not** merge Dining Sessions or table records.
4. A **Payment Group** is a settlement grouping layer over two or more existing dine-in Orders.
5. Payment Group membership is explicit: the cashier selects the other bills that belong to the same customer group.
6. All member Orders must belong to the same Brand and Branch, be dine-in, be accepted/not pending, be unpaid, be Cash-compatible, and not already belong to another open Payment Group.
7. MVP grouped settlement operates on **whole unpaid Orders only**. Orders that have already been split into multiple Checks are not eligible until their split is resolved.
8. One physical Cash payment increments the active cashier shift **once for the combined total**, while each member Order receives its own order-level settlement record for auditability.
9. Each member Order's POS Check ledger is also marked paid so the POS Check view stays consistent with the canonical payment ledger.
10. Each member Dining Session remains individually attributable to its original table/order.
11. Grouped settlement is atomic: failure of any member settlement rolls back the entire grouped payment and shift cash increment.
12. Change is calculated once at the Payment Group level from the physical tendered amount minus the combined total.

## POS UX

From an eligible whole-order **Bayar** flow:

**Gabungkan Tagihan**

→ choose bills from other tables

→ review combined total

→ enter Cash received

→ settle as one payment.

The selection UI identifies each bill by **Meja + Order number + amount** so the cashier can verify the intended group.

## Non-goals

- No cross-branch grouping.
- No merging of Commerce Orders.
- No automatic inference that nearby/adjacent tables belong to one group.
- No grouped settlement of partially paid/split-check Orders in this MVP.
- No new Dining state machine.

## Persistence

- `pos_payment_groups` = grouped settlement identity and final status.
- `pos_payment_group_orders` = explicit Order membership and allocated full-order amounts.
- `pos_payment_group_payments` = one physical grouped payment record.
- Existing `orders`, `order_payments`, `pos_order_checks`, and `pos_check_payments` remain authoritative for their respective transaction/payment/check ledgers.
