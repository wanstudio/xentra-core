# 🔒 Xentra — Client Data Lifecycle, Visibility & Restart Consistency

**Status: LOCKED / AUTHORITATIVE**  
**Decision Date: 2026-09-14**

## Problem

Client/Owner mutations (edit, delete, deactivate, remove assignment, etc.) must remain authoritative after application/process/VPS restart.

A record that remains physically persisted for history, audit, reporting, or referential integrity must not reappear in the Client/Owner current view merely because the row still exists.

## Core Decision

**Persistence != Visibility.**

Database row existence is not sufficient evidence that an entity is currently visible or actionable to a Client/Owner.

Every current-state read path must derive visibility from the applicable combination of:

- tenant/brand scope;
- actor/RBAC permission;
- entity ownership/assignment scope;
- lifecycle state (active, inactive, deleted/archived, etc.);
- domain-specific eligibility/availability rules.

Frontend filtering is not an authorization boundary. Server-side read paths must enforce canonical visibility rules.

## Delete / Lifecycle Rule

When a Client/Owner deletes or removes an entity:

- the mutation must persist across restart;
- the entity must disappear from all relevant current management/operational views;
- historical records may remain when required by audit, orders, reporting, or referential integrity;
- retained historical data must not leak back into current-state views;
- hard deletion is allowed only when the domain contract permits destruction without breaking historical/reference requirements.

## Seed / Demo Data Rule

Demo/bootstrap seed data must never overwrite, resurrect, or reintroduce a Client/Owner mutation on restart.

Seeders must be idempotent and must distinguish **initial provisioning/default bootstrap** from **runtime client-owned state**.

A restart must not restore a deleted client entity simply because the original demo/default definition still exists in seed code.

If a default/demo record must remain physically present for compatibility or history, its current visibility must still respect the persisted lifecycle/ownership state.

## Read Consistency Rule

For every entity that can be edited/deleted from Client/Owner Dashboard, audit the complete chain:

`UI mutation -> API authorization -> persistence -> restart -> API read -> domain filtering -> UI rendering/cache`

A successful DELETE/UPDATE response is not sufficient. Acceptance requires the resulting state to survive restart and remain consistent across every authorized read path that consumes the entity.

## Cache Rule

Cache invalidation is separate from persistence and authorization.

- Current-state API responses must not serve stale deleted/updated entities after mutation.
- Browser/service-worker/CDN caches must not become the source of truth for management or authorization state.
- Mutation flows should revalidate/refetch canonical server state rather than trusting stale local state.
- Immutable/versioned media delivery URLs may remain cacheable; business-entity visibility remains server-authoritative.
- Do not use broad cache purges as a substitute for fixing persistence, seeding, or permission filters.

## Scope

Applies across Client/Owner-managed entities including, where applicable:

- brands;
- branches;
- categories and branch categories;
- master products and branch products/adoptions;
- menu/catalog assignments;
- staff/team memberships;
- promotions/marketing entities;
- settings and other dashboard-managed records;
- media/entity references where deletion or replacement changes current visibility.

## Required Acceptance Tests

For each mutable entity class, tests must cover at minimum:

1. Owner/authorized Client can mutate only records within the permitted tenant/brand/branch scope.
2. Unauthorized actor cannot read, edit, delete, or infer another tenant's records by changing an ID.
3. Deleted/inactive records do not appear in current management or operational endpoints.
4. Historical/reference records remain valid when the domain requires retention.
5. Restarting the runtime/VPS does not resurrect deleted or reverted client state.
6. Re-fetch after mutation returns canonical server state.
7. Browser/service-worker cache cannot make a deleted/updated entity appear as current state.
8. Seed/bootstrap reruns are idempotent and cannot overwrite client-owned lifecycle state.

## Engineering Constraint

Do **not** solve this with a broad domain rewrite. Trace and repair the smallest authoritative persistence, seed, authorization/scope, query-filter, and cache/revalidation boundaries necessary.

Preserve existing domain contracts unless a new explicit architecture decision is required.

## Agent Rule

When investigating a report equivalent to:

> "I already deleted/edited this, why does it appear again?"

Do not assume browser cache first. Prove the state across:

1. persistence;
2. seed/bootstrap;
3. authorization/scope filtering;
4. read queries;
5. cache/revalidation.

Only after those are proven correct should the issue be classified as a client cache problem.
