# Xentra Checkout Recipient Identity Layer v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision Date:** 2026-09-11  
**Authority:** Current Notion locked decisions

## Decision

Xentra explicitly separates **Buyer/Customer identity** from **Order Recipient identity** in Checkout.

A customer may place an order for themselves or for another person without requiring the recipient to have an Xentra account.

## Canonical Delivery UX

```text
Checkout
  ↓
CTA: Pesan Sekarang
  ↓
Recipient Confirmation Bottom Sheet
  ↓
Authenticated customer:
  profile name + active phone shown as default recipient
  ↓
Toggle: “Pesan untuk orang lain”
  OFF → self recipient
  ON  → recipient name + WhatsApp inputs
  ↓
Confirm
  ↓
Checkout shows “Dikirim kepada” recipient card
  ↓
Payment / transaction flow
```

## Unauthenticated Customer

This decision remains compatible with the locked **Deferred Customer Identity** contract.

Do not introduce mandatory registration at Home, Cart, or Checkout entry. If transaction identity is required, use the contextual Phone + OTP Identity Gate at the existing transaction boundary, then perform canonical revalidation before commit/payment.

## Recipient Rules

- `Buyer` identifies who initiates/owns the customer transaction.
- `Recipient` identifies who should receive the fulfillment.
- For an authenticated customer, the customer's current profile name and active phone are the default self-recipient values.
- “Pesan untuk orang lain” reveals recipient name and WhatsApp fields.
- Recipient does **not** need an Xentra account for MVP.
- MVP invariant: **1 Order = 1 Recipient**.
- Recipient data used by an Order is an order-level transaction snapshot and must not be silently changed by later Customer profile changes.
- Historical Orders remain bound to their immutable recipient transaction snapshot.

## Checkout Presentation

After confirmation, Checkout displays a compact **“Dikirim kepada”** card containing recipient name and phone, with an **Ubah** action while the transaction remains editable.

## State / Mutation Boundary

Recipient may be edited only while the Order/transaction remains editable. Once the transaction reaches an operationally locked state, recipient changes must not silently mutate the committed Order; use the applicable support/change workflow instead.

## Notification

Recipient notification is an optional downstream capability. It is not part of the core Recipient entity contract. If implemented, notification consent/state belongs to the relevant communication/notification contract.

## Domain / Data Boundary

Conceptual Order structure:

```text
Order
├── buyer_id / customer identity
├── fulfillment_branch_id
├── delivery destination
└── recipient snapshot
    ├── type: SELF | OTHER
    ├── name
    └── phone
```

The exact physical schema/API names remain subject to the relevant Commerce/Order contract. This decision must not create a new cross-domain database authority by itself.

## Invariants

1. Buyer and Recipient are distinct concepts even when they refer to the same person.
2. Self-order is the default path and requires no extra recipient form for an authenticated customer.
3. Ordering for another person is opt-in through the checkout toggle.
4. Recipient identity must be visible before payment/irreversible transaction completion.
5. Recipient does not need an Xentra account in MVP.
6. One Order has exactly one Recipient in MVP.
7. Recipient data is independent from the Customer profile after order commit.
8. OTP/identity verification must not silently switch Branch, Cart scope, delivery destination, or Recipient choice.
9. Recipient confirmation remains compatible with **Multi-Branch Cart → Single-Branch Checkout → Single-Branch Order**.
10. Do not model this as a special “gift order”; gifting is only one use case of the general Recipient Identity Layer.

## Agent / Audit Rules

- Treat this document as authoritative for Buyer vs Recipient semantics in Checkout.
- Do not collapse recipient fields into Customer profile semantics.
- Do not force recipient registration/account creation.
- Do not expand MVP to multi-recipient orders without a new explicit decision.
- If the current implementation lacks the required Order/Recipient contract, report the **data-contract gap** rather than inventing unrelated domain authority.
- Preserve the existing Deferred Customer Identity contract and its OTP/revalidation boundary.
