<!-- SNAPSHOT FROM NOTION — source page: 02-domain-blueprint; updated 2026-09-09 -->

## 🔒 LOCKED — Workforce Account Hierarchy, Password Management & Security Contract
Dashboard workforce account management is governed by **Core Identity/RBAC + tenant/brand/branch scope**. The hierarchy is not a UI convention; every protected request must be authorized server-side using the actor's current identity, role, permission, scope, target relationship, and action policy.

### Role Management Authority
- **Owner:** may create/manage Manager and Cashier accounts within the Owner's authorized tenant/brand scope; may assign permitted roles and branch scope; may reset subordinate accounts; may enable/disable subordinate accounts.
- **Manager:** may create/manage **Cashier only**, and only within the Manager's current Branch scope; may reset/disable Cashier accounts within that scope; may not create/manage Owner or Manager accounts; may not grant broader role or branch scope than the Manager itself holds.
- **Cashier:** may manage only its own credentials/profile fields that are explicitly permitted; no workforce user-management authority.
- **No actor may grant itself or another identity a role/scope/privilege that exceeds the actor's authority.** Client payload, hidden UI, or route parameter is never an authorization source.

### Password Operations
#### Self Password Change
`Authenticated session → current password proof → new password + confirmation → server authorization → password policy validation → secure password hash → commit → revoke/rotate affected sessions/tokens → audit`
- Current password proof is required for normal self-service change.
- Plaintext passwords are never stored, logged, returned, or exposed through admin APIs.
- Client-supplied password hashes are rejected.
- Password change must invalidate or rotate sessions/tokens according to the authentication service's security policy; at minimum, previously issued sessions that should no longer remain trusted must be revoked.

#### Administrative Password Reset
`Authorized superior → target identity → server role/scope authorization → one-time recovery/reset mechanism → invalidate target sessions/tokens → target sets new password → audit`
- Owner may reset Manager/Cashier within authorized scope.
- Manager may reset Cashier only within current Branch scope.
- Cashier cannot reset another identity.
- An operator must **never be able to read or retrieve the target's existing password**.
- Administrative reset must not require the superior to know or transmit the target's permanent password.
- Recovery/reset secrets are single-use, time-limited, protected from logs, and invalidated after use.

### Account Lifecycle
Normal dashboard lifecycle is **Create → Active → Disable/Enable → Historical retention**. Hard delete is not a normal workforce-user operation because historical transactions, audit records, and actor references must remain traceable.
- Disable must revoke active sessions/tokens and prevent new authentication.
- Re-enable restores access only after normal server-side authorization checks.
- Role/scope changes are security mutations and must be audited.

### Authorization Evaluation — Mandatory Order
For every protected workforce mutation:
`Authenticate → load current identity state → resolve current role/permissions → resolve current tenant/brand/branch scope → resolve target → verify actor-target relationship → verify requested action/role/scope is assignable → verify business/security invariants → mutate atomically → revoke/rotate sessions when required → audit result`

### Security Invariants
- **No self-escalation.** User cannot change its own role, tenant, branch scope, ownership, or privilege through payload manipulation.
- **No cross-scope management.** Manager access is restricted to the Manager's current Branch scope, not historical membership or client-supplied branch IDs.
- **Role ceiling.** Manager can assign/manage Cashier only; Owner can manage permitted subordinate roles; lower roles cannot manufacture higher privileges.
- **Current authorization is authoritative.** Stale JWT/session claims must not be the sole source of truth for sensitive role/scope mutations.
- **Last-owner protection.** Mutations must not leave the tenant/brand without a valid remaining Owner/required critical authority.
- **Disable means inaccessible.** Disabled identities cannot authenticate and existing sessions/tokens are revoked.
- **Audit is append-oriented.** Security mutations record actor, target, action, scope/context, timestamp, outcome, and relevant reason/metadata without secrets.
- **Sensitive actions may require step-up/re-authentication** according to risk policy, especially password reset, role changes, branch-scope changes, disablement, ownership/critical security actions.
- **Cookie-authenticated state changes require CSRF protection** consistent with the authentication architecture; SameSite and Origin/CSRF checks must be enforced where applicable.
- **Rate limits and anti-abuse controls** apply to login, password change/reset, recovery, OTP, and other credential-sensitive endpoints.

### Explicit Worst-Case Guards
The implementation must remain secure when an actor deliberately tampers with requests:
- Cashier submits `role=owner` → **403 / denied**.
- Manager submits another Branch ID → **denied by current scope check**.
- Manager targets Owner/Manager account → **denied by role ceiling/target policy**.
- Attacker reuses a stale user/session after disable or password reset → **session/token revoked and identity status rechecked**.
- Manager attempts to reset a former/currently out-of-scope Cashier → **denied using current target scope**.
- Concurrent disable + sensitive mutation → final mutation must commit only if the actor remains authorized at commit time, using atomic/transactional safeguards where supported.
- User hard-delete attempt → **not allowed through normal dashboard lifecycle**; historical references remain traceable.

### Dashboard Action Matrix
| Action | Owner | Manager | Cashier |
|---|---|---|---|
| Create Manager | ✅ within authorized scope | ❌ | ❌ |
| Create Cashier | ✅ | ✅ within current Branch scope | ❌ |
| Edit Manager | ✅ within authorized scope | ❌ | ❌ |
| Edit Cashier | ✅ | ✅ within current Branch scope | ❌ |
| Change own password | ✅ | ✅ | ✅ |
| Reset Manager password | ✅ | ❌ | ❌ |
| Reset Cashier password | ✅ | ✅ within current Branch scope | ❌ |
| Change role | ✅ where role is assignable | ❌ | ❌ |
| Change branch scope | ✅ where scope is assignable | ✅ only within own scope for subordinate Cashier | ❌ |
| Disable Manager | ✅ | ❌ | ❌ |
| Disable Cashier | ✅ | ✅ within current Branch scope | ❌ |
| Hard delete workforce identity | ❌ normal flow | ❌ normal flow | ❌ |

### Contract Boundary
Dashboard UI may hide or show actions for usability, but **UI visibility is never authorization**. Core is authoritative for identity, role, permission, scope, credential state, and authorization. Domain modules must not mutate credentials or bypass Core security rules directly.

### Security Acceptance Criteria
1. Unauthorized role/scope escalation is rejected server-side.
2. Cross-tenant/brand/branch target access is rejected server-side.
3. Self password change requires current credential proof.
4. Administrative reset never exposes the old password.
5. Passwords are stored only as secure hashes; no plaintext/secret logging.
6. Password reset/change revokes or rotates affected sessions/tokens.
7. Disabled users cannot authenticate or continue using revoked sessions.
8. Last-owner/critical authority invariants cannot be broken.
9. Sensitive mutations are auditable without secrets.
10. CSRF/rate limiting/recovery protections follow the authentication architecture.
11. Normal user lifecycle preserves historical traceability; no routine hard delete.
12. Security decisions remain server-authoritative even when request payloads are malicious or stale.

## 🔒 LOCKED ADDENDUM — Home Discovery / Cart / Checkout Boundary

This addendum supersedes earlier wording that makes Home wait for authoritative ETA/routing or treats the entire Cart as one fulfillment scope.

### Home
Home is a fast discovery/presentation layer. It uses cheap GPS/destination proximity calculation (straight-line distance or a faster equivalent) to render nearby Branches quickly. Initial Home render must not wait for road routing, ETA, delivery cost, driver availability, full-cart eligibility, stock verification, pricing, or Branch Acceptance.

Home discovery is not fulfillment resolution. It may show **“Cabang terdekat dari tempatmu”** and a Branch array without displaying ETA. Ordering may change after reload or Customer interaction.

### Cart / Checkout / Order
- Cart is a shopping container and may contain items associated with multiple Branches/brands.
- Checkout is a single transaction scope containing items from one fulfillment Branch only.
- Order has exactly one fulfillment Branch.
- Customer completes different Branches as separate Checkout/Order processes.
- Multi-Branch fulfillment inside one Checkout/Order is prohibited for v1.

### Actual transaction calculation
Authoritative operational/transaction calculations occur when the Customer proceeds into Checkout and must be freshly validated before payment/commitment. Home is never the authority for fulfillment, inventory, pricing, eligibility, ETA, or acceptance.

### Acceptance / recovery
Branch Acceptance remains separate from Eligibility. The platform-controlled Branch Acceptance timeout is **3 minutes**, not configurable by Owner or Branch Manager. Rejection or timeout ends the current transaction for that Branch. Customer may explicitly choose another Branch and start a new Checkout; no silent rematch.

If the original order was paid online, it enters financial recovery/refund according to payment state/provider behavior and is not transferred to another Branch. Customer may start another independent order immediately while the previous refund remains pending.

### Cancellation
Customer cancellation follows the adopted GoFood-style principle: allowed before Branch acceptance/confirmation; after acceptance, normal Customer cancellation is not allowed. Core enforces the rule from authoritative Order state. Branch/system failure must not be misclassified as Customer cancellation.

### Invariant
**Multi-branch Cart is allowed; multi-branch Checkout/Order is not.**
