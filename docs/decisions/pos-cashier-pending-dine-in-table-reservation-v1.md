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
5. This reservation is independent from the Order acceptance/payment state.
6. When the held order is cancelled, the table hold is released and the table becomes `AVAILABLE`.
7. When the held order becomes a real Order, the temporary hold reference is rebound to the real Order ID so the existing acceptance/payment/session lifecycle can consume or release the same hold.
8. When the Order is accepted/settled and a Dining Session is created, the table transitions from `held` to `occupied`.

## State relationship

```text
Cashier selects Table 05
        |
        v
TABLE = held (UI: DIPESAN)
        |
        | Order still pending
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

This does not introduce a second Dining state machine, a new reservation persistence model, or a new payment flow.

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
