# 🔒 Final Checkout Verification & Single Fulfillment Boundary v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision Date:** 2026-09-17

## Decision

Xentra customer storefront is a **single Brand storefront**, for example:

`app.mybangjo.com`

It is not a separate storefront per Branch. Branch identity is an internal fulfillment concern and is not represented as separate customer URLs such as `app.mybangjo.com/pringsewu`.

The customer cart and normal checkout UI may carry **customer intent/state** without prematurely resolving every fulfillment or promotion constraint. The authoritative decision for fulfillment, promotion eligibility, inventory, pricing, delivery constraints, and order validity happens at the **Final Checkout Verification** boundary immediately before order/payment commit.

## Canonical Customer Flow

```text
app.mybangjo.com
      ↓
Customer browses Brand storefront
      ↓
Claim PWA promotion / reward
      ↓
Reward enters cart as customer cart intent
      ↓
Customer returns Home and adds food
      ↓
CTA shows cart quantity, e.g. "2 Pesanan"
      ↓
Checkout UI displays the current cart intent
      ↓
Customer presses Bayar / Pesan Sekarang
      ↓
FINAL CHECKOUT VERIFICATION
      ├─ resolve fulfillment Branch
      ├─ validate whole cart against that Branch
      ├─ validate promotion / reward against that Branch
      ├─ validate current inventory / availability
      ├─ validate current pricing / discounts
      ├─ validate delivery / order-type constraints
      ├─ validate customer / promotion usage constraints
      └─ validate all other order invariants
      ↓
If valid → commit order + payment/COD flow
If invalid → do NOT create/commit the order; return actionable correction
```

## Single Fulfillment Invariant

A customer order is **single-fulfillment**. One cart/order must resolve to exactly **one fulfillment Branch**.

Internal branch matching may evaluate multiple eligible Branch candidates. Those candidates are implementation inputs only and must never become multiple fulfillment branches, multiple order records, or multiple reward entitlements for one order.

```text
Candidate Branch A ─┐
Candidate Branch B ─┼─→ Fulfillment Resolver → ONE winning Branch
Candidate Branch C ─┘
                                      ↓
                               order.branch_id
```

The final persisted `order.branch_id` must correspond to the same single Branch against which the final cart validation was performed.

## Promotion + Fulfillment Boundary

A promotion is a **campaign/rule**, not a Branch-specific storefront identity. A campaign may be available across multiple Branches, while the final promotion eligibility for an order is evaluated only after the order's fulfillment Branch has been resolved.

```text
Campaign
   ↓
Reward / discount intent in customer cart
   ↓
Final checkout verification
   ↓
Resolved fulfillment Branch
   ↓
Evaluate campaign once in that Branch context
   ↓
Eligible → apply exactly the entitlement allowed by the campaign
Ineligible → reject/remove/replace the affected reward according to product UX
```

A campaign available at five Branches does **not** create five reward entitlements. A customer order can receive only the quantity explicitly permitted by the campaign rules.

## PWA Install Reward Example

The PWA install flow may allow the customer to claim an eligible reward and place it into the cart:

```text
Cart
├─ Ayam 1
└─ Es Teh 1 — GRATIS
```

At this stage, the cart expresses the customer's intended order. Claiming the reward does **not** mean that stock has already been consumed or that a Branch has already been irrevocably committed.

At final verification:

```text
Fulfillment resolver → Bangjo Pringsewu
                         ↓
Check Ayam at Pringsewu      ✅
Check Es Teh at Pringsewu    ❌ HABIS
Check PWA promotion          ✅ / ❌ according to current rules
```

The server must prevent order/payment commit and return an actionable result such as:

> **Maaf, Es Teh sedang habis di cabang yang akan memenuhi pesananmu. Pilih hadiah lain atau lanjut tanpa hadiah.**

The customer must not receive an order containing a reward that cannot be fulfilled by the final Branch.

## Claim Is Cart Intent, Not Stock Consumption

Promotion claim in customer UI is not itself a stock consumption or completed redemption event.

Unless a separate explicit inventory contract says otherwise, stock consumption/reservation and promotion redemption are finalized within the authoritative order transaction boundary, not merely because the customer clicked **Claim**.

This prevents abandoned carts, navigation away/back flows, and stale claims from unnecessarily consuming Branch stock.

## Final Verification Is Server-Authoritative

The UI may show optimistic/customer-friendly state, but UI state is never the business authority.

The final server boundary must re-read current authoritative state and must not trust client-provided:

- fulfillment Branch as proof of eligibility;
- promotion eligibility/result;
- reward price/value;
- inventory availability;
- final totals;
- payment amount;
- customer usage counters.

Any stale or conflicting client state must be rejected or recalculated by Core.

## Atomicity / No Partial Commit

Final verification and commit must preserve the invariant that an invalid order cannot partially commit.

```text
FINAL VERIFY
   ↓
all checks pass?
   ├─ NO → no order/payment commit; return correction details
   └─ YES → commit order and required transactional state
```

Do not create a successful order first and discover a promotion/stock/fulfillment failure afterward.

For online payment, final verification must precede the payment/order commitment boundary required by the selected payment flow. For COD or other deferred-payment modes, the same final business validation still applies before the order is committed as a valid customer order.

## UI vs Authority

```text
Customer UI
  = cart intent + presentation

Core final verification
  = fulfillment + eligibility + inventory + pricing + transaction truth
```

The existence of a reward line in the cart means only **"the customer has selected/claimed this reward intent"**, not **"the reward is guaranteed to be fulfillable"**.

## Explicit Non-Goals

- Do not create separate customer storefront URLs per Branch.
- Do not turn internal Branch candidates into multiple fulfillment branches for one order.
- Do not duplicate one campaign into one promotion identity per Branch merely because multiple Branches participate.
- Do not require the customer UI to resolve and freeze Branch identity merely when the reward is claimed or when the cart CTA is opened.
- Do not consume Branch stock merely because a promotion reward was claimed into the cart.
- Do not create an order and then perform authoritative promotion/stock validation afterward.

## Relationship to Existing Contracts

This decision reinforces the existing Xentra single-branch checkout/order semantics and the server-authoritative Pre-Payment Verification boundary. It does not authorize a rewrite of unrelated customer authentication, payment, catalog authority, or Branch Manager contracts.

Where existing implementation contains legacy whole-cart or pre-resolved Branch paths, those paths must be reconciled to this locked boundary before further promotion/checkout hardening.

## Acceptance Invariants

1. One customer order resolves to exactly one `order.branch_id`.
2. Candidate Branches may be evaluated internally, but only one winner becomes fulfillment authority.
3. Promotion eligibility is evaluated against the resolved fulfillment Branch at final verification.
4. A multi-Branch campaign scope never multiplies one customer's reward entitlement merely because multiple Branches participate.
5. A claimed reward may remain visible in cart before final validation, even if it later becomes ineligible because current Branch inventory/rules changed.
6. Failed final validation creates no valid order/payment commit and returns an actionable correction path.
7. Final persisted order totals, promotion redemption, and inventory effects are derived from authoritative server state within the final transaction boundary.
8. UI branch context is presentation/input only; it is never the final business authority.
