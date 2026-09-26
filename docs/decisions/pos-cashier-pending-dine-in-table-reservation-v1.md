# Xentra — Cashier Pending Dine-In Table Reservation Contract v1

**Status:** LOCKED / IMPLEMENTED  
**Date:** 2026-09-25  
**Repository:** `wanstudio/xentra-core`

## Problem

A cashier can select a physical table for a customer before the resulting order has completed the downstream operational/payment lifecycle. If the table remains `AVAILABLE` until order acceptance, another cashier can accidentally assign the same table to another customer.

## Locked rule

For a cashier-created POS Dine-in order:

1. Selecting a table and holding the order immediately creates a server-side table hold.
2. The table must immediately stop being `AVAILABLE`.
3. The current operational state is `held`; the POS/Manager UI presents this state as **DIPESAN**.
4. Another cashier/POS terminal cannot select the held table.
5. The POS Hold Bill is immediately materialized into the canonical Commerce `Order` with `status = pending` and `order_channel = pos_cashier`.
6. Merchant App therefore sees the same Hold Bill in the Branch Manager order queue and can accept/reject it through the normal operational lifecycle.
7. The cashier-side `pos_held_orders` row stores the canonical `order_id`; it is a working reference, not a second customer order.
8. When the held order is cancelled/rejected, the canonical order is cancelled/rejected and the table hold is released.
9. When the canonical Order is accepted, the Dining Session is created and the table transitions from `held` to `occupied`.
10. When the cashier resumes an accepted Hold Bill, POS settles the existing canonical Order; it must never create a duplicate Order.

## State relationship

```text
Cashier selects Table 05
        |
        v
TABLE = held (UI: DIPESAN)
        |
        | canonical Order = pending
        | visible in Merchant → Pesanan Baru
        |
        +---- another cashier -> REJECTED
        |
        +---- cancel -> AVAILABLE
        |
        +---- Order created -> hold reference = Order ID
                                  |
                                  +-- accepted/settled
                                  |      |
                                  |      v
                                  |   OCCUPIED
                                  |
                                  +-- rejected/cancelled
                                         |
                                         v
                                     AVAILABLE
```

## Important boundary

Table state is not derived from the frontend and is not inferred from Order status. The Dining domain remains authoritative for table availability/concurrency. POS consumes Dining authority.

This does not introduce a second Dining state machine or a second customer/order record. `pos_held_orders` is only the cashier working reference; the canonical `orders` row is the Merchant operational order.

## Compatibility

The existing `branch_table_holds` mechanism is reused for the temporary cashier claim. The existing hold expiry safety remains active. The existing acceptance/payment release paths can consume the same hold after its reference is rebound to the actual Order ID.

## UI terminology

Internal state:

`held`

User-facing operational meaning:

**DIPESAN**

This is intentionally different from:

- `occupied` = **TERISI** — customer is in an active Dining Session.
- `reserved` = **RESERVASI** — scheduled reservation concept.


## 2026-09-26 — Hold Resume/Edit/Re-Hold Contract

- **Buka di Kasir bukan lifecycle transition.** Membuka Hold Bill hanya memasukkan bill yang sama ke editing state POS.
- `pos_held_orders.status` tetap **held** selama bill masih aktif; legacy `resumed` dinormalisasi kembali ke `held`.
- Setelah bill dibuka, kasir boleh menambah/mengubah item lalu menekan **Hold lagi**.
- **Hold lagi wajib update row Hold yang sama**, bukan membuat Hold Bill baru.
- Canonical Commerce `orders` yang terkait juga di-update in-place selama status masih `pending` dan belum ada pembayaran.
- Dining table hold tidak dibuat ulang; tetap satu active hold yang direferensikan oleh canonical `order.id`.
- Jika Merchant sudah menerima/memproses order, atau pembayaran sudah dimulai, bill tidak boleh diedit ulang dari Hold.
