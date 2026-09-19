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