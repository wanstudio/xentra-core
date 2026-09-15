# Xentra — Branch Manager Operational Center

**Status: LOCKED / AUTHORITATIVE**  
**Decision date:** 2026-09-15  
**Scope:** Branch-scoped daily restaurant operations for Xentra-Core / Merchant Dashboard

## 1. Purpose

Branch Manager is the operational authority for a single Branch. The dashboard is an **Operational Center**, not a generic Branch Settings page.

The primary landing surface is **Hari Ini**: the manager should immediately understand whether the branch can accept online business, what needs attention, and which daily operational actions are available.

Owner/Brand-level policy remains outside this scope. Branch Manager cannot silently create or alter brand-wide business policy.

## 2. Canonical Dashboard Information Architecture

### Hari Ini
- Branch identity + current date/time context
- Current operational status
- Today's regular/special hours
- Quick operational actions
- Orders/new orders
- Table availability
- Unavailable menu items
- Active branch promos
- Low-stock attention
- Recent operational activity / audit context

### Operasional
- Pesanan
- Meja
- Menu
- Promo
- Stok

### Tim
- Staff

### Laporan
- Penjualan Hari Ini

### Pengaturan
- Jam Operasional

The navigation may evolve visually, but the business responsibilities above remain the canonical scope.

## 3. Branch Operational State

The system must distinguish **restaurant open/closed** from **online-order availability**.

Canonical conceptual states:
- `OPEN` — branch is operational and online ordering may be available according to channel capability.
- `PAUSED` — branch remains operational, but online ordering is temporarily paused/throttled.
- `CLOSED` — branch is not operational for the relevant customer flow.
- `SCHEDULED_CLOSED` — closed because the applicable schedule says so.
- `EMERGENCY_CLOSED` — manually closed for an exceptional operational reason.

### Manual controls
Branch Manager may perform branch-scoped operational actions such as:
- Buka Cabang
- Tutup Sementara
- Pause Order Online
- Resume Order Online

Sensitive manual changes require a reason where applicable and must be audit logged.

`PAUSED` must not be represented as equivalent to `CLOSED`.

### Current implementation boundary
The current live schema already has `branches.is_open_override` as the server-authoritative manual open/close switch. Do not invent a second competing open/close authority. Any richer state machine must be introduced through an explicit schema/API contract update.

## 4. Operating Hours

The final operational contract must support:
- weekly recurring hours per day;
- special dates / holidays / exceptional schedules;
- schedule-driven open state;
- explicit manual override precedence;
- clear customer-facing effective status.

Current Git schema documentation describes `operating_hours`, but the live SQLite implementation does not yet materialize it as an approved authoritative contract. Therefore implementation must treat this as a **data-contract gap**, not assume the documented example is already live.

## 5. Online Order Pause

Online ordering needs an explicit operational control separate from branch closure.

Minimum semantics:
- pause for a bounded duration (for example 15m, 30m, 1h) or until manually resumed;
- optional/required reason according to final UX contract;
- server-authoritative effective state;
- audit trail;
- customer APIs must consume the effective state rather than infer it from UI.

No client-side timer is authoritative for whether ordering is paused.

## 6. Tables

Daily Branch Manager table operations use these conceptual statuses:

- `AVAILABLE`
- `RESERVED`
- `OCCUPIED`
- `BLOCKED`
- `OUT_OF_SERVICE`

### Manager responsibilities
- View current table state.
- Block/unblock a table for operational reasons.
- See reservation/occupancy context relevant to the branch.
- Provide a reason when manually blocking a table.

### Authority invariant
A table that is reserved, occupied, blocked, or out of service must not be selectable by the Customer PWA when the business contract says it is unavailable.

**Frontend disabling is not sufficient.** Core must validate table availability server-side at the reservation/checkout transaction boundary and protect the mutation against concurrent selection/race conditions. If Customer A and Customer B race for the same table, only a valid server-authorized winner may commit.

### Floor-plan boundary
Daily state management is different from editing physical floor-plan geometry. Creating/moving/deleting tables or changing dining-room layout is an administrative configuration concern and should not be implicitly granted to Branch Manager merely because the manager can operate table status.

## 7. Menu Availability

Branch Manager operates the Branch selling catalog, not the Master Product Catalog.

`branch_products.is_available` remains the branch-scoped availability authority.

Manager may mark a Branch product:
- available;
- unavailable / sold out.

This must not silently mutate Master Product `is_active`.

Stock remains branch-owned. `low_stock_threshold` is branch-scoped and may drive the daily attention view.

## 8. Promotions

Branch Manager may operate **branch-scoped promotion activation** where permitted by the promotion contract.

The dashboard should distinguish:
- brand/global campaigns controlled by Owner/Brand authority;
- branch-scoped promotions that the Branch Manager is allowed to activate/deactivate;
- optional branch-only promotions, only if a future contract explicitly grants creation authority.

Promotion rules must be server-authoritative. Relevant dimensions may include:
- date range;
- day/time window;
- eligible product/category;
- minimum spend;
- order channel/type;
- usage limits;
- stacking/exclusivity;
- manager permission/approval.

Do not treat the existing `branch_settings.promo_config` example as proof that the final promotion domain model already exists.

## 9. Orders

Branch Manager needs a branch-scoped operational order queue.

The dashboard must support the existing acceptance boundary:
- view pending orders;
- inspect order details;
- ACCEPT through a dedicated branch-acceptance path;
- REJECT through a dedicated branch-acceptance path with structured reason;
- refresh/reconcile server-authoritative state.

Do **not** use a generic status PATCH as a substitute for Branch Acceptance.

Branch Manager is branch-scoped. Brand Manager/Owner may have broader scope according to RBAC. Cashier/Kitchen/Customer must not gain Branch Acceptance authority merely because they can see an order.

## 10. Staff

Staff management is branch-scoped for operational users. RBAC remains centralized in Xentra-Core.

Branch Manager must not gain cross-branch workforce authority merely from access to this dashboard.

## 11. Auditability

Operational mutations must be append-only audited using the existing branch operation audit pattern (`branch_operation_logs`) or its approved successor.

At minimum, sensitive actions should preserve:
- branch;
- actor;
- role;
- action/field;
- previous value;
- new value;
- authorization result;
- timestamp;
- product/table context where applicable.

The UI should expose useful "last changed by / when" context for sensitive operational state.

## 12. Authority Model

The following invariant applies to every implementation task in this dashboard:

**Authenticated Branch Manager scope → server/Core authorization → branch-scoped mutation → audit log → authoritative read model → dashboard presentation.**

Client-provided `branch_id` is context/input, never sufficient authorization.

Customer UI and Manager UI are consumers of Core business authority. Neither UI may invent business policy or become the source of truth for status, availability, price, stock, promotion eligibility, table availability, order acceptance, or payment state.

## 13. Known Contract Gaps Before Implementation

The current Git implementation/documentation does not yet establish all APIs/schema needed for this dashboard. In particular, verify/define before coding:
- operating-hours and special-schedule contract;
- richer branch operational state beyond `is_open_override`;
- online-order pause contract;
- table/reservation state and concurrency contract;
- Branch Manager order queue/acceptance read/mutation alignment;
- branch promotion domain/permissions;
- exact branch-scoped staff APIs.

These gaps are intentional checkpoints. Do not hide them with frontend-only state or ad-hoc JSON fields.

## 14. Implementation Rule

Before implementation:
1. Audit the current repository and existing contracts.
2. Map each dashboard feature to an existing authoritative domain/API/schema.
3. Identify genuine gaps.
4. Extend the smallest necessary contract where a new business capability is approved.
5. Implement one independently verifiable vertical slice at a time.
6. Add authorization, race/concurrency protection, audit logging, tests, and browser smoke coverage for operational mutations.

Do not rewrite unrelated architecture, customer authentication, payment, catalog authority, or multi-branch cart semantics.

## 15. Canonical Business Boundary

```text
Owner / Brand Policy
        ↓
Branch Manager Operational Center
        ↓
Branch-scoped operational state
        ↓
Xentra-Core authoritative APIs/domain rules
        ↓
Customer PWA / POS / KDS / other consumers
```

The Branch Manager dashboard is therefore the **daily operational control surface for one Branch**, while Xentra-Core remains the business authority.
