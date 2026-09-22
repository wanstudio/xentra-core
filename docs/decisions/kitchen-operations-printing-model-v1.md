# Xentra — Kitchen Operations + Printing Model v1

**Status:** LOCKED — MVP Kitchen Operations / Printing Baseline  
**Date:** 2026-09-21  
**Latest product boundary:** See `docs/decisions/kds-addon-capability-v1.md` (2026-09-22). KDS is an optional SaaS add-on, not a mandatory MVP surface.

## 1. Kitchen interface decision

For the Xentra MVP, **KDS is NOT a separate dashboard, application, or required kitchen interface**.

The Merchant operational center is the current `merchant-app` surface for Branch Manager daily operations. Kitchen does not need a dedicated software screen when the physical restaurant workflow is based on printed kitchen tickets and direct verbal coordination with the Branch Manager.

Do not introduce or activate a mandatory KDS surface merely to represent kitchen preparation.

## 2. Kitchen operational model

```
Order masuk
→ Merchant Dashboard menerima order
→ Branch Manager menerima/accept order
→ Printer menghasilkan kitchen copy + customer receipt
→ Kitchen menerima/ambil kitchen copy
→ Masak
→ Packing
→ Kitchen copy ditempel/diterapkan pada pesanan sesuai kebutuhan operasional
→ Kitchen memberi tanda siap secara langsung/verbal kepada Manager
→ Manager melanjutkan dispatch/driver assignment
```

Kitchen does not need to operate software for this flow.

## 3. Kitchen state authority

The canonical Order lifecycle remains:

```
pending → confirmed → preparing → ready → out_for_delivery → completed
```

These states do not require a kitchen touchscreen/tablet/dashboard.

The MVP must not create a second kitchen state machine.

## 4. Printing contract

An order must support two logical print outputs:

### Kitchen / Merchant Copy
- order number
- items
- quantities
- modifiers/options
- relevant preparation/packing notes
- service/order type
- information required for kitchen operations

### Customer Receipt
- merchant identity
- order number
- items and quantities
- pricing/total
- appropriate payment information
- other legally/operationally required receipt information

These are **logical outputs, not a requirement for two physical printers**.

## 5. Printer topology

Xentra must not assume every merchant has two physical printers.

Supported topology:

```
Order
 ├─ Kitchen / Merchant Copy
 └─ Customer Receipt
```

Both outputs may route to one printer or separate printers depending on merchant hardware/configuration.

Future routing may support:

```
Order
 ├─→ Kitchen Printer
 └─→ Counter/Cashier Printer
```

Separate physical printers are not an MVP prerequisite.

## 6. Kitchen attention

Kitchen attention may be physical/operational rather than a KDS:

- printer output
- printer/bell audible alert where hardware supports it
- kitchen staff takes the kitchen copy
- kitchen prepares and packs
- kitchen communicates readiness verbally to Branch Manager

## 7. Merchant Dashboard boundary

Merchant Dashboard is the single merchant operational center for MVP:

- order intake
- acceptance/rejection
- order monitoring
- dispatch/driver assignment
- delivery monitoring
- relevant cashier/POS handoff

Kitchen is a restricted operational participant, not a separate dashboard product.

## 8. Explicit non-goals

Do not build for this MVP:

- separate KDS application
- separate Kitchen Dashboard
- mandatory kitchen tablet
- mandatory kitchen login/device
- mandatory kitchen software buttons for Preparing/Ready
- second delivery/order state machine
- two physical printers as a hard requirement
- artificial kitchen workflow merely to imitate GoFood/Grab

## 9. Locked end-to-end flow

```
CUSTOMER
  ↓
ORDER
  ↓
MERCHANT APP
  ↓
BRANCH MANAGER ACCEPTS
  ↓
PRINT
 ├─ Kitchen / Merchant Copy
 └─ Customer Receipt
  ↓
KITCHEN
  ↓
MASAK → PACKING
  ↓
KITCHEN COPY / PACKING IDENTIFICATION
  ↓
"BISA DIAMBIL / ORDER 102 SIAP"
  ↓
BRANCH MANAGER
  ↓
ASSIGN AVAILABLE DRIVER
  ↓
DRIVER
  ↓
PICKED_UP → ON_DELIVERY → DELIVERED
  ↓
CUSTOMER
  ↓
COD HANDOVER / SETTLEMENT
```

## 10. Guardrails

- Existing Order State Machine remains authoritative.
- Existing Delivery domain remains authoritative for delivery.
- COD remains separate from fulfillment/delivery.
- No duplicate state machine.
- No changes to Branch Acceptance semantics.
- No deletion/reseed of existing branches, menus, products, or customer data.
- No unrelated changes to Google authentication, PWA boot, promo, or checkout.
- This document records the operational decisions from the 2026-09-21 discussion.
