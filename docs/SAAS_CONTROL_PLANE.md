# Xentra SaaS Control Plane & Client Provisioning

**Status: LOCKED**  
**Scope: Platform architecture / SaaS lifecycle**

## 1. Platform Model

Xentra is a SaaS platform, conceptually similar to Shopify or WordPress. Xentra is the platform; each business deployed through Xentra is a client/tenant.

- `xentra.cloud` = Xentra SaaS Control Plane / Admin Panel.
- `app.<client-domain>` (for example `app.mybangjo.com`) = client runtime entry point.
- Client domains are tenant/brand entry points, not Xentra platform identity.
- A client does not automatically own or receive an Xentra runtime/server.
- Default deployment remains on Xentra infrastructure and is tenant-scoped.
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
- Do not introduce VPS-per-client, DB-per-client, microservices-per-domain or Kubernetes solely to satisfy the SaaS model.
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
