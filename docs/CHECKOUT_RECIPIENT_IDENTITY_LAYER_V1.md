# Xentra Checkout Recipient Identity Layer v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision Date:** 2026-09-11  
**UX Refinement Lock:** 2026-09-19  
**Authority:** Current Notion locked decisions

## Decision

Xentra explicitly separates **Buyer/Customer identity** from **Order Recipient identity** in Checkout.

A customer may place an order for themselves or for another person without requiring the recipient to have an Xentra account.

## Canonical Checkout UX

The Recipient Identity Layer remains an order-level domain concept, but its default presentation is intentionally simple.

In the customer PWA Checkout, **Recipient is shown inside the existing “Alamat Pengiriman” card**, directly below the selected delivery address.

The UI is visually one compact card, while Address and Recipient remain separate domain concepts.

Conceptual layout:

Alamat Pengiriman                         Pilih
Pringsewu Utara
Pringsewu, Pringsewu

─────────────────────────────────
Dikirim kepada
Ikhwan · 08xxxxxxxx                    Ubah

Do **not** create a large standalone Recipient card in the normal Checkout flow.

## Recipient Editing

The `Ubah` action beside **Dikirim kepada** opens a lightweight Recipient bottom sheet.

Rules:
- Authenticated customer defaults to **Saya sendiri** using the current authenticated customer profile.
- **Orang lain** is explicit opt-in.
- Recipient does not need an Xentra account for MVP.
- Recipient does not require a separate OTP.
- Recipient confirmation must be visible before payment/irreversible transaction completion.
- Recipient remains editable only while the transaction remains editable.

## Address Boundary

The existing **Tambah Alamat / Detail alamat** surface remains focused on the destination itself:
- address/name/label;
- location/map pin;
- optional delivery landmark/detail;
- favorite/default-address behavior.

Do **not** make Recipient a mandatory field of `Tambah Alamat` and do not model Recipient as a permanently owned child of a saved Address.

A saved Address may optionally provide a **default recipient** in future UX, but the transaction-level Recipient remains independently selectable/overridable.

Example: the same saved Address “Kantor” may be used by Order A for Budi and Order B for Siti.

Therefore:
- **Address = where**
- **Recipient = who receives**
- **Buyer = who places/owns the transaction**

UI may visually combine Address + Recipient for simplicity, but backend/domain contracts must keep them separate.

## Unauthenticated Customer

This decision remains compatible with the locked **Deferred Customer Identity** contract.

Do not introduce mandatory registration at Home, Cart, or Checkout entry. If transaction identity is required, use the contextual Phone + OTP Identity Gate at the existing transaction boundary, then perform canonical revalidation before commit/payment.

## Recipient Rules

- `Buyer` identifies who initiates/owns the customer transaction.
- `Recipient` identifies who should receive the fulfillment.
- For an authenticated customer, the customer's current profile name and active phone are the default self-recipient values.
- “Pesan untuk orang lain” is explicit opt-in through Recipient editing.
- Recipient does **not** need an Xentra account for MVP.
- MVP invariant: **1 Order = 1 Recipient**.
- Recipient data used by an Order is an order-level transaction snapshot and must not be silently changed by later Customer profile changes.
- Historical Orders remain bound to their immutable recipient transaction snapshot.

## State / Mutation Boundary

Recipient may be edited only while the Order/transaction remains editable. Once the transaction reaches an operationally locked state, recipient changes must not silently mutate the committed Order; use the applicable support/change workflow instead.

## Notification

Recipient notification is an optional downstream capability. It is not part of the core Recipient entity contract. If implemented, notification consent/state belongs to the relevant communication/notification contract.

## Domain / Data Boundary

Conceptual Order structure:
- buyer_id / customer identity
- fulfillment_branch_id
- delivery destination
- recipient snapshot: type SELF or OTHER, name, phone

The exact physical schema/API names remain subject to the relevant Commerce/Order contract. This decision must not create a new cross-domain database authority by itself.

## Invariants

1. Buyer and Recipient are distinct concepts even when they refer to the same person.
2. Self-order is the default path and requires no extra recipient form for an authenticated customer.
3. Ordering for another person is opt-in through Recipient editing.
4. Recipient identity must be visible before payment/irreversible transaction completion.
5. Recipient does not need an Xentra account in MVP.
6. One Order has exactly one Recipient in MVP.
7. Recipient data is independent from the Customer profile after order commit.
8. OTP/identity verification must not silently switch Branch, Cart scope, delivery destination, or Recipient choice.
9. Recipient confirmation remains compatible with **Multi-Branch Cart → Single-Branch Checkout → Single-Branch Order**.
10. Do not model this as a special “gift order”; gifting is only one use case of the general Recipient Identity Layer.
11. Saved Address and Recipient are separate concepts even when the UI presents them in one compact Checkout card.
12. `Tambah Alamat` is not the authoritative Recipient editor.
13. A saved Address must not permanently determine the Recipient of every future Order.

## Agent / Audit Rules

- Treat this document as authoritative for Buyer vs Recipient semantics and the locked Checkout UX boundary.
- In Checkout, reuse the existing **Alamat Pengiriman** card and place **Dikirim kepada** beneath the address.
- Provide `Ubah` to edit Recipient through the lightweight Recipient bottom sheet.
- Keep `Tambah Alamat / Detail alamat` focused on destination/address data.
- Do not collapse recipient fields into Customer profile semantics.
- Do not force recipient registration/account creation.
- Do not make Recipient a permanent child/owner of a Saved Address.
- Do not expand MVP to multi-recipient orders without a new explicit decision.
- If the current implementation lacks the required Order/Recipient contract, report the **data-contract gap** rather than inventing unrelated domain authority.
- Preserve the existing Deferred Customer Identity contract and its OTP/revalidation boundary.

## UX Supersession Note

The earlier implementation direction that placed a full **Recipient Confirmation Bottom Sheet immediately after the “Pesan Sekarang” CTA** is superseded as the default presentation.

The **Recipient Identity Layer itself remains locked**. Only the default Checkout presentation/interaction has changed to the simpler Address-card + `Dikirim kepada` pattern defined above.

## Customer Phone Completion & SELF Recipient Identity

**Locked:** 2026-09-21

Customer phone is part of the authenticated Customer Profile/Identity and is the authoritative phone source for Recipient `SELF`.

Rules:
- Google authentication provides Customer identity, but Google authentication alone does not guarantee that the Customer profile has a usable phone number.
- If an authenticated Customer has no phone number, Xentra must require a phone-completion step before the transaction can continue to final order/payment commit.
- The phone is collected once and saved to the Customer Profile/Identity.
- `SELF` automatically uses the Customer Profile name + phone.
- Do not ask the customer to re-enter their own phone inside Recipient editing when the Customer Profile already has a valid phone.
- Existing customers with a valid phone skip phone completion.
- New Google customers without a phone complete the phone field after Google authentication, whether the flow originated from Profile/Signup or the Checkout identity gate.
- After phone completion, return to the same checkout intent without losing cart, address, branch, recipient, promotion, payment method, or COD cash amount.
- The Order stores its own Recipient snapshot; later Customer Profile changes must not mutate historical Orders.

Canonical flow:

```
Google Auth
  ↓
Customer identity resolved
  ↓
Phone exists?
  ├─ YES → continue
  └─ NO  → Complete Phone → save Customer Profile → continue
  ↓
Checkout
  ↓
SELF Recipient = Customer Profile name + phone
```

Boundary:
- Customer Profile/Identity owns the reusable current customer phone.
- Order Recipient snapshot owns the phone captured for that order.
- Saved Address does not own Recipient.
- Recipient OTHER remains independent and requires no Xentra account, Google authentication, or OTP.

Checkout may be the contextual place where a missing phone is collected, but the resulting phone must be persisted to Customer Profile/Identity and then used as the authoritative SELF Recipient value.

## Customer Phone Completion UI & Flow

**Locked:** 2026-09-21

Customer phone completion uses a **Bottom Sheet**, not a floating form.

### Profile / Signup
After Google Signup/Auth succeeds, if the Customer Profile has no valid phone:
1. Open the Phone Completion Bottom Sheet.
2. Require the customer to enter their WhatsApp/phone number.
3. Save the number to Customer Profile/Identity.
4. Continue to the Profile flow.

The phone is not merely checkout state.

### Checkout / Transaction Identity Gate
If Google Auth is triggered from Checkout and the authenticated Customer has no phone:
1. Open the same Phone Completion Bottom Sheet.
2. Collect and save the phone to Customer Profile/Identity.
3. Return to the same Checkout intent.
4. Preserve cart, address, branch, recipient, promotion, payment method, and COD cash amount.

Use transaction-appropriate continuation copy such as **“Simpan & Lanjutkan Pesanan”**.

### UX boundary
- Phone Completion = Customer Profile/Identity concern.
- Recipient editing = Checkout Recipient concern.
- SELF Recipient reads name + phone from Customer Profile.
- OTHER Recipient remains independently editable in the Recipient bottom sheet.
- Do not create a floating form or a second phone-capture system.

### Canonical flow
```
Google Signup/Auth
  ↓
Customer identity resolved
  ↓
Phone exists?
  ├─ YES → continue
  └─ NO  → Phone Completion Bottom Sheet
              ↓
           Save Profile
              ↓
           Continue
```

When originating from Checkout, continuation must return to the same valid Checkout context without losing transaction state.

