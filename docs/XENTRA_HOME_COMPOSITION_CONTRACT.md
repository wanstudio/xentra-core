# Xentra Home Composition Contract

**Status:** LOCKED BUSINESS/UX CONTRACT
**Decision Date:** 2026-09-04
**Authority:** Current Notion locked decisions

## Purpose

Customer Home is a dynamic, fast presentation/discovery container. It must not hardcode Branch count, Branch IDs, menu/catalog structure, fulfillment authority, or transaction business rules.

## Canonical Customer Flow

```text
Destination Context
      ↓
FAST Branch Discovery
      ↓
Customer selects Branch
      ↓
Category
      ↓
Product
      ↓
Cart
      ↓
Checkout (single Branch scope)
      ↓
Fresh authoritative verification
      ↓
Payment
      ↓
Branch Acceptance
      ↓
Fulfillment
```

## Home Performance Contract

Home first-load speed is the primary presentation requirement.

Home discovery may use a cheap GPS/destination proximity algorithm, primarily geographic proximity such as straight-line distance, or another faster equivalent. The exact algorithm is an implementation choice as long as it is fast, deterministic enough for the UI purpose, and does not become transaction authority.

Home MUST NOT block initial render on:

- road-routing API calls;
- authoritative ETA calculation;
- delivery-cost calculation;
- driver availability;
- full-cart eligibility;
- stock verification;
- authoritative pricing;
- Branch Acceptance;
- payment verification.

Home does not need to display ETA/distance on initial render. A simple heading such as **“Cabang terdekat dari tempatmu”** and a data-driven Branch array is sufficient.

The discovery ordering may change after reload or Customer interaction/context changes. This is acceptable because Home ordering is a discovery/presentation result, not a fulfillment promise.

## Branch Count Behavior

### Exactly 1 relevant Branch

- Hide Branch selector/discovery UI.
- Hide the text/section `Cabang terdekat dari tempatmu`.
- Directly render `Category → Product` for that Branch context.
- Preserve Branch context internally for catalog, Cart, Checkout, and later authoritative validation.

### More than 1 Branch

- Render a data-driven Branch discovery array.
- Do not require ETA calculation before initial Home render.
- Customer may click/select a Branch and enter that Branch's catalog context.
- The first displayed Branch is not guaranteed to become the final fulfillment Branch.

### Large Branch counts

1, 2, 50, or more Branches use the same composition model. Pagination, lazy loading, virtualization, database geographic indexing, or other performance optimizations may be used without changing business semantics.

## Authority Boundary

Home is not authoritative for:

- fulfillment Branch;
- ETA/routing;
- inventory availability;
- authoritative price;
- eligibility;
- Branch acceptance;
- authorization;
- payment state;
- order state;
- financial or inventory mutations.

“Cabang terdekat” is a discovery/presentation concept only.

## Cart / Checkout Boundary

The previous shorthand **“1 Cart → 1 Fulfillment Branch”** is superseded by the more precise rule:

> **Multi-branch Cart is allowed; multi-branch Checkout/Order is not.**

Cart is a shopping container and may retain items associated with multiple Branches/brands.

Checkout is a transaction scope for **one Branch only**. Customer completes different Branches as separate Checkout/Order processes.

Every Order has exactly one `fulfillment_branch_id`.

No single Checkout/Order may combine fulfillment from multiple Branches in Xentra Core v1.

## Authoritative Transaction Boundary

Actual operational calculations happen when Customer proceeds into Checkout and, critically, before payment/commitment.

At that point the system performs fresh checks required by the applicable domains, including current availability/stock, price, serviceability, fulfillment capability, promotion validity, and other required conditions.

Home state is never sufficient evidence to authorize payment or create an authoritative fulfillment commitment.

## Branch Selection Modes

`AUTO` and `CUSTOMER_SELECTED` remain valid **transaction-level selection semantics** where the applicable Commerce contract requires them. They are NOT Home discovery behavior.

- Home discovery does not call `AUTO` merely because it orders nearby Branches.
- `CUSTOMER_SELECTED` means the Customer explicitly selects a Branch; Core still validates it.
- `AUTO` means Core/BranchMatcher is explicitly asked to resolve a Branch for a transaction when no explicit Customer selection exists.

Do not conflate Home discovery ordering with `AUTO` fulfillment resolution.

## Acceptance

Eligibility and Branch Acceptance remain separate:

```text
Order Request
  → Core Eligibility
  → ELIGIBLE
  → AWAITING_BRANCH_ACCEPTANCE
  → ACCEPT / REJECT / TIMEOUT
```

The Xentra platform Branch Acceptance timeout is **3 minutes**. It is platform-controlled and is **not configurable by Owner or Branch Manager**.

After rejection/timeout, the current transaction for that Branch ends. Customer may explicitly choose another Branch and start a **new Checkout**. No silent rematch.

## Paid Rejection / Timeout

If the original transaction was already paid online and its Branch rejects/times out, the original transaction is not transferred to another Branch. It enters financial recovery according to payment state/provider behavior.

Customer may immediately start a new independent order while the prior refund/recovery remains pending. A pending refund on one order must not block another Branch/order.

## Customer Cancellation

Follow the adopted GoFood-style principle:

- Customer cancellation is allowed before Branch acceptance/confirmation.
- After Branch acceptance, normal Customer cancellation is not allowed.
- Core enforces cancellation from authoritative Order state.
- Branch/system rejection, timeout, or payment failure must not be classified as Customer cancellation.

## Agent Rules

1. Do not turn Home discovery into fulfillment matching.
2. Do not add routing/ETA calls to initial Home merely to produce a more accurate display.
3. Do not treat Home's nearest/first Branch as an authoritative fulfillment commitment.
4. Do not mix items from multiple Branches into one Checkout/Order.
5. Do not silently rematch a rejected/timed-out transaction.
6. Do not block a new independent order because another order is awaiting refund/recovery.
7. Do not invent Owner/Branch Manager controls for the 3-minute acceptance policy.
8. If a required business policy is absent, report the GAP rather than inventing it.

## Verification Matrix

1. Initial Home renders without waiting for road routing/ETA/payment/acceptance checks.
2. One Branch hides discovery and renders its catalog directly.
3. Multiple Branches render a data-driven nearby Branch array.
4. Home does not hardcode Branch IDs/count/menu structures.
5. Reload/interaction may change discovery ordering without violating transaction authority.
6. Customer-selected Branch reaches the correct catalog/Cart context.
7. Cart can contain items associated with multiple Branches.
8. Checkout isolates one Branch scope.
9. Order stores exactly one fulfillment Branch.
10. Fresh authoritative verification occurs before payment/commitment.
11. Acceptance timeout is 3 minutes and tenant roles cannot configure it.
12. Rejection/timeout ends the current transaction; alternative requires explicit new Checkout.
13. Paid rejection/timeout is financially recovered without transferring payment to another Branch.
14. Pending refund does not block an unrelated new order.
15. Cancellation follows authoritative Order state.
