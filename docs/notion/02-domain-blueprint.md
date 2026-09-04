<!-- SNAPSHOT FROM NOTION — source page: 02-domain-blueprint; updated 2026-09-04 -->

## 🔒 LOCKED ADDENDUM — Home Discovery / Cart / Checkout Boundary

This addendum supersedes earlier wording that makes Home wait for authoritative ETA/routing or treats the entire Cart as one fulfillment scope.

### Home
Home is a fast discovery/presentation layer. It uses cheap GPS/destination proximity calculation (straight-line distance or a faster equivalent) to render nearby Branches quickly. Initial Home render must not wait for road routing, ETA, delivery cost, driver availability, full-cart eligibility, stock verification, pricing, or Branch Acceptance.

Home discovery is not fulfillment resolution. It may show **“Cabang terdekat dari tempatmu”** and a Branch array without displaying ETA. Ordering may change after reload or Customer interaction.

### Cart / Checkout / Order
- Cart is a shopping container and may contain items associated with multiple Branches/brands.
- Checkout is a single transaction scope containing items from one fulfillment Branch only.
- Order has exactly one fulfillment Branch.
- Customer completes different Branches as separate Checkout/Order processes.
- Multi-Branch fulfillment inside one Checkout/Order is prohibited for v1.

### Actual transaction calculation
Authoritative operational/transaction calculations occur when the Customer proceeds into Checkout and must be freshly validated before payment/commitment. Home is never the authority for fulfillment, inventory, pricing, eligibility, ETA, or acceptance.

### Acceptance / recovery
Branch Acceptance remains separate from Eligibility. The platform-controlled Branch Acceptance timeout is **3 minutes**, not configurable by Owner or Branch Manager. Rejection or timeout ends the current transaction for that Branch. Customer may explicitly choose another Branch and start a new Checkout; no silent rematch.

If the original order was paid online, it enters financial recovery/refund according to payment state/provider behavior and is not transferred to another Branch. Customer may start another independent order immediately while the previous refund remains pending.

### Cancellation
Customer cancellation follows the adopted GoFood-style principle: allowed before Branch acceptance/confirmation; after acceptance, normal Customer cancellation is not allowed. Core enforces the rule from authoritative Order state. Branch/system failure must not be misclassified as Customer cancellation.

### Invariant
**Multi-branch Cart is allowed; multi-branch Checkout/Order is not.**
