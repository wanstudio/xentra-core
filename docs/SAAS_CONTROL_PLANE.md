# Xentra SaaS Control Plane & Client Provisioning

**Status: LOCKED**  
**Scope: Platform architecture / SaaS lifecycle**

## 1. Platform Model

Xentra is a SaaS platform, conceptually similar to Shopify or WordPress. Xentra is the platform; each business deployed through Xentra is a client/tenant.

- `xentra.cloud` = Xentra SaaS Control Plane / Admin Panel.
- `app.<client-domain>` (for example `app.mybangjo.com`) = client runtime entry point.
- Client domains are tenant/brand entry points, not Xentra platform identity.
- A client does not automatically own or receive an Xentra runtime/server.
- Default deployment remains on Xentra infrastructure and is tenant-scoped. Database topology is not fixed by the tenant model and may be shared or isolated based on deployment tier, scale, isolation requirements, and operational needs.
- Dedicated runtime/server is an optional deployment topology when justified; it does not change the logical tenant model.

## 2. Two Different Surfaces

### Xentra SaaS Control Plane — `xentra.cloud`

Used by Xentra internal workforce to manage the platform and its clients.

```text
xentra.cloud
├── /                 → Xentra SaaS landing page
├── /admin            → SaaS Admin Panel
├── /admin/clients    → Client / tenant management
├── /admin/billing    → Plans, subscriptions and billing
├── /admin/domains    → Client domain management
├── /admin/provisioning → Provisioning / deployment operations
└── /admin/platform   → Platform configuration / operations
```

This surface must never be treated as the merchant dashboard for Bangjo or any other client.

### Client Runtime — `app.mybangjo.com`

Used by the client and its customers.

```text
app.mybangjo.com
├── /                 → Customer PWA
├── /dashboard        → Merchant Dashboard
├── /dashboard/menu   → Merchant menu management
└── /dashboard/...    → Other client-authorized operations
```

The same runtime model applies to future clients, with their own configured domains and tenant/brand context.

## 3. Client Lifecycle

The canonical SaaS lifecycle is:

```text
Prospect / Client
      ↓
Register on xentra.cloud
      ↓
Create Client / Organization
      ↓
Create Brand
      ↓
Submit business requirements
      ↓
Select / assign plan
      ↓
Configure features and integrations
      ↓
Configure domain
      ↓
Provision tenant
      ↓
Provision client runtime/configuration
      ↓
Deploy brand
      ↓
Verify domain / TLS / health
      ↓
READY
```

The lifecycle must support explicit states and safe failure/retry handling. A failed provisioning step must not silently produce a partially active client.

## 4. SaaS Admin Responsibilities

The Control Plane is authoritative for platform-level concerns:

- Client/tenant registration and lifecycle.
- Organization and brand provisioning orchestration.
- Subscription/plan state and billing status.
- Feature entitlement at platform level.
- Domain registration, verification and association.
- Provisioning and deployment orchestration.
- Runtime/deployment status.
- Platform workforce access and scoped support access.
- Platform-level audit evidence.

Business transaction authority remains inside the appropriate business domain. The Control Plane must not absorb merchant business logic merely because it manages the tenant.

## 5. Client Responsibilities

The client runtime is authoritative for client business operations within its tenant/brand/branch scope, including where applicable:

- Branches.
- Menus/catalog.
- Orders.
- POS operations.
- Inventory.
- Payment.
- Delivery.
- Reporting.
- Merchant users and their permitted roles.

Core remains authoritative for identity, authorization, tenant/brand/branch scope and shared platform foundations.

## 6. Tenant and Domain Rules

- `xentra.cloud` identifies the Xentra platform/control plane.
- A client custom domain identifies a client/tenant entry point.
- Domain resolution must determine tenant/brand context from authoritative configuration.
- No new client should require hardcoded application-domain checks.
- `app.mybangjo.com` may remain valid as Bangjo's configured domain, but it must not be the architectural fallback for all tenants.
- Tenant scope must never be accepted from an untrusted client payload when it can be derived from authenticated identity and authoritative domain/context.

## 7. Provisioning Boundary

Provisioning creates/configures the resources required for a client to become operational. It may include:

1. Tenant/client record.
2. Organization/brand records.
3. Initial owner/workspace access.
4. Feature entitlements.
5. Required domain mapping.
6. Integration configuration.
7. Client runtime configuration.
8. Deployment/release association.
9. Health/readiness verification.

Provisioning must be idempotent where practical and must expose failure state rather than pretending deployment succeeded.

## 8. Deployment Topology

Logical SaaS architecture is independent from physical deployment topology.

Default:

```text
GitHub
  ↓
Xentra VPS / Xentra infrastructure
  ↓
Xentra runtime
  ↓
Tenant-scoped client domains
```

A dedicated client runtime may be introduced when justified, but it remains a deployment decision rather than a change to the tenant/domain model.

Database topology follows the same principle. Do **not** lock `DB-per-client` as mandatory for every client. The default may use tenant-scoped data on shared Xentra infrastructure, while an isolated database may be introduced when justified by deployment tier, isolation, scale, or operational requirements. SQLite, PostgreSQL, or another database topology is an implementation/deployment decision and must not redefine the logical tenant model.

## 9. Billing / Subscription Boundary

Subscription is a platform concern:

```text
Client
  ↓
Plan
  ↓
Subscription
  ↓
Billing status
  ↓
Feature entitlements / limits
  ↓
Client runtime availability
```

Billing state may affect whether a client can remain active, but billing must not bypass Core authorization or business-domain rules.

## 10. Non-Goals / Guardrails

- Do not make `xentra.cloud` another copy of the Bangjo merchant dashboard.
- Do not make every client a hardcoded special case.
- Do not couple tenant identity to repository names.
- Do not equate a custom client domain with a dedicated physical server.
- Do not introduce VPS-per-client, DB-per-client, microservices-per-domain or Kubernetes solely to satisfy the SaaS model. DB-per-client is allowed when justified by deployment tier, isolation, scale, or operational requirements; it is not mandatory for every client.
- Do not move merchant business logic into the SaaS Control Plane.
- Do not expose platform-wide client data to a client-scoped user.

## 11. Implementation Direction

The existing Xentra Core/domain architecture remains the foundation. This document adds the missing SaaS Control Plane and client provisioning lifecycle; it does not authorize an architectural rewrite.

Implementation should proceed in this order:

1. Model SaaS Control Plane identity/access boundary.
2. Define client/tenant lifecycle and provisioning state machine.
3. Define plan/subscription/entitlement contracts.
4. Define domain onboarding and verification lifecycle.
5. Define provisioning/deployment contracts.
6. Build `xentra.cloud` SaaS Admin UI/API.
7. Remove remaining single-client/Bangjo assumptions from shared runtime code.
8. Validate multi-tenant isolation and client provisioning end-to-end.

## 12. 🔒 LOCKED — Xentra Cloud Registration & Owner Onboarding

**Added 2026-09-11 — Control Plane registration architecture.**

New client/business registration MUST originate from `xentra.cloud`, not from a client runtime such as `app.mybangjo.com`.

### 12.1 Registration surface

`xentra.cloud` is the SaaS account and business onboarding entry point:

```text
xentra.cloud
├── /login
├── /register
├── /verify-email
├── /forgot-password
├── /reset-password
└── /onboarding
```

Client runtime domains such as `app.mybangjo.com` remain client/merchant runtime surfaces and must not become the primary SaaS signup surface.

### 12.2 Authentication methods

Initial supported registration/login methods:

- Email + password.
- Google OAuth / OpenID Connect.

Email is the primary user-facing account identifier for new registration. Legacy username-based authentication may remain temporarily for existing accounts during migration, but new onboarding must not depend on a restaurant-specific username/password bootstrap credential.

Passwords MUST be securely hashed and MUST NOT be stored, logged, or returned in plaintext.

Google authentication MUST use a validated Google identity flow. Xentra stores the provider identity reference and relevant verified identity metadata; Xentra does not store the user's Google password.

### 12.3 First registered user

The first user creating a new business becomes the initial `owner` for that business.

Canonical logical model:

```text
Xentra User
    ↓
Organization
    ↓
Brand
    ↓
Branch
```

The user-facing onboarding flow should avoid unnecessary internal terminology where possible, while the backend preserves the canonical Organization → Brand → Branch model.

### 12.4 New-business provisioning

Registration and provisioning are separate concerns but form one onboarding lifecycle:

```text
Register / Login
      ↓
Create Xentra User
      ↓
Create Organization
      ↓
Create Brand
      ↓
Create initial Branch
      ↓
Assign User = owner
      ↓
Business onboarding
      ↓
Owner Dashboard
```

Provisioning MUST be safe, idempotent where practical, tenant-scoped, and auditable. A partially failed provisioning operation must expose explicit failure/retry state rather than silently creating an inconsistent business.

### 12.5 Onboarding UX

The preferred onboarding is progressive rather than a single large registration form.

Minimum initial setup should collect only information required to create the business workspace, followed by an onboarding wizard such as:

1. Owner profile.
2. Business information.
3. Brand information.
4. First branch/location.
5. Completion and dashboard entry.

Post-registration setup should use a dashboard checklist for optional/incremental configuration such as menu/category, media, operating hours, and service configuration. Users must not be blocked at registration by data that can safely be completed later.

### 12.6 Identity and business separation

A Xentra account and a business/organization are distinct concepts. The identity model must support a future user having access to multiple organizations and/or brands according to authorization rules.

Do not create separate unrelated user databases for `xentra.cloud` and each client runtime. Core remains the authority for identity, authentication, authorization, and tenant/brand/branch scope.

### 12.7 Existing clients and legacy accounts

Existing client accounts such as Bangjo MUST NOT be destroyed or recreated solely to introduce the new registration flow.

Migration/linking should support associating a verified email and, where desired, a Google identity with an existing user while preserving existing organization/brand/branch ownership and authorization. Legacy login may remain during migration until the new identity flow is proven stable.

### 12.8 Runtime boundary

The architecture remains:

```text
xentra.cloud
    ↓
SaaS identity + onboarding + provisioning
    ↓
Organization / Brand / Tenant
    ↓
Client runtime
    ↓
app.<client-domain>
```

`xentra.cloud` MUST NOT become another copy of the merchant dashboard. Merchant operational functions remain in the client runtime.

### 12.9 Security guardrails

- Do not use default production passwords as the primary SaaS onboarding mechanism.
- Do not expose passwords or OAuth client secrets in logs, source control, UI responses, or audit records.
- Prevent account enumeration where practical.
- Apply rate limiting/brute-force protection to authentication endpoints.
- Validate email ownership before treating a new email account as verified.
- Validate Google identity tokens/authorization responses server-side.
- Prevent an authenticated user from assigning themselves arbitrary roles or tenant scope.
- First registration receives only the `owner` role for the newly provisioned business; manager/cashier/staff roles remain controlled by the existing RBAC model.
- Tenant isolation and authorization remain mandatory for every protected operation.

### 12.10 Implementation guardrail

This decision is additive. It does **not** authorize rewriting the existing identity, tenant, domain, Connector, or client-runtime architecture without a concrete compatibility requirement.

Implementation should proceed incrementally:

1. Audit current Core identity/session model and `xentra.cloud` runtime entry.
2. Define registration and identity-provider data contracts.
3. Implement email registration/verification.
4. Implement Google OAuth/OIDC.
5. Implement new-business provisioning and Owner assignment.
6. Implement onboarding wizard and setup checklist.
7. Add existing-account identity linking/migration.
8. Validate authentication, authorization, tenant isolation, provisioning rollback/retry, and end-to-end client runtime access.

**LOCKED — Xentra SaaS Control Plane / Identity & Onboarding**

## 13. 🔒 LOCKED — Xentra Platform Owner Identity & Secure Bootstrap

**Added 2026-09-11 — separates Xentra platform identity from merchant/client ownership.**

Xentra Platform Owner is NOT a merchant `owner` and MUST NOT be created through the public merchant/business registration flow.

### 13.1 Platform vs Merchant Identity

```text
XENTRA PLATFORM
xentra.cloud
├── Platform Owner
├── Platform Admin / Workforce
└── SaaS Control Plane

CLIENT / TENANT
Business
├── Organization
├── Brand
├── Branch
└── Merchant Owner / Managers / Staff
```

Rules:
- `xentra.cloud/register` is for new merchant/client business registration, not Xentra internal platform-owner creation.
- Platform Owner identity is separate from tenant/merchant ownership and must not require creating a fake Xentra organization, brand, or branch.
- Platform Owner MUST NOT be provisioned through SQL injection, public HTTP endpoints, hidden UI endpoints, or a hardcoded production credential.
- Initial Platform Owner provisioning MUST use a controlled, auditable, one-time or tightly restricted secure bootstrap mechanism outside the public registration flow.
- Bootstrap credentials MUST never be committed to source code, logs, audit records, or API responses.
- Platform Owner authentication should support strong password authentication and MUST require MFA before privileged Control Plane operations are considered fully enabled.
- Platform Owner authorization is platform-scoped and must not inherit merchant `owner` semantics accidentally.
- Existing merchant `owner` roles remain tenant-scoped and continue to represent business ownership within Organization → Brand → Branch.

### 13.2 Secure Bootstrap Direction

Preferred implementation:
```text
Controlled deployment / secure operator environment
              ↓
One-time Platform Owner bootstrap
              ↓
Platform Owner identity
              ↓
MFA enrollment
              ↓
xentra.cloud Control Plane
```

The bootstrap mechanism must be idempotent/safe against duplicate creation, must use secure password hashing, and must emit an auditable platform-security event. After successful bootstrap, the ability to create another initial Platform Owner must be explicitly restricted or disabled according to the implementation.

### 13.3 Architectural Boundary

Merchant registration remains:
```text
xentra.cloud/register
      ↓
Xentra User
      ↓
Organization
      ↓
Brand
      ↓
Branch
      ↓
Merchant Owner
```

Platform identity remains:
```text
Secure bootstrap
      ↓
Platform Owner
      ↓
xentra.cloud/admin
```

Do not merge these flows merely to reuse the same public registration endpoint. Shared authentication primitives are allowed, but platform authorization and merchant tenancy boundaries MUST remain explicit.

**LOCKED — Xentra Platform Identity / Security Architecture**
