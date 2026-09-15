# Xentra — Owner ↔ Branch Manager Dashboard Boundary

**Status: LOCKED / AUTHORITATIVE**  
**Decision date:** 2026-09-15  
**Scope:** Client/Owner Dashboard and Branch Manager Operational Center

## 1. Purpose

This document locks the responsibility boundary between the Owner Dashboard and the Branch Manager Dashboard.

The dashboards are complementary, not duplicate versions of the same control surface:

- **Owner:** CONFIGURE + GOVERN + OBSERVE
- **Branch Manager:** OPERATE + OBSERVE
- **Xentra-Core:** AUTHENTICATE + AUTHORIZE + ENFORCE + PERSIST + AUDIT
- **Customer/POS/KDS:** CONSUME / EXECUTE according to their authorized role and contract

The same business entity may therefore be visible in both dashboards, but its mutation authority must remain semantically distinct.

## 2. Canonical Responsibility Model

```text
Owner / Brand Policy
        ↓
Xentra-Core authorization + business rules
        ↓
Branch Manager daily operation
        ↓
Branch-scoped operational state
        ↓
Customer PWA / POS / KDS / other consumers
```

Owner decisions establish durable business configuration and governance. Branch Manager actions operate the current branch within those boundaries. Core remains the source of truth and must enforce scope and authorization server-side.

## 3. Owner Dashboard — Authority

Owner is responsible for business-level configuration, governance, cross-branch visibility, and exceptional intervention.

### Owner owns

- Master Product Catalog
- Categories
- Branch product adoption
- Branch Menu configuration
- Permanent/default pricing and business policy where applicable
- Branch profile and structural configuration
- Default recurring operating schedule
- Table/floor-plan configuration
- Promotion/campaign creation and governance
- Eligible branches, products/categories, periods, limits, stacking, channels and other campaign policy
- Workforce management according to locked `User → Role → Scope` RBAC
- Cross-branch orders/history/reporting
- Cross-branch business performance
- Branch health / operational attention visibility
- Audit/history visibility

### Owner normally does not perform daily branch operations

The Owner Dashboard must not become the normal operational queue for:

- daily open/close
- temporary online-order pause
- daily table blocking
- daily sold-out/unavailable product operation
- daily stock operation
- normal order ACCEPT/REJECT
- routine branch promo activation

These belong to the Branch Manager Operational Center when the actor has the required branch-scoped permission.

### Exceptional Owner override

Owner may have explicit emergency/governance override capabilities where a business contract requires them, such as **Force Close Branch**.

Such actions are exceptional, not a second daily-operations workflow, and require:

- explicit Core authorization;
- appropriate scope/role checks;
- reason where required;
- audit trail;
- authoritative downstream state.

## 4. Branch Manager — Authority

Branch Manager is the operational authority for one Branch.

### Branch Manager owns daily operation

- Current branch open/closed operational state
- Temporary online-order pause/throttle
- Daily operating exceptions within the approved schedule contract
- Table availability state
- Reservation/occupancy operational context
- Branch product availability / sold-out state
- Branch stock operational state
- Activation/deactivation of approved branch-scoped promotions
- Branch-scoped order queue and Branch Acceptance
- Branch operational staff within delegated scope
- Daily operational reporting
- Operational audit context

Branch Manager cannot silently create or alter brand-wide policy.

## 5. Domain Boundary Matrix

| Domain | Owner Dashboard | Branch Manager Dashboard | Core Authority |
|---|---|---|---|
| Branch profile | Configure | Observe | Enforce scope |
| Branch status | Observe + exceptional override where approved | Operate daily state | Enforce |
| Operating hours | Default/permanent schedule | Daily exception/temporary override | Resolve effective state |
| Online orders | Observe + exceptional override if explicitly approved | Pause/resume/throttle | Enforce effective availability |
| Master Products | Create/edit/manage | No master editing | Authoritative catalog |
| Branch Menu | Configure adoption/assortment/policy | Operate availability | Enforce branch scope |
| Stock | Observe policy/reporting | Operate branch stock | Persist + validate |
| Tables/floor plan | Configure geometry/layout | Operate daily status | Enforce availability |
| Reservations | Governance/reporting | Daily operational context | Validate concurrency |
| Promotions | Create/govern campaign | Activate/deactivate approved branch promo | Evaluate eligibility |
| Orders | Cross-branch observe/investigate | Branch queue + ACCEPT/REJECT | Enforce transition authority |
| Team | Full workforce authority per RBAC | Branch-scoped operational staff | Enforce User→Role→Scope |
| Reports | Strategic/cross-branch | Daily branch operations | Authoritative read model |
| Audit | Governance/history | Operational context | Append/enforce |

## 6. Catalog Boundary

The system must preserve the distinction between:

1. **Master Product** — business identity/content controlled at Owner/Brand level.
2. **Branch adoption / Menu configuration** — determines which branches sell the product and how it is presented/configured.
3. **Branch availability** — daily operational state controlled by the Branch Manager.

`branch_products.is_available` remains the branch-scoped availability authority.

A Branch Manager marking an item sold out must not silently mutate Master Product `is_active`.

The Owner UI may observe branch availability, but the normal daily mutation belongs to Branch Manager.

## 7. Operating Hours and Online Ordering

The effective branch state must be derived from the approved precedence between:

```text
Owner default schedule
        +
Branch special schedule / daily exception
        +
Explicit operational override
        ↓
Effective branch state
        ↓
Customer/POS/KDS behavior
```

Restaurant closure and online-order pause are distinct concepts. `PAUSED` must not be represented as `CLOSED`.

No client-side timer or dashboard UI state is authoritative for effective ordering availability.

## 8. Tables

Owner/Admin configuration covers physical table/floor-plan geometry, such as creating, moving, deleting, numbering, capacity and dining-room layout.

Branch Manager operates the current state of those tables:

- AVAILABLE
- RESERVED
- OCCUPIED
- BLOCKED
- OUT_OF_SERVICE

Core must validate availability at the transaction boundary and protect reservation/selection mutations against concurrent races. Frontend disabling alone is insufficient.

## 9. Promotions

Owner/Brand authority defines campaign policy. Branch Manager may only operate promotions within the branch scope and permission explicitly granted by the promotion contract.

The initial Branch Manager surface should favor activation/deactivation of approved campaigns over exposing a full promotion builder.

Do not treat legacy/example `branch_settings.promo_config` data as proof that the final promotion domain already exists.

## 10. Orders

Owner Orders is primarily a business/history/investigation surface across authorized branches.

Branch Manager Orders is an operational queue for the current branch.

Branch Acceptance remains a dedicated mutation boundary. A generic kitchen/order status PATCH must not be used as a substitute for ACCEPT/REJECT authority.

Payment settlement must not silently become Branch Acceptance.

## 11. Team

Owner retains the locked full workforce-management authority within authorized client scope.

Branch Manager receives only branch-scoped operational staff authority. Access to the Branch Manager dashboard must never imply cross-branch workforce authority.

RBAC is centralized in Xentra-Core; dashboard visibility is not authorization.

## 12. Owner Branches Page

The Owner `Branches` area remains valid, but its role is **Branch Management / Configuration & Performance**, not daily Branch Operations.

It should provide:

- branch list and profile;
- branch configuration;
- branch manager assignment;
- default operating configuration;
- menu/adoption context;
- table/floor-plan configuration;
- branch performance;
- branch health / operational attention;
- audit/history visibility;
- entry point into the Branch Manager operational surface.

The Owner should be able to understand current branch state without duplicating the Manager's daily control queue.

## 13. Owner Branch Health / Operational Attention

Add a lightweight cross-branch visibility layer to Owner Dashboard.

Examples:

- branch currently closed;
- online ordering paused;
- unusual or emergency closure;
- unavailable products;
- low-stock attention;
- operational issue requiring review;
- who changed the state and when.

This is primarily an **observation/governance** surface. It should not automatically duplicate every Branch Manager mutation control.

## 14. Navigation Terminology

Use language that reinforces the boundary:

- Owner: `Team`
- Branch Manager: `Staff`
- Owner: `Branch Management` / `Configuration & Performance`
- Branch Manager: `Operasional`
- Owner Catalog: `Master Products`, `Categories`, `Menus`, `Branch Menu Configuration`
- Branch Manager Menu: `Availability` / `Sold Out` operational state

Avoid ambiguous labels such as one shared `Operations` area or one shared `Available` toggle whose meaning changes by role.

## 15. Implementation Rules

Before implementing or expanding either dashboard:

1. Map the feature to the responsibility boundary in this document.
2. Identify the authoritative Core domain/API/schema.
3. Do not duplicate mutation authority merely because both dashboards display the same entity.
4. Extend the smallest necessary contract when a genuine capability gap exists.
5. Enforce authorization and scope in Core.
6. Audit sensitive operational mutations.
7. Protect race-sensitive operations transactionally.
8. Implement vertical slices with tests and browser smoke coverage where applicable.
9. If UI requirements conflict with this boundary, stop and return to the decision log instead of silently weakening the contract.

## 16. Relationship to Existing Locked Contracts

This decision complements and does not replace:

- `docs/BRANCH_MANAGER_OPERATIONAL_CENTER.md`
- existing Owner Dashboard UI Blueprint in Notion
- existing `User → Role → Scope` RBAC/security contracts
- existing catalog/menu ownership contracts
- existing Branch Acceptance / payment separation contracts

Where a more specific locked contract exists, that contract remains authoritative for its domain; this document defines the cross-dashboard responsibility boundary.
