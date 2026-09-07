# Xentra Multi-Branch Cart → Checkout UX

**Status: LOCKED — UX / business-flow clarification**  
**Decision date:** 2026-09-07  
**Authority:** Current Notion `03 — Business Flow` and existing Commerce boundary.

## Core rule

Xentra allows the Customer Cart to contain items associated with multiple Branches, but **Checkout and Order remain single-Branch**.

```text
Cart (may contain multiple Branch groups)
        ↓
Single-Branch Checkout
        ↓
Single-Branch Order
```

Items from different Branches must never be silently combined into one Checkout or Order.

## Bottom checkout CTA

The bottom CTA is a fast path to completing an order. Its behavior depends on how many Branch groups currently exist in the Cart.

### One Branch

When the Cart contains items from only one Branch:

```text
┌──────────────────────────────┐
│  3 Item              52.000  │
│  Lihat pesanan kamu          │
└──────────────────────────────┘  🛍️³
```

Tapping the checkout area goes directly to `#checkout` for that Branch.

There is no intermediate Branch-selection sheet.

### Two or more Branches

When the Cart contains items from multiple Branches, the CTA must not imply that the aggregate total is one transaction.

Example:

```text
Branch A
2 item — Rp32.000

Branch B
1 item — Rp20.000
```

Recommended CTA presentation:

```text
┌──────────────────────────────┐
│  2 Pesanan                   │
│  dari 2 cabang        Rp52.000│
└──────────────────────────────┘  🛍️³
```

The aggregate total may remain visible as information, but the primary semantic label is the number of Branch orders/groups.

Tapping the CTA opens a **Bottom Sheet / Branch Order Switcher** rather than directly opening Checkout.

## Bottom Sheet behavior

The Bottom Sheet keeps the Customer on the current Home context and lists the Branch groups in the Cart.

Example:

```text
┌───────────────────────────────┐
│  ─────────                    │
│                               │
│  Pesanan kamu                 │
│                               │
│  ┌─────────────────────────┐  │
│  │ Cabang A                │  │
│  │ 2 item · Rp32.000       │  │
│  │              Checkout → │  │
│  └─────────────────────────┘  │
│                               │
│  ┌─────────────────────────┐  │
│  │ Cabang B                │  │
│  │ 1 item · Rp20.000       │  │
│  │              Checkout → │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

For 3+ Branches, the list becomes vertically scrollable. There is no fixed Branch slot count.

Selecting `Checkout` for a Branch opens `#checkout` for that Branch only.

## What must NOT happen

- Do not merge Branch A + Branch B into one Checkout.
- Do not create one Order with multiple `fulfillment_branch_id` values.
- Do not silently choose the last-viewed Branch.
- Do not silently choose the last-added Branch.
- Do not silently move items to another Branch to make Checkout possible.
- Do not force the Customer into the full Cart page merely to resolve a multi-Branch checkout choice.

## Cart vs Bottom CTA

### Cart icon

The Cart icon is the management/review surface.

It may show:

```text
Cart

CABANG A
────────────
Ayam Bakar × 1
Es Teh × 1

CABANG B
────────────
Nasi Goreng × 1
```

Its purpose is to let the Customer review and manage all cart contents.

### Bottom CTA

The bottom CTA is the fast checkout path:

```text
1 Branch
→ direct #checkout

2+ Branches
→ Bottom Sheet
→ choose Branch order
→ single-Branch #checkout
```

## UX principle

Expose the Branch split only when necessary.

The common case should remain one-tap:

```text
One Branch → Checkout
```

The exceptional multi-Branch case should be explicit and safe:

```text
Multiple Branches → Choose which order to checkout
```

This preserves the Xentra principle that Customers should not need to understand fulfillment algorithms, while preventing the UI from pretending that separate Branch fulfillment can become one transaction.

## Invariants

1. Cart may be multi-Branch.
2. Checkout is always single-Branch.
3. Order is always single-fulfillment-Branch.
4. Multi-Branch Cart is never silently merged into one Checkout/Order.
5. Customer-selected Branch is never silently changed by the CTA.
6. One-Branch Cart keeps the direct checkout path.
7. Multi-Branch Cart uses a Bottom Sheet / Branch Order Switcher.
8. The interaction must scale to any number of Branch groups.

## Scope

This document defines the Customer-facing UX behavior for the bottom checkout CTA. It does not change the existing Commerce lifecycle, BranchMatcher, eligibility, payment, acceptance, recovery, or Order state machine.
