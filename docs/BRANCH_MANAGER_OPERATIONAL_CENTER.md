# Xentra — Branch Manager Operational Center

**Status: LOCKED / AUTHORITATIVE — reconciled with Canonical Architecture & Product Library v2 and Branch Manager Menu Configuration v1**  
**Decision date:** 2026-09-17  
**Scope:** Branch-scoped daily restaurant operations + branch-local menu configuration

> **Canonical map:** `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`. This document defines the Branch Manager surface in detail; it must not redefine terminology, scope, or cross-dashboard authority independently.
> **Menu authority lock:** `docs/decisions/branch-manager-menu-configuration-v1.md`.

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
- **Menu**
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
Branch Manager branch-local menu configuration + daily operation
        ↓
Branch-scoped operational state
        ↓
Customer PWA / POS / KDS
```

Branch Manager = **OPERATE + OBSERVE**, including approved **branch-local Menu Configuration**. Core = **AUTHENTICATE + AUTHORIZE + ENFORCE + PERSIST + AUDIT**.

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

## 8. Menu — Branch Assortment & Categories

Branch Manager has explicit **branch-scoped Menu Configuration authority** for the authenticated manager's current Branch.

### 8.1 Adopt products from Master Catalog

Master Catalog remains Owner/Brand authority. Branch Manager may **adopt/select approved Master Products** into the Branch's selling assortment.

Adoption means:
- the product already exists in the Brand Master Catalog;
- the current Branch chooses to sell that product;
- the resulting Branch Product is scoped to the current Branch;
- adoption does not grant any Master Product editing authority.

Branch Manager may not create a new Master Product merely because the Branch needs a menu item.

### 8.2 Branch Categories

Branch Manager may manage **Branch Categories** for the current Branch:
- create;
- rename;
- reorder;
- delete, subject to referential/data-integrity rules.

Branch Categories are not Master Categories. They are branch-local selling structures and may differ between Branches.

### 8.3 Category membership

Branch Manager may assign/remove adopted Branch Products to/from one or more Branch Categories.

The relationship is **many-to-many**:

```text
Branch Product ↔ Branch Category
```

The same Branch Product may appear in multiple local categories without duplicating the product.

### 8.4 Operational availability

Branch Manager continues to operate Branch Product availability/sold-out state.

`branch_products.is_available` remains the branch-scoped availability authority. This must not mutate Master Product `is_active`.

Stock is a separate Inventory concern.

### 8.5 Explicit prohibitions

Branch Manager must not:
- create/edit/delete Master Products;
- create/edit/delete Master Categories;
- modify Bundle/Composite composition;
- change Master Product identity/content/defaults outside approved Branch override contracts;
- modify another Branch's assortment or categories;
- change brand-wide catalog policy;
- create a Branch-owned bundle/composite product.

**No Branch Bundle Engine.** Bundles remain Master Catalog constructs defined by Owner/Brand.

### 8.6 Branch menu resolution

```text
Master Catalog (Owner / Brand)
        ↓ approved Master Products
Branch adoption (Branch Manager, own Branch)
        ↓
Branch Products
        ↓
Branch Categories (Branch Manager, own Branch)
        ↓
Availability / stock (Branch operational state)
        ↓
Customer-facing Branch Menu
```

Adoption/assignment is not a snapshot boundary. Supported Master Product defaults may resolve through the canonical Master → Branch override contract. Branch operational state remains Branch-scoped.

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

Operational and branch-menu mutations use the existing branch-operation audit pattern or its approved successor.

Sensitive actions should preserve:
- Branch;
- actor;
- role;
- action/field;
- previous value;
- new value;
- authorization result;
- timestamp;
- relevant product/category context.

UI may expose last changed by/when, but UI state is not authoritative.

## 13. API/security boundary

Every protected mutation follows the Core authorization sequence:

```text
Authenticate
→ current identity
→ current role/permission
→ current Branch scope
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
- exact branch-scoped staff APIs;
- final API/data mapping for Branch Product adoption and Branch Category CRUD if the current implementation does not yet expose those mutations.

These are explicit gaps. Do not hide them with frontend-only state or ad-hoc fields.

## 15. Implementation rule

Before implementation:
1. consult Library v2 and `docs/decisions/branch-manager-menu-configuration-v1.md`;
2. map feature to Branch Manager responsibility;
3. identify authoritative Core domain/API/schema;
4. identify genuine gap;
5. extend the smallest approved contract;
6. implement a verifiable vertical slice;
7. add authorization, concurrency protection, audit, tests, and browser smoke coverage as appropriate.

Do not rewrite unrelated authentication, payment, Commerce, or Master Catalog authority.

## 16. Canonical relationship

This document is subordinate to:

- locked business decisions;
- `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md` for canonical terminology/scope/authority mapping;
- `docs/decisions/branch-manager-menu-configuration-v1.md` for Branch-local Menu Configuration authority;
- more-specific locked domain contracts.

If a conflict is discovered, stop implementation, reconcile the canonical decision/library, then update this document and implementation evidence.


## 17. 🔒 LOCKED — Human-Readable Business/System Activity Presentation

The Branch Manager dashboard's **Aktivitas Terkini**, Business Log, and System Log must be presented as human-readable operational narratives. Raw database identifiers and structured audit payloads are evidence, not the primary user-facing language.

### Presentation boundary

The authoritative audit record remains structured and append-oriented. Do **not** remove or replace technical fields such as `branch_id`, `product_id`, `actor_id`, `action`, `field`, `previous_value`, `new_value`, and `created_at`.

Instead, the read/presentation layer must translate those records into understandable Indonesian business language.

Example:

- Raw: `action=branch_product.update`, `field=price`, `product_id=...`, `previous_value=40000`, `new_value=44000`
- UI: **Harga Ayam Goreng diubah dari Rp40.000 menjadi Rp44.000** — Budi · Branch Manager · 07:52

Other expected narratives include:

- **Ayam Goreng ditandai tidak tersedia** — Budi · Branch Manager · 07:52
- **Ayam Goreng dipindahkan ke kategori Makanan** — Budi · Branch Manager · 07:52
- **Pesanan #XN-... dibatalkan** — Budi · Branch Manager · 08:14
- **Pesanan #XN-... ditolak** — Budi · Branch Manager · 08:20
- **Status cabang diubah menjadi Tutup Sementara** — Budi · Branch Manager · 08:21
- **Stok Ayam Goreng diubah dari 12 menjadi 8** — Budi · Branch Manager · 08:32

### Business Log vs System Log

**Business Log** explains the business action/decision in language that an Owner or Branch Manager can immediately understand: what happened, which business object was affected, who performed it, and the reason when applicable.

**System Log** explains the corresponding system/operational event in human-readable language. It may expose technical details only in an expandable detail/technical-reference context.

Neither log should render raw JSON, UUIDs, internal action constants, or database field names as the primary activity sentence.

### Technical traceability

Technical identifiers remain available for investigation and audit traceability through a secondary **Detail Teknis / Reference** view when appropriate. This may include Log ID, Branch ID, Product ID, Order ID, actor ID, internal action, field, before/after values, and correlation/reference information.

The rule is therefore:

**Structured authoritative evidence → semantic log formatter/read model → human-readable dashboard presentation → optional technical detail.**

This is a presentation/read-model concern, not a new Activity domain and not a replacement for the existing audit trail.
