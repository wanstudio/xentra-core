# Xentra-Core Commerce Implementation Reconciliation Plan

**Status:** ACTIVE IMPLEMENTATION PLAN  
**Date:** 2026-09-04

## Authority
This plan implements the latest locked Xentra Commerce decisions. Notion is business authority; `docs/notion/` and this contract are durable implementation guidance; Git is current implementation evidence. Existing implementation must not override a newer locked decision.

## Locked Boundary
- Cart may contain items associated with multiple Branches.
- Checkout is a single transaction scope for one Branch.
- Order has exactly one `fulfillment_branch_id`.
- Multi-Branch fulfillment inside one Checkout/Order is prohibited for v1.
- `AUTO` and `CUSTOMER_SELECTED` are transaction selection modes, distinct from final `fulfillment_branch_id`.
- CUSTOMER_SELECTED is not a bypass: Core validates the selected Branch canonically.
- No silent rematch to another Branch after customer selection or transaction failure.
- `ELIGIBLE` is not `ACCEPTED`.
- Acceptance flow: `AWAITING_BRANCH_ACCEPTANCE -> ACCEPTED / REJECTED / TIMEOUT`.
- Acceptance timeout is platform-controlled at 3 minutes.
- ACCEPTED commits the Branch; `fulfillment_branch_id` becomes immutable for normal lifecycle purposes.
- Customer normal cancellation is allowed only before acceptance.
- Branch may cancel after ACCEPTED only through an explicit exception flow.
- Branch exception requires a simple structured reason code plus optional note.
- Branch reject, timeout, and exception are not `CUSTOMER_CANCEL`.
- Order state and Payment state remain separate.
- Financial recovery must be idempotent and must not block an independent new Order.

## Implementation Sequence

### R1 — Cart & Checkout Reconciliation
- Audit and remove old `1 Cart = 1 Branch` enforcement.
- Support multi-Branch Cart grouping.
- Produce independent single-Branch Checkouts.
- Reject multi-Branch Checkout scope without silently moving items.
- Isolate failure/recovery between independent Checkouts.

### R2 — Branch Selection
- Normalize `AUTO` and `CUSTOMER_SELECTED`.
- AUTO uses BranchMatcher then canonical Eligibility.
- CUSTOMER_SELECTED validates the selected Branch through Core/Eligibility.
- Ineligible selected Branch is rejected; never silently rematched.
- Core establishes authoritative `fulfillment_branch_id`.

### R3 — Checkout Verification
- Fresh branch state and capability checks.
- Canonical product assignment/availability checks.
- Authoritative stock check.
- Server-authoritative pricing.
- Delivery/destination verification where applicable.
- Final verification barrier before Order/payment commitment.

### R4 — Order Creation
- Persist authoritative Branch and selection mode.
- Persist required customer/item/price/delivery snapshots.
- Keep `order_type` separate from `order_channel`.
- Enforce exactly one `fulfillment_branch_id`.
- Prevent Branch mutation after ACCEPTED.

### R5 — Branch Acceptance
- Implement `AWAITING_BRANCH_ACCEPTANCE`.
- Implement authorized, atomic, idempotent ACCEPT and REJECT.
- Audit actor, Branch, Order, state transition and timestamp.
- Protect acceptance races.

### R6 — Acceptance Timeout
- Enforce server-authoritative 3-minute timeout.
- Implement AWAITING -> TIMEOUT.
- Protect ACCEPT vs TIMEOUT race.
- Allow a new independent Checkout after timeout; no silent rematch.

### R7 — Customer Cancellation
- Allow CUSTOMER_CANCEL only before acceptance.
- Reject CUSTOMER_CANCEL after ACCEPTED at Core/state-machine level.
- Derive actor from authoritative auth context.
- Keep CUSTOMER_CANCEL, BRANCH_REJECT, BRANCH_TIMEOUT, BRANCH_EXCEPTION, SYSTEM_CANCEL and PAYMENT_FAILURE semantically distinct.

### R8 — Branch Exception
- Allow explicit Branch exception after ACCEPTED.
- Require reason code: `PRODUCT_OUT_OF_STOCK`, `KITCHEN_CANNOT_SERVE`, `OPERATIONAL_PROBLEM`, `SYSTEM_PROBLEM`, `OTHER`.
- Optional note.
- Enforce Branch scope.
- Never change fulfillment Branch.
- Audit exception details.

### R9 — Payment Recovery
- Keep Order and Payment lifecycles separate.
- Handle paid failure according to authoritative Payment state/provider behavior.
- Do not invent refund/cancel semantics unsupported by payment state.
- Make recovery idempotent.
- Pending refund on one Order must not block an independent new Order.

### R10 — No Silent Rematch Audit
Audit Home, Catalog, Cart, Checkout, Order, Payment and Delivery for fallback/rematch logic. Remove any silent Branch replacement after transaction selection.

### R11 — Concurrency & Integrity
Test at minimum:
- Customer Cancel vs Branch Accept.
- Branch Accept vs Timeout.
- Branch Reject vs Timeout.
- Branch Exception vs Customer Cancel.
- Payment Success vs Timeout.
- Duplicate Accept/Reject/Exception.

Expected properties: atomic, deterministic, idempotent, auditable, no illegal terminal transition.

### R12 — Regression & Contract Audit
- Preserve C1-C4 behavior unless an audit proves a conflict/regression.
- Add lifecycle tests.
- Run the complete test suite.
- Search for stale `1 cart = 1 branch`, silent rematch, and cancel-after-accept assumptions.
- Verify Notion → `docs/notion/` → contracts → code consistency.

## Agent Rules
1. Read relevant contract and existing implementation before coding.
2. Reuse existing domain ownership and canonical services.
3. Make the smallest change that satisfies the locked contract.
4. Do not restart C1-C4 without evidence of a regression or business conflict.
5. Do not invent policies for unresolved areas.
6. If ambiguity is found: **DO NOT GUESS / DO NOT INVENT / REPORT GAP**.
7. Tests must cover both success and failure/race paths.
8. UI is not authority; Core/server state is authoritative.
