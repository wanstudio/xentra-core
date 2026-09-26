# Xentra — Purchase Type / Fulfillment Environment Contract v1

**Status: LOCKED — BUSINESS / UX / ARCHITECTURE CONTRACT v1**
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

This contract was cross-referenced against the current Xentra source and current restaurant SaaS fulfillment patterns, then approved for implementation on 2026-09-26.

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

## 5.1 Phase, Substate, Event, Timing, and Exception Separation

A primary phase is the smallest set of user-facing steps that meaningfully changes the operator's mental model.

The following MUST NOT automatically become primary phases:
- driver assignment;
- customer arrival;
- payment settlement;
- cash handover;
- ETA/time windows;
- internal audit events.

These belong to substates, actions, timing/context, financial state, handoff, or activity history as appropriate.

Conceptual model:

`Fulfillment Environment → Primary Phases + Substates/Actions + Timing + Exceptions + Handoffs + Activity History`

Timing is independent from phase. A scheduled order may wait for its processing window without inventing additional UI phases.

Exceptions are side paths from the normal flow, not forced into the happy-path phase list.

Handoffs between environments are explicit business events.

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

This contract does not authorize:
- replacing the canonical Commerce Order;
- duplicate Orders, payment ledgers, or inventory pools per environment;
- a second competing global Order/fulfillment state machine;
- changing already locked Dine-in rules;
- inventing new purchase types;
- treating UI projection as authorization or domain authority.

Driver execution/COD implementation remains subject to the existing Driver + COD contract and its own vertical implementation boundary. This contract defines how that delivery environment is represented; it does not invent a new Driver identity system.

## 16. Cross-Reference Result

The final cross-reference found no conceptual blocker.

Current official SaaS references reviewed:
- Square Order Manager separates fulfillment status, order type/source, payment status, scheduling/fulfillment timing, and activity history.
- Toast Orders Hub separates approval/preparation/ready/completion from first-party driver assignment and delivery progress, with role permissions around delivery completion.

Xentra therefore adopts the same architectural separation at the level appropriate to its own domain:
- primary phase ≠ every operational event;
- timing ≠ phase;
- payment ≠ fulfillment;
- activity history ≠ phase;
- exceptions are side paths;
- environment handoffs are explicit;
- authorization remains server-side.

Reference sources:
- https://squareup.com/help/us/en/article/6923-pickup-orders-on-square-point-of-sale
- https://developer.squareup.com/docs/orders-api/fulfillments
- https://support.toasttab.com/en/article/Order-Hub-Overview
- https://support.toasttab.com/en/article/Managing-Off-Premise-Orders-with-Orders-Hub

## 17. Implementation Rule

Implementation MUST prefer:

`One canonical Commerce Order`
+
`Independent Fulfillment Environment contracts`
+
`Environment-specific UI/state projections`
+
`Explicit transition authority`

over a universal operational state machine that tries to serve every purchase type.

**Status: LOCKED — implementation authorized.**

Implementation record — current HEAD `ec480f60ff00fdee39031b7a2ecdb401c661e016c`:
- Fulfillment Environment projection extended in `apps/customer-pwa/assets/js/core/fulfillment-environments.js`.
- Customer order tracking wired to environment-specific phases/labels.
- Merchant Order Center wired to environment-specific status labels.
- Backend OrderStateMachine now rejects transitions that do not belong to the order's fulfillment environment.
- Delivery Job lifecycle now keeps `delivered` separate from canonical Order `completed`.
- Regression coverage added for environment isolation, projections, transition compatibility, and Delivery completion semantics.

Verification constraint: full `npm test` was not run in this environment because the available runtime could not resolve GitHub/DNS for a fresh repository checkout. Source-level verification was performed through the repository files and targeted contract tests were added.

Any later change to environment phases, completion authority, handoff semantics, or shared-vs-independent boundaries requires a new explicit decision.
