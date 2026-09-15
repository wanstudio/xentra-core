# Xentra — Branch Manager Operational Center

**Status: LOCKED / AUTHORITATIVE — reconciled with Canonical Architecture & Product Library v2**  
**Decision date:** 2026-09-15  
**Scope:** Branch-scoped daily restaurant operations

> **Canonical map:** `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`. This document defines the Branch Manager surface in detail; it must not redefine terminology, scope, or cross-dashboard authority independently.

## 1. Purpose

Branch Manager is the operational authority for a single Branch. The dashboard is an **Operational Center**, not a generic Branch Configuration page.

Primary landing surface: **Hari Ini**. The manager should immediately understand whether the Branch can accept online business, what needs attention, and which daily operational actions are available.

Owner/Brand policy remains outside this scope. Branch Manager cannot silently create or alter brand-wide business policy.

## 2. Canonical information architecture

### Hari Ini
- Branch identity + current date/time context
- Current operational status
- Today's regular/special hours
- Quick operational actions
- Orders/new orders
- Table availability
- Unavailable menu items
- Active approved branch promos
- Low-stock attention
- Recent operational activity / audit context

### Operasional
- Pesanan
- Meja
- Menu availability
- Promo activation
- Stok

### Tim
- Staff

### Laporan
- Penjualan Hari Ini

### Pengaturan
- Jam Operasional / approved branch operational exceptions

Visual navigation may evolve; business responsibility remains canonical.

## 3. Responsibility model

```text
Owner / Brand Policy
        ↓
Xentra-Core authorization + business rules
        ↓
Branch Manager daily operation
        ↓
Branch-scoped operational state
        ↓
Customer PWA / POS / KDS
```

Branch Manager = **OPERATE + OBSERVE**. Core = **AUTHENTICATE + AUTHORIZE + ENFORCE + PERSIST + AUDIT**.

## 4. Branch operational state

The system distinguishes restaurant state from online-order availability.

Canonical conceptual states:
- `OPEN`
- `PAUSED`
- `CLOSED`
- `SCHEDULED_CLOSED`
- `EMERGENCY_CLOSED`

`PAUSED` means online ordering is temporarily paused/throttled while the Branch may remain operational. It is not equivalent to `CLOSED`.

### Manual controls
Branch Manager may perform branch-scoped operational actions such as:
- Buka Cabang
- Tutup Sementara
- Pause Order Online
- Resume Order Online

Sensitive changes require reason where the contract requires it and must be audited.

The current live schema has `branches.is_open_override` as a server-authoritative manual open/close switch. Do not invent a second competing authority without an explicit schema/API decision.

## 5. Operating hours

The intended contract supports:
- weekly recurring hours;
- special dates/holidays;
- schedule-driven state;
- explicit manual override precedence;
- customer-facing effective status.

Where the live implementation lacks the final persistence contract, record a **data-contract gap** rather than hiding the gap with frontend state or ad-hoc JSON.

Authority boundary:

```text
Owner default/permanent schedule
        +
Branch daily/special exception
        +
approved operational override
        ↓
Core-resolved effective state
```

## 6. Online-order availability

Online ordering is distinct from Branch closure.

Minimum semantics:
- bounded pause duration or manual resume;
- server-authoritative state;
- audit trail;
- customer APIs consume effective state;
- no client timer is authoritative.

Branch Manager operates this within branch scope. Owner observes and may receive exceptional override only where separately authorized.

## 7. Tables

Daily Branch Manager table states:
- `AVAILABLE`
- `RESERVED`
- `OCCUPIED`
- `BLOCKED`
- `OUT_OF_SERVICE`

Manager responsibilities:
- view current state;
- block/unblock operationally;
- see reservation/occupancy context;
- provide reason for manual block where required.

Owner/Admin configuration of physical floor-plan geometry is separate from daily status operation. Creating/moving/deleting tables is not implied by Manager access.

Core must validate availability at reservation/selection transaction boundaries and protect race-sensitive mutations.

## 8. Menu availability

Branch Manager operates **Branch Product Availability**, not Master Product identity.

`branch_products.is_available` remains the branch-scoped availability authority.

Manager may mark a Branch Product available or unavailable/sold out. This must not mutate Master Product `is_active`.

Stock is a separate Inventory concern. `low_stock_threshold` is Branch-scoped configuration/operational attention data.

Canonical distinction:

```text
Master Product
    ≠ Branch Product
    ≠ Branch Menu
    ≠ Branch Product Availability
    ≠ Stock
```

## 9. Promotions

Branch Manager may operate **approved branch-scoped promotions** where explicitly permitted.

Owner/Brand defines campaign policy. Manager activation/deactivation is operational execution, not campaign governance.

Do not treat legacy `branch_settings.promo_config` data as proof that the final promotion domain already exists.

## 10. Orders and Branch Acceptance

Branch Manager needs a branch-scoped operational order queue.

The surface may:
- view pending orders;
- inspect details;
- ACCEPT through dedicated Branch Acceptance;
- REJECT through dedicated Branch Acceptance with reason;
- reconcile current server state.

Do not use generic status PATCH as a substitute for Branch Acceptance.

Payment settlement is a financial mutation and must not silently become order acceptance.

Owner Orders remains a cross-branch business/history/investigation surface, not the normal Branch acceptance queue.

## 11. Staff

Staff management is Branch-scoped for operational workforce. RBAC remains centralized in Core.

Branch Manager must not gain cross-Branch workforce authority merely from access to this dashboard.

## 12. Auditability

Operational mutations use the existing branch-operation audit pattern or its approved successor.

Sensitive actions should preserve:
- Branch;
- actor;
- role;
- action/field;
- previous value;
- new value;
- authorization result;
- timestamp;
- relevant product/table context.

UI may expose last changed by/when, but UI state is not authoritative.

## 13. API/security boundary

Every protected mutation follows the Core authorization sequence:

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

Client-provided `branch_id` is context/input, never sufficient authorization.

## 14. Implementation gaps

Before coding a new capability, verify/define the smallest necessary contract for:
- operating-hours and special-schedule persistence;
- richer Branch operational state beyond current implementation authority;
- online-order pause;
- table/reservation state and concurrency;
- Branch order queue/acceptance alignment;
- branch promotion domain/permissions;
- exact branch-scoped staff APIs.

These are explicit gaps. Do not hide them with frontend-only state or ad-hoc fields.

## 15. Implementation rule

Before implementation:
1. consult Library v2;
2. map feature to Branch Manager responsibility;
3. identify authoritative Core domain/API/schema;
4. identify genuine gap;
5. extend the smallest approved contract;
6. implement a verifiable vertical slice;
7. add authorization, concurrency protection, audit, tests, and browser smoke coverage as appropriate.

Do not rewrite unrelated authentication, payment, Catalog ownership, or Commerce semantics.

## 16. Canonical relationship

This document is subordinate to:

- locked business decisions;
- `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md` for canonical terminology/scope/authority mapping;
- more-specific locked domain contracts.

If a conflict is discovered, stop implementation, reconcile the canonical decision/library, then update this document and implementation evidence.
