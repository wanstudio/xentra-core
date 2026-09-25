# Xentra — POS Canonical Order Split / Merge Check v1

**Status:** IMPLEMENTED / ACTIVE  
**Decision date:** 2026-09-26  
**Scope:** POS cashier billing checks after Hold materialization

## Decision

Xentra POS Split/Merge operates on the **canonical Commerce Order**, not on `pos_held_orders`.

- `orders` remains the single canonical commercial transaction.
- `pos_held_orders` remains only the cashier working reference.
- Split creates an additional **open check** under the same canonical Order.
- Split never creates a second Commerce Order.
- Split never creates a second Dining Session.
- Split never creates a second physical table or synthetic table number such as `05-B`.
- Merge combines two open checks belonging to the same canonical Order.
- The canonical Order ID and Dining/table context remain unchanged.

## Persistence model

```text
Order #X123
├── Check #1
│   ├── Order Item A × 1
│   └── Order Item B × 1
└── Check #2
    └── Order Item C × 1
```

The check layer is a POS billing projection over `orders` + `order_items`.

Persistence:
- `pos_order_checks`
- `pos_order_check_items`

Order items are never duplicated; check rows reference the existing `order_items.id` and store the quantity allocated to each check.

## Invariants

1. Every check belongs to exactly one canonical Order.
2. A split source check must remain non-empty.
3. Only OPEN checks can be split or merged.
4. The total quantity allocated across checks for an order item must not exceed the canonical `order_items.quantity`.
5. Split/merge does not mutate `orders.id`, `orders.table_number`, or Dining Session identity.
6. Check operations use transactional persistence mutation.
7. New order items added after a split are assigned to the primary open Check #1.

## POS UI

The Hold Bill list now exposes **Split** for a Hold that already has a canonical `order_id`.

The Split/Merge manager:
- shows all open checks and their items;
- lets the cashier choose item quantities to move into a new check;
- lets the cashier merge an open secondary check back into Check #1;
- explicitly communicates that this remains **1 Order** and does not change the table/session.

## Payment boundary

This implementation establishes the canonical check model and split/merge UI boundary. Payment allocation across multiple payment methods remains governed by the separate Payment lifecycle and must not be implemented by creating duplicate Orders.

## Reference basis

Square documents split checks by item/seat while keeping the restaurant transaction within the check workflow. Toast documents split checks, partial/multiple payments, and combining open checks. These references support the separation of **Order / Check / Payment** concepts; Xentra-specific persistence and lifecycle rules remain defined by this contract.

## Regression coverage

The POS domain test verifies:
- Hold materializes to one canonical Order;
- splitting creates two checks under that same Order;
- no second Order is created;
- the same Dining table hold remains attached to the canonical Order;
- merging returns the Order to one check.

## Related

- `docs/decisions/pos-flow-audit-backlog-v1.md`
- `docs/decisions/pos-cashier-pending-dine-in-table-reservation-v1.md`
