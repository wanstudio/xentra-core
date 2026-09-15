# Locked Decision — Transactional Email & Workforce Invitation v1

**Status:** LOCKED — architecture/product contract for implementation  
**Decision date:** 2026-09-15

## 1. Purpose

Define the canonical email-delivery boundary and workforce invitation lifecycle required for Xentra Owner → Manager/Staff onboarding without creating a second identity system or coupling business logic directly to an email vendor.

This document is subordinate to locked business decisions and `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`.

## 2. Current implementation audit

The current `main` branch already contains useful identity/email foundations:

- `EmailProvider` abstraction exists under `core/identity/EmailProvider.js`.
- `EmailVerificationService` already generates cryptographically secure verification tokens, stores only token hashes, invalidates prior active tokens, enforces expiry, consumes tokens atomically, and supports safe resend behavior.
- Google provider identities are linked by immutable provider subject (`sub`) through `user_auth_providers`; email is not the provider identity key.
- `WorkforceService` already contains User lifecycle, role/scope fields, password hashing, password reset, and workforce authorization logic.
- `security_audit_log` exists and is already used for identity/security events.

However, production delivery is not implemented yet. The current `EmailProvider` has no real outbound SMTP/API transport and the production-provider branch is effectively a no-op. The current workforce `createUser` path also requires a password and immediately creates an active/verified user, so it cannot be reused unchanged for invitation acceptance.

Therefore the correct implementation is an extension/reconciliation, not a rewrite of identity/email foundations.

## 3. Transactional Email architecture

Xentra uses a provider-agnostic email boundary:

```text
Domain / Identity / Workforce workflow
                ↓
        Xentra Email Service
                ↓
         Email Provider API
                ↓
        Resend adapter (v1)
                ↓
       Resend / xentra.cloud
```

### Locked provider decision

**Resend is the current production transactional-email provider for Xentra v1.**

Provider coupling must remain isolated behind the existing `EmailProvider` abstraction. Domain services must not import or call the Resend SDK/API directly.

The provider is infrastructure/transport, not identity authority, RBAC authority, business authority, or source of truth.

### Environment / secret boundary

Production credentials are server-side secrets only. They must never be committed, logged, returned by APIs, exposed to browser code, or stored in business configuration.

Expected runtime configuration is conceptually:

```text
EMAIL_PROVIDER=resend
RESEND_API_KEY=<secret>
EMAIL_FROM=<verified sender on xentra.cloud>
```

Exact secret storage mechanism follows the deployment environment.

### Sender identity

Use a verified sender on `xentra.cloud`, initially `noreply@xentra.cloud` unless a different verified sender is explicitly selected. Receiving/inbound email is not part of v1.

## 4. Email message boundary

Transactional email is a delivery capability, not a business entity.

Initial supported message types:

- `EMAIL_VERIFICATION`
- `PASSWORD_RESET`
- `TEAM_INVITATION`
- `SECURITY_NOTIFICATION`

Future message types may reuse the same service/provider boundary without creating another email system.

Every send request should carry normalized message intent such as:

```text
message_type
recipient
subject/template identity
rendered variables or template data
correlation/context metadata when available
```

Provider-specific response data may be retained as transport evidence, but provider message IDs must not become business identifiers.

## 5. Workforce invitation is distinct from email verification

**Invitation ≠ email verification.**

Email verification proves control/verification of an email address. An invitation proves that an authorized organization actor offered a specific role/scope relationship to a recipient.

Do not reuse `email_verification_tokens` as workforce invitations.

## 6. Canonical invitation model

A `Workforce Invitation` is a Core/Identity workforce onboarding record. It must preserve the intended relationship before a User account is activated.

Conceptual fields:

```text
id
organization_id
brand_id
branch_id (nullable only when role/scope permits broader scope)
email
role
invited_by_user_id
status
 token_hash
expires_at
accepted_at
revoked_at
created_at
updated_at
```

The implementation must use the canonical User/Role/Scope model rather than creating a separate account type.

The exact persistence table name is an implementation detail, but it must not be confused with `users` or `email_verification_tokens`.

## 7. Invitation lifecycle

Canonical lifecycle:

```text
PENDING
   ├── ACCEPTED → ACTIVATED
   ├── REVOKED
   └── EXPIRED
```

A resend supersedes the previous active invitation token rather than allowing multiple simultaneously valid invitation tokens for the same invitation context.

Invitation tokens must be:

- cryptographically random;
- stored only as hashes;
- single-use;
- time-limited;
- invalidated when accepted, revoked, or superseded;
- never exposed through normal API responses or logs.

Initial implementation default TTL: **7 days**. If a future business/security decision changes the TTL, update this contract before implementation changes it.

## 8. Owner → Branch Manager invitation flow

Canonical flow:

```text
Owner Dashboard
    ↓
Team → Add Member
    ↓
Email + Role + authorized Scope/Branch
    ↓
Core authorization
    ↓
Create PENDING invitation
    ↓
Send TEAM_INVITATION through Email Service
    ↓
Recipient opens secure invitation URL
    ↓
Authenticate with Xentra
    │
    ├── Existing Xentra User → confirm identity → accept
    │
    └── New person → Google-first or Email + Password account setup → accept
    ↓
Core validates invitation + current identity + expiry + role/scope rules
    ↓
Create/link User relationship or activate invited membership
    ↓
Assign Role + Scope
    ↓
Consume invitation atomically
    ↓
Audit
    ↓
Manager can enter authorized merchant surface
```

The invitation URL is not itself a login session and is not authorization. Successful authentication does not grant the invited role until Core validates and accepts the invitation.

## 9. Existing User vs new User

### Existing Xentra User

Do not create a duplicate User. Resolve the authenticated identity and attach the invited Organization/Brand/Branch role/scope relationship according to the invitation.

Existing Google identity links remain attached to the same Xentra User.

### New recipient

The recipient creates/authenticates one Xentra User identity during invitation acceptance. Google-first remains the primary authentication UX, with Email + Password as fallback.

The new account must not receive merchant authority before invitation acceptance succeeds.

The current legacy `WorkforceService.createUser` method must not be used unchanged for this path because it requires a password and immediately returns an active, email-verified user.

## 10. Email address binding

The invitation is addressed to a normalized email address, but email text alone is not sufficient authorization.

For a new recipient, the authenticated email/provider identity must be reconciled with the invitation recipient according to the authentication contract before acceptance. Do not allow an authenticated person to accept an invitation intended for a different email without an explicit, separately designed account-recovery/transfer policy.

For Google authentication, the stable Google `sub` identifies the provider identity; the verified email is used for invitation recipient matching, not as the provider identity key.

## 11. Authorization rules

Owner workforce authority remains governed by the existing `User → Role → Scope` RBAC model.

Core must enforce:

1. authenticated inviter is authorized to add the requested role/scope;
2. requested Branch belongs to the authorized Brand/Organization;
3. inviter cannot grant authority above its role ceiling;
4. Branch Manager invitations are restricted to the permitted Branch scope;
5. invitation acceptance cannot widen role/scope beyond the invitation record;
6. client-supplied `branch_id`, `role`, or `organization_id` cannot override the authoritative invitation or authenticated scope;
7. revoked/expired/used invitations cannot be accepted;
8. invitation acceptance is atomic with membership/role-scope assignment;
9. sensitive mutations are auditable.

## 12. Invitation security

Required protections:

- token entropy generated with cryptographic randomness;
- token hash persisted instead of raw token;
- one-time consumption;
- expiry;
- previous-token invalidation on resend;
- generic responses where enumeration risk exists;
- rate limiting/throttling for repeated invitation sends/acceptance attempts where supported by the existing security infrastructure;
- no role/scope in the URL as authoritative data;
- no password generated or chosen by the Owner;
- no raw invitation token in logs, analytics, audit metadata, or API response.

## 13. Email delivery semantics

Business state must not be falsely reported as delivered merely because a provider request was constructed.

At minimum, the transport boundary distinguishes:

```text
REQUESTED / QUEUED
SENT / ACCEPTED BY PROVIDER
FAILED
```

The business invitation remains authoritative in Core. Email delivery status is transport evidence. A provider failure must be observable and must not silently activate a User.

Whether invitation creation and provider dispatch are synchronous or use an outbox/queue is an implementation decision; the chosen implementation must preserve the above state semantics and avoid duplicate activation.

## 14. Audit

At minimum, auditable events should cover:

- invitation created;
- invitation send attempted/succeeded/failed where supported;
- invitation resent/superseded;
- invitation revoked;
- invitation accepted;
- invitation expired;
- invited User activated/role-scope assigned;
- suspicious/invalid acceptance attempts where the security event model supports it.

Never include raw invitation tokens, passwords, API keys, or other secrets in audit metadata.

## 15. Password handling

Owner never supplies or receives a Manager's password.

For Email + Password acceptance, the recipient sets their own password subject to the existing password policy. For Google-first acceptance, the recipient links/authenticates their own Google provider identity.

Existing password reset functionality remains separate from invitation acceptance.

## 16. Domain / surface boundary

```text
xentra.cloud
    → Xentra account / SaaS control-plane authentication

app.<client-domain>/dashboard
    → merchant operational surface

Xentra-Core
    → identity + authorization + invitation enforcement

Resend
    → email transport only
```

The client domain is not a separate identity system. The same Xentra User can access authorized surfaces according to Role + Permission + Scope.

## 17. Implementation constraints

Before implementation:

- preserve the existing `EmailProvider` abstraction;
- add a Resend adapter rather than importing Resend into business services;
- preserve `EmailVerificationService` behavior unless a contract discrepancy is found;
- add a dedicated Workforce Invitation service/model instead of overloading email verification;
- reconcile the current `users.password_hash NOT NULL` schema with Google-first/invitation onboarding safely rather than inserting arbitrary credentials into business flow;
- do not weaken existing Google `sub` linking invariants;
- do not create a second identity table/system;
- do not make email delivery a prerequisite for authorization checks at request time;
- do not change Owner/Branch Manager authority boundaries.

## 18. Required verification

Tests must cover at least:

### Email provider
- Resend adapter sends through the provider boundary using configured secret.
- Missing provider secret fails explicitly.
- Provider errors are normalized and observable.
- Secret is never returned/logged.
- Existing test adapter remains usable without external network calls.

### Invitation
- Authorized Owner creates Branch Manager invitation for an authorized Branch.
- Unauthorized role/scope assignment is rejected.
- Invitation token is hashed and single-use.
- Resend invalidates prior active token.
- Expired/revoked/used invitation cannot be accepted.
- Existing Xentra User is not duplicated.
- New recipient cannot gain merchant authority before acceptance.
- Accepted invitation assigns exactly the invited role/scope.
- Client payload cannot widen role/Branch/Organization scope.
- Acceptance is safe under concurrent/replay attempts.
- Audit evidence exists for security-sensitive transitions.

### Regression
- Existing Google authentication tests remain green.
- Existing email verification tests remain green.
- Existing workforce RBAC/security tests remain green.
- Existing ownership request/verification behavior remains green.

## 19. Explicit non-goals

v1 does not introduce:

- inbound email / Resend Receiving;
- marketing email campaigns;
- tenant-specific Resend accounts;
- Owner-created passwords for staff;
- a separate Manager identity system;
- a second RBAC system;
- automatic ownership transfer through invitation;
- arbitrary cross-domain Google OAuth configuration.

## 20. Status

**LOCKED — implementation contract v1.**

The implementation may choose concrete class names, table names, transport mechanics, and UI copy within this boundary, but must not change the identity, authorization, invitation, or provider-ownership rules without a new locked decision.
