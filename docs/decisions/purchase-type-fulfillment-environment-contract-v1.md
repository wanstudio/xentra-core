# Xentra — Purchase Type / Fulfillment Environment Contract v1

**Status: DRAFT — REVIEW REQUIRED BEFORE IMPLEMENTATION**
**Date:** 2026-09-26
**Scope:** Commerce fulfillment UX, operational workflow, phase model, human-facing labels, and authority boundaries

## 1. Purpose

Xentra MUST treat each purchase type as its own **Fulfillment Environment**.

A Fulfillment Environment is the operational experience for one purchase type. It defines its own:
- human-facing phases;
- action set;
- transition authority;
- UI hierarchy;
- contextual information;
- completion semantics;
- exception handling vocabulary.

The environments are siblings, not variants that inherit one universal operational UI flow.

This contract is intentionally a **review draft**. It is not implementation authorization until the business/UX direction is approved.

## 2. Core Principle

Do not force every purchase type into one generic lifecycle such as:

`pending → confirmed → preparing → ready → completed`

That lifecycle may remain useful as an internal canonical representation where required by the existing domain, but it MUST NOT dictate the human-facing workflow of every purchase type.

Instead:

`Commerce Order → order_type → Fulfillment Environment`

Each environment renders only the phases and actions that make sense for that real-world situation.

## 3. What Is Shared vs Independent

### Shared Commerce foundation

There remains one authoritative Commerce Order and shared domain data for:
- Order identity;
- customer;
- branch;
- items;
- pricing;
- inventory;
- payment ledger;
- audit history;
- relevant customer/order metadata.

Do NOT create a duplicate Order record, duplicate payment ledger, or duplicate inventory pool for each Fulfillment Environment.

### Independent operational experience

Each Fulfillment Environment independently owns:
- human-facing phase names;
- phase count;
- next-action presentation;
- relevant operational context;
- actor/action authority;
- environment-specific exception states;
- environment-specific completion wording.

The same underlying domain event may therefore produce different UI behavior across environments.

## 4. No Operational Inheritance Between Purchase Types

The following are explicitly prohibited:

- One universal UI phase list reused by all purchase types.
- One universal `Complete Order` action shared by all purchase types.
- Showing Delivery phases inside Pickup UI.
- Showing Driver phases inside Dine-in UI.
- Showing table/session actions inside Delivery UI.
- Making payment settlement automatically complete every fulfillment environment.
- Making one environment's transition semantics silently apply to another environment.

Shared infrastructure is allowed. Shared **operational semantics** are not assumed.

## 5. Fulfillment Environments

The current purchase-type set is:

1. `dine_in`
2. `pickup`
3. `delivery`
4. `reservation`

Each environment is independent at the UX/operational layer.

### A. DINE-IN Environment — Proposed Human Flow

Real-world mental model:

`Datang → Pesanan diterima → Makan → Bayar → Selesai`

Proposed operational phases:

| Phase | Human label | Primary authority |
|---|---|---|
| 1 | Menunggu diterima | Branch Manager / authorized operational staff |
| 2 | Sedang diproses | Kitchen / operational staff |
| 3 | Sedang menikmati | Active Dining Session |
| 4 | Siap diselesaikan | Cashier/POS + operational boundary |
| 5 | Selesai | Authorized staff according to Dining Session contract |

Important:
- Table identity and Dining Session remain Dine-in-specific concerns.
- Additional orders belong to the same Active Dining Session where applicable.
- Completing payment does NOT by itself complete the Dining Session.
- Completing the Dining Session releases the table according to the existing Dine-in contract.
- Delivery concepts must not appear in this environment.

### B. PICKUP Environment — Proposed Human Flow

Real-world mental model:

`Pesanan masuk → Dibuat → Siap diambil → Sudah diambil`

Proposed operational phases:

| Phase | Human label | Primary authority |
|---|---|---|
| 1 | Menunggu diterima | Branch Manager / authorized operational staff |
| 2 | Sedang disiapkan | Kitchen / operational staff |
| 3 | Siap diambil | Merchant / fulfillment staff |
| 4 | Sudah diambil | Authorized handoff staff |

Important:
- No Driver lifecycle is shown.
- No table/session lifecycle is shown.
- The environment should be able to remain shorter than Delivery because there is no delivery execution.

### C. DELIVERY Environment — Proposed Human Flow

Real-world mental model:

`Pesanan masuk → Dibuat → Siap diantar → Sedang diantar → Selesai diantar`

Proposed operational phases:

| Phase | Human label | Primary authority |
|---|---|---|
| 1 | Menunggu diterima | Branch Manager / authorized operational staff |
| 2 | Sedang disiapkan | Kitchen / operational staff |
| 3 | Siap diantar | Branch Manager / dispatch boundary |
| 4 | Sedang diantar | Driver |
| 5 | Selesai diantar | Driver |

Delivery-specific subflows:
- driver assignment;
- pickup;
- delivery execution;
- delivery completion;
- COD cash collection/custody;
- COD cash handover;
- payment settlement.

Important:
- Driver becomes the authority for actual delivery execution after assignment.
- `Selesai diantar` means the delivery job has completed.
- COD cash possession and Payment Settlement remain separate.
- Delivery completion MUST NOT be expressed as a Dine-in-style session completion.
- Delivery MUST NOT require Cashier to operate delivery progress.

### D. RESERVATION Environment — Proposed Human Flow

Real-world mental model:

`Buat reservasi → Dikonfirmasi → Menunggu kedatangan → Tamu datang → Selesai / masuk Dine-in`

Proposed operational phases:

| Phase | Human label | Primary authority |
|---|---|---|
| 1 | Menunggu konfirmasi | Reservation/Branch Manager |
| 2 | Sudah dikonfirmasi | Reservation/Branch Manager |
| 3 | Menunggu kedatangan | Reservation/Branch Manager |
| 4 | Tamu sudah datang | Branch operational staff |
| 5 | Dialihkan ke Dine-in | Dine-in operational boundary |

Important:
- Reservation is not an active Dine-in session merely because a reservation exists.
- When the customer actually arrives, the reservation may hand off into the Dine-in environment according to the approved reservation contract.
- Reservation UI must not inherit Delivery or Pickup phases.

## 6. Human Labeling Rule

Internal state names and human-facing labels are different layers.

Backend/internal terminology may remain technical, for example:
- `pending`;
- `confirmed`;
- `preparing`;
- `ready`;
- `picked_up`;
- `on_delivery`;
- `delivered`;
- `completed`.

The UI SHOULD translate these into the language of the person performing the real-world task.

Examples:

| Internal event/state | Human-facing example |
|---|---|
| pending | Menunggu diterima |
| preparing | Sedang disiapkan |
| ready for pickup | Siap diambil |
| ready for delivery | Siap diantar |
| picked_up by driver | Sudah diambil driver |
| on_delivery | Sedang diantar |
| delivered | Selesai diantar |
| COD cash pending handover | Uang COD belum diserahkan |
| payment settled | Pembayaran selesai |

Do not expose backend vocabulary merely because it exists in the database.

## 7. Completion Is Environment-Specific

There is no universal human meaning for **"Selesai"**.

Examples:

**Dine-in**
- "Selesai" means the Dining Session is explicitly finished and the table can be released.

**Pickup**
- "Sudah diambil" means the merchant has completed the pickup handoff.

**Delivery**
- "Selesai diantar" means the Driver reports the delivery as completed.

**Reservation**
- "Dibawa ke Dine-in" / equivalent means the reservation has handed off to an actual dining context.

Payment settlement is an independent financial event and must not be treated as a generic fulfillment-completion button.

## 8. Authority Must Be Defined Per Environment

Authority is attached to the real-world action, not merely to the word "complete".

### Dine-in
- Branch operational acceptance: Branch Manager / approved staff boundary.
- Kitchen production: Kitchen authority.
- Payment settlement: Cashier/POS.
- Dining Session completion: authorized Dine-in operational actor according to the existing contract.

### Pickup
- Branch acceptance: Branch Manager / approved staff boundary.
- Kitchen production: Kitchen authority.
- Pickup handoff completion: authorized merchant/fulfillment actor.

### Delivery
- Branch acceptance: Branch Manager / approved staff boundary.
- Driver assignment: Branch Manager.
- Pickup / on-delivery / delivered: Driver.
- COD cash handover: Driver + Cashier.
- Payment settlement: Cashier/POS.

### Reservation
- Reservation confirmation: Reservation/Branch Manager authority.
- Arrival/check-in: Branch operational authority.
- Handoff into Dine-in: Dine-in operational boundary.

No environment may infer authority from another environment's rules.

## 9. Cross-Environment Handoffs

Independence does not mean isolation from authoritative events.

An environment may hand off to another environment when the business model genuinely requires it.

Example:

`Reservation → Customer arrives → Dine-in Environment`

The handoff is explicit.

The Reservation environment does not silently become a Dine-in environment merely because both concern a table.

Similarly:

`Delivery → delivered → COD cash remains pending → Cashier settlement`

The delivery experience ends its fulfillment action while the financial/cash experience continues independently.

## 10. State Projection Rule

A backend/domain event may be consumed by multiple surfaces, but each surface decides its own presentation according to its environment contract.

The system SHOULD conceptually separate:

`Domain Event → Environment Projection → Human UI`

rather than:

`Database Status → Universal UI Label`

This allows one purchase type to have 3 meaningful phases while another has 5 or more without creating contradictory business behavior.

## 11. Environment Boundary for Mobile/Desktop UI

Each environment owns its own:
- phase indicator;
- primary action;
- status copy;
- detail information;
- warning/error handling;
- completion confirmation.

The UI must not present irrelevant controls merely because another purchase type needs them.

Examples:
- Delivery may show Driver assignment.
- Pickup must not show Driver assignment.
- Dine-in may show Table/Session context.
- Delivery must not show Table context.
- COD Delivery may show cash-custody status.
- Dine-in does not show Driver cash custody.

## 12. Payment Separation

Payment remains a shared financial domain but is **not** the fulfillment state machine.

This means:
- payment may be pending while fulfillment progresses;
- fulfillment may complete while payment remains pending where the business contract allows it;
- payment settlement must be performed by its authorized financial actor;
- a payment event must not silently mutate unrelated operational environment semantics.

COD is the clearest example:
`Delivery completed → Driver holds cash → Cash handover → Cashier settlement`

## 13. Offline / Technical State Separation

Network connectivity, Core reachability, terminal readiness, shift state, synchronization, and similar technical conditions are not fulfillment phases.

The POS readiness indicator contract remains separate.

A technical condition may prevent an action or change the UI readiness indicator, but it MUST NOT redefine the business meaning of a fulfillment phase.

## 14. Exception Model

Each environment may define its own operational exceptions.

Examples:

**Dine-in**
- customer does not arrive;
- table blocked;
- session cannot be completed while unpaid/unaccepted according to contract.

**Pickup**
- customer does not arrive;
- customer requests cancellation;
- item unavailable.

**Delivery**
- customer unavailable;
- customer refuses COD;
- incorrect cash amount;
- driver reassignment;
- cash handover variance;
- delivery failure.

**Reservation**
- customer late/no-show;
- table unavailable;
- reservation cancellation;
- check-in failure.

Exceptions MUST be defined in the environment where they occur rather than added to one global status machine.

## 15. Non-Goals

This contract does NOT authorize:
- implementation of new APIs;
- database migration;
- replacement of the existing Order model;
- creation of duplicate Orders per environment;
- creation of duplicate payment records per environment;
- creation of separate inventories per environment;
- immediate replacement of the existing Order State Machine;
- implementation of Driver App/COD in this review step;
- changing already locked Dine-in rules without an explicit new decision.

## 16. Review Questions Before Implementation

The following points require explicit review before implementation:

1. Are **Dine-in / Pickup / Delivery / Reservation** the correct independent Fulfillment Environments?
2. Are the proposed human-facing phases understandable to real branch staff?
3. Should any environment have fewer or more phases?
4. Which role owns each environment-specific completion action?
5. Which phases should be visible to Customer, Merchant, Cashier, Driver, and Owner?
6. Which exception cases are mandatory for MVP?
7. Should any environment introduce an additional subflow without becoming a new global state machine?
8. What exact technical representation should be used underneath the environment projection?

## 17. Implementation Rule After Approval

Only after this review is approved should implementation proceed.

Implementation MUST prefer:

`One canonical Commerce Order`
+
`Independent Fulfillment Environment contracts`
+
`Environment-specific UI/state projections`
+
`Explicit transition authority`

over a universal operational state machine that tries to serve every purchase type.

**Current status remains DRAFT until explicit approval.**
