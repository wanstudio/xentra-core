# Xentra — Merchant Authentication Route Boundary v1

**Status:** LOCKED / ACTIVE  
**Decision date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## Decision

Extract the merchant authentication HTTP surface from `server/routes/api.js` into:

`server/routes/merchant-auth.js`

This is a **focused vertical boundary**, not permission to resume a wholesale `api.js` split.

The boundary owns these related HTTP concerns as one coherent unit:

- merchant/business registration;
- identity-only registration;
- email verification and resend;
- merchant password login;
- merchant profile/session endpoint;
- Google/workforce authentication;
- Google onboarding;
- cross-domain handoff create/exchange;
- Google account linking and link-init;
- public auth provider configuration.

## Why

Authentication is a Core responsibility and these routes already form one tightly coupled security flow. Keeping the entire flow in one route module reduces accidental coupling to unrelated order, catalog, marketing, payment, and operational route code.

Splitting the auth flow into smaller route fragments would increase the chance of moving security invariants independently and creating inconsistent authentication behavior.

## Constraints / invariants

- Existing endpoint paths and aliases remain unchanged.
- Existing response contracts and error codes remain unchanged.
- Existing identity services remain authoritative.
- Existing `TokenSessionStore`, `RateLimiter`, and `requireAuth` remain shared infrastructure injected into the route module.
- No second authentication/session system is introduced.
- Tenant/brand/branch authorization remains server-side.
- Google workforce identity and invitation rules remain owned by Core Identity / Workforce services.
- Handoff remains single-use and time-limited through the existing `HandoffService`.
- No authorization decision moves into frontend code.
- This extraction does not move domain business logic.

## Compatibility / migration strategy

1. Extract the existing route implementation without changing behavior.
2. Register the new module once from `server/routes/api.js`.
3. Keep shared auth infrastructure in `api.js` until a later, separately reviewed infrastructure boundary is justified.
4. Lock the route boundary with a structural regression test.
5. Preserve all existing runtime auth tests unchanged.

## Relationship to the incremental-refactoring baseline

The existing target-architecture baseline defers a generic `server/routes/api.js` split. This decision is a narrow exception for the merchant-auth vertical boundary only.

It does **not** authorize extraction of unrelated API routes merely for file-size reduction.

## Verification

Structural checks required for this change:

- `server/routes/api.js` contains exactly one `registerMerchantAuthRoutes(router, ...)` registration.
- The canonical auth route implementations do not remain inline in `api.js`.
- All auth endpoints listed above are present in `merchant-auth.js`.
- The affected JavaScript files parse successfully.
- Existing authentication, Google, handoff, and workforce regression suites remain the behavioral authority.

## Remaining uncertainty

Full `npm test` execution is still a repository/runtime verification step; this structural change itself does not redefine the auth contract.
