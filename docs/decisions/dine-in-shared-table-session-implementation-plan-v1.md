# Dine-in Shared Table Session — Implementation Plan

**Status:** In progress; implementation authorized from CTO discussion on 2026-10-30. The addendum to the active dine-in contract records the approved QR table-cycle path.  
**Scope:** Customer PWA, Dining, Commerce, Payment, POS, Merchant App  
**Goal:** One cashier-opened table cycle that multiple customers can join by scanning the table QR and use to place individually attributed orders into one shared bill.

## 1. Decision summary

Use a cashier-opened table cycle as the authority for dine-in. The cashier assigns the table and puts its placard out. The table QR identifies the branch and table; scanning it resolves the currently open cycle for that table. Each diner can use their own phone and account. Their orders are attributed to them, but all accepted orders belong to one canonical Commerce Order and one shared table bill.

The cashier or Merchant App controls whether the table cycle is open and when it is closed. A QR scan joins an existing open cycle; it does not claim an available table or create a session. Staff can reject a customer or release a table when the placard was issued by mistake or nobody is seated.

### Recommended domain shape

```text
Branch + Table
    └── one open Dining Session / table cycle
            ├── zero or more session members (customer accounts)
            └── one canonical Commerce Order / shared bill
                    ├── participant-attributed order batches
                    ├── one or more checks/payment allocations
                    └── accepted item deltas sent to kitchen
```

The table cycle may exist before the first order. Create or bind the canonical Commerce Order atomically when the first order is submitted. Concurrent first orders must converge on that same Order.

## 2. Customer and staff flow

1. **Cashier opens the table.** POS selects an available table, opens its dine-in cycle, and issues/places its table placard. The table becomes operationally occupied/open. This is an active table cycle, not a temporary payment hold.
2. **Customer scans the placard.** The static QR identifies the branch and table. The server resolves the current open cycle. If no cycle is open, the PWA explains that the table is not ready and directs the guest to staff.
3. **Customer identifies themselves.** A new customer can sign up in the PWA. If an eligible signup promotion is active, the existing Promotion Engine validates and applies it once according to the campaign rules.
4. **Customer joins.** The server adds the authenticated customer to the open session idempotently. Multiple distinct accounts may join the same session. A repeat scan by the same account does not create duplicate membership.
5. **Customer browses and submits an order.** The first order creates/binds the session’s canonical Order. Each submission is recorded as a batch with its creator and source. Server-side validation checks the active session, membership, menu price, availability, idempotency key, and promotion eligibility.
6. **Merchant accepts or rejects each submitted batch.** Acceptance adds the batch to the shared bill, deducts stock at the current acceptance boundary, and sends only newly accepted items to kitchen/printing. Rejection or timeout affects that batch; it does not automatically close the table cycle.
7. **Diners pay.** The shared bill is the financial authority. POS may allocate checks/items or accept contributions using the existing split-bill/payment-allocation contract. Online payments and their callbacks update the same outstanding balance visible to POS. Never allocate or settle more than the amount due.
8. **Staff closes the table.** After confirming the party has left and outstanding operational/payment conditions are resolved, authorized staff close the Dining Session and release the table. Payment completion alone does not release it.

## 3. Authority and invariants

- Dining owns table assignment, open/close cycle, and session membership.
- Commerce owns the canonical Order and participant-attributed order batches.
- Payment owns settlement and allocation; paid status does not end the Dining Session.
- POS owns staff operations to open/close a table, issue the placard, manage checks, and release a table.
- Merchant App owns operational review and accept/reject actions for incoming orders.
- Customer PWA renders the server-resolved active session and submits orders; it cannot claim availability or choose a different table after joining.
- One physical table has at most one open Dining Session at a time. One session has at most one active canonical Commerce Order; rejected/cancelled/timed-out Order records remain as history and do not count toward the shared bill. A replacement Order may be created after the prior one reaches a terminal non-payable state.
- Any joined member may submit their own orders. Membership does not grant access to other members’ phone numbers, payment credentials, or account details.
- Shared bill totals are visible to members; the PWA should make clear which items the current customer submitted and what the whole table owes.
- QR sharing is handled as an operational case: staff can reject a request or close/release a mistakenly opened table. Do not add GPS checks, rotating QR codes, or extra presence verification for this flow.
- A QR for a table resolves only its current open cycle. Requests carrying a stale/closed cycle identifier must fail after the table is closed or reused.
- A pending order timeout/rejection is separate from the table cycle lifecycle. Do not expire an occupied table using the 15-minute payment-hold timer.

## 4. Current implementation and required changes

### Existing reusable seams

- `domains/dining/` is the authority for table/session lifecycle; do not move table rules into checkout or PWA code.
- `domains/commerce/services/OrderAdditionService.js` already supports idempotent, attributed order batches and additional orders against one parent Order. Extend its session binding/authorization seam rather than creating a second group-order engine.
- The existing POS split-bill allocation contract provides check and payment allocation behavior. Reuse it for the shared table bill.
- Existing Merchant acceptance is the inventory boundary for accepted dine-in orders; preserve stock and kitchen behavior at that boundary.

### Gaps to resolve

- Customer session lookup and additional-order routes currently bind access to a single `customer_phone`. Replace that as the authorization rule with membership in the active Dining Session.
- Dining session attach/claim logic currently rejects a different phone on an occupied table. Allow joining only by resolving the active table cycle from its QR and adding an authenticated member; do not expose a general “join by session ID” operation.
- Public QR claim currently has a path that can create/attach a session before Merchant acceptance. Change the QR role to join a cycle opened by POS. A scan must not activate a cashier hold or an available table.
- Current checkout can create a table hold after order placement and continue if hold creation fails. The QR-first table-cycle flow must open the Dining Session through the Dining authority before customers can order; it must not silently create an order detached from its assigned table cycle.
- `DiningTableService` has a 15-minute hold sweep that releases temporary holds. Keep that timer for its payment-hold purpose only; an open seated session persists until staff closes it.
- Existing security tests encode “only one customer phone per session.” Replace that narrow assumption with checks that another account cannot join by guessing an ID, while valid QR-bound members can join and submit attributed batches.
- Customer PWA checkout currently exposes a floor-plan table selection flow. In a QR-joined open session, show the current table and session and do not show a table picker. Keep any floor-plan flow only where the separate customer-started dine-in contract still explicitly requires it.

## 5. Phased implementation

### Phase 0 — Reconcile the business contract

Publish this decision as the proposed flow and reconcile the conflicting snapshots before implementation. In particular, update the current dine-in table/layout contract and its scenario matrix, the cashier pending-table contract, the additional-order contract, and payment allocation contract. Mark older Notion snapshots as superseded where they prescribe customer table selection or a single customer per session.

Record these recommended choices in the canonical contract:

- cashier opens the table cycle before QR guests can join;
- QR is a table locator for the current cycle, not an occupancy claim;
- many customer accounts can join one table cycle;
- one shared bill/order is default; optional check allocations support separate payment;
- staff explicitly closes/releases the table;
- eligible signup promotion is enforced by the existing promotion rules.

### Phase 1 — Dining table-cycle lifecycle

- Add or adapt the Dining service operation for POS to open a table cycle and explicitly close/release it.
- Reuse the existing operational `OCCUPIED` state with an active Dining Session if it expresses this lifecycle cleanly. Add a new state only if the current repository state machine cannot represent an opened table with no Commerce Order yet.
- Enforce one open session per table atomically. Opening an already occupied/blocked/reserved table must fail with a clear POS response.
- Keep payment `HELD` semantics and expiry separate from an open, seated table.
- Closing must be auditable and reject unsafe closure when accepted orders remain unpaid, subject to the agreed payment policy. A rejected/timed-out individual batch must not silently close the session.

### Phase 2 — Session membership and QR resolution

- Add session membership persistence keyed uniquely by `(dining_session_id, customer_id)`; preserve the session’s existing customer/phone fields as legacy or primary-contact metadata, not the membership gate.
- Add a Dining-owned operation to resolve the active cycle from authoritative branch/table QR identity and join the signed-in customer.
- Require normal account authentication for ordering; support guest signup through the existing identity flow before joining. Do not authorize membership from a client-supplied session ID alone.
- Make join repeat-safe. Confirm branch/tenant scope and current session state on every join and order submission.
- Retain a member attribution on every submitted batch for receipts, staff review, and support investigation.

### Phase 3 — One shared Commerce Order and order batches

- Bind one canonical Commerce Order to each open Dining Session. The first submitted order creates it atomically if it does not exist; parallel first submissions must not create duplicate parent Orders.
- Reuse `OrderAdditionService` for first and subsequent customer submissions where possible. Ensure the initial batch and later batches share consistent accept/reject, inventory, idempotency, pricing-revalidation, and audit behavior.
- Attribute each batch and item set to the submitting member and source channel. Do not replace the Order’s primary customer snapshot as the authorization mechanism.
- Ensure the server calculates shared subtotal, tax, fees, discounts, paid amount, and outstanding balance from canonical records. Clients submit item choices and quantities, not totals.
- Keep each accepted batch’s kitchen/print output incremental so earlier items are not re-fired.

### Phase 4 — POS and Merchant operations

- POS: expose Open Table / issue placard, current open-cycle state, shared bill, member-attributed batches, check/payment allocation, and Close/Release.
- Merchant App: show incoming batches with table/session and submitting customer label; allow accept/reject per batch. Show when a batch timeout occurs without implying the full table is closed.
- Ensure table status, queue state, accepted Order total, stock, and payment balances update from domain outcomes, not independent frontend flags.
- Provide staff an explicit way to reject an invalid/remote QR claim and release a table that was opened by mistake or has no diners.

### Phase 5 — Customer PWA

- On QR open, show restaurant/branch, table label, and that the diner has joined the active table session.
- Let each member browse and submit their own cart without changing the table.
- Show the current member’s submitted items and clear shared-bill totals. Do not expose other members’ contact or account details.
- Remove floor-plan selection from the active QR session path. If a scan finds no active session, give a clear “ask staff to open this table” state.
- Preserve normal cart/order behavior for pickup and delivery.

### Phase 6 — Promotion and payment integration

- Apply signup promotion through Promotion Engine server validation, with campaign eligibility and redemption idempotency. Repeat QR scans, signup retries, and payment retries must not issue duplicate rewards.
- Reuse canonical check/payment allocation for online payment and POS payments. Online payment callbacks must settle the correct allocation against the shared bill and update POS/PWA views.
- Define recovery for payment success arriving after table closure or a client timeout: keep the financial record authoritative, surface the reconciliation condition to staff, and never reopen/reassign the table implicitly.

### Phase 7 — Rollout and compatibility

- Use an additive migration for membership and session-to-order binding. Preserve historical Dining Sessions, Orders, payment allocations, and primary customer metadata.
- Backfill the current session customer as the first member where identity can be resolved; leave historical unknown identities intact rather than fabricating membership.
- Roll out backend lifecycle and authorization before PWA changes. Keep existing non-dine-in purchase paths unaffected.
- If a staged release needs a feature switch, scope it to this flow and remove it after adoption; do not build a general workflow framework.
- Provide a rollback path that disables QR joining while retaining additive schema and existing historical records.

## 6. Acceptance criteria

1. POS opens Table 4; Table 4 has one open Dining Session before any customer order exists.
2. Two or more distinct signed-in customers scan the same active table QR and join the same session.
3. A repeated scan by the same customer does not create duplicate membership.
4. Each member submits a different order; POS and Merchant see all batches under one canonical Commerce Order and the same table cycle.
5. Simultaneous first submissions create exactly one parent Order and preserve both batches.
6. Batch creator attribution is correct; a member cannot submit for a different member or access their contact/payment credentials.
7. Merchant can accept or reject individual batches. Only accepted items affect stock, payable total, and kitchen output. Rejecting/timing out one batch leaves the table cycle open.
8. Online payment and POS payment allocations update one shared outstanding balance. Repeated callbacks are idempotent, and total settlement cannot exceed amount due.
9. Payment completion leaves the table occupied until authorized staff closes/releases it.
10. A valid active table QR joins the current cycle; a QR scan on an available table cannot create/claim a session. A closed-cycle/stale request cannot attach to the next cycle.
11. Staff can reject a mistaken/no-show claim or release an empty table. No 15-minute payment-hold sweep releases an open table cycle.
12. Eligible signup promotion is applied once; ineligible, duplicate, or replayed claims do not mint additional reward.
13. Customer PWA displays the table and shared bill for the QR flow without offering a second table selection.
14. Existing pickup/delivery and non-group order behavior remains unchanged.

## 7. Fraud and operational failure cases

| Case | Expected handling |
|---|---|
| QR photo is shared to someone elsewhere | They can only request/join the currently open table cycle. Staff may reject their order or close/release a mistakenly opened table. No GPS requirement. |
| Several people at one table scan | They become members of one session and submit separate attributed batches into the shared bill. |
| Customer guesses or replays a session ID | Membership endpoint is not session-ID-authorized; current table QR resolution and authenticated identity are required. |
| Old browser submits after cashier closes table | Server rejects because the session cycle is closed, even if the table number is reused. |
| Two first orders arrive concurrently | Transaction/unique binding returns one canonical parent Order and preserves both idempotent batches. |
| Merchant rejects one person’s batch | That batch is rejected; other accepted batches and the table cycle remain intact. |
| Table is opened but no diner arrives | Staff rejects/release/closes it from POS; this is an operational decision, not an automatic customer timer. |
| Duplicate payment callback or retry | Payment idempotency prevents duplicate allocation/settlement. |
| Payment completes after staff closes table | Keep settlement; flag for reconciliation without reopening the table. |
| Signup promo claim is replayed | Promotion Engine’s eligibility/redemption idempotency prevents duplicate reward. |

## 8. Explicit non-goals

- Customer-selected or multi-table checkout in the QR table-cycle flow.
- Multiple independent Commerce Orders for each person at one table.
- A shared editable cart where every member can change another member’s items.
- GPS, one-time passwords, rotating QR codes, or hardware presence checks.
- Customer-created occupancy on an available table by scanning a static QR.
- Reservations, table transfer by customer, or redesign of the floor-plan editor.
- Replacing the POS, Merchant App, inventory, payment provider, or kitchen architecture.
- Supporting remote dine-in ordering while the branch is offline.

## 9. Source references and known contradictions

This plan is based on the discussed cashier-opened QR cycle and the repository’s existing domain seams. The snapshots below contain rules that conflict with this proposal; they must be reconciled before implementation, rather than silently treated as jointly true:

- [Dine-in Table & Branch Layout Contract](../XENTRA_DINE_IN_TABLE_LAYOUT_CONTRACT.md) currently says customer chooses one table, QR does not start an active session, Merchant acceptance starts the session, and payment holds can expire after 15 minutes.
- [Dining Table Reservation Domain Contract](dining-table-reservation-domain-contract-v1.md) defines table/session/hold authority and current lifecycle semantics.
- [POS Cashier Pending Dine-in Table Reservation](pos-cashier-pending-dine-in-table-reservation-v1.md) defines cashier holds and acceptance behavior.
- [Dine-in Additional Order Batch Contract](dine-in-additional-order-batch-contract-v1.md) defines one table/session/order with attributed additional batches.
- [POS Split Bill Payment Allocation](pos-split-bill-payment-allocation-v1.md) defines payment/check allocation.
- [Notion Dine-in Table Layout snapshot](../notion/03-business-flow-dine-in-table-layout.md) is an older snapshot and also describes customer-side table selection.

Relevant implementation and regression evidence to inspect during delivery:

- `server/routes/customer.js` — current phone-bound session lookup, additions, and QR claim paths.
- `domains/dining/services/DiningTableService.js` — active session attachment, occupied-table validation, and temporary hold expiry.
- `server/routes/operational-orders.js` — Merchant acceptance boundary for dine-in.
- `domains/commerce/services/OrderAdditionService.js` — reusable canonical-order batch behavior.
- `apps/customer-pwa/assets/js/pages/checkout.js` — current floor-plan checkout selection and active-order path.
- `tests/dineInAdditionalOrderBatch.test.js`, `tests/domains/dineInMerchantAcceptanceBaseline.test.js`, `tests/domains/dineInSecurityP0.test.js`, `tests/core/dineInOpenBill.test.js`, `tests/domains/dineInTableFloorPlan.test.js`, and relevant POS/payment allocation tests.

## 10. Stop condition

Stop when one POS-opened table cycle supports multiple PWA members, attributed batches, Merchant acceptance/rejection, a single authoritative shared bill with safe payment allocation, and explicit staff close/release—verified across the customer, merchant, and POS surfaces. Do not expand this delivery into reservations, multi-table selection, or a new group-order platform.

## 11. Implementation progress

- **Implemented in this change:** POS table-cycle open endpoint and action; Dining-owned atomic table/session transition; additive session-member persistence; QR join for authenticated customers; member-aware open-bill lookup and additional-order authorization; checkout authorization against the active session; serialized first Order binding with a concurrent first submission routed into an Order Addition batch; Customer PWA QR/session state; release path preserves Dining close guards; the shared-bill API and PWA show the signed-in customer's own submitted items and status alongside the full table balance, without exposing the primary customer's name.
- **Implemented in the payment follow-up:** original online payment callbacks for a shared dine-in session settle against their immutable gateway amount even if the shared bill has since grown; POS can collect the remaining balance in cash; the cumulative payment summary is marked `multiple` and included in settlement reporting; POS can create online payment intents per check, reserve pending amounts, receive gateway callbacks into the check ledger, and show pending versus settled amounts.
- **Implemented in the latest follow-up:** pending per-check intents are queried from the gateway after two minutes and reconciled through the same validated callback path; a confirmed gateway 404 cancels the intent and releases its reserved balance without cancelling the Order; payment reporting reads settled check contributions per provider while avoiding duplicate seeded and cumulative summary rows.
- **Fixed during final verification:** terminal Order transitions now release dine-in table holds through `DiningTableService`, including the table's operational state. Previously the state machine marked the hold row cancelled first, causing the service to find no active hold and leave the table stuck as `held` after reject/cancel/timeout.
- **Verification:** focused dine-in, Merchant acceptance, customer shared bill, POS, payment, and reporting suites pass (90 tests); the dine-in security P0 suite also passed in the preceding run. Mocked gateway create/callback/reconciliation, duplicate callback, expired gateway intent, check allocation seeding, and provider reporting are covered. Live Midtrans/DOKU sandbox execution remains unverified because this environment has no sandbox credentials.
- **Verified in repository:** Merchant's pending batch detail includes the submitter name, submitted items and per-batch accept/reject actions (`server/routes/admin-orders.js`, `apps/merchant-app/assets/js/orders.js`). Customer PWA shared-bill data includes the full table balance and the signed-in member's own submissions (`server/routes/customer.js`, `apps/customer-pwa/assets/js/pages/checkout.js`).
- **Reconciled:** the older Notion table-layout snapshot is explicitly marked superseded for cashier-opened QR cycles; the canonical contract addendum remains authoritative for that flow.
- **Implemented promo attribution:** additional batches persist the submitter phone, revalidate promotion eligibility as that member when Merchant accepts the batch, and record redemption in the additive `promotion_redemption_members` ledger. The legacy per-order ledger remains populated as an aggregate for compatibility; member-level claim limits, promotion redemption reporting, and duplicate protection use the member ledger. Historical redemptions are backfilled idempotently on startup. The data migration is additive; rollback should retain both ledgers and disable the new reader/writer together rather than drop member history.
- **Implemented in the latest Customer PWA / POS UX follow-up:** a table QR retained through signup/login is retried after authentication; after that attempt its pending token is consumed, and if no active table cycle exists the customer is asked to scan again after staff opens one. Checkout clears a cached table when its previously joined session has ended and blocks dine-in submission through that closed QR cycle. For an additional batch on an existing shared Order, checkout now labels the amount as the value of the additional order, hides payment-method choices, and explains that the batch enters the shared bill after Merchant acceptance and is paid through the cashier, with per-menu splitting available there. The table summary distinguishes the overall table balance from the current member's own submissions.
- **Implemented in POS attribution follow-up:** the cashier's existing Order detail can list Customer PWA batches by submitter display name, items, subtotal, Merchant status, and rejection reason. The POS response is projected to these fields and does not include the submitter phone number. Merchant detail continues to show all member batches, including accepted and rejected history, without flattening those items into duplicate rows.
- **Lifecycle behavior confirmed in code:** session completion/release is guarded by `DiningTableService.completeDiningSession`; pending or unaccepted orders and unpaid accepted orders prevent release. Table QR tokens are permanent locators by design, so a later scan resolves only the currently open table cycle; an old in-app session ID is not sufficient to join a closed cycle.
- **Implemented in the backend hardening follow-up:** all Customer PWA dine-in checkout now requires a cashier-opened Dining Session and verified `dining_session_members` membership. Customer session lookup, batch submission, checkout validation, and Dining domain validation no longer authorize by `customer_phone`; public join accepts only the opaque table QR token, not a guessable table number/alias. Existing active-session members are backfilled idempotently from authenticated `orders.customer_id` references. Reused client transaction IDs are rejected when they belong to another customer.
- **Implemented in lifecycle safeguards:** Order completion is blocked while any addition batch is awaiting Merchant action; terminal cancellation/rejection/timeout of the parent Order cancels its pending addition batches with an audit reason. `OrderAdditionService` rechecks that the Dining Session is still active when submitting or deciding a batch, including inside the write transaction. `completeDiningSession` refuses release while an addition is pending, and direct table release refuses to clear an active table hold tied to a non-terminal or unpaid completed Order. The shared-bill response no longer chooses a cancelled Order as the active Order.
- **Order-cycle edge handling:** an active table session can receive additional batches while its canonical Order is `completed`, until staff closes the session. Rejected/cancelled/timed-out/expired parent Orders are excluded from the bill and active-order lookup; after a terminal non-payable Order, a replacement initial Order may bind to that still-open session.
- **Backend verification status:** syntax checks passed for touched backend and app JavaScript, and `git diff --check` passed. Regression and runtime integration tests are intentionally deferred until implementation work is complete, per user direction. The additive membership backfill has been reviewed in source order but has not been run against the deployment database.
- **Additional backend lifecycle hardening:** parent dine-in Orders cannot transition to `completed` while any Customer PWA batch is pending. If the parent Order is cancelled, rejected, or times out, pending batches transition to `cancelled` with an audit reason so no Merchant action remains stranded. POS direct release also rejects active holds tied to a non-terminal or unpaid completed Order.
- **Verification for the latest UX follow-up:** `node --check` passed for the touched PWA, POS, and Order Addition Service JavaScript, and `git diff --check` passed. No browser-based cross-app walkthrough or tests were run for this follow-up. In particular, the Customer PWA does not initiate payment for later addition batches; current behavior intentionally routes that payment through POS/cashier split allocation after Merchant acceptance.
- **UI/UX audit and fixes (2026-10-31):** POS table QR print no longer displays the legacy human-readable `meja<number>` fallback, which the QR claim API intentionally rejects; the printed placard now tells guests to scan to join the table session and order. Customer PWA messages for an invalid/inactive QR now direct guests to ask staff to open the table or provide a valid QR instead of suggesting manual table selection. Merchant pending-addition indicators now label the value as a count of submitted batches/kiriman, matching the API's `pending_additions_count` contract rather than incorrectly calling it an item count. Static JavaScript syntax and whitespace checks passed; no tests or browser walkthrough were run per the current instruction.
- **Fulfillment choice isolation (2026-10-31):** a QR-joined customer is no longer forced to keep Dine-in selected. The fulfillment sheet preserves the currently selected type and allows Delivery, Pick-up, and Reservation while the dining session remains joined. Only a cart submitted with Dine-in and an active shared bill is sent as an Order Addition batch; other fulfillment types continue through normal checkout without a `dining_session_id`. Returning to Dine-in reuses the active session/table. For a locked table, the Dine-in sheet shows a fixed active-session/table summary and skips the floor-plan request; the floor plan remains for non-QR legacy table selection. `node --check` and `git diff --check` passed for the touched Customer PWA file; no tests were run per instruction.
- **Backend flow audit — unresolved findings (2026-10-31):** this is a source review, not a test result. The items below are recorded as gaps to resolve before calling the dine-in lifecycle complete. No code was changed for these findings in this audit.
  1. **Table block/unblock can detach operational state from an active session (high priority).** Scenario: staff blocks an occupied QR table, then unblocks it. `DiningTableService.setTableBlockedState` writes `blocked` / `available` through `updateTableOperationalState`; that repository update does not change `current_session_id`. QR join and Customer PWA dine-in validation require table state `occupied`, so guests can no longer join or submit while blocked. After unblock, the table appears `available` while its prior Dining Session and session-table mapping remain active; `openTableSession` checks the operational state and can attempt to create another active cycle. **Recommended resolution:** reject block/unblock while a table has an active session, or provide one atomic staff operation that safely closes/reassigns the active cycle before changing availability. **Evidence:** `domains/dining/services/DiningTableService.js` (`setTableBlockedState`, `joinActiveTableSession`, `openTableSession`); `core/data/repositories/DiningTableRepository.js` (`updateTableOperationalState`).
  2. **Order-cancellation cleanup can bypass all Dining close guards (high priority).** Scenario: an Order cancellation is followed by `completeDiningSession` failing because an order, payment, or pending batch still blocks closure. The cancellation route catches every error and directly updates `dining_sessions.status = 'completed'`. This bypasses the Dining service guards and does not release/update the associated `branch_table_states` rows, so the session and table can disagree; an outstanding bill may also be left attached to a completed session. **Recommended resolution:** remove the direct SQL fallback. Preserve the active session/table when guarded close fails, and report the cleanup failure for staff resolution. **Evidence:** `server/routes/operational-orders.js` cancellation cleanup around `completeDiningSession`; `domains/dining/services/DiningTableService.js` (`completeDiningSession`).
  3. **[RESOLVED 2026-11-01] Table Floor Plan Re-architected: Moved to Reservation with `[ ] Pilih meja` toggle; Dine-in simplified to Cashier QR scan.** Rather than discarding the interactive floor plan, the table layout is transitioned to the **Reservation** checkout flow. When booking a reservation, customers have an optional `[ ] Pilih meja` checkbox toggle. When checked (active / green `#00a637`), the interactive branch layout opens beneath, allowing the customer to choose their preferred table in advance. The chosen table is validated and saved into `orders.table_number` (with `selection_mode = 'CUSTOMER_SELECTED'`). When unchecked, table assignment is left `NULL` (`UNASSIGNED`) for branch staff to allocate upon arrival. In Dine-In, the unauthorizable floor-plan dead end is replaced with a clear QR scan prompt (`Scan QR Meja`), reinforcing the cashier-opened session requirement.
  4. **[RESOLVED 2026-11-01] `active_table` status recognized by session-close guard.** `completeDiningSession` in `DiningTableService` now includes `active_table` in `acceptedStatuses`. Upon session closure, any settled orders in `active_table` or `ready` are atomically marked `completed`. Unaccepted orders and pending addition batches continue to strictly block closure as safety invariants.
- **Focused edge-case matrix for the deferred verification phase:** (a) block/unblock an occupied table and attempt QR join, addition, release, and reopen; (b) cancel an Order while another session Order is unpaid or an addition is pending, then verify guards and table/session state remain consistent; (c) customer without a QR tries the floor-plan path and receives a usable next step rather than a checkout dead end; (d) reservation check-in with a positive total is settled and closed; (e) two members submit their first order concurrently and one request is replayed after a lost response; (f) Merchant accepts/rejects a batch while POS closes the session; (g) payment callback races with a new accepted addition and session close; (h) customer switches from Dine-in to Delivery/Pick-up/Reservation, reloads checkout, and later returns to the still-active table session.
- **Known accepted QR-sharing behavior:** permanent table QR identifies the table, not a unique seating party or device. A photo of the QR may be reused to join whichever cycle staff currently opened. The approved contract deliberately relies on staff operations and Merchant order review rather than GPS, rotating QR, or a physical-presence challenge; this remains a documented operational risk, not an unimplemented fraud control.
- **Remaining UI/runtime validation:** browser walkthrough is still needed for: POS opening a table and printing/scanning its QR; signup/login continuation; two members submitting and seeing their own items plus shared balance; Merchant batch review; POS payment allocation and guarded close. The old customer-started floor-plan UI is still present, but the backend now requires a cashier-opened, QR-joined session; resolve this UI/backend mismatch before feature completion. The cashier-opened QR path must remain bound to its joined session and cannot use manual table selection as a QR recovery path.
- **Still required before feature completion:** run the focused regression suites for multi-member promotion eligibility, duplicate/replay callbacks, cancellations, and existing promotion behavior; exercise POS/PWA/Merchant together in a running environment; review the additive migration against the deployment database. These checks are not established by syntax validation alone.
- This progress note is not a claim that all acceptance criteria in Section 6 have passed.
