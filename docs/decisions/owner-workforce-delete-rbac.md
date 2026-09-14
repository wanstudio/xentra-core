# Locked Decision — Owner Workforce Management & Permanent Member Delete

**Status:** LOCKED  
**Date:** 2026-09-14

## Decision

In the Xentra Client/Owner Dashboard, `owner` is the highest authority inside the client organization for workforce management.

The Owner may:

- view members
- create members
- edit members
- assign roles and scopes
- deactivate members
- reset member passwords
- **permanently delete staff/member accounts**

This extends the existing `User → Role → Scope` RBAC model. It does not introduce a new permission system, frontend-only authorization, or hardcoded client-specific rules.

## Role Boundary

| Action | Owner | Brand Manager | Branch Manager |
|---|---|---|---|
| View members | Full organization scope | Delegated/scoped | Branch scoped |
| Add members | Full organization scope | Delegated/scoped | Branch scoped |
| Edit members | Full organization scope | Delegated/scoped | Branch scoped |
| Assign role/scope | Full authority | Delegated | Limited/scoped |
| Deactivate | Full authority | Delegated | Limited/scoped |
| Reset password | Full authority | Delegated | Limited/scoped |
| **Permanent delete member** | **YES** | **NO** | **NO** |
| Delete/replace Owner | Separate ownership flow | NO | NO |

## Delete Semantics

Permanent deletion removes the member's account/membership access but **must not cascade-delete business history** such as orders, transactions, audit records, or other records required for business integrity.

The Owner must not be able to delete their own account through ordinary Team management. Ownership lifecycle is a separate controlled flow.

## Enforcement

Core/backend authorization is authoritative. Hiding a Delete action in the frontend is not a security boundary.

Implementation must enforce:

1. authenticated actor is an Owner;
2. target member is within the actor's authorized organization scope;
3. target is not the actor's own account;
4. protected ownership constraints are respected;
5. historical business records are preserved;
6. unauthorized Brand Manager and Branch Manager attempts return an authorization denial.

## UI

Owner Team member rows should expose permanent deletion as an Owner-only action, alongside existing Edit, Deactivate, and Reset Password actions. The destructive action requires explicit confirmation.

## Testing

Add/maintain coverage for:

- Owner can permanently delete an eligible member.
- Owner cannot delete self through ordinary Team management.
- Brand Manager cannot permanently delete a member.
- Branch Manager cannot permanently delete a member.
- Cross-organization/cross-scope deletion is denied.
- Business history remains intact after deletion.
- Existing User → Role → Scope and tenant isolation behavior remains green.
