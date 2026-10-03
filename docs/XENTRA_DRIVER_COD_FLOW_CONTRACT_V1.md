# XENTRA — Driver + COD Flow Contract v1.1

**Status: LOCKED BUSINESS / UX DIRECTION**
**Date:** 2026-10-03

> **Revision:** v1.1 supersedes the COD settlement wording in v1. The canonical payment state remains `settlement`; the UI may display this as **PAID/LUNAS**.

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

**Cash Collection:** pending → collected → handed_over

**Payment:** pending → settlement

Cash custody/handover is a separate operational record from Payment settlement.

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
13. Authorized Cashier/POS settlement changes the cash payment to `settlement` (the merchant-facing UI may show **PAID/LUNAS**).
14. If the Order is already `completed`, the COD payment remains settlement-eligible until the outstanding cash is validly handed over and settled; Order completion does not close the payment lifecycle.

## Critical Invariant
**Customer receiving the food is not the same event as merchant receiving the cash.**
Therefore:
- Order fulfillment may be completed while COD payment is still pending.
- Cash collection must be auditable independently from Order state.
- Payment settlement must remain possible after Order fulfillment is complete for an outstanding COD cash payment.
- Cash custody must identify who currently holds collected COD cash.
- `delivered` and `completed` MUST NOT automatically change a COD payment from `pending` to `settlement`.
- Driver MUST NOT perform the final payment settlement transition.
- Cashier/POS is the authority for the final cash-payment settlement, subject to RBAC and shift rules.

## COD Payment Settlement Eligibility

The following rule is LOCKED for the MVP:

### Normal COD Case
A COD order may reach:
- Delivery Job = `delivered`;
- Order = `completed`;
- Payment = `pending`.

This is valid and expected while the collected physical cash has not yet completed the cashier handover/settlement flow.

### Cashier Settlement Gate
Cashier/POS MAY transition Payment from `pending` to `settlement` only when all relevant guards pass:

1. The order belongs to the cashier's authorized branch/scope.
2. The payment method is COD/physical cash (`cash` in the current payment model).
3. The payment is still outstanding and has not already reached `settlement`.
4. The physical COD cash has been collected and handed over to Cashier/POS according to the Cash Collection/Custody contract.
5. The authenticated cashier and applicable open-shift rules are satisfied.
6. The amount being settled matches the outstanding amount; any over-tendered amount is handled as change, and any short amount is rejected or routed to the explicit variance flow.

### Completed Order Exception
`Order = completed` is explicitly **NOT** a reason to reject a valid COD cash settlement.

The implementation MUST NOT use a blanket terminal-order guard that blocks all cash settlement merely because `order.status === 'completed'`.

However, this exception applies only to the outstanding COD cash settlement described above. It MUST NOT permit:
- cash settlement of online/non-cash payments;
- settlement by Driver;
- settlement for another branch without authorization;
- duplicate settlement of an already-settled payment;
- bypassing the cash handover/custody record where that record is required by the implementation.

### Terminology
- **Cash handover confirmed:** physical custody has moved from Driver to Cashier/POS.
- **Payment settlement:** the authoritative payment state becomes `settlement`.
- **PAID/LUNAS:** a UI presentation label for a payment whose canonical state is `settlement`.

These are related but distinct events and MUST NOT be collapsed into one generic Order status.

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
- Payment settlement: Cashier/POS (subject to existing RBAC/shift contract). Driver has no settlement authority.

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
- payment settlement attempted after order completion;
- duplicate cash handover/settlement;
- cashier/branch scope mismatch.

The `Order = completed` + `Payment = pending` COD case is now explicitly locked as a valid state. Database/API/Driver App implementation MUST conform to this contract.
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