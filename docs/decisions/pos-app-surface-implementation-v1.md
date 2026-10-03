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

**Shift is not a primary navigation destination.** Shift is a cashier-session context and is exposed through the POS status/topbar and contextual modal actions.

POS capabilities exposed in the execution surface:

- single Sale / transaction flow;
- menu selection inside Sale;
- optional table context for dine-in transactions;
- cart quantity changes;
- hold / resume POS Sale for Dine-In and Takeaway;
- cash payment and cash tender/change;
- transaction history;
- transaction-detail actions, including COD cash handover/settlement where applicable;
- receipt printing / reprint;
- shift open/status/break/cash-in/cash-out/close controls through the contextual Shift UI;
- online/offline state indication;
- offline local sale fallback;
- sync outbox on reconnect;
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

 
## POS Payment Modes — locked MVP structure

POS payment selection is exactly **three modes**:

1. **Cash** — immediate cashier settlement; tender/change and offline POS supported.
2. **Payment Gateway** — one POS mode backed by the active configured Xentra gateway, **DOKU or Midtrans**. POS waits for Core/gateway settlement.
3. **QRIS Statis** — merchant's existing static QRIS; POS creates a pending sale, displays the configured QR, and requires explicit cashier verification before settlement.

Core mapping:

| POS mode | Core payment method | Settlement |
| --- | --- | --- |
| Cash | `cash` | CashSettlementService |
| Payment Gateway | `midtrans` / `doku` | Gateway webhook/status |
| QRIS Statis | `qris_static` | Manual cashier verification |

QRIS Statis is a **fallback/manual mode**, not a new PJP or dynamic-QR integration.

Offline POS remains **cash-only**. Payment Gateway and QRIS Statis require connectivity to Core.

Gateway timeout is treated as `reconciliation_pending`; it must not be blindly retried or duplicated. A clear gateway failure cancels that failed payment attempt, allowing the cashier to create a new sale using another payment mode.

The same Xentra-Core payment authority remains the single source of truth. No second payment state machine is introduced.

## POS Transaction UX — LOCKED REVISION 1.2

**Date:** 2026-10-03

### Transaction Mode

Every new POS sale starts with a transaction-mode selector inside the **Kasir** workspace:

**Dine-In | Takeaway**

This selector is **transaction context, not navigation**.

- **Dine-In** → table context is required before payment/completion.
- **Takeaway** → no table context.
- Frontend label is **Takeaway**.
- Backend/domain value remains **`pickup`** for the applicable POS sale contract.
- **Delivery is not a cashier-facing POS sale mode** and is not shown in the new-sale selector.

The underlying POS composer still uses the canonical backend order type value. Therefore the UX mapping is:

`Dine-In` → `dine_in`  
`Takeaway` → `pickup`

### Hold Bill UX — Exact Placement

Hold Bill is a **transaction action/state**, not a payment method and not a navigation mode.

#### 1. Current Draft Sale — action "Tahan"

**Mobile:**
The active Draft Sale is opened through the **Rincian Pesanan** modal. The modal footer must place:

**[ Tahan ]    [ Bayar Rp… ]**

- **Tahan** is the left/secondary action.
- **Bayar** is the right/primary action.
- Tahan saves the current Draft Sale as a Hold Bill and returns the cashier to a clean/new Sale context.
- Tahan is available for both **Dine-In** and **Takeaway** while the Sale is still a draft.
- For Dine-In, the selected table remains part of the held Sale and the table hold follows Dining/Core authority.
- The modal must **not** contain a **"Ditahan (N)"** button.

**Desktop/tablet:**
The active Draft Sale may expose the same **Tahan** action in the current **Pesanan/cart action area**. It performs the same Hold mutation. It must not create a second Hold workflow.

#### 2. Already-Held Sales — location "Ditahan"

The held-sales list is a **separate list view**, not part of the current-sale review/checkout modal.

Exact navigation:

**Bottom Nav → Transaksi → local tab "Pesanan Ditahan (N)"**

That tab is the authoritative cashier entry point to:
- see already-held Sales;
- choose **Buka/Resume**;
- choose **Batal** according to the existing Hold Bill contract.

The **"Ditahan (N)"** entry therefore belongs to the **Transaksi workspace**, not inside **Rincian Pesanan**.

The POS cart/header must not duplicate this as a second competing Hold-list workflow. If an implementation currently exposes a **"Ditahan (N)"** shortcut beside the current Draft Sale actions, that shortcut is legacy UI and is to be removed/reconciled to the Transaksi → Pesanan Ditahan entry point.

#### 3. Semantic separation

- **Tahan** = save/mutate the **current Draft Sale** into Hold Bill state.
- **Pesanan Ditahan (N)** = open/list **Sales that were already saved as Hold Bill**.
- **Buka/Resume** = restore one held Sale into the Sale workspace.
- **Bayar** = begin payment for the current Sale.

A Hold Bill is not a payment status and not a separate transaction type.

### Single Transaction Flow

**Select transaction mode → Select Menu → Cart → Table (Dine-In only) → Payment → Complete**

The same Sale/Transaction Composer is used for both modes; only the required table context differs.

### Delivery Boundary

POS does not create or operate the Driver delivery lifecycle. Driver/Delivery remains authoritative for:

`unassigned → assigned → picked_up → on_delivery → delivered`

A delivery order may still appear in POS transaction context when the cashier must perform a financial action, especially COD cash handover and payment settlement. That action belongs to the **transaction detail**, not to a Delivery tab or new-sale mode.

### Shift Boundary

Shift remains an authoritative POS operating state and is required by the existing cashier/shift contract, but it is **not a primary navigation destination**.

Shift operations are exposed through the contextual POS header/status and modal:
- open shift;
- view current shift state;
- start/end break;
- Cash In;
- Cash Out;
- close shift and variance.

A missing/closed shift may still gate transaction completion where required by the Core contract.

### Manual Refresh Boundary

The POS must not expose a permanent **Refresh** button on every page as the normal mechanism for data freshness.

Normal freshness should be handled automatically by the existing POS re-fetch/synchronization behavior:
- initial page/view load;
- return to the relevant POS view/foreground where appropriate;
- after successful mutations that affect the displayed data;
- reconnect/resynchronization after offline operation;
- explicit retry/recovery when a previous fetch failed.

A manual refresh control may exist only as a secondary recovery/debug affordance when a concrete operational need requires it; it must not be repeated as a primary button on each POS page.

### UX Invariant

**POS is an execution surface, not a collection of workflow tabs.**

Do not introduce a new top-level tab merely because a domain attribute exists in the underlying Order model. The existence of `dine_in`, `pickup`, or `delivery` in Core does not by itself justify a dedicated POS navigation mode.

This revision supersedes the earlier POS UI wording that listed `dine-in / pickup / delivery` as an exposed POS order-type selection and the earlier primary-navigation listing that included Shift.
