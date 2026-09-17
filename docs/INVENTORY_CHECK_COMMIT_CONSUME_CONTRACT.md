# 🔒 Inventory Check → Commit → Consume Contract v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-17  
**Scope:** Xentra Commerce customer order flow, online payment, COD, POS Sale, branch inventory concurrency, and the boundary between stock check, commitment/reservation, and stock consumption.

## 1. Why this decision was needed

Xentra already had two important decisions:

1. Customer Checkout performs a final availability/stock and price verification at the end of Checkout, immediately before Pay.
2. `Order` lifecycle and financial lifecycle are separate, so a cash/COD Order may be `confirmed` while its payment remains `pending`.

The unresolved boundary was what happens after that final stock check and before the later inventory deduction.

Treating the entire problem as one event is unsafe:

- If Xentra only checks stock and does not commit it, two concurrent customers can both pass the same check and both proceed against the same remaining quantity.
- If Xentra immediately consumes stock merely because an Order is confirmed, the system incorrectly treats promised-but-not-yet-fulfilled stock as physically consumed and makes cancellation/recovery less clean.
- If COD waits for physical cash collection before any commitment, the Branch can already be preparing an Order while the same stock remains promiseable to another transaction.

Therefore Xentra separates three business moments:

```text
CHECK
  ↓
COMMIT / RESERVE
  ↓
CONSUME
```

## 2. How the decision was selected

The decision combines the existing Xentra business contracts with recurring patterns observed in established POS/commerce systems.

### Existing Xentra constraints preserved

- Final customer stock/price verification stays at the end of Checkout, immediately before Pay.
- Inventory remains Branch-scoped with exactly one shared Branch stock pool.
- There are no separate POS, PWA, COD, dine-in, WhatsApp, or marketplace stock buckets.
- Commerce `Order` and POS `Sale` remain distinct canonical objects.
- `Order.status` and payment state remain separate; COD can be confirmed while payment is pending.
- Core remains the business/inventory authority; POS is an operational execution layer.
- Offline POS can continue supported local operations and later reconcile with Core.

### Competitor patterns used as evidence

The research did not copy a vendor's schema. It looked for the underlying operating pattern:

- **Square** distinguishes on-hand inventory from committed inventory / available-to-sell concepts. This supports treating already-promised units differently from physically remaining units.
- **Toast** shows that inventory effects do not have to share the exact same trigger as payment and supports restaurant POS operation during connectivity loss.
- **Lightspeed Restaurant** demonstrates local POS operation followed by synchronization while centralized back-office control remains authoritative.
- **Olsera** and **majoo** reinforce the restaurant need for POS ↔ central synchronization of transactional/product/inventory state.

The Xentra decision takes the minimum common concept needed to solve Xentra's concurrency and COD problems, without importing unnecessary vendor-specific complexity.

## 3. Canonical Branch inventory model

There is still **one Branch stock pool**.

Do not create:

```text
POS stock
PWA stock
COD stock
Dine-in stock
Marketplace stock
WhatsApp stock
```

Instead, the Branch quantity has an explicit commitment state:

```text
On-hand = stock physically/business-wise on hand
Committed = quantity already promised to active Orders
Available-to-sell = On-hand - Committed
```

`Committed` is not a second stock pool. It is a reservation/commitment state attached to the same Branch inventory for a particular Order.

Example:

```text
On-hand   = 5
Committed = 3
Available = 2
```

A new request for 3 must fail even though on-hand remains 5 because only 2 units remain available to promise.

## 4. CHECK — final availability and price verification

For Customer Commerce the existing Xentra rule remains authoritative:

```text
Cart
 ↓
Checkout (single Branch)
 ↓
Customer presses Pay
 ↓
FINAL STOCK + PRICE CHECK
```

This final check must evaluate available-to-sell, not merely raw on-hand quantity.

If the check fails:

```text
STOP
 ↓
show changed stock/price state
 ↓
require customer review/update
```

Payment must not proceed from stale availability or price data.

## 5. COMMIT / RESERVE — authoritative stock promise

When the final check succeeds, Xentra must immediately create an authoritative commitment for the required quantity before that quantity is allowed to be relied on as secured by the Order.

The check and commitment form one guarded authoritative transaction boundary. The implementation must not do:

```text
read stock
→ return PASS
→ wait
→ later write reservation
```

because another transaction could win the same stock in between.

The business meaning is:

> **CHECK** asks whether the quantity can still be promised.  
> **COMMIT** means the quantity is now promised to this Order and cannot be promised again to a competing connected Order.

Commitment does not mean the food is already consumed.

## 6. ONLINE PAYMENT — temporary commitment before payment

Canonical flow:

```text
Cart
 ↓
Checkout
 ↓
Customer presses Pay
 ↓
Final stock + price verification
 ↓
Commit / reserve stock
 ↓
Payment processing
 ↓
Payment success
 ↓
Order confirmed / fulfillment
 ↓
Consume stock at the authoritative fulfillment execution boundary
```

### Why before payment?

Suppose the remaining stock is 5 and two customers each request 3.

Without commitment:

```text
A checks → PASS
B checks → PASS
A pays
B pays
```

The business has now accepted 6 against 5.

With commitment:

```text
A check → PASS
A commit 3

On-hand   = 5
Committed = 3
Available = 2

B check → FAIL
```

This prevents the connected online payment path from creating a paid-order-versus-no-stock race.

### Payment attempt expiry/release

A payment attempt can fail, time out, be abandoned, or otherwise stop before payment/order progression reaches the state that justifies the hold.

Therefore a payment-attempt commitment must be temporary and releasable. It may never become an indefinite stock lock.

The exact TTL duration is deliberately not locked here; that is an implementation/configuration decision. The invariant is locked.

## 7. COD — commit before cash collection

COD follows the same stock commitment rule but a different financial timeline:

```text
Checkout
 ↓
Final stock + price check
 ↓
Commit / reserve stock
 ↓
Order = CONFIRMED
 ↓
Payment = COD / PENDING
 ↓
Kitchen / fulfillment
 ↓
Consume stock
 ↓
Cash collected
 ↓
Payment = SETTLED
```

The explicit decision is:

> **COD does not wait for cash collection to commit stock.**

Reason: once an Order is confirmed and the Branch is relying on those units for preparation/fulfillment, those units must not remain available to a competing connected transaction.

This preserves the existing Xentra rule that `orders.status = confirmed` can coexist with `order_payments.payment_status = pending`.

If COD is cancelled before consumption, its commitment is explicitly released through the inventory transaction lifecycle. The historical Order remains intact.

## 8. CONSUME — actual inventory deduction

Consumption is the Inventory transaction that decreases on-hand quantity.

For customer Orders, the exact fulfillment event that represents the business's authoritative consumption boundary remains an Inventory/Commerce implementation boundary, but its meaning is fixed:

```text
Committed stock
 ↓
fulfillment execution boundary reached
 ↓
Inventory consumes quantity
 ↓
Committed quantity is released as consumed
 ↓
On-hand decreases
```

Example:

```text
Before:
On-hand   = 5
Committed = 3
Available = 2

After consuming 3:
On-hand   = 2
Committed = 0
Available = 2
```

Xentra must not collapse `confirmed`, `paid`, and `consumed` into one hidden state.

## 9. DIRECT POS SALE — immediate execution

A connected POS Sale is an immediate operational sale, not an online customer payment attempt waiting for completion.

Canonical flow:

```text
POS creates Sale
 ↓
Authoritative stock check
 ↓
Atomic Sale + inventory consumption
 ↓
Sale committed
```

There is normally no reason to create a long-lived reservation first. POS can check and consume atomically at Sale commit.

POS still does not own the inventory authority; it invokes the approved Commerce/Inventory boundary.

## 10. OFFLINE POS — local execution, later reconciliation

When POS is offline, it cannot know the complete current global Branch inventory state.

The device therefore uses its last valid Branch snapshot and records the local Sale plus local inventory effect durably:

```text
Last-known local stock
 ↓
Local stock check
 ↓
Local Sale + local inventory effect
 ↓
Atomic durable local commit
 ↓
Sync queue
 ↓
Core reconciliation
```

This is intentionally different from the connected online reservation path. A disconnected device cannot commit against a Core state that it cannot reach.

After reconnect, Core reconciles the offline Sale against transactions that may have happened elsewhere. Genuine cross-channel conflict remains possible.

This does not invalidate the Check → Commit model. It is the known trade-off of offline operation and is handled by the existing POS offline conflict contract: one Branch stock pool, no permanent automatic channel priority, stable historical Sale/Order records, idempotent synchronization, and Manager resolution when a true conflict exists.

## 11. Cancellation and release

A commitment exists only while the Order is entitled to hold those units.

Therefore:

- successful fulfillment transitions commitment into consumption;
- valid cancellation before consumption releases the commitment;
- failed/expired/abandoned online payment attempts release temporary commitments;
- conflict/remediation flows record explicit inventory consequences rather than silently changing original Sale/Order history.

Every release and consumption is an explicit Inventory transaction/evidence event. No silent absolute-stock overwrite is allowed.

## 12. Availability display is not commitment

Home/Product availability is a view of current known state, not a reservation.

Low-stock warning is also only an operational signal. It does not create a commitment and does not automatically disable the product.

Only the authoritative transaction boundary can create a stock commitment.

## 13. Connected concurrency invariant

For authoritative connected flows:

> No two transactions may successfully commit overlapping quantities beyond the Branch quantity available after existing commitments.

A final stock read followed by an unguarded later reservation is not sufficient. The implementation must make the availability decision and commitment race-safe at the authoritative Inventory/Order transaction boundary.

## 14. Failure examples

### Online vs online

```text
Stock = 5
A requests 3
B requests 3

A check + commit → PASS
Available becomes 2
B check + commit → FAIL
```

### COD vs online

```text
Stock = 5
COD A requests 3

Check → PASS
Commit A → 3
Available = 2

Online B requests 3
Check → FAIL
```

COD keeps its stock commitment even though payment is still pending.

### COD cancellation

```text
Stock = 5
COD A commit = 3
Available = 2

A cancelled before fulfillment
↓
Release = 3
Available = 5
```

### Online vs offline POS

```text
Core stock = 5
PWA commits 3
POS disconnected with stale local state of 5
POS sells 3 offline

Combined demand = 6 against stock 5
```

Core can surface the conflict during reconciliation. The original records remain intact and Manager resolution applies.

## 15. What this decision does NOT introduce

- channel-specific inventory pools;
- a second inventory authority inside POS;
- waiting for online payment before every inventory effect;
- indefinite payment reservations;
- automatic POS-over-online or online-over-POS priority;
- a separate Web POS product;
- deletion/rewrite of historical transactions to hide conflicts.

## 16. Final locked decision

Xentra adopts **Check → Commit/Reserve → Consume**.

1. **CHECK:** Customer Commerce performs the final availability + price verification at the end of Checkout, immediately before Pay.
2. **COMMIT:** a successful check is followed by an authoritative stock commitment before the Order is allowed to rely on that quantity as secured.
3. **ONLINE PAYMENT:** payment-attempt commitments are temporary/releasable until payment/order progression reaches the state that justifies the hold.
4. **COD:** stock is committed before cash collection; `Order confirmed` may coexist with `Payment pending`.
5. **CONSUME:** actual stock is deducted by the authoritative Inventory transaction at the defined fulfillment execution boundary.
6. **DIRECT POS SALE:** connected POS may atomically check and consume at Sale commit instead of using an unnecessary reservation window.
7. **OFFLINE POS:** uses last-known local state and later reconciles; genuine cross-channel conflicts remain possible.
8. **ONE BRANCH = ONE STOCK POOL:** no channel-specific stock buckets.

This decision closes the previously open gap between Checkout's final availability verification and inventory deduction without redesigning Xentra's existing Commerce flow or introducing unnecessary inventory complexity.

## 17. AI-worker guardrails

Any AI worker implementing Commerce, Inventory, Payment, Order, or POS behavior must treat these rules as locked:

- never use raw on-hand as available-to-sell when active commitments exist;
- never perform final stock check and later unguarded reservation as separate race-prone steps;
- never wait for COD cash settlement before committing stock;
- never permanently reduce on-hand merely because an Order is confirmed;
- never create channel-specific stock quantities;
- never fabricate provider-confirmed payment while offline;
- never delete or rewrite historical Order/Sale records to hide an inventory conflict;
- any change requires a new business/architecture decision and may not be invented implicitly by an implementation worker.
