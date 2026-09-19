# Xentra Customer Identity Scope v1 — Organization Scoped

**Status:** LOCKED / AUTHORITATIVE  
**Decision Date:** 2026-09-19

## Canonical decision

Customer identity is **Organization-scoped**, not Brand-scoped.

Organization → Brands → Branches, while Customer Identity belongs to the Organization.

A single human Customer within one Organization must resolve to one canonical Customer identity even when that Customer orders from multiple Brands belonging to the same Organization.

## Identity boundary

- Google `sub` remains the immutable external identity key.
- Internal `customer_id` remains an Xentra-generated identifier.
- Customer identity belongs to the Organization.
- Brand is not the primary Customer identity boundary.
- The same Google Customer may transact with multiple Brands when those Brands belong to the same Organization.
- A Google identity belonging to Organization A must never resolve to a Customer in Organization B.
- Customer authentication must not infer Organization from an arbitrary client-supplied Brand ID without authoritative tenant resolution.

## Data-scope distinction

Organization-scoped identity does **not** mean cross-Brand data visibility.

- Customer Identity → Organization scope.
- Order / Cart / Promotion / Catalog / Branch data → existing Brand / Branch business scope.

Cross-Brand identity continuity must not become automatic cross-Brand data access.

## Google authentication

Google ID token → verify issuer / audience / expiry / verified identity → Google sub → CustomerAuthProvider → Customer identity within Organization → Customer session.

The provider binding must carry enough authoritative scope to determine the Organization before issuing a Customer session.

## Required implementation direction

The current Brand-scoped implementation is now considered an implementation mismatch with this locked business decision.

Future implementation must:

1. Add or derive authoritative `organization_id` for Customer identity.
2. Make CustomerAuthProvider resolution Organization-safe.
3. Allow the same Google Customer across Brands within one Organization.
4. Reject cross-Organization reuse with fail-closed behavior.
5. Preserve Brand/Branch scope for order and business authorization.
6. Ensure Customer session context cannot broaden business-data access.
7. Add regression tests for same-Google identity across Brands in one Organization, rejection across Organizations, duplicate prevention, workforce separation, and invalid-session fail-closed behavior.

## Migration rule

Existing dummy Customer records may be deleted/recreated. No legacy Google↔phone Customer linking or historical migration is required.

Do not silently migrate or merge real customer accounts unless a newer explicit decision contracts such behavior.

## Supersession rule

This decision supersedes any implementation or documentation that treats `brand_id` as the canonical Customer identity boundary.

It does not supersede Brand-scoped commerce/business rules, Branch fulfillment rules, Customer checkout UX, Google-first authentication, or fail-closed authentication/security invariants.

**LOCKED — Customer Identity Domain / Organization Scope v1**
