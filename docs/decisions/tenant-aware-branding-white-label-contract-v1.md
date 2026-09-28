# Xentra — Tenant-Aware Branding & White-Label Contract v1

**Status: LOCKED / AUTHORITATIVE**
**Decision date:** 2026-09-28
**Scope:** platform branding, tenant/client branding, white-label behavior, Xentra Business Portal presentation, direct client-domain behavior, and cross-surface branding resolution.

> Canonical Notion decision: https://app.notion.com/p/3e91ae1e12b1819ab93efbec9601d0c6

## 1. Context

Xentra is a SaaS platform. Xentra is the management/platform layer; each business is a logical Organization/Tenant.

The immediate issue was the relationship between:
- Xentra as the default platform brand.
- biz.xentra.cloud as the desired default Owner/Merchant business portal.
- client domains such as m.mybangjo.com that already use the client's own brand.
- the current direction for Owner-uploaded logos to become the default logo across application surfaces.
- VIP clients such as Bangjo that may run on dedicated infrastructure/server.

Without a platform-vs-tenant branding contract, these concerns can be mixed together. The result could be hardcoded client logos, inconsistent branding between POS/Merchant/Customer, or an incorrect architecture where client domains must pass through biz.xentra.cloud to obtain branding.

## 2. Core decision

Xentra has a **Platform Brand**. Each tenant has a **Tenant Brand**. Tenant branding is an override of the platform default, not a fork of the Xentra product.

Default behavior:
- No tenant override → effective brand is Xentra.
- Tenant override → effective brand is the tenant's configured brand.
- White-label → tenant brand is used across all supported tenant-facing surfaces.

Bangjo VIP is a reference tenant for the white-label + dedicated-deployment case.

## 3. biz.xentra.cloud

biz.xentra.cloud is the designated **Xentra Business Portal** entry point for Owner and Merchant experiences.

Default presentation is Xentra-branded:

    biz.xentra.cloud
        ↓
    Xentra Business Portal
        ↓
    Xentra branding by default

After a user is working inside a tenant/workspace, the portal may present that tenant's effective brand according to the tenant branding policy.

biz.xentra.cloud is a product surface, not a routing gateway for client domains.

## 4. Direct client-domain rule

Client domains remain direct tenant entry points.

Examples:

    m.mybangjo.com
        ↓
    Bangjo runtime
        ↓
    Tenant = Bangjo
        ↓
    Effective Brand = Bangjo

    pos.mybangjo.com
        ↓
    Bangjo POS
        ↓
    Tenant = Bangjo
        ↓
    Effective Brand = Bangjo

Do **not** introduce:

    m.mybangjo.com
        ↓
    biz.xentra.cloud
        ↓
    Bangjo

merely to obtain branding or tenant context.

Domain → tenant/brand resolution must come from the authoritative Domain Registry/configuration already defined by the Xentra SaaS architecture.

## 5. Dedicated/VIP deployment does not change tenant identity

Bangjo may use:
- dedicated server/runtime;
- dedicated database/storage;
- dedicated deployment lifecycle;
- custom domains;
- tenant branding / full white-label.

None of those create a separate application identity or separate SaaS tenant.

Logically:

    Xentra Platform
      └─ Organization/Tenant: Bangjo
           ├─ Brand
           ├─ Branches
           ├─ Users/Roles
           ├─ Orders/POS/Merchant/Customer
           └─ Branding Policy

Physical deployment is an infrastructure choice. Tenant identity, authorization, domain association, and branding remain Xentra tenant-scoped concepts.

## 6. Branding modes

| Mode | Effective brand | Intended use |
| --- | --- | --- |
| platform | Xentra | Default platform experience |
| tenant | Tenant brand | Standard custom tenant branding |
| white-label | Tenant brand across supported surfaces | VIP/full-branded experience |

The commercial packaging of these modes is outside this contract.

## 7. Effective branding resolver

Every application surface must consume one effective branding context derived from authoritative tenant context.

Conceptually:

    Request
      ↓
    Authoritative tenant / organization / brand context
      ↓
    Tenant branding override active?
      ├─ No  → Xentra Platform Brand
      └─ Yes → Tenant Brand

The exact API/component implementation is not locked. The following principles are locked:
- Branding must not be resolved by hardcoded client domain names.
- Branding must not be hardcoded independently inside each app.
- The resolver must consume server-authoritative tenant/brand context.
- Removing a tenant override must fall back cleanly to Xentra.

## 8. One branding contract across surfaces

Where applicable, the same effective branding must be used by:
- Owner Dashboard
- Merchant App
- POS
- Customer PWA
- Checkout
- Order Received / Order Detail
- Login/authentication presentation
- favicon/browser metadata
- PWA install presentation
- receipts and printable outputs
- order/kitchen tickets
- customer-facing transactional emails
- workforce invitation emails
- future tenant-facing surfaces.

The goal is to prevent mixed experiences such as POS = Bangjo while Customer PWA = Xentra when the tenant is configured for white-label.

## 9. Owner-uploaded logo interpretation

The Owner-uploaded logo is the tenant's branding asset.

It means:

> Set the tenant's branding asset. Use it as the effective brand when the tenant branding policy overrides the Xentra platform default.

The current agent instruction to make the Owner-uploaded logo the default logo everywhere is therefore valid only when routed through tenant-aware branding resolution.

Applications must not contain client-specific assets such as a permanent Bangjo logo path or hostname exception.

## 10. Recommended logical model

    Tenant
      ├─ deployment_type
      ├─ domains
      └─ branding
           ├─ mode
           ├─ display_name
           ├─ logo
           ├─ logo_light
           ├─ logo_dark
           ├─ favicon
           ├─ primary_color
           └─ secondary_color

The physical DB schema may normalize these fields differently. What is locked is the ownership and resolution boundary: branding belongs to the tenant/brand context and is centrally resolvable.

## 11. Identity and security boundary

Branding is presentation state; tenant identity is authorization state.

Rules:
- A logo or branding payload must never determine tenant identity.
- Client-supplied tenant_id/brand_id, query parameters, or arbitrary headers must not authorize protected operations.
- Domain → tenant/brand association comes from authoritative configuration.
- Authenticated identity and server-side authorization determine accessible tenant/workspace scope.
- The branding resolver consumes that already-authoritative context.
- Changing a logo must never change ownership, RBAC, branch scope, subscription, domain ownership, or historical transaction data.

## 12. Explicitly prohibited

- Hardcoding Bangjo or another client into common branding logic.
- Hardcoding Xentra as the mandatory logo for every tenant-facing surface.
- Maintaining separate logo configuration independently in POS, Merchant, Customer, and Owner apps.
- Routing client domains through biz.xentra.cloud merely for branding.
- Creating a separate identity/account system for VIP tenants.
- Forking the product solely for white-label branding.
- Letting frontend state determine authoritative tenant/brand scope.

## 13. Implementation acceptance criteria

1. A default tenant works with Xentra branding without uploading a logo.
2. A tenant can upload its own branding and the effective brand appears consistently on supported surfaces.
3. Bangjo can run in dedicated infrastructure while remaining the same logical Xentra tenant.
4. biz.xentra.cloud works as the Xentra Business Portal without being a mandatory proxy for client domains.
5. m.mybangjo.com and pos.mybangjo.com resolve Bangjo directly and can render Bangjo branding.
6. Owner, Merchant, POS, Customer and future surfaces reuse the same effective-branding contract.
7. Removing an override falls back to Xentra.
8. Branding changes never mutate tenant identity, ownership, authorization, or historical transaction records.
9. No client-specific logo/domain is introduced as permanent application-source logic.
10. The contract works for both shared and dedicated tenant deployments.

## 14. Implementation boundary

This document locks the architecture/contract; it does not authorize an unrelated broad refactor.

Before implementation, the agent must inspect the current logo upload/storage path, current tenant/brand resolution, all hardcoded logo sources, and all major application surfaces. Implement the smallest reusable branding-resolution mechanism that fits the existing architecture, then migrate surfaces incrementally and test platform fallback, tenant override, white-label, and direct-domain behavior.

## 15. Relationship to existing Xentra decisions

This decision is additive to the existing rules that:
- Xentra is the SaaS platform/control plane.
- Organization → Brand → Branch is the logical hierarchy.
- client domains are first-class tenant/brand entry points.
- Domain Registry is authoritative for domain → tenant/brand association.
- one Xentra User can access multiple Xentra/client surfaces according to authorization.
- dedicated deployment does not imply a separate tenant identity.

Related Notion pages:
- 09 — SaaS Control Plane & Client Provisioning
- 02 — Domain Blueprint
- Workforce Invitation Email — Client-First Branding v1

**Final locked rule:** Xentra is the platform and default brand. Tenant branding is a tenant-scoped override. White-label is a tenant branding mode, not a separate application architecture. Dedicated/VIP infrastructure does not create a separate tenant identity. biz.xentra.cloud is the Xentra Business Portal, while client domains remain direct tenant entry points and must never be routed through biz.xentra.cloud merely for branding.