<!-- SNAPSHOT FROM NOTION — source page: 03-business-flow; updated 2026-09-04 -->

# 🔒 LOCKED ADDENDUM — Corrected Customer Commerce Flow

This addendum supersedes earlier Home wording that required authoritative ETA ordering and the shorthand **“One Cart → One Fulfillment Branch.”**

## Home
Home is a **fast discovery/presentation layer**. First-load speed is the primary concern.

Flow:
`Destination Context → Fast Branch Discovery → Customer selects Branch → Catalog → Product → Cart`

Home discovery may use a cheap GPS/destination proximity calculation, such as straight-line geographic distance, or another faster equivalent. It must not wait for expensive road routing, ETA, delivery cost, driver availability, full-cart eligibility, stock, pricing, or Branch Acceptance before rendering the initial Home.

Home may display a simple heading such as **“Cabang terdekat dari tempatmu”** and a data-driven Branch array. ETA does not need to appear on Home.

The discovery order may change after reload or Customer interaction. This is acceptable because Home ordering is discovery/presentation data, not an authoritative fulfillment decision.

## Catalog / Cart / Checkout
After Customer selects a Branch:

`Selected Branch → Category → Product → Cart → Checkout`

Cart is a **shopping container** and may contain items associated with multiple Branches/brands.

Checkout is a **single transaction scope** and may contain items from **one Branch only**. Customer completes different Branches as separate Checkout/Order processes.

Each Order has exactly one `fulfillment_branch_id`. Multi-Branch fulfillment within one Checkout/Order is prohibited for v1.

Therefore:

**Multi-branch Cart is allowed; multi-branch Checkout/Order is not.**

## Final Actual Verification
Home is not authoritative. When Customer proceeds to Checkout and especially before payment/commitment, Xentra performs fresh authoritative calculations/checks required by Commerce/Delivery/Inventory/Payment contracts, including current availability/stock, pricing, serviceability, and other applicable conditions.

## Branch Acceptance
`ELIGIBLE ≠ ACCEPTED`.

After Core Eligibility, Branch operational acceptance remains a separate step.

The Branch acceptance window is a **platform-controlled 3-minute Xentra policy**, not configurable by Owner or Branch Manager.

`ELIGIBLE → AWAITING_BRANCH_ACCEPTANCE → ACCEPTED / REJECTED / TIMEOUT`

Timeout means the Branch is not accepted and the current transaction ends for that Branch.

After rejection/timeout, Customer may explicitly choose another Branch and start a **new Checkout**. The system must not silently rematch the existing transaction.

## Paid Rejection / Timeout
If the original order was already paid online and the Branch rejects/times out, the original transaction is not transferred to another Branch. It enters financial recovery according to payment state/provider behavior. Customer may immediately start a new independent order while the previous refund/recovery remains pending.

A pending refund on one order must not block an unrelated order for another Branch.

## Customer Cancellation
Follow the adopted GoFood-style principle: Customer cancellation is allowed before Branch acceptance/confirmation; after Branch acceptance, normal Customer cancellation is not allowed. Core enforces this from authoritative Order state.

Branch/system rejection, timeout, or payment failure must not be classified as Customer cancellation.

## Core Invariants
- Home is fast discovery, not fulfillment resolution.
- Home does not need ETA on initial render.
- Home may use cheap proximity ordering and may reorder after reload/interaction.
- Actual transaction conditions are freshly checked before payment/commitment.
- Multi-branch Cart is allowed.
- One Checkout/Order = one fulfillment Branch.
- Customer completes different Branches as separate transactions.
- No silent rematch after rejection/timeout.
- 3-minute acceptance timeout is platform-controlled, not tenant-configurable.
- Paid order rejection/timeout does not transfer payment to another Branch.
- Pending refund on one order does not block another independent order.
