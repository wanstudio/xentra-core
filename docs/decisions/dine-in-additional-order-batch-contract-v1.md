# Xentra — Dine-in Additional Order Batch Contract v1

**Status: LOCKED — BUSINESS / UX / ARCHITECTURE CONTRACT v1**  
**Date:** 2026-09-26  
**Scope:** Dine-in additions, POS/customer add-on flow, billing, fulfillment, kitchen ticketing

## 1. Purpose

This contract defines how a customer can add food or drinks after the original Dine-in Order has already been accepted or is already being prepared.

The core problem is:

- the original Order must remain immutable after operational acceptance;
- a Dine-in customer may legitimately order more items later;
- the additional items still belong to the same Dining Session and the same canonical Commerce Order;
- the new items may require their own acceptance/printing event before they become part of the payable bill.

## 2. Canonical Model

The canonical Dine-in relationship remains:

`1 Table → 1 Dining Session → 1 Commerce Order`

An **Additional Order Batch** is a logical child/batch inside that canonical Commerce Order.

It is NOT:

- a second Commerce Order;
- a second Dining Session;
- a second table;
- a second inventory pool;
- a second payment ledger.

Conceptual model:

```text
Dining Session
└── Commerce Order #123
    ├── Initial Batch
    │   ├── Nasi Goreng x2
    │   └── Es Teh x2
    │
    ├── Additional Batch #1
    │   ├── Kopi x2
    │   └── Kentang x1
    │
    └── Additional Batch #2
        └── Air Mineral x2
```

The batching concept is for operational history, fulfillment submission, and kitchen delta-ticketing. The commercial transaction remains one Order.

## 3. UX Rule

The Additional Order capability is **optional and dormant by default**.

The normal active Dine-in Order UI shows:

- existing order items;
- current bill/payment actions;
- a clear `+ Tambah Pesanan` action.

There is no empty Additional Order form that is permanently open.

When the customer asks for more items:

```text
Active Order
    ↓
+ Tambah Pesanan
    ↓
Additional Batch Draft
    ↓
Review
    ↓
Kirim Pesanan
```

Only one active Additional Batch Draft is needed per cashier session.

## 4. Original Order Immutability

Once the original Order has passed Merchant operational acceptance:

- existing accepted item quantities cannot be edited through the normal POS composer;
- existing accepted items remain visible for reference;
- existing item steppers are visually locked;
- attempting to edit a locked item shows an explanatory warning;
- `Bayar` and payment-allocation actions remain available.

An Additional Batch is the supported path for new consumption.

The system must not silently turn an attempted edit of the old Order into an Additional Batch.

## 5. Additional Batch Lifecycle

The Additional Batch does not create a competing global Order lifecycle.

Its minimal operational lifecycle is:

```text
DRAFT
  ↓
PENDING_ACCEPTANCE
  ↓
ACCEPTED
  ↓
FULFILLMENT_FOLLOWS_PARENT
```

Rejection is a side path:

```text
PENDING_ACCEPTANCE → REJECTED
```

The batch status is an operational sub-resource/event context, not a replacement for the canonical Commerce Order status machine.

After acceptance, the additional items participate in the existing Dine-in fulfillment experience of the parent Dining Session.

Do not create a second universal Order state machine.

## 6. Who Creates It

Supported entry points:

1. **POS**
   - cashier opens the active Dine-in Order;
   - cashier chooses `+ Tambah Pesanan`;
   - cashier builds the addition;
   - cashier submits it.

2. **Customer**
   - customer is already associated with the active Dining Session/table context;
   - customer submits additional items through the customer surface;
   - the addition enters the same canonical Order context.

Both entry points must converge on the same Core/Dining/Commerce authority.

## 7. Acceptance Boundary

Additional items are not automatically accepted merely because they were drafted or submitted.

At submission:

- server revalidates product availability;
- server revalidates authoritative price;
- branch and Dining Session context are validated;
- the addition is recorded as pending acceptance.

At Merchant acceptance:

- the Additional Batch becomes operationally accepted;
- sellable product stock is reduced at the same acceptance boundary used by the current Commerce contract;
- the batch becomes billable;
- the accepted items become part of the same canonical Order total.

If acceptance fails, the addition does not consume stock and does not become payable.

## 8. Kitchen / Production Ticket

Kitchen execution uses the delta of the Additional Batch.

For example:

```text
Original ticket
Meja 12
Nasi Goreng x2
Es Teh x2

Later:

Additional ticket
Meja 12
Kopi x2
Kentang x1
```

The system should not reprint the full original order merely because an addition was submitted.

This is compatible with the MVP kitchen model of kitchen ticket printing plus Branch Manager/direct coordination; no KDS is introduced by this contract.

## 9. Billing and Payment

Additional Batch and Payment remain separate concerns.

When an Additional Batch is accepted:

- its amount increases the outstanding amount of the same Commerce Order;
- no duplicate Payment Ledger is created;
- no duplicate Commerce Order is created.

Payment cases:

### A. Parent Order is still unpaid

The additional amount increases the bill that remains outstanding.

### B. Parent Order is partially paid

The additional amount becomes new outstanding balance without rewriting already-paid allocations.

### C. Parent Order is fully paid but Dining Session is still active

The system must allow a new outstanding payable amount under the same Commerce Order.

The preferred billing representation is a new open Check/allocation for the newly accepted Additional Batch rather than modifying a Check that is already fully paid.

This keeps previous Payments immutable and preserves the existing Split Bill / Check allocation contract.

## 10. Split Bill Interaction

Additional Batch must not create a new Commerce Order merely to support split payment.

If the parent Order has active Checks:

- the Additional Batch remains under the same Order;
- already-paid Check allocations must not be rewritten;
- newly accepted amount becomes additional outstanding bill value;
- the POS payment-allocation layer decides how the new amount is allocated.

The exact allocation UI may reuse the existing Check allocation mechanisms.

## 11. Inventory

Additional Batch follows the existing single-branch inventory authority.

Draft:

- no stock mutation.

Pending acceptance:

- no stock mutation.

Merchant acceptance:

- stock consumption occurs according to the authoritative acceptance boundary.

There is no:

- dine-in stock;
- POS stock;
- additional-order stock;
- per-batch inventory pool.

All accepted items use the same Branch sellable-product stock pool.

## 12. Completion

Adding items does not reopen or reset the parent Dine-in lifecycle.

The Dining Session remains active.

The parent Order does not go backwards from:

`preparing → pending`

merely because an Additional Batch exists.

The Additional Batch is appended to the existing dining context.

Dining Session completion remains a separate explicit operation.

## 13. Cancellation / Correction

Before acceptance:

- an Additional Batch may be rejected/cancelled according to the environment exception rules;
- no stock is consumed;
- no payable amount is added.

After acceptance:

- the batch is no longer treated as an editable draft;
- normal edit controls do not rewrite accepted items;
- correction, void, refund, or staff-authorized exception behavior must use their own explicit contract when implemented.

This contract does not invent a generic post-accept edit/void workflow.

## 14. Data Boundary

The implementation may represent the concept with a dedicated child record such as:

```text
order_additions
```

or an equivalent batch reference on canonical `order_items`.

The implementation choice must preserve:

- one canonical `orders` row;
- auditable item provenance;
- batch ordering/timestamp;
- creator/actor context;
- acceptance/rejection history;
- compatibility with Check allocation;
- compatibility with kitchen delta-ticket printing.

Do not introduce a second `orders` row just to represent an addition.

## 15. Legacy Source Constraint

The current POS implementation still contains legacy logic such as `appendItemsToTableBill()` that appends items into `pos_held_orders.items_payload`.

That path is not authoritative for this contract.

The target implementation must use the canonical Commerce Order boundary and must not make `pos_held_orders` a second source of truth.

Similarly, opening the existing `Masing-masing` payment flow must never mutate the original Hold Bill merely to prepare payment allocation.

## 16. UI Mental Model

The intended cashier mental model is:

```text
ORDER LAMA
locked after acceptance
        │
        ├── Bayar
        ├── Masing-masing
        │
        └── + Tambah Pesanan
                ↓
          ADDITION BATCH
                ↓
          Merchant Accept
                ↓
          Kitchen ticket
                ↓
          Same bill / same session
```

In plain language:

**Pesanan lama dikunci → pembayaran tetap bebas → tambahan makanan masuk lewat `+ Tambah Pesanan`.**

## 17. Non-Goals

This contract does not introduce:

- a second Commerce Order for the same Dine-in Session;
- a second Dining Session;
- a new POS state machine;
- a separate inventory pool;
- a separate payment ledger;
- automatic table reassignment;
- KDS;
- a generic post-accept edit/void workflow.

## 18. Related Contracts

- Dining / Table / Reservation Domain Contract v1
- POS Dine-in Transaction Composer & Table Context v1
- POS Opened Order Payment Entry v1
- POS Split Bill / Payment Allocation Contract v1
- POS Payment Group / Multi-Table Settlement v1
- Purchase Type / Fulfillment Environment Contract v1
- Inventory Model — Sellable Product Stock vs Raw Material Inventory v1
- Final Checkout Verification & Single Fulfillment Boundary v1

## 19. Implementation Rule

Implementation MUST preserve:

**One Table → One Dining Session → One Commerce Order**

and add:

**Optional Additional Batch → same Commerce Order → explicit acceptance → same bill → delta kitchen ticket**

The Additional Batch is a child operational/billing unit, not a replacement Commerce Order.

**STATUS: LOCKED — IMPLEMENTATION AUTHORIZED.**

Any change that makes an Additional Batch a separate Commerce Order, creates a second Dining Session, changes the acceptance boundary, or introduces a competing global state machine requires a new explicit architecture/business decision.
