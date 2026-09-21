# Xentra Core — Technical Architecture Specification

**Version:** 2.1.0  
**Status:** Canonical Engineering Specification — reconciled with `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`  
**Decision date:** 2026-09-15

> **Canonical architecture/product map:** `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`. This document describes engineering structure; it must not redefine business ownership or dashboard authority independently.

## 1. System Overview

Xentra is a multi-tenant, multi-brand, multi-branch restaurant platform supporting customer ordering, branch operations, POS, KDS, inventory, payment, delivery, reporting, and platform provisioning.

### Merchant hierarchy

```text
Platform
└── Organization
    └── Brand
        └── Branch
            ├── Terminal
            │   └── Shift
            └── branch-scoped operational context
```

## 2. Architectural principles

1. **Core is authoritative for identity and authorization.** Authentication, current role, permission, tenant/brand/branch scope, target relationship, and sensitive authorization decisions are server-side.
2. **Customer branch selection is not client authority.** Client branch context is input; the server resolves eligibility and commitment according to the Commerce contract.
3. **Catalog concepts remain separate.** Master Product, Master Category, Branch Product, Branch Category, Branch Menu, Branch Product Availability, and Stock are not synonyms.
4. **Commerce and POS are separate transaction models.** `Order` is not `Sale`; payment/settlement is not Branch Acceptance.
5. **Operational state is distinct from configuration.** A durable configuration value does not itself represent current runtime state.
6. **Financial and operational lifecycles remain separate.** Order fulfillment, payment, settlement, Sale, and Shift have distinct authority and state machines.
7. **Historical transaction data is protected.** Required snapshots remain immutable so later configuration changes do not distort historical reporting.
8. **Missing authoritative evidence fails safely.** No arbitrary availability, permission, stock, or financial fallback may manufacture a valid state.
9. **UI is never an authorization source.** Hidden/visible controls are presentation only.

## 3. Module boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│                       SURFACES                              │
│ Owner Dashboard | Branch Manager | Customer PWA | POS | KDS │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS / SSE / WebSocket
┌────────────────────────────▼────────────────────────────────┐
│                         CORE                                │
│ Auth • RBAC • Scope • Tenant/Brand/Branch • Integrity       │
│ Persistence enforcement • Audit foundation                  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                    DOMAIN SERVICES                           │
│ Catalog • Commerce • POS • Inventory • Payment              │
│ Delivery • Reporting • Integration                           │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                    DATA / PROVIDERS                          │
│ SQLite/PostgreSQL/MySQL • Routing • Midtrans • Wablas etc.  │
│ (Wablas / WhatsApp OTP: RETIRED 2026-09-21 — no longer used) │
└─────────────────────────────────────────────────────────────┘
```

Physical service/database separation is not implied unless separately locked.

## 4. Domain ownership

| Domain | Responsibility |
|---|---|
| Xentra-Core | identity, RBAC, scope, shared integrity, enforcement and audit foundation |
| Catalog | Master Product and selling-catalog concepts |
| Commerce | Cart, Checkout, Order |
| POS | Terminal, Shift, Sale, Sale Item and in-store execution |
| Inventory | stock and inventory movement |
| Payment | payment and settlement lifecycle |
| Delivery | delivery calculation and fulfillment |
| Reporting | reporting read models and analytics |
| Integration | external providers and hardware adapters |

An orchestrator may coordinate multiple domains but does not transfer ownership.

## 5. Surface responsibility

### Owner Dashboard
Business Control Center: **CONFIGURE + GOVERN + OBSERVE**.

It handles master catalog governance, durable branch configuration, campaign governance, workforce authority, cross-branch visibility, reporting, Branch Management/Configuration & Performance, Branch Health, and explicitly authorized exceptional intervention.

It is not the normal daily queue for branch open/close, sold-out operation, daily table blocking, branch order acceptance, daily stock operation, or routine branch promo activation.

### Branch Manager Operational Center
Daily branch operations: **OPERATE + OBSERVE**.

It handles current Branch operational state, online-order pause/throttle, daily schedule exceptions, table state, Branch Product availability, branch stock operation, approved branch promotion activation, branch order queue/Branch Acceptance, branch-scoped staff, and daily reporting.

### Customer PWA
**CONSUME:** discover, purchase, track.

### POS / KDS
**EXECUTE:** POS executes in-store transactions; KDS executes kitchen preparation workflow.

## 6. Canonical catalog boundary

```text
Master Product / Master Category
          ↓
Branch Menu Configuration / Branch Product
          ↓
Branch Product Availability
          ↓
Customer / POS / KDS
```

Master Product defaults may be inherited by supported Branch fields; explicit Branch overrides win. Branch availability is a separate operational state. Stock is a separate Inventory concern.

Do not reintroduce snapshot/save-point terminology as the current resolution model.

## 7. Canonical commerce boundary

```text
Multi-Branch Cart
        ↓
Single-Branch Checkout
        ↓
Single-Branch Order
```

`Order` is a Commerce object. `Sale` is a POS object. `Payment` and `Settlement` are financial objects. Branch Acceptance is a dedicated authorization boundary and must not be implemented as a side effect of payment settlement.

## 8. Configuration boundary

Configuration is scoped durable input. It must not become a generic business-logic container.

Canonical examples:

- Branch Configuration
- Branch Delivery Configuration
- Branch Pickup Configuration
- Branch Dine-In Configuration
- Operating Schedule Configuration
- Branch Menu Configuration

Infrastructure secrets remain server-side. Technical invariants remain code constants. Domain workflow remains in its domain.

## 9. State and authority

Core resolves and enforces effective state. Examples:

```text
Owner default schedule
        +
Branch daily/special exception
        +
approved operational override
        ↓
Effective Branch state
```

`PAUSED` online ordering is not equivalent to `CLOSED`.

Table states are `AVAILABLE`, `RESERVED`, `OCCUPIED`, `BLOCKED`, `OUT_OF_SERVICE`.

Branch Product availability is not Master Product `is_active` and is not stock quantity.

## 10. Protected mutation sequence

```text
Authenticate
→ current identity
→ current role/permission
→ current scope
→ target
→ actor-target relationship
→ requested authority
→ business invariants
→ atomic mutation
→ security side effects when required
→ audit
→ authoritative response
```

Client-provided IDs, hidden UI controls, stale claims, or local timers are not authorization sources.

## 11. Reliability and integrity

Race-sensitive operations such as Branch Acceptance, table selection/reservation, guarded stock deduction, and other financial/operational mutations must be protected at the server transaction boundary.

Bootstrap/restart must preserve persisted business state and must not destructively converge live business data to demo defaults.

## 12. Documentation precedence

When this engineering document conflicts with the canonical library or a more specific locked business contract:

1. locked business decision wins;
2. Library v2 is reconciled;
3. affected domain contract is reconciled;
4. implementation is reviewed;
5. tests/evidence are updated.

Do not solve documentation conflict by introducing a synonym or silently changing business authority.

## 13. Canonical reference

`docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md` is the primary map for entity naming, scope, ownership, authority, dashboard surface, lifecycle, terminology, and AI-worker implementation rules.
