# Xentra — POS App Surface Implementation v1

**Status:** IMPLEMENTED / ACTIVE  
**Date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## Purpose

Implement the locked separation between the Branch Manager Merchant App and the cashier POS surface without creating a second backend, inventory authority, catalog authority, payment authority, or order state machine.

## Locked responsibility

### Merchant App

**Manage + Operate + Observe the Branch**

Primary navigation remains:

- Hari Ini
- Pesanan
- Meja
- Menu
- Promo
- Stok
- Staff
- Penjualan Hari Ini
- Jam Operasional

These workflows cover branch configuration, operational intervention, acceptance, monitoring, workforce management, stock/menu management, and branch reporting.

### POS App

**Execute the Sale / Transaction**

Standalone application:

`apps/pos-app/**`

Primary navigation:

- Kasir
- Transaksi
- Meja
- Shift

POS capabilities exposed in the execution surface:

- menu selection inside Sale;
- order type: dine-in / pickup / delivery;
- cart quantity changes;
- hold / resume dine-in bill;
- cash payment and cash tender/change;
- transaction history;
- receipt printing / reprint;
- table selection as transaction context;
- shift open;
- cash in / cash out;
- shift close and cash variance;
- online/offline state indication;
- offline local sale fallback;
- sync outbox on reconnect.

POS intentionally does **not** expose Merchant management navigation for:

- Master Product;
- Branch Category administration;
- branch assortment management;
- promotion governance;
- stock management;
- staff administration;
- operating-hour administration;
- cross-branch management;
- branch reporting as the primary management surface.

## Surface routing

Unified authentication now resolves:

- `branch_manager` → `/merchant/`
- `cashier` → `/pos/`
- `owner` / `brand_manager` → `/owner/`

The Owner Dashboard also enforces its server-resolved landing so a cashier or Branch Manager cannot use it as an accidental fallback surface.

## Core/API boundary

New cashier-scoped POS transport endpoints:

- `POST /api/v1/pos/sales`
- `GET /api/v1/pos/sales`
- `GET /api/v1/pos/held-orders`
- `POST /api/v1/pos/held-orders`
- `GET /api/v1/pos/orders/:id/receipt`
- `GET /api/v1/pos/terminal/current`

Existing POS shift/offline endpoints remain the domain authority.

Terminal registration remains a Manager/Owner operation; cashier POS only reads the active terminal binding. This preserves the existing `1 Branch = 1 active POS terminal` invariant.

## Important product boundary

The POS `Meja` screen is deliberately transactional:

**select/use table for a sale**

It does not provide Merchant controls such as:

- table administration;
- QR administration;
- branch layout configuration;
- branch-wide table intervention.

Merchant App remains the operational table-management surface.

Likewise, POS `Menu` is a **selling surface inside Kasir**, not a branch catalog-management screen.

## Offline boundary

When connectivity is unavailable, the POS attempts the existing Core local-operation contract:

`/pos/local/sale`

with:

- terminal binding;
- branch scope;
- active shift;
- cash-only offline payment;
- durable local transaction;
- local stock deduction;
- sync outbox.

On reconnect, the POS requests:

`/pos/local/sync-outbox`

No offline capability creates a second inventory or order authority.

## Reference alignment

The separation follows the locked Xentra POS ↔ Merchant App boundary and common restaurant POS patterns where the POS focuses on checkout, payment, cash/session tracking, receipts, and offline operation. Shopify documents POS-specific payment-session, cash-drawer, receipt, and offline permissions; Toast documents continued order/payment/receipt operation and local-sync behavior during offline mode.

## Verification performed

Static boundary checks passed against the latest GitHub source:

- standalone POS files exist;
- POS navigation is execution-first;
- Merchant App management navigation remains separate;
- cashier landing resolves to `/pos/`;
- Branch Manager landing remains `/merchant/`;
- POS endpoints are cashier-scoped where they execute cashier actions;
- terminal registration remains managerial;
- POS frontend has no Merchant App module coupling.

**Full `npm test` has not been executed in this environment.**
