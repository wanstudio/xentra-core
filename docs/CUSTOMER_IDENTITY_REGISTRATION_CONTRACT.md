# Xentra Customer Identity & Deferred Registration Contract

**Status:** LOCKED BUSINESS/UX CONTRACT  
**Decision Date:** 2026-09-19  
**Authority:** Current Notion locked decisions

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
