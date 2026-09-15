# Xentra — Owner ↔ Branch Manager Dashboard Boundary

**Status:** LOCKED / AUTHORITATIVE — reconciled with Canonical Architecture & Product Library v2  
**Decision date:** 2026-09-15  
**Scope:** Client/Owner Dashboard and Branch Manager Operational Center

> **Canonical map:** `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`. This document remains the detailed cross-dashboard contract; Library v2 is the canonical map for terminology, scope, authority, lifecycle, and surface relationships.

## 1. Purpose

The Owner Dashboard and Branch Manager Operational Center are complementary, not duplicate versions of the same control surface.

- **Owner:** CONFIGURE + GOVERN + OBSERVE
- **Branch Manager:** OPERATE + OBSERVE
- **Xentra-Core:** AUTHENTICATE + AUTHORIZE + ENFORCE + PERSIST + AUDIT
- **Customer/POS/KDS:** CONSUME / EXECUTE according to contract

The same business entity may be visible in multiple surfaces, but mutation authority remains semantically distinct and server-enforced.

## 2. Owner Dashboard

Owner is responsible for durable business configuration, governance, cross-branch visibility, and explicitly authorized exceptional intervention.

Owner authority includes:
- Master Product Catalog and Master Categories;
- Branch Menu configuration and durable Branch Product adoption/configuration;
- permanent/default Branch configuration and recurring operating schedule;
- table/floor-plan geometry and structural configuration;
- promotion/campaign creation and governance;
- cross-branch Orders/history/reporting/performance;
- workforce management under `User → Role → Scope` RBAC;
- Branch Health / operational attention visibility;
- audit/history visibility.

Owner does **not** become the normal daily operational queue for Branch open/close, online-order pause, table blocking, Branch Product sold-out state, daily stock operation, normal Branch Acceptance, or routine approved-promo activation.

Exceptional Owner overrides require explicit authorization, appropriate scope, reason where required, and auditability.

## 3. Branch Manager Dashboard

Branch Manager is the operational authority for one Branch.

Branch Manager authority includes:
- daily Branch open/close state and approved schedule exceptions;
- online-order pause/resume/throttle;
- daily table state and reservation/occupancy context;
- Branch Product availability/sold-out state;
- Branch stock operation;
- activation/deactivation of approved Branch-scoped promotions;
- Branch order queue and dedicated Branch Acceptance;
- Branch-scoped operational staff;
- daily operational reporting and audit context.

Branch Manager cannot silently create or alter brand-wide policy.

## 4. Domain boundary matrix

| Domain | Owner | Branch Manager | Core |
|---|---|---|---|
| Branch profile | Configure | Observe | Enforce scope |
| Branch status | Observe + exceptional override | Operate daily state | Enforce |
| Operating hours | Default/permanent schedule | Daily/special exception | Resolve effective state |
| Online orders | Observe + explicit exception | Pause/resume/throttle | Enforce effective availability |
| Master Product | Create/edit/manage | Observe | Authoritative catalog enforcement |
| Branch Menu | Configure adoption/assortment/policy | Observe | Enforce branch scope |
| Branch Product Availability | Observe | Operate | Enforce |
| Stock | Observe/report | Operate | Persist/validate |
| Tables/floor plan | Configure geometry | Operate daily status | Enforce availability/concurrency |
| Reservations | Governance/reporting | Daily operational context | Validate concurrency |
| Promotions | Create/govern campaign | Activate approved Branch promo | Evaluate eligibility |
| Orders | Cross-branch observe/investigate | Branch queue + ACCEPT/REJECT | Enforce transition authority |
| Team | Full workforce authority per RBAC | Branch-scoped staff | Enforce User→Role→Scope |
| Reports | Strategic/cross-branch | Daily Branch operations | Authoritative read model |
| Audit | Governance/history | Operational context | Append/enforce |

## 5. Catalog boundary

Canonical concepts are separate:

```text
Master Product
    ≠ Master Category
    ≠ Branch Product
    ≠ Branch Category
    ≠ Branch Menu
    ≠ Branch Product Availability
    ≠ Stock
```

Owner manages Master Product and durable Branch Menu configuration. Branch Manager operates Branch Product availability. `branch_products.is_available` is the Branch-scoped availability authority.

Sold-out/unavailable operation must not silently mutate Master Product `is_active`.

## 6. Operating hours and online ordering

```text
Owner default/permanent schedule
        +
Branch daily/special exception
        +
approved operational override
        ↓
Core-resolved effective state
```

Restaurant closure and online-order pause are distinct concepts. `PAUSED` must not be represented as `CLOSED`.

## 7. Tables

Owner/Admin configures physical floor-plan geometry. Branch Manager operates current table status:

`AVAILABLE`, `RESERVED`, `OCCUPIED`, `BLOCKED`, `OUT_OF_SERVICE`.

Core validates availability server-side and protects race-sensitive mutations.

## 8. Promotions

Owner/Brand defines campaign policy. Branch Manager may operate only approved Branch-scoped promotions. A full promotion builder is not implied by Manager access.

## 9. Orders

Owner Orders is primarily cross-branch business/history/investigation. Branch Manager Orders is the operational queue.

Branch Acceptance remains a dedicated mutation boundary. Payment settlement is a financial mutation and must not silently become Branch Acceptance. Generic status PATCH must not be used to bypass this distinction.

## 10. Workforce

Owner retains highest client workforce authority within authorized scope. Branch Manager receives only Branch-scoped operational staff authority. Core centrally enforces User → Role → Scope.

## 11. Branches and Branch Health

Owner `Branches` is Branch Management / Configuration & Performance, not daily Branch Operations. It may expose branch profile/configuration, manager assignment, default operating configuration, menu/adoption context, table/floor-plan configuration, performance, health, and audit/history, plus entry to Branch Manager operations.

`Branch Health` is an observation/governance surface for closure, online-order pause, emergency state, unavailable products, low-stock attention, unresolved operational issues, and who changed state/when.

## 12. Implementation invariant

Before implementing either dashboard:
1. consult Library v2;
2. map the feature to the responsibility boundary;
3. identify authoritative Core domain/API/schema;
4. do not duplicate mutation authority because an entity is visible in another surface;
5. enforce authorization and scope in Core;
6. audit sensitive mutations;
7. protect race-sensitive operations transactionally;
8. update the affected domain contract if a genuine capability gap exists;
9. update this document only when the business contract changes.

## 13. Related contracts

- `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md` — canonical architecture/product map;
- `docs/BRANCH_MANAGER_OPERATIONAL_CENTER.md` — detailed Branch Manager operational contract;
- existing Owner Dashboard UI Blueprint in Notion;
- existing `User → Role → Scope` RBAC/security contracts;
- existing Catalog/Menu ownership contracts;
- existing Branch Acceptance/payment separation contracts.

Where a more specific locked domain contract exists, that contract remains authoritative for its domain. Library v2 remains the cross-cutting canonical map.
