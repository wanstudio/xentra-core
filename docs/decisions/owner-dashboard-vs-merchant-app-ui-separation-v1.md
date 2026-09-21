# Xentra — Owner Dashboard vs Merchant App UI Separation v1

Status: LOCKED
Decision date: 2026-09-21

## Decision

Xentra uses two distinct frontend UI surfaces above the same Xentra-Core authority:

- Owner Dashboard — Business Control Center
- Merchant App — Restaurant Operating App for Branch Manager

This is a frontend / UX / IA separation, not a backend split.

## Owner Dashboard

Desktop-first and multi-branch.

Responsibilities:
- Configure
- Govern
- Observe
- Cross-branch business visibility
- Master catalog and durable business configuration
- Branch management/configuration and performance
- Strategic reporting, workforce and governed finance/marketing surfaces

Canonical IA remains defined by the locked Owner Dashboard UI Blueprint.

## Merchant App

Mobile-first and branch-scoped.

Responsibilities:
- Operate
- Observe
- Branch-local menu configuration
- Daily order queue and Branch Acceptance
- Tables, stock, approved promo activation
- Branch staff operations
- Daily reporting and operating hours
- Delivery/driver monitoring or assignment only where the delivery contract authorizes Branch Manager

Canonical business responsibilities remain defined by Branch Manager Operational Center contract.

## Shared Core

Both surfaces use the same:
- authentication/session
- RBAC and permission model
- tenant/brand/branch scope enforcement
- Core domain services
- APIs
- persistence
- audit
- authoritative lifecycle/state machines

Never duplicate business authority merely because the UI is separate.

## Current Source Audit — 2026-09-21

Current HEAD audited: `2364da436558f4c6c8468c55609ec0f9e7ba41fb`.

### What already exists

1. `apps/merchant-dashboard/index.html` already contains Owner-oriented desktop navigation and Branch Manager route surfaces in the same document.
2. `apps/merchant-dashboard/assets/js/dashboard.js` already has separate platform/client routing concepts and Branch Manager-specific navigation/rendering.
3. Branch Manager role and branch scope are enforced server-side; existing tests cover:
   - unauthenticated access
   - branch scope isolation
   - role tampering
   - owner cross-branch visibility
   - Owner-only governance restrictions
   - authenticated branch context reconstruction
4. `server/app.js` currently serves the same `index.html` for `/dashboard* ` after host/tenant validation.
5. Existing test suites already treat Owner and Branch Manager as complementary surfaces and verify role-aware navigation/context.

### Readiness assessment

**Backend/domain readiness: HIGH.**
The Core already has the important separation: role, scope, authority and APIs are not dependent on the visual shell.

**Frontend separation readiness: MEDIUM-HIGH.**
The UI can be separated, but the current implementation is still a monolithic SPA document/script containing both Owner and Branch Manager surfaces. The main work is extraction and routing, not rebuilding the business domains.

**Operational migration risk: MEDIUM.**
The split must preserve:
- existing `/dashboard` compatibility
- login/session handoff
- role-aware redirects
- branch context
- deep links
- asset paths/cache busting
- existing Owner and Branch Manager tests

## Required split shape

Recommended structure:

```
apps/
├── owner-dashboard/
│   ├── index.html
│   └── assets/
└── merchant-app/
    ├── index.html
    └── assets/
```

The existing `merchant-dashboard` should be treated as the migration source, not duplicated indefinitely.

Server routing should resolve the authenticated role/surface while keeping Core APIs shared.

## Migration rule

Do not delete the existing combined dashboard first.

Sequence:
1. Extract Owner surface.
2. Extract Merchant App surface.
3. Preserve shared authentication/session contract.
4. Point role-appropriate routes to the new surfaces.
5. Run existing Owner/BM tests and add surface-isolation smoke tests.
6. Remove only dead combined-shell code after parity is verified.

## Explicit non-goal

Do not change business lifecycle/state machines, RBAC semantics, checkout, customer auth, payment, promo domain or unrelated APIs merely to perform this UI split.

## Source of truth

- Notion: 🔒 Xentra Merchant Operating App — UX / IA Contract v1
- Notion: Owner Dashboard — UI Blueprint v1 (LOCKED)
- Notion: 🔒 Owner ↔ Branch Manager Dashboard Boundary v1
- Notion: 🔒 Branch Manager Operational Center — Business Contract v1
