# Locked Decision — Multi-Business Workforce Membership v1

**Status:** IMPLEMENTED — architecture decision aligned with the workforce invitation contract  
**Decision date:** 2026-09-24

## Canonical behavior

A single Xentra User identity may have multiple independent workforce memberships:

```text
One Xentra User
  ├── Business A → OWNER
  ├── Business B → MANAGER
  └── Customer identity remains in the separate Customer domain
```

The same normalized email identifies the same workforce User identity. The role and operational scope are **membership properties of a specific Brand/Business**, not global properties of the User.

## Invitation behavior

When an Owner of Business B invites an email that already belongs to an existing Xentra User:

```text
Owner of B
  ↓
Team → Invite Member
  ↓
email = existing.user@email
role = Manager
scope = Business B / Branch
  ↓
accept invitation
  ↓
attach workforce_memberships row for Business B
```

The existing User identity is reused. No duplicate User is created, and no existing membership for another Business is overwritten.

## Persistence model

### User identity

`users` remains the authentication identity record and retains legacy scope columns for compatibility during migration.

### Workforce relationship

Canonical per-business authorization is stored in:

```text
workforce_memberships
- user_id
- organization_id
- brand_id
- branch_id
- role
- status
```

A User may have at most one active/current membership row per Brand via the unique `(user_id, brand_id)` key.

## Security boundaries

Being Owner/Manager in one Business does not automatically grant access to another Business.

Protected tenant operations resolve the current Business membership before applying role and branch authorization.

Changing or disabling a membership affects that Business relationship. It must not disable or overwrite the User's relationships in other Businesses.

Deleting a team member from a Business removes that membership rather than deleting the global User identity.

## Customer boundary

Customer identity remains intentionally separate from workforce identity:

```text
users + user_auth_providers
    = workforce identity

customers + customer_auth_providers
    = customer identity
```

The same email may therefore exist in both domains without creating an email uniqueness collision between Customer and Workforce.

## Compatibility

Existing `users.brand_id`, `users.organization_id`, `users.branch_id`, and `users.role` fields remain temporarily for backward compatibility and migration safety.

New authorization logic treats `workforce_memberships` as the canonical per-business relationship whenever a membership exists.

## Required regression scenario

The implementation must preserve this scenario:

```text
User X
  Business A → OWNER

Owner of Business B invites User X's email
  Business B → MANAGER

Expected:
  - same users.id
  - Business A membership unchanged
  - Business B membership added
  - login/session on A resolves OWNER
  - login/session on B resolves MANAGER
```
