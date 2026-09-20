# Xentra — Branch Manager Delivery Dispatch Wiring Audit v1

**Status:** LOCKED — Audit / Implementation Boundary  
**Audit date:** 2026-09-21  
**Repository:** wanstudio/xentra-core  
**Audited head:** 72b43c39ea2cd18e2f4fe5b32c6adc5da292dba6

## Purpose

Lock the verified implementation boundary before changing the Branch Manager operational order center.

## Verified Existing Foundations

- Branch-scoped order queue exists at `GET /api/v1/admin/branches/:id/orders`.
- Branch Manager branch scope is enforced; cross-branch order visibility is denied.
- Pending orders expose server-computed `acceptance_deadline_at`.
- Branch Acceptance is a dedicated mutation: `POST /api/v1/orders/:id/branch-acceptance`.
- `pending → confirmed` must continue through Branch Acceptance; generic status mutation must not replace it.
- Existing Order lifecycle remains: `pending → confirmed → preparing → ready → out_for_delivery → completed`.
- Existing Delivery domain contains `DeliveryModel`, `DeliveryDispatchService`, `BranchDriverProvider`, and `order_deliveries` persistence.
- Existing Delivery Job lifecycle remains: `unassigned → assigned → picked_up → on_delivery → delivered`.
- Existing permission model contains `delivery:manage` and `delivery:view`.

## Confirmed Gap

The repository contains the Delivery dispatch domain/service and tests, but the audit did not find a clear Merchant Dashboard application/API wiring that exposes driver assignment as an operational Branch Manager action through the existing Delivery domain.

Therefore the next implementation slice is **API/application wiring**, not a new Delivery domain.

## Locked Responsibility Boundary

- Branch Manager: accept/reject order, monitor order lifecycle, assign/dispatch driver, monitor delivery.
- Head Kitchen/KDS: preparing, ready.
- Driver: pickup, on-delivery, delivered, COD cash collection/custody.
- Cashier/POS: COD handover, cash verification, payment settlement.

The Branch Manager UI must not become authority for Driver pickup/on-delivery/delivered transitions.

## Locked Target Flow

`pending → confirmed → preparing → ready`

At `ready`:

`Delivery Job: unassigned → assigned`

Driver then owns:

`assigned → picked_up → on_delivery → delivered`

Order execution subsequently reaches:

`out_for_delivery → completed`

Delivery `delivered` is never the canonical Order status.

COD collection and payment settlement remain independent of fulfillment completion.

## UI Boundary

The Merchant order center must become genuinely mobile-first:

- mobile order cards, not horizontally-scrolling desktop tables;
- new-order visual attention and audible alert where browser/device policy permits;
- normal order discovery must not depend on a visible Refresh button;
- operational state and Delivery Job state must be shown separately;
- Ready means ready for driver pickup, not delivered;
- driver assignment is a Branch Manager action;
- driver pickup/on-delivery/delivered are Driver/Delivery-domain actions.

Desktop/tablet usability must remain intact.

## Implementation Guardrails

- Reuse existing Order State Machine and Delivery domain.
- Do not create a second delivery state machine.
- Do not rename canonical states.
- Do not change Branch Acceptance semantics.
- Do not conflate Delivery `delivered` with payment settlement.
- Do not delete, reseed, or recreate existing branches, menus, products, or customer data.
- Do not modify Google authentication, PWA boot, promo, checkout, or unrelated flows.
- Add authorization, branch-scope checks, audit logging, tests, and browser smoke coverage for any new operational mutation.
- Before adding an endpoint, inspect existing application routes/services to avoid duplicate APIs.

## Required Next Vertical Slice

1. Identify the authoritative existing route/application layer used by Merchant Dashboard order operations.
2. Add the smallest necessary branch-scoped Delivery assignment/status API wiring around the existing DeliveryDispatchService.
3. Wire Branch Manager assignment UI to that API.
4. Keep Driver delivery transitions under the Driver/Delivery authority.
5. Reconcile order state and delivery job state without introducing duplicate state machines.
6. Add regression tests for branch scope, authorization, valid/invalid transitions, idempotency/duplicate assignment protection, and COD separation.
7. Only after the API slice is verified, implement the mobile-first order center presentation and new-order attention UX.

**This document is an audit lock, not authorization to implement all future items at once.**
