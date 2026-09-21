# Xentra Checkout Recipient Identity Layer v1

**Status:** REVISED — unlocked & rewritten in place  
**Decision Date:** 2026-09-11  
**UX Refinement Lock:** 2026-09-19  
**Revision (unlock):** 2026-09-21 — recipient input moved into “Tambah / Detail alamat”  
**Authority:** Current Notion locked decisions + this revision

---

## Revision 2026-09-21 — why this document was unlocked and changed

The earlier locked presentation placed recipient editing inside the Checkout
address card (“Dikirim kepada” + `Ubah` → lightweight Recipient bottom sheet).

The product decision changed: **recipient name + WhatsApp number are now plain
optional inputs in the “Tambah / Detail alamat” sheet**, alongside the existing
address detail / landmark (“patokan”) inputs. They behave like the other free-text
inputs on that surface — they are not an identity/account feature.

Authoritative consequences of this revision:

1. **Recipient input lives in the “Tambah / Detail alamat” sheet**
   (`location-picker.js`). Address and Recipient remain separate domain concepts
   even though the customer enters both on the same surface.
2. **The Checkout “Dikirim kepada” row is HIDDEN — NOT deleted.** The row markup,
   the `Ubah` wiring (`x-btn-change-recipient`) and
   `openRecipientSheet()` / `_recipientSummaryHtml()` are intentionally kept in
   `checkout.js` for reference/reuse. Checkout therefore no longer presents a
   recipient editor.
3. **Recipient is transaction-scoped.** Values entered for an order are snapshotted
   onto that order. After a successful order the draft recipient is cleared, so the
   next order falls back to **SELF** unless the customer fills the fields again.
   A previous order’s recipient must never silently apply to a new order.
4. **Empty recipient fields → SELF.** The order then uses the authenticated
   Customer Profile name + phone. Filling only one of the two fields is rejected
   in the sheet (both or neither).
5. **The snapshot is displayed as “Dikirim kepada”** in the order status screen
   (`order-received`), which remains the authoritative post-order presentation.
6. **No WhatsApp notification is sent for the recipient.** There is no Wablas
   wiring in the order path, and none is to be added. Recipient name/phone are
   informational/operational order data only. (The WhatsApp OTP transport is a
   separate identity mechanism and is unaffected by this decision.)
7. **Recipient still requires no Xentra account and no OTP.** “Tambah Alamat” is
   not an identity surface; the recipient is order-level data.

---

## Decision

Xentra explicitly separates **Buyer/Customer identity** from **Order Recipient
identity** in Checkout.

A customer may place an order for themselves or for another person without
requiring the recipient to have an Xentra account.

## Canonical Checkout UX (revised 2026-09-21)

- Checkout shows the **Alamat Pengiriman** card only (address label, address text,
  optional landmark). The recipient row is **hidden** (see revision §2).
- The recipient is entered on the address surface: **“Tambah / Detail alamat”**
  carries two optional inputs — **Nama penerima** and **Nomor WhatsApp penerima** —
  together with the address detail/landmark inputs. The sheet’s confirm action is
  **“Simpan”**.
- Values are optional; leaving both empty is the normal SELF order.
- **“Dikirim kepada”** is shown after the order exists, in the order/received
  status screen, using the order’s own recipient snapshot.

Do **not** re-introduce a recipient editor into the Checkout card while this
revision is in force (the retained code is reference-only).

## Recipient Editing (revised 2026-09-21)

- Editing happens in **“Tambah / Detail alamat”** (optional fields).
- Both fields filled → **OTHER** recipient (name + WhatsApp number).
- Both fields empty → **SELF** (Customer Profile name + phone).
- Exactly one field filled → invalid; the sheet blocks the save and asks for both
  or neither.
- The `Ubah` sheet retention rule from the previous lock no longer applies to the
  Checkout card; the code is kept but not rendered.

## Address Boundary (revised 2026-09-21)

The “Tambah Alamat / Detail alamat” surface is now also the recipient entry point:

- address / label;
- location / map pin;
- optional delivery landmark / detail;
- **optional recipient name + WhatsApp number**;
- favorite/default-address behavior.

Still forbidden:

- Recipient must **not** be persisted as a permanent child of a saved Address; a
  saved Address must not determine the Recipient of future Orders.
- Recipient must not become a mandatory field of “Tambah Alamat”.
- Recipient must not become an account/identity requirement.

Therefore:
- **Address = where**
- **Recipient = who receives** (transaction-level, snapshot on the order)
- **Buyer = who places/owns the transaction**

UI may combine Address + Recipient for simplicity, but backend/domain contracts
must keep them separate.

## Unauthenticated Customer

This decision remains compatible with the locked **Deferred Customer Identity**
contract.

Do not introduce mandatory registration at Home, Cart, or Checkout entry. If
transaction identity is required, use the contextual Phone + OTP Identity Gate at
the existing transaction boundary, then perform canonical revalidation before
commit/payment.

## Recipient Rules

- `Buyer` identifies who initiates/owns the customer transaction.
- `Recipient` identifies who should receive the fulfillment.
- For an authenticated customer, the customer’s current profile name and active
  phone are the default self-recipient values.
- “Pesan untuk orang lain” is explicit opt-in through the recipient fields.
- Recipient does **not** need an Xentra account for MVP.
- MVP invariant: **1 Order = 1 Recipient**.
- Recipient data used by an Order is an order-level transaction snapshot and must
  not be silently changed by later Customer profile changes.
- Historical Orders remain bound to their immutable recipient transaction
  snapshot. The draft recipient is cleared after a successful order.

## State / Mutation Boundary

Recipient may be edited only while the Order/transaction remains editable. Once the
transaction reaches an operationally locked state, recipient changes must not
silently mutate the committed Order; use the applicable support/change workflow
instead.

## Notification

**No recipient WhatsApp notification is sent.** There is no Wablas (or other
provider) wiring in the order path for the recipient, and none is to be added.

## Domain / Data Boundary

Conceptual Order structure:
- buyer_id / customer identity
- fulfillment_branch_id
- delivery destination
- recipient snapshot: type SELF or OTHER, name, phone

The physical mapping used by the implementation: `orders.recipient_type`
(default `self`), `orders.recipient_name`, `orders.recipient_phone`, populated at
order creation from the client recipient draft (OTHER) or from the authenticated
session (SELF). This decision must not create a new cross-domain database
authority by itself.

## Invariants

1. Buyer and Recipient are distinct concepts even when they refer to the same person.
2. Self-order is the default path and requires no extra recipient form for an
   authenticated customer.
3. Ordering for another person is opt-in through recipient editing.
4. Recipient identity must be captured before payment/irreversible transaction
   completion and is visible in the order status screen.
5. Recipient does not need an Xentra account in MVP.
6. One Order has exactly one Recipient in MVP.
7. Recipient data is independent from the Customer profile after order commit.
8. OTP/identity verification must not silently switch Branch, Cart scope, delivery
   destination, or Recipient choice.
9. Recipient confirmation remains compatible with **Multi-Branch Cart →
   Single-Branch Checkout → Single-Branch Order**.
10. Do not model this as a special “gift order”; gifting is only one use case of the
    general Recipient Identity Layer.
11. Saved Address and Recipient are separate concepts even when the UI presents the
    inputs on one sheet.
12. `Tambah Alamat` is not the authoritative Recipient **owner** (it is only the
    input surface); the Order owns the snapshot.
13. A saved Address must not permanently determine the Recipient of every future
    Order.
14. A recipient draft captured for one order must never silently apply to a
    subsequent order.

## Agent / Audit Rules

- Treat this document as authoritative for Buyer vs Recipient semantics, the
  revised entry surface, and the hidden-Checkout-row decision.
- Recipient inputs live in **“Tambah / Detail alamat”** (optional, both-or-neither).
- Do **not** re-render the Checkout “Dikirim kepada” row unless a new decision
  supersedes this revision. The retained code is not to be deleted.
- Display “Dikirim kepada” in the order/order-received status screen from the
  order snapshot.
- Keep the recipient transaction-scoped: clear the draft after a successful order.
- Do not wire any WhatsApp/Wablas notification for the recipient.
- Do not collapse recipient fields into Customer profile semantics.
- Do not force recipient registration/account creation.
- Do not make Recipient a permanent child/owner of a Saved Address.
- Do not expand MVP to multi-recipient orders without a new explicit decision.
- If the current implementation lacks the required Order/Recipient contract, report
  the **data-contract gap** rather than inventing unrelated domain authority.
- Preserve the existing Deferred Customer Identity contract and its
  OTP/revalidation boundary.

## Supersession Note

The earlier implementation direction that placed a full **Recipient Confirmation
Bottom Sheet immediately after the “Pesan Sekarang” CTA**, and the later
Checkout-card **“Dikirim kepada” + `Ubah`** sheet, are both **superseded as the
default presentation** by this revision.

The **Recipient Identity Layer itself remains locked.** Only the input surface and
the Checkout presentation changed.

## Customer Phone Completion & SELF Recipient Identity

**Locked:** 2026-09-21

Customer phone is part of the authenticated Customer Profile/Identity and is the
authoritative phone source for Recipient `SELF`.

Rules:
- Google authentication provides Customer identity, but Google authentication alone
  does not guarantee that the Customer profile has a usable phone number.
- If an authenticated Customer has no phone number, Xentra must require a
  phone-completion step before the transaction can continue to final
  order/payment commit.
- The phone is collected once and saved to the Customer Profile/Identity.
- `SELF` automatically uses the Customer Profile name + phone.
- Do not ask the customer to re-enter their own phone inside recipient editing when
  the Customer Profile already has a valid phone.
- Existing customers with a valid phone skip phone completion.
- New Google customers without a phone complete the phone field after Google
  authentication, whether the flow originated from Profile/Signup or the Checkout
  identity gate.
- After phone completion, return to the same checkout intent without losing cart,
  address, branch, recipient, promotion, payment method, or COD cash amount.
- The Order stores its own Recipient snapshot; later Customer Profile changes must
  not mutate historical Orders.

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
- Recipient OTHER remains independent and requires no Xentra account, Google
  authentication, or OTP.

Checkout may be the contextual place where a missing phone is collected, but the
resulting phone must be persisted to Customer Profile/Identity and then used as the
authoritative SELF Recipient value.

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
4. Preserve cart, address, branch, recipient, promotion, payment method, and COD
   cash amount.

Use transaction-appropriate continuation copy such as **“Simpan & Lanjutkan
Pesanan”**.

### UX boundary
- Phone Completion = Customer Profile/Identity concern.
- Recipient editing = address-sheet input + Order snapshot concern.
- SELF Recipient reads name + phone from Customer Profile.
- OTHER Recipient remains independently editable in the address sheet.
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

When originating from Checkout, continuation must return to the same valid
Checkout context without losing transaction state.
