# Xentra Cart & Checkout Contract

**Status:** LOCKED BUSINESS/UX CONTRACT
**Decision Date:** 2026-09-04
**Authority:** Current Notion locked decisions

## Core Boundary

> **Multi-branch Cart is allowed; multi-branch Checkout/Order is not.**

Cart and Checkout are intentionally different scopes.

### Cart

Cart is a **shopping container**. It may retain items associated with multiple Branches/brands while the Customer browses and decides what to purchase.

Cart is not an authoritative fulfillment commitment and is not itself an Order.

### Checkout

Checkout is a **transaction scope for one Branch only**.

When Customer starts Checkout for Branch A, only items belonging to that Checkout scope/Branch are included. Items belonging to Branch B remain available in Cart and are not mixed into Checkout A.

Customer completes Branch A and Branch B as separate Checkout/Order processes.

### Order

Every Order has exactly one `fulfillment_branch_id`.

Xentra Core v1 does not support multi-Branch fulfillment inside one Checkout or Order.

## Canonical Flow

```text
Home
  ↓
Fast Branch Discovery
  ↓
Customer selects Branch
  ↓
Branch Catalog
  ↓
Add items to Cart
  ↓
Cart may contain multiple Branch scopes
  ↓
Customer starts Checkout for one Branch
  ↓
Checkout contains that Branch's items only
  ↓
Fresh authoritative verification
  ↓
Payment
  ↓
Branch Acceptance
  ↓
Fulfillment
  ↓
Order completed/cancelled
```

## Home Boundary

Home is optimized for first-load speed and discovery. It may use cheap GPS/destination proximity ordering, such as straight-line distance or a faster equivalent.

Home does not need ETA, road routing, delivery cost, driver availability, full-cart eligibility, stock verification, pricing verification, or Branch Acceptance before initial render.

Home discovery ordering is not a fulfillment guarantee.

## Fresh Verification

Authoritative operational/transaction calculations happen when Customer proceeds into Checkout and must be freshly validated before payment/commitment.

Home data must never be treated as sufficient evidence for payment or fulfillment commitment.

## Branch Acceptance

Eligibility is not acceptance:

```text
Core Eligibility
  ↓
ELIGIBLE
  ↓
AWAITING_BRANCH_ACCEPTANCE
  ↓
ACCEPTED / REJECTED / TIMEOUT
```

Acceptance timeout is a **platform-controlled 3-minute policy**. Owner and Branch Manager cannot configure it.

If rejected or timed out:

- the current transaction for that Branch ends;
- there is no silent rematch;
- Customer may explicitly choose another Branch and start a new Checkout.

## Paid Failure Recovery

If the original Order was already paid online and the Branch rejects/times out, the original transaction is not transferred to another Branch. It enters financial recovery according to payment state/provider behavior.

Customer may immediately start a new independent order while the previous refund/recovery remains pending.

A pending refund for one Order must not block another independent Order, including another Branch within the same Brand.

## Customer Cancellation

Follow the adopted GoFood-style principle:

- Customer cancellation is allowed before Branch acceptance/confirmation.
- After Branch acceptance, normal Customer cancellation is not allowed.
- Core enforces cancellation from authoritative Order state.
- Branch/system rejection, timeout, or payment failure is not Customer cancellation.

## Authority Rules

- UI/client is never the authority for fulfillment, eligibility, pricing, inventory, payment, or order state.
- A Branch selected from Home is a customer selection/context, not proof that the Branch can fulfill the final transaction.
- Client-provided `branch_id` is not authoritative merely because it was sent by the client.
- Customer location, delivery destination, and fulfillment Branch remain distinct contexts.

## Agent Rules

1. Do not force Cart into a single-Branch container merely because Checkout/Order is single-Branch.
2. Do not merge items from different Branches into one Checkout or Order.
3. Do not make a rejected/timed-out Checkout silently switch Branch.
4. Do not make a pending refund globally block the Customer from starting another independent order.
5. Do not put the 3-minute acceptance policy under Owner or Branch Manager settings.
6. Do not perform expensive routing/ETA work merely to render initial Home.
7. Do not treat Home discovery order as authoritative fulfillment resolution.
8. If a required policy is not defined, report the GAP instead of inventing behavior.

## Verification Matrix

1. Cart can hold items from multiple Branches/brands.
2. Starting Checkout for Branch A excludes Branch B items.
3. Branch B items remain available for a separate Checkout.
4. One Checkout creates an Order with exactly one fulfillment Branch.
5. Initial Home does not wait for expensive routing/ETA/payment/acceptance checks.
6. Fresh verification occurs before payment/commitment.
7. Branch acceptance has a 3-minute platform-controlled timeout.
8. Rejection/timeout does not silently rematch.
9. Paid rejection/timeout does not transfer payment to another Branch.
10. Pending refund does not block an independent new order.
11. Customer cancellation is enforced by authoritative Order state.
