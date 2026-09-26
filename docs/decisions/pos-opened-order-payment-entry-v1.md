# Xentra — POS Opened Order Payment Entry v1

Status: **LOCKED / ACTIVE**

## UX contract

For a POS Order opened back into the cashier after Hold Bill:

- **Bayar Rp...** is the primary direct-payment CTA.
- **Masing-masing** is a separate secondary CTA that opens the payment-allocation overlay.
- Split-bill actions are not shown inside the **Ditahan / Hold Bill** list.
- The Hold Bill list is for **Buka di Kasir** and cancellation; payment choices belong to the reopened order context.

## Masing-masing overlay

The reopened order opens one payment decision overlay containing:

1. **Bayar Berdasarkan Menu** — if the customer wants to pay only the menu they ordered.
2. **Bagi Rata** — if the bill should be divided evenly among customers.
3. **Atur Nominal** — if customers pay specified amounts sequentially until the whole transaction is paid.
4. **Gabungkan Tagihan** — when one group is using multiple tables and eligible whole unpaid orders need one Cash settlement.

## Rationale

The cashier is already working on the active transaction after reopening a Hold Bill. Payment options therefore live on the active order instead of being hidden behind a separate Split action in the Held list.

## Data invariants

- One table remains one Commerce Order.
- Split bill remains Check allocation inside one Order.
- Multi-table grouping remains Payment Group settlement across multiple Orders.
- No payment entry point creates a duplicate Commerce Order or Dining Session.
