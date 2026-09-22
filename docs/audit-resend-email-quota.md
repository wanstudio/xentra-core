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
| **Test suite hitting Resend production** | **RULED OUT** | All tests use `EmailProvider({ provider: 'memory' })` or inject `mockClient`. `emailProviderResend.test.js:117` uses `'re_mock_test_key'`. No test file creates `ResendEmailAdapter` without mock. |
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
