# Xentra — POS Opened Order Payment Entry v1

Status: **LOCKED / ACTIVE**

## UX contract

For a POS Order that has been opened back into the cashier after a Hold Bill:

- **Bayar Rp...** is the primary direct-payment CTA and uses the existing normal settlement flow.
- **Masing-masing** is a separate secondary CTA that opens the payment-allocation overlay.
- Split-bill controls are not presented as actions inside the **Ditahan / Hold Bill** list.
- The Hold Bill list is responsible for **Buka di Kasir** and cancellation; payment decisions belong to the reopened order context.

## Masing-masing overlay

The reopened order opens a dedicated overlay containing:

1. **Bayar Berdasarkan Menu** — if the customer wants to pay only the menu they ordered.
2. **Bagi Rata** — if the bill should be divided evenly among customers.
3. **Atur Nominal** — if customers pay specified amounts sequentially until the whole transaction is paid.

For multi-table groups, **Gabungkan Tagihan** is available from this payment decision layer when the order is still a whole unpaid order.

## Rationale

A cashier opening a Hold Bill is already working on the transaction. Payment options should therefore be visible on that active order rather than hidden behind a separate Split action in the Held list.

The Held list is navigation/state management. The reopened order is the payment context.

## Relationship to canonical data

- One table remains one Commerce Order.
- Split bill remains Check allocation inside one Order.
- Multi-table grouping remains Payment Group settlement across multiple existing Orders.
- No payment UI action creates duplicate Commerce Orders or Dining Sessions.
