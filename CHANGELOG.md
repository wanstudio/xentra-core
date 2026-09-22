## [Unreleased] - 2026-09-22
### Merchant App frontend extraction + test runtime alignment
- **Merchant App extracted as a standalone frontend entry point.** `apps/merchant-app/` serves the Branch Manager operating surface (Hari Ini, Order Center, Meja, Menu, Stok, Promo, Staff, Jam Operasional, Laporan) as its own document/script, booting independently at `/merchant-app`. Owner and Platform surfaces remain in `apps/merchant-dashboard`; no backend, domain, RBAC or API contract changed.
- **Shared merchant frontend layer consolidated.** `apps/merchant-shared/` now owns the auth/session guards, the branch-catalog/override/category helpers, the shared surface stylesheet and the reusable widgets, consumed by both surfaces instead of duplicated. `apps/merchant-dashboard/index.html` links the shared stylesheet from `/merchant-shared`.
- **Role-appropriate routing.** Branch Manager sessions that reach `/dashboard` are redirected to `/merchant-app`; Core continues to enforce authorization for every API call. `/dashboard` routing is otherwise unchanged and `merchant-dashboard` is retained.
- **CI now tests on the production runtime (Node 24).** The test jobs previously ran Node 20, where `node:sqlite` is unavailable and the database layer falls back to `sql.js` — an engine production never uses. Production runs Node 24 (`docs/DEPLOY_VPS.md`; `deploy-vps.yml` activates Node 24).
- **Test suite repaired and no longer hangs.** `npm test` gains `--test-force-exit`, demo fixtures are seeded explicitly per suite (schema initialization intentionally provisions only the essential tenant), customer session fixtures carry `organization_id`, and checkout test stubs/fixtures were completed. Full suite: **381 → 52 failures** on Node 24.
- **Known infrastructure issue (reported, not changed):** `server/database/db.js:97` checks for the error string `'Cannot find module'` while Node 20 raises `'No such built-in module: node:sqlite'`. In `NODE_ENV=production` this makes the `sql.js` fallback terminate the process instead of falling back. Not changed here because it alters production runtime behaviour.
- Full audit, evidence and remaining failure classification: `docs/TEST_SUITE_RUNTIME_AND_CI_AUDIT.md`.

### Resend email is now production-only (hard guard)
- **Fixed an environment hole in email provider selection.** `EmailProvider` resolved `EMAIL_PROVIDER` before `NODE_ENV`, so an environment exporting `EMAIL_PROVIDER=resend` (local `.env`, shell profile, CI variable) selected the Resend transport even under `NODE_ENV=test`. Suites that drive the HTTP API use the module-level `defaultEmailProvider`, so they could perform real deliveries and consume Resend quota.
- **Two-layer guard.** Real transports (`resend`) are demoted to the in-memory provider whenever `NODE_ENV !== 'production'`; and a live `ResendEmailAdapter` can no longer be constructed outside production — `require('resend')` is unreachable unless `NODE_ENV=production` or a client is injected explicitly for tests. Unknown provider names still fail explicitly.
- **Production behaviour unchanged.** `NODE_ENV=production` still selects Resend.
- **Proof:** new `tests/core/emailEnvironmentGuard.test.js`; email-flow suites run with `EMAIL_PROVIDER=resend` + the real key exported and a tripwire preload report **65/65 passing with zero Resend SDK loads**. Adapter contract suite remains green.
- Evidence and addendum: `docs/audit-resend-email-quota.md`.

## [Unreleased] - 2026-09-15
### Locked Owner ↔ Branch Manager dashboard boundary
- Locked the cross-dashboard responsibility model: **Owner = CONFIGURE + GOVERN + OBSERVE**, **Branch Manager = OPERATE + OBSERVE**, and **Xentra-Core = AUTHENTICATE + AUTHORIZE + ENFORCE + PERSIST + AUDIT**.
- Owner Dashboard remains the business control center for master catalog, branch configuration, default operating policy, floor-plan configuration, campaign governance, workforce authority, cross-branch reporting, branch health visibility, and exceptional governance overrides.
- Branch Manager remains the daily operational control surface for one Branch: operational open/close, online-order pause, daily schedule exceptions, table state, branch product availability, branch stock, approved branch promo activation, branch order queue/acceptance, branch-scoped staff, and daily operational reporting.
- Locked the boundary that normal daily mutations must not be duplicated into Owner Dashboard merely because Owner can observe the same entity. Owner may have explicit exceptional/emergency overrides only where separately authorized and audited.
- Locked the catalog distinction: Master Product and durable Branch Menu configuration belong to Owner/Brand authority; `branch_products.is_available` remains the Branch Manager's branch-scoped daily availability authority.
- Locked the table distinction: Owner/Admin configures physical floor-plan geometry; Branch Manager operates daily table state. Core must enforce reservation/table availability server-side and protect race-sensitive mutations transactionally.
- Locked the operating-hours distinction: Owner defines default/permanent schedule; Branch Manager handles branch-scoped daily/special operational exceptions; Core resolves the effective state.
- Locked the promotion distinction: Owner/Brand defines campaign policy; Branch Manager may activate/deactivate only approved branch-scoped promotions within explicit permission.
- Locked the order distinction: Owner Orders is primarily cross-branch business/history/investigation; Branch Manager Orders is the operational queue. Branch Acceptance remains a dedicated authorization boundary and payment settlement must not silently become acceptance.
- Added authoritative contract: `docs/OWNER_BRANCH_MANAGER_BOUNDARY.md`.

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
- **Acceptance actor boundary (CHECK-1/CHECK-4).** The generic kitchen PATCH
  no longer exposes `'confirmed'` (ACCEPT) or `'cancelled'` (generic post-accept
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
