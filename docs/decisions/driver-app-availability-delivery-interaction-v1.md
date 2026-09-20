# 🔒 Xentra — Driver App Availability + Delivery Interaction Contract v1

**Status:** LOCKED — Business / UX Direction  
**Date:** 2026-09-21

## Purpose

Lock the Driver App/PWA interaction model so delivery progress is driven by the actor performing the real-world action, while Branch Manager remains responsible for assignment/dispatch and monitoring.

## Driver Availability

Driver availability is separate from delivery-job state.

- **OFFLINE** — driver does not receive new assignments.
- **ONLINE / AVAILABLE** — driver can receive assignments.
- Driver controls availability with an explicit ON/OFF toggle.
- Availability MUST NOT be treated as a delivery-job transition.

## Delivery Job Flow

The locked MVP interaction is:

```
UNASSIGNED
  ↓
ASSIGNED
  ↓
Driver: ACCEPT / REJECT
  ↓
Driver: PICK UP / AMBIL PESANAN
  ↓
PICKED_UP
  ↓
Driver: START DELIVERY / PESANAN DIANTAR
  ↓
ON_DELIVERY
  ↓
Driver: COMPLETE DELIVERY / SELESAI ANTAR
  ↓
DELIVERED
```

Branch Manager performs **driver assignment**. After assignment, the Driver App becomes the authority for pickup, on-delivery, and delivered transitions.

## Branch Manager Responsibility

Manager should not manually click every downstream delivery status.

Manager:
1. monitors READY order;
2. selects an available driver;
3. assigns the driver;
4. monitors delivery progress.

After assignment, downstream delivery progress is driven by Driver actions/events.

## Customer Status + Notifications

Customer-facing delivery status and notifications should be derived automatically from the authoritative Delivery Job events.

Examples:

- Driver assigned → customer can see that a driver is being assigned / assigned.
- Driver accepts → customer can be informed that the driver has accepted the delivery.
- Driver is heading to merchant → customer can receive the corresponding progress state when location/progress data is available.
- Driver picks up → customer sees that the order has been picked up / is being delivered.
- Driver is on delivery → customer sees delivery-in-progress.
- Driver marks delivered → customer sees delivery completed.

ETA, driver progress, and notification delivery are system-generated from available assignment/location/timing data. They are not separate Manager status buttons.

If location/ETA data is unavailable, Xentra MUST NOT invent an ETA; show an appropriate non-ETA status instead.

## Order vs Delivery State

Do not collapse the two lifecycles.

**Order:**
`pending → confirmed → preparing → ready → out_for_delivery → completed`

**Delivery Job:**
`unassigned → assigned → picked_up → on_delivery → delivered`

Delivery `delivered` MUST remain a Delivery Job state and MUST NOT become the canonical Order state.

The Order may transition to `out_for_delivery` when delivery execution has actually started after pickup, according to the existing Order State Machine and application wiring.

## COD Boundary

Driver collection of COD cash remains separate from delivery completion and payment settlement.

**Cash Collection:**
`pending → collected → handed_over → settled`

`DELIVERED` does not imply payment settlement.

## UX Guardrails

- Do not require Manager to click pickup, on-delivery, or delivered merely to keep the UI synchronized.
- Do not create a second Delivery state machine.
- Reuse the existing Delivery domain and `DeliveryDispatchService`.
- Do not introduce merchant-side driver PIN/code verification.
- Do not create a separate Dispatcher role for MVP.
- Driver availability and delivery-job status must remain separate concepts.
- Assignment acceptance/rejection must be auditable.
- All actions must remain branch-scoped and permission-checked.
- Driver must only be able to act on jobs assigned to that driver.
- Customer notifications must be event-driven/system-generated rather than manually authored per status.

## Locked Principle

**Human clicks represent real-world operational decisions/actions. System automatically propagates state, ETA, visibility, and notifications wherever those can be derived reliably.**

**Git source of truth:** `docs/decisions/driver-app-availability-delivery-interaction-v1.md`
