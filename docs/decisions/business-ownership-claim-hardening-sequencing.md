# 🔒 LOCKED — Business Ownership Claim Security Hardening & Execution Sequencing

**Decision Date:** 2026-09-16
**Status:** LOCKED — DEFERRED IMPLEMENTATION

## Decision

The current Business Claim flow is considered a **security risk** because an authenticated Xentra account may currently be able to claim an already-registered business without sufficient independent ownership verification.

The canonical security decision is already defined in:

- `docs/BUSINESS_OWNERSHIP_REQUEST_VERIFICATION.md`

This document does **not** redefine that ownership model. It locks the execution sequencing and makes the implementation boundary explicit.

## Required Security Model

Authentication of a person is not proof that the person owns the business.

The following states MUST remain separate:

```text
Account verified
      ≠
Business ownership verified
      ≠
Owner authority granted
```

Therefore:

```text
Google / Email authentication
        ↓
Xentra User identified
        ↓
Request Ownership
        ↓
PENDING
        ↓
Existing owner/contact approval
        OR
Verify Business Ownership escalation
        ↓
Re-authentication / step-up confirmation
        ↓
Owner authority granted
```

There must be **no instant claim-to-owner** for an existing tenant.

## Existing Tenant Preservation

When a business/domain already exists:

- do not create a duplicate tenant;
- preserve the existing tenant and its data;
- do not transfer Owner authority merely because the requester is authenticated;
- attach/grant Owner authority only after the canonical ownership verification workflow succeeds.

## Current Risk Boundary

Until this hardening is implemented, the existing claim path must be treated as **not production-safe for ownership authorization**.

Do not attempt to hide or redefine this risk as an authentication problem.

Google authentication, email authentication, invitation acceptance, and business ownership verification are separate concerns.

## Execution Sequencing — LOCKED

This security fix is intentionally **deferred while the immediate engineering objective is Branch Manager Dashboard / Operational Center implementation**.

Current priority:

```text
Google/Auth regression stabilization
        ↓
Branch Manager Dashboard
        ↓
Branch Manager operational modules
        ↓
Dashboard integration/hardening
        ↓
Business Ownership Claim Security Hardening
```

The deferred status does NOT weaken the security decision. It only records implementation order.

## Non-Negotiable Future Implementation Rules

When this issue is activated for implementation:

- reuse the existing Xentra identity/authentication system;
- reuse the existing tenant model;
- reuse the existing ownership-request decision;
- reuse the existing email foundation;
- reuse the existing audit/security-event mechanism;
- do not create a second identity system;
- do not create a second RBAC system;
- do not create a second tenant/membership authority;
- do not auto-link ownership based only on Google email;
- do not trust `return_to`, domain strings, branch IDs, role fields, or frontend state as ownership authority;
- do not silently transfer Owner authority;
- preserve existing tenant data;
- make approval/rejection/expiry auditable;
- protect concurrent ownership requests and approval races;
- require step-up/re-authentication for high-privilege ownership approval.

## Required Future Flow

```text
Requester
  ↓
Authenticate
  ↓
Existing Business Lookup
  ↓
Request Ownership
  ↓
PENDING
  ↓
Existing Owner / Authorized Contact
  ├── APPROVE → Re-authenticate → OWNER GRANTED
  ├── REJECT  → Request cancelled + security event
  └── NO RESPONSE → EXPIRED

If existing owner/contact is inaccessible:
  ↓
Verify Business Ownership
  ↓
Evidence / review appropriate to risk
  ↓
Owner authority only after verification succeeds
```

## Implementation Gate

Do not activate this work merely because the claim UI exists or because a user asks to "fix claim" informally.

Activation requires an explicit implementation phase/task based on this decision and the canonical ownership document.

When activated, the worker must first audit:

1. current claim endpoint(s);
2. current tenant lookup/merge behavior;
3. current Owner assignment logic;
4. authentication/session model;
5. email notification infrastructure;
6. audit/security-event model;
7. current ownership tests;
8. current production/data lifecycle safeguards.

Then implement the smallest evidence-backed reconciliation.

## Scope Boundary

This decision does NOT authorize changes to:

- Branch Manager Dashboard;
- Branch Manager order operations;
- catalog;
- inventory;
- POS/KDS;
- payment;
- delivery;
- customer order flow;
- Google authentication architecture.

Those remain separate workstreams.

## Relationship to Canonical Ownership Decision

`docs/BUSINESS_OWNERSHIP_REQUEST_VERIFICATION.md` remains the authoritative business ownership/security contract.

This document only records:

1. the currently observed claim security risk;
2. the decision that it must be fixed;
3. the explicit implementation sequencing;
4. the boundary preventing this issue from being mixed into the current Branch Manager Dashboard work.
