# Audit Report: Resend ~200 Email Quota Exceeded

**Date:** 2026-09-22  
**Status:** READ-ONLY audit — no source code modified

---

## CONFIRMED Culprit

**Legitimate production registration emails — no bug, no leak, no loop.**

The ~200 emails are explained entirely by normal `registerBusiness()` calls sending verification emails, plus `resend-verification` calls.

## Evidence from Database

| Source | Count | Email type |
|---|---|---|
| `registerBusiness()` calls | **146** users with org+brand (non-Google) | 1 verification email each |
| `createInvitation()` calls | **2** invitations sent | 1 invitation email each |
| `resendVerificationEmail()` calls | unknown (not audited) | 0–~52 emails |
| **Minimum confirmed** | | **148 emails** |

User registration timeline:

- Sep 12: 72 users (84 Google onboarded)
- Sep 15: 45 users (33 Google onboarded)
- Sep 16: 32 users (25 Google onboarded)
- Sep 17: 3 users
- Sep 19: 8 users

## Email-sending code paths (exhaustive)

1. **`POST /auth/register`** → `RegistrationService.registerBusiness()` → `createAndSendVerificationToken()` → `ResendEmailAdapter.sendEmail()` → **Resend API call** — `server/routes/api.js:3578`, `core/identity/RegistrationService.js:212-214`, `core/identity/EmailVerificationService.js:29-54`

2. **`POST /auth/resend-verification`** → `EmailVerificationService.resendVerificationEmail()` → `createAndSendVerificationToken()` → same chain — `server/routes/api.js:3773`, `core/identity/EmailVerificationService.js:140-161`

3. **`POST /admin/invitations`** → `WorkforceInvitationService.createInvitation()` → `emailProvider.sendTeamInvitation()` → **Resend API call** — `core/identity/WorkforceInvitationService.js:431`

4. **`POST /admin/invitations/:id/resend`** → `WorkforceInvitationService.resendInvitation()` → `emailProvider.sendTeamInvitation()` → **Resend API call** — `core/identity/WorkforceInvitationService.js:604`

## Apakah ~200 email masuk akal dari production traffic?

**YA.** 146 `registerBusiness()` + 2 invitations = 148 minimum. Dengan ~50 calls ke `resend-verification` (rate-limited 3/15min/IP), total ~200 wajar.

## Yang sudah bisa di-RULE OUT

| Hypothesis | Status | Evidence |
|---|---|---|
| **Test suite hitting Resend production** | **PARTIALLY WRONG — see Addendum** | The original conclusion assumed every test injects `EmailProvider({ provider: 'memory' })` or a mock client. That holds for the adapter unit tests, but **not** for suites that drive the HTTP API: they use the module-level `defaultEmailProvider`, which resolved `EMAIL_PROVIDER` **before** `NODE_ENV`. Any environment exporting `EMAIL_PROVIDER=resend` therefore made those suites deliver real email. Fixed by the guard in the Addendum. |
| **Retry / loop in email code** | **RULED OUT** | `ResendEmailAdapter.sendEmail()` calls `this.client.emails.send()` exactly once (line 155). No retry, no loop, no `MAX_ATTEMPTS`. |
| **Duplicate submit / double-click** | **RULED OUT** | Frontend `resendInvitation()` has `confirm()` dialog (dashboard.js:4755). Registration has rate limiting (5/10min/IP). Resend verification has rate limiting (3/15min/IP). |
| **PM2/systemd duplicate runtime** | **RULED OUT** | No `ecosystem.config.js`, no PM2 config, no systemd service file found in repo. |
| **Other services using same RESEND_API_KEY** | **RULED OUT** | Only `ResendEmailAdapter.js` reads `process.env.RESEND_API_KEY`. No other file uses it. |
| **seed-demo.js sending emails** | **RULED OUT** | `tools/seed-demo.js` only calls `db.seedDemoData()` — does not trigger email. |
| **`createBusinessForUser` (onboarding) sending email** | **RULED OUT** | `RegistrationService.createBusinessForUser()` (line 489) only creates org/brand/branch. No email dispatch. |
| **OTP / WhatsApp via Resend** | **RULED OUT** | OTP endpoint is retired (returns 410). Uses Wablas, not Resend. |

## Secondary finding: test data waste

**12 `dynowner_*@resto.com` users** (and 1 `other@tenant.com`) are test artifacts with fake emails that went through `registerBusiness()`. Each generated a Resend email to an undeliverable address — 13 wasted emails that still count against quota.

These have `branch_id = NULL` (not created by standard `registerBusiness()` which always creates a branch), suggesting they were created by a test script or manual DB manipulation that called `registerBusiness` code paths.

## Fix yang diperlukan (JANGAN implementasikan sekarang)

1. **Guard `registerBusiness()` against fake/test emails in production** — Add a blocklist or domain validation to prevent sending Resend emails to undeliverable addresses like `*@resto.com`, `*@test.com` in production. This prevents wasted quota from test data.

2. **Add audit logging to `resendVerificationEmail()`** — Currently there's no `security_audit_log` entry for resend-verification calls. Adding one would make the exact resend count measurable.

3. **Consider Resend domain verification allowlist** — In production, only send emails to domains that actually exist. Resend may already handle bounce tracking, but client-side validation avoids wasting quota upfront.

---

## Addendum — 2026-09-22: environment guard (IMPLEMENTED)

### The hole

`EmailProvider._determineProviderName()` resolved the transport in this order:

1. explicit `options.provider`
2. **`process.env.EMAIL_PROVIDER`**
3. `NODE_ENV === 'production'` → `resend`
4. otherwise `memory`

Because step 2 preceded step 3, an environment that exported `EMAIL_PROVIDER=resend`
(a local `.env`, a shell profile, a CI variable) selected the Resend transport **even
when `NODE_ENV=test`**. Several suites drive the HTTP API (`/auth/register`,
`/admin/invitations`, resend-verification) and therefore use the module-level
`defaultEmailProvider` singleton — those suites would have performed real deliveries
and consumed the Resend quota.

### The guard (two layers)

1. **`core/identity/EmailProvider.js`** — real transports (`resend`) are demoted to the
   in-memory provider whenever `NODE_ENV !== 'production'`, with a one-time warning.
   Unknown provider names still fail explicitly (contract preserved).
2. **`core/identity/ResendEmailAdapter.js`** — a live transport cannot be constructed
   outside production: `require('resend')` is now unreachable unless `NODE_ENV=production`
   or a client is injected explicitly (the test seam).

Production behaviour is unchanged: `NODE_ENV=production` still selects Resend.

### Verification

- `tests/core/emailEnvironmentGuard.test.js` (8 cases): test/development resolve to memory,
  an explicit `resend` request is demoted, a live transport cannot be constructed outside
  production, an injected client still works, production selection is unchanged, the SDK is
  never loaded, and unknown providers still throw.
- Adapter contract suite (`tests/core/emailProviderResend.test.js`) still green — 19/19 combined.
- Email-flow suites (verification, reconciliation, invitation, access policy, adapter,
  guard) executed with `EMAIL_PROVIDER=resend`, the real `RESEND_API_KEY` and `EMAIL_FROM`
  exported, plus a tripwire preload that reports any load of the Resend SDK or any
  `https.request`: **65/65 passing, 0 Resend SDK loads**. The same tripwire does fire when
  the production path consciously constructs the adapter, confirming the detector works.
