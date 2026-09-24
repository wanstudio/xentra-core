# Xentra — Target Architecture & Incremental Refactoring Baseline v1

**Status:** LOCKED / ACTIVE  
**Decision date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## Purpose

This document is the engineering baseline for structural refactoring and POS work.

It was derived from the latest repository state plus external architecture references. Older Notion/Git documents that conflict with this baseline are not active architecture truth until reconciled.

This is a **risk-reduction architecture**, not a guarantee of zero production errors at scale.

## 1. Target Architecture

Xentra uses:

**Modular Monolith Backend + Independent Frontend Applications + Business-Capability Domain Boundaries + Incremental Migration.**

Do not perform a big-bang rewrite or split the backend into microservices merely to clean up folders.

Target:

```text
xentra-core/
│
├── apps/
│   ├── customer-pwa/
│   ├── merchant-app/
│   ├── pos-app/
│   ├── kitchen-app/
│   └── owner-dashboard/          # future extraction
│
├── shared/
│   └── frontend/
│       ├── auth/
│       ├── session/
│       ├── http/
│       ├── dom/
│       ├── ui/
│       └── utilities/
│
├── domains/
│   ├── catalog/
│   ├── commerce/
│   ├── dining/
│   ├── pos/
│   ├── inventory/
│   ├── payment/
│   ├── delivery/
│   ├── promotion/
│   └── reporting/
│
├── core/
└── server/
```

## 2. Responsibilities

- **Core:** authenticate, authorize, enforce, persist, audit.
- **Catalog:** Master Product, Master Catalog, Branch selling-catalog contracts.
- **Commerce:** Cart, Checkout, Order lifecycle.
- **Dining:** table, dining-session, reservation capability (after its detailed contract is locked).
- **POS:** Terminal, Shift, Sale, Sale Item, POS execution, offline/local mechanics, POS hardware boundary.
- **Inventory:** stock state and movement.
- **Payment:** payment processing and settlement authority.
- **Delivery:** delivery calculation and fulfillment.
- **Promotion:** promotion policy/evaluation and activation lifecycle.
- **Reporting:** read models and analytics; never become source mutation authority.
- **Integration:** external provider/hardware adapters; never owns business policy.

## 3. Frontend Boundaries

- **Owner Dashboard:** configure / govern / observe.
- **Merchant App:** manage / operate / observe one Branch.
- **POS App:** execute physical sale / cashier transaction.
- **Customer PWA:** discover / purchase / track.
- **Kitchen App:** kitchen execution surface when/if KDS is activated.

Shared API/data access does not transfer business authority.

Feature placement follows the workflow/job of the user, not the existence of an API.

## 4. POS Boundary

POS is a separate application and workflow.

POS includes:
- cashier sale and in-sale menu selection;
- variations/modifiers;
- hold/resume;
- void/cancel;
- payment/tender/change;
- QRIS/non-cash and split payment workflows;
- receipt print/reprint;
- shift open/close;
- opening float;
- cash in/out;
- cash variance;
- offline queue;
- reconciliation/sync/retry.

Merchant App remains the Branch management/operations surface and does not become the primary cashier/POS workflow.

Never create duplicated business authority between Merchant App and POS.

## 5. Dining Boundary

Current source places `DiningTableService`, `TableRecommendationService`, and `Template01` under `domains/pos`, but they are consumed outside cashier-only workflows.

Target:

```text
domains/dining/
├── DiningTableService
├── TableRecommendationService
└── table/layout/template concerns
```

**Migration rule:** write and lock the detailed Dining/Table/Reservation contract first. Then move incrementally, using compatibility re-exports/shims where necessary.

Do not silently redefine reservation/table behavior during the move.

## 6. Catalog Boundary

`CatalogService` currently sits in Commerce but its responsibilities are catalog-oriented.

Target:

```text
domains/catalog/
  Master Product
  Master Catalog
  Branch Product
  Branch Category
  branch assortment
  branch catalog overrides
```

Commerce remains focused on:

```text
Cart
Checkout
Order
```

Move incrementally; preserve consumers until the new boundary is verified.

## 7. Shared Frontend Rule

Use:

```text
shared/frontend/
```

for genuinely generic cross-application primitives such as auth/session/http/dom/ui utilities.

Do not turn shared into a dumping ground.

Current `apps/merchant-shared/js/branch-catalog.js` mixes client/data operations and surface-specific UI. Future direction:

```text
merchant-shared/
  Owner + Merchant shared business client/data concerns

merchant-app/
  Merchant-specific renderers/workflows

owner-dashboard/
  Owner-specific renderers/workflows
```

Promote code into generic shared only when multiple applications truly need the same reusable contract.

## 8. Do Not Refactor Now

Do not, merely for cleanup:

- split `server/routes/api.js`;
- extract Owner Dashboard in the same wave as POS;
- convert Xentra into microservices;
- create a second POS state machine when Core/domain lifecycle can be reused;
- create separate POS-vs-online inventory pools without a new business decision;
- make KDS a mandatory MVP dependency.

## 9. Migration Sequence

```text
0. Freeze target architecture + boundaries
        ↓
1. Establish generic shared/frontend primitives
        ↓
2. Create standalone apps/pos-app/
        ↓
3. Lock detailed Dining/Table/Reservation boundary
        ↓
4. Move Dining incrementally
        ↓
5. Narrow domains/pos/ to true POS concerns
        ↓
6. Extract Catalog responsibilities from Commerce
        ↓
7. Split merchant-shared UI vs client/data concerns
        ↓
8. Build/finish POS on stable boundaries
        ↓
9. Owner Dashboard extraction later
```

Every phase must remain testable and reversible.

## 10. Production-Safety Rules

Structural changes on high-traffic paths must be incremental.

Before promoting each migration:

1. preserve old behavior through compatibility seams where necessary;
2. run domain/security/regression tests;
3. inspect the complete affected diff and consumer list;
4. verify database migration + transaction/concurrency behavior;
5. verify logging/metrics/error reporting;
6. release a small, reversible change rather than a large cut-over.

For high-traffic mutations, prefer atomic transactions, idempotent mutation handling where duplicate requests can occur, server-authoritative authorization/scope, and stable APIs during migration.

Frontend separation should also avoid unnecessary coupling of startup bundles and unrelated surfaces.

## 11. Invariants

```text
Core
  AUTHENTICATE
  AUTHORIZE
  ENFORCE
  PERSIST
  AUDIT

App
  OWNS USER WORKFLOW / PRESENTATION

Domain
  OWNS BUSINESS RULES / STATE

Integration
  OWNS PROVIDER / HARDWARE ADAPTER

UI
  NEVER BECOMES AUTHORIZATION
```

Canonical distinctions:

- Order != Sale
- Payment != Settlement
- Void != Refund
- Master Product != Branch Product
- Master Category != Branch Category

## 12. Reference Basis

Supporting references:

- Microsoft Azure Architecture Center — domain analysis / bounded contexts:
  https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis
- Martin Fowler — Micro Frontends:
  https://martinfowler.com/articles/micro-frontends.html
- Martin Fowler — Strangler Fig:
  https://martinfowler.com/bliki/StranglerFigApplication.html
- Nx — monorepo folder structure / deliberate sharing:
  https://nx.dev/docs/kb/folder-structure
- Square Developer — POS offline mode:
  https://developer.squareup.com/docs/pos-api/cookbook/offline-mode

These references support the principles of business-capability boundaries, explicit frontend application boundaries, deliberate sharing, incremental modernization, and explicit offline/reconciliation handling. They do not override Xentra-specific business decisions.

## 13. Change Control

Any change to the target structure, domain ownership, app boundary, migration sequence, or safety invariants requires a new Architecture Decision that explicitly records:

- what changes;
- why the previous decision is no longer valid;
- affected apps/domains;
- compatibility/migration strategy;
- test impact;
- production-risk impact.

No implementation commit may silently redefine this architecture.
