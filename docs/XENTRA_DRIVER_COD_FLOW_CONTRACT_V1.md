# XENTRA — Driver + COD Flow Contract v1

**Status: LOCKED BUSINESS / UX DIRECTION**
**Date:** 2026-09-19

## Purpose
This document locks the MVP business/UX boundary for Driver, Delivery, COD cash custody, Cashier/POS, Branch Manager, and Head Kitchen before implementation.

## Branch Workforce Actors
- **Branch Manager:** Order Operations + Delivery Dispatch/Assignment.
- **Head Kitchen:** Kitchen production lifecycle.
- **Cashier:** POS, cash drawer, COD cash handover, and payment settlement.
- **Driver:** Delivery fulfillment and COD cash collection/custody.

**No separate Dispatcher role is required for MVP.** Branch Manager performs dispatch/driver assignment.

## Interface Boundaries
- **Branch Manager Dashboard / Order Operations:** controls order acceptance/rejection, operational order overview, driver assignment, and delivery overview.
- **KDS / Kitchen:** controls food-production states: preparing and ready.
- **Driver App/PWA:** controls assigned delivery execution, pickup, delivery progress, delivery completion, and COD cash collection.
- **POS / Cashier:** remains the financial/cash workstation. It is not the authority for delivery progress. POS is not dine-in-only; it also handles cash management and COD cash handover/settlement.

## Core Separation
Do not create one giant status covering order, delivery, cash, and payment.

**Order:** confirmed → preparing → ready → out_for_delivery → completed

**Delivery Job:** unassigned → assigned → picked_up → on_delivery → delivered

**Cash Collection:** pending → collected → handed_over → settled (exact naming may be refined during state-contract phase)

**Payment:** pending → settlement

`delivered` is a Delivery state, not a canonical Order state. `completed` is the canonical fulfillment-complete Order state.

## COD Human Flow
1. Customer places a COD delivery order.
2. Branch Manager sees the new order and accepts/rejects it.
3. Accepted order enters kitchen workflow.
4. Head Kitchen prepares the food and marks it ready.
5. Branch Manager assigns an available branch/Xentra driver.
6. Driver accepts/receives the delivery job and performs pickup → on delivery → arrival → delivery.
7. For COD, Driver collects the actual cash amount from the customer and records the amount received/tendered as defined by the cash contract.
8. After successful delivery, delivery is `delivered` and the order fulfillment may become `completed` even if the physical cash has not yet reached the cashier.
9. While cash is held by Driver, **cash custody = Driver** and **payment remains pending**.
10. Driver hands cash to Cashier.
11. Cashier verifies expected vs received cash and confirms handover.
12. Custody moves from Driver to Merchant/Cashier custody.
13. Authorized Cashier/POS settlement changes the cash payment to settlement.

## Critical Invariant
**Customer receiving the food is not the same event as merchant receiving the cash.**
Therefore:
- Order fulfillment may be completed while COD payment is still pending.
- Cash collection must be auditable independently from Order state.
- Payment settlement must remain possible after Order fulfillment is complete.
- Cash custody must identify who currently holds collected COD cash.

## POS Boundary
POS should NOT become a second delivery dashboard. Cashier should not need to:
- accept online delivery orders;
- mark food preparing/ready;
- assign drivers;
- track driver GPS;
- mark delivery on the road.

POS SHOULD provide:
- normal POS/dine-in transactions;
- cash drawer/shift operations;
- COD cash handover queue;
- expected vs actual cash comparison;
- cashier confirmation of received cash;
- authorized payment settlement.

## Authority by Transition (MVP Direction)
- Order pending → confirmed: Branch Manager.
- Kitchen preparation transitions: Head Kitchen.
- Ready → delivery dispatch/assignment: Branch Manager.
- Delivery assignment: Branch Manager.
- Delivery pickup/on-delivery/delivered: Driver.
- COD cash collection: Driver.
- Cash handover/receipt: Driver + Cashier.
- Payment settlement: Cashier/POS (subject to existing RBAC/shift contract).

## Explicit Non-Goals for MVP
- Separate Dispatcher role.
- Fleet Manager role.
- Full fleet/vehicle management as a prerequisite for Driver App.
- Making POS the authority for delivery lifecycle.
- Making Driver a Customer account.
- Putting cash custody into order notes.
- Mutating canonical Order status to `delivered`.

## Next Contract Work Before Coding
The next business/state contract must explicitly define failure/exception flows:
- customer unavailable;
- customer refuses COD/order;
- driver fails delivery;
- incorrect cash amount / short or over cash;
- driver cash handover variance;
- driver loses cash;
- driver cancellation/reassignment;
- cash collected but delivery state transition fails;
- payment settlement attempted after order completion.

Only after these states and transition guards are locked should database/API/Driver App implementation begin.
## Merchant Mobile Order Center — UX Direction v1 (LOCKED)

This section locks the operational UX direction for the Branch Manager / Merchant order center based on the source audit and the agreed GoFood/GrabMerchant-style operational pattern. It is a UX/interaction contract, not a copy of any third-party UI.

### Mobile-First Order Queue

The mobile Branch Manager order queue MUST NOT present the operational order list as a desktop table that relies on horizontal scrolling.

On mobile:
- Each order is presented as an operational card.
- The card prioritizes order number, elapsed/new state, customer, service type, item count, total, current operational state, and the next permitted action.
- Tapping an order opens its operational detail view.
- Search/filter controls must not consume most of the initial viewport.
- Horizontal scrolling MUST NOT be required to perform core order operations.

Desktop/tablet may retain a table representation where appropriate.

### New Order Attention

A newly received branch order is an operational event, not something the merchant should discover only by manual refresh.

When a new pending order is detected:
- show a prominent new-order visual state/badge;
- play an audible new-order alert when browser/device policy permits;
- place the new order at the top of the relevant queue;
- allow the merchant to open the order and accept/reject it;
- preserve the existing Branch Acceptance contract and endpoint semantics.

Polling may remain as a compatibility/fallback mechanism, but the UX MUST NOT depend on a visible Refresh button for normal order discovery.

### Operational State Presentation

The merchant-facing order center MUST represent the separation between Order lifecycle and Delivery Job lifecycle.

Order lifecycle:
pending → confirmed → preparing → ready → out_for_delivery → completed

Delivery Job lifecycle:
unassigned → assigned → picked_up → on_delivery → delivered

The following mapping is LOCKED:
- pending: new order requiring Branch Manager acceptance/rejection.
- confirmed: accepted and awaiting/under kitchen processing.
- preparing: kitchen is preparing the order.
- ready: food is ready for driver pickup; this MUST NOT mean already delivered.
- out_for_delivery: delivery execution has started after pickup.
- completed: canonical fulfillment-complete Order state.
- delivered: Delivery Job state only; it MUST NOT become the canonical Order status.

### Driver Handoff / In-House Driver

Xentra uses its internal/branch driver flow for this contract.

After an order becomes ready:
- Branch Manager may assign an available driver through the existing Delivery domain.
- The operational UI must show unassigned / assigned delivery state distinctly from Order state.
- There is NO merchant-side driver code/PIN entry requirement in this flow.
- Do not introduce a third-party driver verification step merely to imitate an external marketplace.
- Driver pickup, on-delivery, and delivered transitions belong to the Driver interface/Delivery domain.

### Role Boundaries

Branch Manager:
- accept/reject orders;
- monitor operational order lifecycle;
- assign/dispatch driver;
- monitor delivery progress.

Head Kitchen/KDS:
- preparing;
- ready.

Driver:
- receive assigned job;
- pickup;
- on delivery;
- delivered;
- COD cash collection/custody.

Cashier/POS:
- COD cash handover;
- cash verification;
- payment settlement.

The Branch Manager UI MUST NOT become the authority for driver pickup/on-delivery/delivered transitions merely for UI convenience.

### COD Boundary

Delivery completion and COD cash settlement remain separate events.

delivered MUST NOT imply payment settlement.

A delivered COD order may remain payment-pending while cash is held by the Driver and awaiting handover to Cashier/POS.

### Implementation Guardrails

The implementation MUST:
- reuse the existing Order state model and Delivery domain where possible;
- avoid creating a second/duplicate delivery state machine;
- avoid renaming canonical states;
- avoid changing payment/COD contracts;
- avoid changing Branch Acceptance semantics;
- avoid deleting or reseeding existing branches, menus, products, or customer data;
- avoid unrelated changes to Google authentication, PWA boot, promo, or checkout flows;
- preserve desktop usability while introducing a genuinely mobile-first operational presentation.

This UX direction is locked as the target for the next source-code audit and implementation phase.