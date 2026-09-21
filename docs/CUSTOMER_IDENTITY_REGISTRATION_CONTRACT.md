# Xentra Customer Identity & Deferred Registration Contract

**Status:** LOCKED BUSINESS/UX CONTRACT  
**Decision Date:** 2026-09-19  
**Authority:** Current Notion locked decisions

## 🔒 SUPERSEDING DECISION — WhatsApp OTP & Wablas RETIRED

**Status:** RETIRED / NO LONGER USED  
**Decision Date:** 2026-09-21

WhatsApp OTP login and its Wablas transport are **retired**. They are no longer
used anywhere in the customer flow, and no WhatsApp notification is dispatched for
customers, orders, or recipients.

Authoritative:
- **Customer identity = Google Sign-In + Phone Completion**
  (`PATCH /customer/profile/phone`). No OTP step is required for login, checkout,
  or order commit.
- `/auth/otp/send`, `/auth/otp/verify` and `/auth/otp/trust` short-circuit with
  `410 OTP_RETIRED` and never dispatch a Wablas message.
- The legacy OTP challenge store, routes, and the client OTP sheets are
  **HIDDEN, NOT DELETED** — kept for reference and clearly marked as retired.
  Do not re-enable without a new explicit decision.
- Any earlier OTP “step-up / recovery” wording in this document is superseded by
  this section; session-security and fail-closed invariants remain valid.
- Tests must not use OTP or Wablas: OTP/Wablas-exercising tests are skipped with a
  RETIRED note, and session fixtures are created through the server
  `TokenSessionStore` (the same store the Google path uses).

## 🔒 LOCKED — Google Identity Gate Placement in Checkout v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision Date:** 2026-09-19

This decision locks where and how Google Sign-In / Google One Tap appears in the customer ordering flow so authentication does not feel like an early registration wall or disrupt normal food ordering.

### Canonical placement

Do **not** place “Continue with Google” on Home, before browsing, before catalog exploration, or immediately when the customer enters Checkout.

The preferred identity gate is **late in Checkout, after the customer has completed the meaningful ordering work and immediately before the transaction requires an authenticated Customer identity**.

Canonical flow:

```text
Home → Location / Branch Context → Catalog → Product → Cart → Checkout
→ Address + Recipient + Delivery / Purchase Details → Order Review
→ Lanjutkan Pesanan / Bayar → Identity Gate (only if required)
→ Continue with Google → Google authentication
→ Return to the same valid Checkout context → Final Checkout Verification
→ Create Order / Payment / COD
```

### UX principle

Google authentication is a **transaction identity gate**, not a registration/onboarding screen.

The customer should first feel: “Saya sudah selesai memilih makanan dan mengisi pesanan; tinggal satu langkah untuk melanjutkan.”

Therefore:
- Checkout CTA remains an ordering action such as **Lanjutkan Pesanan** or **Bayar**, not “Login”.
- Only after that action requires authenticated Customer identity should the Google prompt appear.
- Suggested copy: **“Satu langkah lagi — Masuk untuk melanjutkan pesananmu.”**
- Primary action: **Continue with Google**.
- A valid authenticated session skips the Identity Gate and continues directly to Final Checkout Verification.
- Authentication must preserve cart, Branch, destination, recipient, promotion, delivery mode, and payment state.
- Server-side canonical transaction state must be revalidated after authentication before order/payment commit.

### What must NOT happen

- No Google login wall on Home.
- No forced Google login before browsing.
- No “Register first” flow before menu exploration.
- No authentication prompt merely because Checkout was opened.
- No authentication prompt on every order when a valid session already exists.
- No authentication failure fallback to create-order or payment commit.
- No silent Branch rematch or checkout-state mutation caused by authentication.

### Canonical distinction

**SHOPPING** — Home → Catalog → Product → Cart → Checkout

**TRANSACTION** — Address → Recipient → Order Review → Lanjutkan / Bayar

**IDENTITY — only when required** — Continue with Google

**SECURITY** — Final Checkout Verification

**COMMIT** — Create Order → Payment / COD → Branch Acceptance → Fulfillment

### Agent / implementation rule

When implementing or auditing Customer authentication UX, treat this placement as authoritative. Do not move Google authentication earlier in the shopping flow merely because authentication is technically available. Preserve the deferred-identity principle and place the identity gate at the least disruptive transaction boundary.

**Status: LOCKED / AUTHORITATIVE for Customer Checkout UX.**

---

## 🔒 SUPERSEDING DECISION — Customer Authentication & OTP Role

**Status:** LOCKED / AUTHORITATIVE  
**Decision Date:** 2026-09-19

This decision supersedes the earlier interpretation that WhatsApp + OTP is Xentra's primary/default customer authentication method. Existing session-security and fail-closed invariants remain valid; the authentication channel and OTP role are refined.

### Canonical decision

- **Primary Customer authentication:** Google Sign-In / Google One Tap.
- **Customer phone number:** contact/fulfillment data, not the primary Customer identity credential.
- **WhatsApp OTP:** retained as a **step-up / recovery verification capability**, not required for every login, checkout, or order.
- A customer must not be forced to complete WhatsApp OTP merely because they entered Checkout or placed another normal order.
- A valid authenticated session allows normal transactions without repeated OTP.
- Authentication/session failure must fail closed and must never fall through to `create-order` or payment commit.
- Provider-specific WhatsApp infrastructure is intentionally **not locked**. Do not reintroduce Wablas/device automation merely to satisfy the OTP capability.

### Why

Xentra is a restaurant ordering product. The normal customer intent is ordering food, not proving ownership of a WhatsApp number on every transaction. OTP introduces delivery latency and an external dependency, while a customer contact number does not need ownership verification merely for driver/recipient contact.

### OTP is appropriate for

1. High-risk account/credential changes when phone ownership verification is required.
2. Account recovery when the primary authentication method is unavailable and an approved recovery factor is needed.
3. Explicitly defined sensitive actions that receive a separate security decision.
4. Any future flow that explicitly contracts phone ownership verification.

OTP is **not** automatically required for:

- browsing;
- Cart;
- Checkout;
- normal order creation;
- delivery/recipient phone contact;
- COD;
- every new order;
- every session refresh.

### Canonical customer flow

```text
Browse / Shop
  ↓
Checkout
  ↓
Google Sign-In / One Tap (only when authenticated identity is required)
  ↓
Customer session
  ↓
Contact phone for order/fulfillment
  ↓
Final Checkout Verification
  ↓
Order / Payment
```

### Sensitive / recovery path

```text
Authenticated customer
  ↓
Sensitive action / recovery
  ↓
Step-up verification
  ↓
Approved factor (email / WhatsApp OTP / other explicitly contracted method)
  ↓
Continue
```

### Security invariants retained

- Authentication failure must fail closed.
- Never allow authentication/verification failure → catch/fallback → `create-order` or payment commit.
- Revalidate canonical transaction state after any authentication/step-up flow before commit.
- Authentication/verification must never silently change Branch, cart scope, destination, recipient, promotion state, or payment state.
- Session continuity/security remains server-authoritative.

### Agent rule

When reading older Customer Identity/OTP contracts, treat this section as the current superseding decision for **OTP role and primary authentication**. Do not restore WhatsApp OTP as mandatory login unless a newer explicit decision supersedes this one. Do not invent provider, pricing, expiry, refresh-token, or recovery policy; report a GAP when the required security policy is not yet contracted.

---

## Historical / Superseded — OTP as Xentra Login

The previous contract described WhatsApp + OTP as the normal Customer Identity Gate. That wording is retained only as historical context and is **not current authority** after the 2026-09-19 superseding decision above.

The following invariants from the previous contract remain active unless explicitly superseded:

- No mandatory registration before Home or normal browsing.
- GPS/location does not require registration.
- Active Destination does not require registration.
- Checkout entry does not automatically require registration.
- Persistent Address Book data requires an identifiable Customer account.
- Required identity verification occurs before irreversible transaction commit/payment initiation.
- OTP/verification must not silently rematch or switch the selected Branch.
- OTP/verification must not silently mutate the Customer's Active Destination or cart scope.
- Canonical transaction state must be revalidated after any authentication/verification before commit/payment intent creation.
- Historical Orders remain bound to immutable transaction snapshots.
- If a feature requires authentication earlier, use a contextual Identity Gate rather than global mandatory registration.

## Deferred Registration Principle

Xentra does **not** require Customer registration at the beginning of the shopping journey.

Customer identity is requested only when the transaction or feature actually requires an authenticated Customer identity.

The UX concept is **deferred identity**, not a traditional mandatory registration/onboarding step.
