# Xentra Cart & Checkout Contract

**Status:** LOCKED BUSINESS/UX CONTRACT
**Decision Date:** 2026-09-08
**Authority:** Current Notion locked decisions

## 🔒 Locked Cart Interaction Performance Model

> **Shared Authoritative Cart State + Optimistic Transaction + Asynchronous Reconciliation.**

Cart interaction is a fast path. Quantity changes must update the shared authoritative in-memory Cart State immediately; expensive secondary work must not block the interaction.

### Shared Cart State

Home, Cart, and Checkout consume the same Cart State for cart interaction data.

If quantity is changed in Checkout and the Customer navigates Back to Home/Cart, Home/Cart must reflect the latest Cart State. Checkout must not maintain an independent mutable copy of cart quantity.

### Quantity transaction

```text
User + / -
  ↓
Cart transaction
  ↓
Authoritative in-memory Cart State
  ↓
Immediate local UI update
  ↓
Asynchronous reconciliation
```

The immediate path must not synchronously wait for:

- network/API requests;
- delivery/routing/ETA calculation;
- promotion evaluation;
- stock/availability verification;
- payment processing;
- unrelated page-wide rendering or subscriber work.

Secondary reconciliation may be batched/coalesced across rapid quantity changes. Reconciliation results must be revision-aware so stale results cannot overwrite newer Cart State.

Optimistic client state is not business authority. Core/server remains authoritative for final price, availability/stock, promotion eligibility/benefit, delivery capability/economics, fulfillment Branch, payment state, and Order state according to their respective domain contracts.

## 🔒 Locked Checkout Upsell Branch Scope

Checkout is a **single fulfillment cycle for exactly one Branch**. Therefore, Checkout upsell/recommendation is also constrained to that Checkout fulfillment Branch.

### Upsell rule

The Checkout section such as **“Tambah ini untuk melengkapi pesananmu”** must contain products from the **current Checkout fulfillment Branch only**.

```text
Multi-Branch Cart
      ↓
Checkout Branch A
      ↓
Checkout items = Branch A scope
Upsell = Branch A scope only
      ↓
Order = Branch A
```

- Cross-Branch products must not appear as Checkout upsell.
- Checkout must not use another Branch as an upsell fallback merely because that product exists globally or in the Customer's Cart.
- Multi-Branch Cart remains allowed. This rule does not turn Cart into a single-Branch container.
- Checkout remains single-Branch and Order remains single-Branch.
- Catalog/domain remains authoritative for Branch Product assignment, availability, price, and stock.
- Checkout/UI must not create business eligibility for a product from another Branch.
- If the existing data/API contract cannot provide Branch-scoped upsell, report the **data-contract gap** rather than inventing cross-Branch behavior.

### Authority and composition

Checkout may orchestrate the upsell presentation for its current fulfillment context, but it does not become the authority for catalog availability, price, stock, or Branch Product assignment.

This rule is a direct consequence of the locked boundary:
**Multi-Branch Cart → Single-Branch Checkout → Single-Branch Order.**

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
Checkout upsell contains that Branch's products only
  ↓
Quantity changes update shared Cart State immediately
  ↓
Secondary reconciliation runs asynchronously
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
- Cart quantity is client interaction state, but final transactional validity remains server/Core authoritative.
- Checkout upsell scope follows the authoritative Checkout fulfillment Branch; it is not a cross-Branch recommendation authority.

## Agent Rules

1. Do not force Cart into a single-Branch container merely because Checkout/Order is single-Branch.
2. Do not merge items from different Branches into one Checkout or Order.
3. Do not make a rejected/timed-out Checkout silently switch Branch.
4. Do not make a pending refund globally block the Customer from starting another independent order.
5. Do not put the 3-minute acceptance policy under Owner or Branch Manager settings.
6. Do not perform expensive routing/ETA work merely to render initial Home.
7. Do not treat Home discovery order as authoritative fulfillment resolution.
8. Do not make quantity `+/-` wait for expensive secondary processing before updating the UI.
9. Do not create a second independent mutable cart quantity authority inside Checkout.
10. Do not apply stale asynchronous reconciliation results over a newer Cart State revision.
11. Do not show cross-Branch products in Checkout upsell.
12. Do not invent a cross-Branch upsell fallback when Branch-scoped upsell data is unavailable; report the data-contract gap.
13. If a required policy is not defined, report the GAP instead of inventing behavior.

## Verification Matrix

1. Cart can hold items from multiple Branches/brands.
2. Starting Checkout for Branch A excludes Branch B items.
3. Branch B items remain available for a separate Checkout.
4. One Checkout creates an Order with exactly one fulfillment Branch.
5. Checkout upsell contains products from the Checkout fulfillment Branch only.
6. Cross-Branch products are excluded from Checkout upsell.
7. Initial Home does not wait for expensive routing/ETA/payment/acceptance checks.
8. `+/-` updates the shared Cart State and directly affected UI immediately.
9. Checkout quantity changes are visible in Home/Cart after Back without requiring an independent checkout-to-home synchronization authority.
10. Rapid quantity changes can reconcile as a latest-state batch without losing the final intended quantity.
11. Stale reconciliation results cannot overwrite a newer Cart State.
12. Fresh verification occurs before payment/commitment.
13. Branch acceptance has a 3-minute platform-controlled timeout.
14. Rejection/timeout does not silently rematch.
15. Paid rejection/timeout does not transfer payment to another Branch.
16. Pending refund does not block an independent new order.
17. Customer cancellation is enforced by authoritative Order state.
