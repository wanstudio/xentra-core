# Xentra Customer Identity & Deferred Registration Contract

**Status:** LOCKED BUSINESS/UX CONTRACT  
**Decision Date:** 2026-09-08  
**Authority:** Current Notion locked decisions

## 🔒 Core Decision

Xentra does **not** require Customer registration at the beginning of the shopping journey.

Customer identity is requested only when the transaction actually requires an authenticated Customer identity.

The UX concept is **deferred identity**, not a traditional mandatory registration/onboarding step.

## Canonical Customer Flow

```text
Home
  ↓
Location / GPS
  ↓
Fast Branch Discovery
  ↓
Branch Catalog
  ↓
Product
  ↓
Cart
  ↓
Checkout (single Branch)
  ↓
Purchase Type / Destination / Required Details
  ↓
Fresh Canonical Verification
  ↓
Order Review
  ↓
Identity Gate (only if unauthenticated)
  ↓
Phone Number + OTP
  ↓
Canonical Revalidation
  ↓
Transaction Commit / Payment Intent
  ↓
Payment
  ↓
Branch Acceptance
  ↓
Fulfillment
```

## Identity Boundary

The following may be used anonymously:

- Home
- GPS/location discovery
- Active Destination
- Branch discovery and selection
- Catalog/product browsing
- Cart
- Checkout preparation
- Purchase type selection
- Delivery destination entry
- Order review

Authentication/identity becomes mandatory only when required by the transaction contract, such as creating the customer-bound transaction or initiating payment.

## OTP / Registration Semantics

There is no separate mandatory `Daftar` screen in the normal purchase flow.

The Identity Gate should use a concise phone verification flow, for example:

> **Masukkan nomor HP untuk melanjutkan pesanan.**

Successful OTP verification creates or authenticates the Customer account/session as required.

Therefore:

```text
Phone Number
   ↓
OTP Verification
   ↓
Existing Customer → authenticate session
New Customer      → create Customer identity/account
```

## Exact Timing Rule

The Identity Gate must occur **before irreversible transaction commit or payment intent creation when authenticated identity is required**.

It must not be forced merely because the Customer entered Checkout.

This means the preferred boundary is:

```text
Checkout preparation
  ↓
Fresh verification
  ↓
Review
  ↓
Identity Gate
  ↓
OTP
  ↓
Canonical revalidation
  ↓
Transaction commit / payment intent
```

The final canonical revalidation after OTP is required because cart, price, availability, destination, eligibility, or other transactional state may have changed while the Customer was completing identity verification.

## Address Book Boundary

`Address Book` is persistent, account-bound data.

Anonymous Customers may use a temporary Active Destination for discovery and checkout preparation.

Accessing or saving persistent addresses may trigger the Identity Gate earlier, but this is an **optional authentication trigger**, not a mandatory registration requirement for browsing or shopping.

```text
Address Book
  = persistent account data

Active Destination
  = current runtime destination context
```

OTP must not silently change the selected Branch, cart scope, or destination.

## Location / GPS Boundary

GPS does not imply registration.

GPS may provide the temporary discovery context used to render nearby Branches quickly. An explicit Active Destination must not be silently overwritten by ongoing GPS movement.

Delivery destination remains distinct from Customer GPS and fulfillment Branch.

## Returning Customer

If a valid authenticated session exists, the Customer bypasses the Identity Gate.

If the session has expired and the transaction requires identity, the Customer verifies the phone number with OTP again.

## Purchase Type Independence

Registration timing is not tied specifically to Delivery.

Pickup, Dine-in, Reservasi, and other purchase types follow the same principle: identity is transaction-triggered rather than location-triggered, unless their specific operational contract requires identity earlier.

## Invariants

1. No mandatory registration before Home or normal browsing.
2. GPS/location does not require registration.
3. Active Destination does not require registration.
4. Checkout entry does not automatically require registration.
5. Persistent Address Book data requires an identifiable Customer account.
6. Identity verification occurs before irreversible transaction commit/payment initiation when required by the transaction contract.
7. OTP verification must not silently rematch or switch the selected Branch.
8. OTP verification must not silently mutate the Customer's Active Destination or cart scope.
9. Canonical transaction state must be revalidated after OTP before commit/payment intent creation.
10. Historical Orders remain bound to their immutable transaction snapshots and are not changed by later Customer profile/address changes.
11. If a feature requires authentication earlier, that feature may invoke the Identity Gate contextually rather than introducing global mandatory registration.

## Agent Rules

1. Do not add mandatory login/registration to Home.
2. Do not require OTP merely to obtain GPS or browse Branches/products.
3. Do not force an account before Cart or Checkout preparation without a concrete domain requirement.
4. Do not implement `Daftar` as a separate onboarding flow when phone + OTP can satisfy identity creation/authentication.
5. Do not create the transaction/payment intent before required identity verification.
6. Do not trust pre-OTP checkout state without canonical revalidation after OTP.
7. Do not let OTP change Branch, cart scope, or destination implicitly.
8. Do not make Address Book and Active Destination the same entity/state.
9. If an integration genuinely requires authenticated identity earlier, implement a contextual Identity Gate at that dependency boundary and document the reason; do not move global registration to Home.
10. If the required identity/payment contract is undefined, report the GAP instead of inventing provider-specific behavior.
