# Xentra — Driver + COD Happy Path Validation v1

**Status: LOCKED — MVP BUSINESS / ARCHITECTURE BASELINE**  
**Date:** 2026-10-06

## Scope

This document locks the validated **happy-path** lifecycle for a single Xentra delivery order paid by Cash on Delivery (COD).

It is a correctness baseline for MVP implementation. It is **not** a claim that every exception flow is already complete; exception handling remains a separate contract boundary.

## Canonical lifecycle

```
Customer creates COD delivery order
  ↓
PENDING
  ↓ Branch Manager ACCEPT
CONFIRMED
  ↓ Kitchen
PREPARING
  ↓
READY
  ↓ Branch Manager ASSIGN
DELIVERY = ASSIGNED
  ↓ Driver ACCEPT
DELIVERY = PICKED_UP
  ↓ Driver starts delivery
ORDER = OUT_FOR_DELIVERY
DELIVERY = ON_DELIVERY
  ↓ Customer receives order + Driver collects COD
DELIVERY = DELIVERED
ORDER = COMPLETED
COD = COLLECTED
CASH CUSTODY = DRIVER
PAYMENT = PENDING
  ↓ Driver → Cashier handover
COD = HANDED_OVER
CASH CUSTODY = CASHIER
  ↓ Cashier settlement
PAYMENT = SETTLEMENT
```

## Locked invariants

1. Delivery lifecycle and payment lifecycle are separate.
2. `delivery.delivered` does not imply payment settlement.
3. A COD delivery may validly reach `Order = completed` while `Payment = pending` while the Driver still holds the physical cash.
4. Driver owns delivery execution and COD cash collection.
5. Cashier/POS owns physical cash handover confirmation and final payment settlement.
6. Driver cannot perform final payment settlement.
7. A Driver must be explicitly assigned and identified before performing delivery actions.
8. Pickup cannot occur before the Order reaches `ready`.
9. Driver acceptance is required before pickup.
10. COD settlement requires explicit physical handover to Cashier and cannot use the earlier customer tender amount as the cashier settlement amount.

## Source implementation alignment

The Xentra source already persists customer delivery destination as a routing snapshot in `order_deliveries` using:

- `destination_address`
- `destination_latitude`
- `destination_longitude`

The existing Delivery domain uses a separate Delivery Job state model and the existing Payment domain keeps payment state independent from Order fulfillment.

The Driver/COD implementation has been tightened on branch `proposal/xentra-taxonomy-composed-menu-v1` to enforce the invariants above.

## External reference validation

The lifecycle pattern is consistent with established last-mile delivery platforms:

- Bringg models driver actions as explicit fulfillment stages, lets the Driver App receive assigned orders, navigate to destinations, perform handoff actions, and optionally collect payment for cash orders. Drivers can launch their preferred navigation app from the Driver App. 
- Onfleet requires assigned driver tasks to be started/completed through the Driver App, supports strict task ordering, and captures completion details such as location, photos, signatures, notes, and other required fields. Onfleet also supports custom required data such as cash collected on delivery.
- Odoo explicitly treats Cash on Delivery as payment at the time of delivery, while its delivery/order operations remain separate from payment configuration.
- DispatchTrack documents separate billing/settlement workflows based on delivery data captured by the driver, including driver settlement and COD-related evidence.

These references validate the **shape of the workflow**, not Xentra-specific names or exact implementation.

## Boundary: what is and is not locked

### Locked now
- Happy-path Order → Kitchen → Delivery → Driver → Customer → COD Handover → Cashier Settlement.
- Separation of Order, Delivery, COD custody, and Payment state.
- Actor authority by stage.
- Driver assignment/acceptance requirement.
- Customer destination snapshot as Driver routing input.
- No Google Maps dependency is required for this lifecycle.

### Still separate before full exception contract is considered complete
- customer unavailable
- COD refusal
- delivery failure / return
- driver cancellation / reassignment
- short/over cash and variance handling
- lost cash
- cash collected while delivery transition fails
- duplicate handover/settlement
- branch/scope mismatch
- explicit proof-of-delivery requirements

The happy-path baseline may be used as the implementation source of truth while the exception contract is completed separately.

## External references

- Bringg Driver Actions: https://help.bringg.com/v1/docs/set-up-driver-actions
- Bringg Driver App: https://help.bringg.com/docs/rolling-out-the-bringg-platform
- Onfleet Start a Task: https://support.onfleet.com/hc/en-us/articles/10348790592020-Start-a-Task
- Onfleet Driver App Settings: https://support.onfleet.com/hc/en-us/articles/10228814951060-Driver-App-Settings
- Odoo Cash on Delivery: https://www.odoo.com/documentation/19.0/id/applications/finance/payment_providers/inperson_payments.html
- DispatchTrack Billing and Settlement: https://www.dispatchtrack.com/blog/billing-and-settlement-2/
