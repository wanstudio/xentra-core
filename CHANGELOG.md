## [Unreleased] - 2026-09-09
### Locked workforce account hierarchy & credential security contract
- Locked client workforce account authority: **Owner** may manage permitted Manager/Cashier accounts within authorized tenant/brand scope; **Manager** may manage Cashier accounts only within current Branch scope; **Cashier** has no workforce-management authority and may manage only its own credentials where permitted.
- Locked password separation: self-service password change requires current credential proof; administrative reset uses a one-time recovery/reset mechanism and never exposes or requires the target's existing/permanent password.
- Locked security invariants: no self-escalation, no cross-scope management, role ceiling, current authorization as source of truth for sensitive mutations, last-owner protection, disabled-account access revocation, session/token revocation or rotation after credential/security mutations, append-oriented audit without secrets, CSRF/rate limiting where applicable, and step-up/re-auth for high-risk actions.
- Locked workforce lifecycle: normal path is Create → Active → Disable/Enable → Historical retention; hard delete is not a normal dashboard operation.
- Locked mandatory authorization order for workforce mutations: authenticate → current identity/RBAC → tenant/brand/branch scope → target relationship → action/role/scope assignability → security invariants → atomic mutation → session/token handling → audit.
- Git snapshot `docs/notion/02-domain-blueprint.md` updated to mirror the locked contract recorded in Notion.

## [Unreleased] - 2026-09-04
### Post-R5 integrity audit — Payment ≠ Branch Acceptance (CHECK-2 / CHECK-1 / CHECK-4)
- **Payment settlement no longer confirms orders (CHECK-2).** Previously both
  Midtrans settlement and cash settlement set `orders.status='confirmed'`
  directly from `'pending'`, letting payment success silently become Branch
  operational acceptance with no ACCEPT decision (violating the locked
  `Payment → Branch ACCEPT → Fulfillment` boundary). Settlement is now a
  PAYMENT-only transition: the order stays `'pending'`
  (AWAITING_BRANCH_ACCEPTANCE) and the ONLY path to `'confirmed'` is
  `POST /orders/:id/branch-acceptance`. Late settlement on a terminal order
  (rejected/timeout/cancelled/exception) still routes to `fulfillment_exception`
  + `[Perlu Refund]` with ZERO stock/promo side effects (existing R11 behavior).
- **Cash lifecycle aligned with the locked roadmap.** Customer-app cash orders
  start `'pending'` (awaiting acceptance); POS-cashier (branch-created) cash
  orders start `'confirmed'`. `CashSettlementService` no longer mutates order
  status and rejects settlement of an unaccepted order (`ORDER_NOT_ACCEPTED`),
  so a cashier can never settle (and thereby accept) an order the branch has
  not accepted — settlement stays a payment mutation.
- **Acceptance actor boundary (CHECK-1/CHECK-4).** The generic kitchen PATCH no
  longer exposes `'confirmed'` (ACCEPT) or `'cancelled'` (generic post-accept
  cancel) to any role. ACCEPT is exclusively the branch-acceptance endpoint
  (audited, idempotent); after-ACCEPT cancellation awaits the explicit R8
  exception flow. Merchant dashboard “Ubah Status” for `pending` orders now
  calls `/orders/:id/branch-acceptance` (and the broken `delivered` mapping was
  fixed to `out_for_delivery`).
- Tests: +3 regressions (payment suite: settlement keeps AWAITING + only ACCEPT
  confirms, settle-after-accept untouched; API: manager kitchen-PATCH
  `confirmed`/`cancelled` → 403; API: midtrans settlement never bypasses
  ACCEPT). Full suite 225/225.

### R10/R11/R12 — Commerce integrity audit (defects fixed)
- **R11 TOCTOU guard**: `OrderStateMachine.transition` now accepts an optional
  `expected_current_status` re-validated INSIDE the transaction. The R7
  customer-cancel endpoint passes `'pending'`, closing a real race: customer
  cancel racing branch ACCEPT could previously cancel an ACCEPTED order
  (machine allowed `confirmed → cancelled` for managers, and the endpoint's
  pre-check ran outside the lock). Loser now fails `[STATE_CHANGED]`, order
  stays ACCEPTED, no audit row. (+2 machine tests)
- **R11 late-settlement guard**: Midtrans settlement previously force-`UPDATE`
  `orders.status='confirmed'` unconditionally — a settlement arriving after