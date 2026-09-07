# P5 — Checkout Cart Performance + Branch-Scoped Upsell

**Status:** IMPLEMENTATION PROMPT
**Authority:** Current locked Notion decisions + `docs/XENTRA_CART_CHECKOUT_CONTRACT.md`
**Repository:** `wanstudio/xentra-core`

## 1. NON-NEGOTIABLE AUTHORITY

Before changing code, read the current locked contracts, especially:

- `docs/XENTRA_CART_CHECKOUT_CONTRACT.md`
- the locked Customer Cart Interaction Performance Model in Notion
- the locked Checkout Upsell Branch Scope decision in Notion

Do not invent or revise business policy.

If code, comments, tests, or older documentation conflict with the locked contract, treat the implementation as the thing to fix. Do not ask the user to reconfirm an already-locked decision.

## 2. TASK

Fix the Customer Checkout `+/-` quantity responsiveness while preserving the locked architecture, and enforce that Checkout upsell is scoped to the Checkout fulfillment Branch.

There are TWO requirements. They are related by Checkout scope but must not be conflated:

### A. Cart quantity interaction

Xentra uses:

**Shared Authoritative Cart State + Optimistic Transaction + Asynchronous Reconciliation**

The quantity fast path must be:

```text
User + / -
→ Cart transaction
→ shared authoritative in-memory Cart State
→ immediate directly-affected UI update
→ asynchronous reconciliation
```

`+/-` must not synchronously wait for:

- network/API
- delivery/routing/ETA
- promotion evaluation
- stock/availability verification
- payment
- unrelated broad rendering/subscriber work

Do not create a second Checkout cart state.

### B. Checkout upsell scope

Checkout is one fulfillment cycle for exactly one Branch.

Therefore:

```text
Checkout Branch A
→ Checkout items: Branch A
→ Checkout upsell: Branch A only
→ Order: Branch A
```

The Checkout section such as **“Tambah ini untuk melengkapi pesananmu”** must not contain products from Branch B, Branch C, or another Branch merely because they exist globally or in the Customer's multi-Branch Cart.

Multi-Branch Cart remains valid. Do not convert Cart into a single-Branch container.

## 3. FIRST: AUDIT ACTUAL CODE

Do not modify code immediately.

Trace the real implementation in:

- `apps/customer-pwa/assets/js/core/store.js`
- `apps/customer-pwa/assets/js/pages/checkout.js`
- relevant Home/Cart files
- the actual Checkout upsell/recommendation implementation and its data source

Trace all relevant:

- `Store.subscribe()`
- `Store.setQty()`
- `Store.addItem()`
- `Store.removeCartItem()`
- `Store.getState()`
- cart item lookup/grouping
- Checkout render/update handlers
- promotion refresh/evaluation
- delivery quote/match calls
- availability/stock verification
- upsell data retrieval and filtering

Establish the actual synchronous path before changing it.

## 4. FAST PATH REQUIREMENT

The immediate quantity path must perform only work required to make the changed quantity and directly-derived local UI current.

Target concept:

```text
setQty
→ authoritative Cart State mutation
→ required local persistence as appropriate
→ immediate required UI
```

Secondary work may then reconcile asynchronously:

```text
→ promotion
→ delivery
→ availability/stock
→ other server-dependent work
```

Do not use arbitrary `setTimeout()` delays as a performance fix.

Do not fake responsiveness.

Do not remove required reconciliation just to make the interaction appear fast.

## 5. SHARED STATE INVARIANT

Home, Cart, and Checkout must continue to consume the same authoritative Cart State.

If:

```text
Home
→ Checkout
→ quantity +1
→ Back
```

Home/Cart must show the new quantity from the shared Cart State.

Checkout must not maintain an independent mutable quantity authority.

## 6. REVISION-AWARE RECONCILIATION

If secondary reconciliation is asynchronous, ensure stale results cannot overwrite newer Cart State.

Example:

```text
revision 10 → reconciliation request
revision 11 → newer quantity transaction
revision 10 response arrives
→ discard stale result
```

Rapid quantity intents may be coalesced/batched for secondary work, but the final intended quantity must be preserved.

Use the smallest mechanism compatible with the existing architecture. Do not rewrite the Store unnecessarily.

## 7. BRANCH INVARIANTS

Preserve:

- cart item branch provenance
- branch-scoped cart identity
- multi-Branch Cart
- single-Branch Checkout
- single-Branch Order

Do not merge the same SKU across different Branch scopes.

Do not silently rematch a Checkout to another Branch.

Do not turn `branch_id` from client context into business authority.

## 8. UPSELL IMPLEMENTATION RULE

Trace where Checkout upsell products actually come from.

The source must be constrained to the authoritative Checkout fulfillment Branch.

Correct conceptual flow:

```text
Checkout fulfillment Branch A
        ↓
Branch-scoped catalog/product context
        ↓
Eligible upsell candidates for Branch A
        ↓
Upsell UI
```

Incorrect:

```text
Global catalog
  ↓
Mixed Branch products
  ↓
UI filters/guesses Branch
```

Do not invent a cross-Branch fallback.

Do not make a product from another Branch eligible merely because it is in the Cart or globally available.

If the existing API/data contract cannot supply the required Branch-scoped upsell context, STOP that part of the implementation and report:

**DATA-CONTRACT GAP: Branch-scoped Checkout upsell cannot be established from the existing authoritative data contract.**

Do not fabricate a field, endpoint, or business rule unless one already exists in the locked contracts/codebase.

## 9. AUTHORITY BOUNDARY

Catalog/domain remains authoritative for:

- Branch Product assignment
- availability
- price
- stock

Checkout orchestrates its transaction context but does not become the catalog authority.

Client/UI is not authoritative for:

- fulfillment Branch
- pricing
- stock
- promotion eligibility
- delivery capability
- payment
- Order state

## 10. SCOPE CONTROL

Do not modify unrelated:

- Product Master / Branch override architecture
- payment architecture
- order lifecycle
- Branch Acceptance
- delivery business rules
- promotion business rules
- branch selection algorithm
- database schema unless a proven existing contract requires it

If another issue is discovered, report it instead of expanding scope.

## 11. REQUIRED TESTS

At minimum verify:

1. `+` updates shared Cart State immediately.
2. `-` updates shared Cart State immediately.
3. Quantity UI/subtotal/local total update without waiting for network.
4. Rapid `+/-` produces the correct final quantity.
5. Stale reconciliation cannot overwrite newer state.
6. Checkout quantity change is visible after Back to Home/Cart.
7. Multi-Branch Cart remains supported.
8. Same product from different Branches remains branch-scoped.
9. Checkout remains single-Branch.
10. Checkout upsell contains only products from the current Checkout fulfillment Branch.
11. Cross-Branch products are not presented as Checkout upsell.
12. Existing promotion/delivery/availability reconciliation still occurs where required.
13. No arbitrary timeout hack is used.

## 12. FINAL REPORT

Return:

### Root Cause
Actual measured/traced cause of the quantity lag.

### Upsell Source
Actual source of Checkout upsell and how Branch scoping is enforced.

### Files Changed
Exact files changed.

### Fast Path
Before/after mutation path.

### Reconciliation
What remains asynchronous and how revision/stale-result protection works.

### Contract Verification
Explicitly check:

- Shared Authoritative Cart State
- Optimistic Transaction
- Asynchronous Reconciliation
- Home/Cart/Checkout shared state
- no duplicate Checkout cart authority
- Multi-Branch Cart preserved
- Single-Branch Checkout preserved
- Single-Branch Order preserved
- Checkout upsell = fulfillment Branch only
- no cross-Branch upsell
- server/Core remains business authority

### Tests
List exact tests and results.

### Remaining Gaps
Only genuine unresolved contract/data gaps. Do not invent a workaround.
