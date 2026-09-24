# Xentra Dine-in Table & Branch Layout Contract

**Status:** LOCKED BUSINESS/DOMAIN CONTRACT
**Decision Date:** 2026-09-08
**Authority:** Current Notion locked decision — Dine-in Table Layout & Branch Table Configuration

## 1. Scope

Xentra `dine_in` is table-aware. A customer-started Dine-in purchase is associated with exactly one physical Table at the selected fulfillment Branch. Customer-side multi-table selection is not allowed.

Customer-facing Dine-in selection may use a visual floor-plan/table map instead of a simple table list.

```text
Purchase Type = Dine-in
        ↓
Guest Count
        ↓
Table Recommendation / Selection (one Table)
        ↓
Confirm
        ↓
Checkout
        ↓
Order(s) (`order_type = dine_in`)
```

## 2. Branch-Owned Layout

Each Branch may configure its own dining layout independently.

The physical table arrangement is Branch operational configuration. It is not a Brand-wide shared layout and there is no fixed table count or fixed arrangement across Branches.

A Branch layout may define:

- table identity/label;
- table position;
- table dimensions;
- table shape/orientation;
- seating capacity;
- dining areas and other non-table visual objects required for context.

A Branch may start from a template or a blank canvas. Templates are starting configurations, not fixed business rules.

## 3. Layout vs Operational State

Layout configuration and table operational state are separate concerns.

Layout answers:

- where the table is;
- how it is visually represented;
- what it is called;
- its seating capacity.

Operational state answers whether the table is currently available, held, occupied, reserved, blocked/unavailable, or otherwise in an approved lifecycle state.

A state change must not modify layout configuration.

A table's identity must remain stable when its visual position, dimensions, shape/orientation, label, or capacity changes.

Removing a Table from active use is a soft-delete/deactivation operation so historical identity remains intact.

## 4. Authority and Concurrency

Customer UI is a renderer of authoritative Branch table data and is never the source of table availability.

When a Customer confirms a table selection, Xentra must validate current availability server-side. A stale customer view must not permit two active assignments to the same Table.

POS/staff operations and Customer Dine-in selection must converge on the same authoritative operational table state rather than maintaining conflicting independent availability state.

## 5. Guest Count, Capacity, and Recommendation

Each Table has an authoritative seating capacity.

Guest count is an input to table recommendation and operational validation. The Customer should be guided toward suitable capacity but is not hard-blocked from manually selecting an undersized Table solely by client-side filtering.

The recommendation algorithm must:

1. Prefer one available Table whose capacity is sufficient for the guest count.
2. If no single sufficient Table is available, find a combination of available Tables whose combined capacity is sufficient.
3. There is no fixed maximum number of Tables in a combination; use as many as required when availability permits.
4. Prefer combinations whose Tables are spatially close on the configured Branch floor plan.
5. Among otherwise suitable candidates, prefer fewer Tables and better capacity efficiency.

The system presents one best recommendation and visually highlights/selects it on the floor plan. The Customer may manually change the selection.

“Close” means spatial proximity derived from the configured floor-plan geometry/coordinates/dimensions, not Table number ordering or GPS distance. Recommendations must adapt when the Branch layout changes.

Visual dimensions are presentation data and must never become the capacity rule.

## 6. Customer Dine-in Table Scope

Customer-side Dine-in selection is **single-table only**.

- A Customer may select/claim exactly one Table for a customer-started Dine-in context.
- Customer App must not expose multi-table selection or allow a Customer to claim multiple Tables through repeated QR scans, floor-plan selections, or multiple pending requests.
- Any operational table correction required after acceptance is a Merchant/POS responsibility, not a customer self-service table transfer.
- Multi-table customer selection is explicitly out of scope for the current MVP/business contract.

## 7. Customer Entry, Merchant Acceptance, and Payment

Customer Dine-in has two valid entry methods:

1. **Table QR** — resolves Branch + Table directly.
2. **Customer PWA Floor Plan** — Customer selects one Table from the visual layout.

QR is a shortcut for selecting the Table. It does **not** automatically create an Active Dining Session.

Floor-plan selection likewise does **not** automatically create an Active Dining Session.

Both entry methods converge into the same customer-started Dine-in order flow:

`QR OR FLOOR PLAN → 1 TABLE → DINE-IN ORDER → MERCHANT ACCEPT / REJECT → ACTIVE DINING SESSION`

Customer-side table selection is a declaration/selection, not authoritative occupancy. The Merchant operationally accepts or rejects the customer-started Dine-in order.

### Payment

Xentra customer payment has two practical methods:

- **Online:** Customer may pay from anywhere. Physical presence is not a required security condition for online payment. If a Customer pays online for a Dine-in order and does not arrive, the payment is not treated as a technical table-fraud problem.
- **Cash:** Customer selects Cash and the order enters Merchant operational flow. Merchant/Branch Manager can verify whether the Customer is present at the selected Table. If the Customer does not arrive within the configured operational timeout, the Merchant may cancel/reject the cash Dine-in order.

Do not invent an additional customer-facing payment/security step solely to prove physical presence.

### Table hold

Browsing or selecting a Table does not create an occupancy hold.

Where the existing payment/hold contract requires a temporary Table hold during payment, the hold remains a server-authoritative operational mechanism and expires according to the existing **15-minute** contract. A hold is not equivalent to an Active Dining Session.

Frontend timers are not authoritative; backend/payment provider callbacks or webhooks determine payment state.

Each Table has a stable QR identity. QR may be revoked and replaced by Owner/Branch Manager/authorized Staff without changing Table identity or historical records.

Staff may block/unblock a Table temporarily without changing its layout.

## 8. Dining Lifecycle and Additional Orders

An Active Dining Session begins only after the customer-started Dine-in order reaches the approved Merchant operational acceptance boundary.

Payment completion does not mean the dining session is finished.

A Dine-in Dining Session remains active until staff/POS explicitly completes/finishes it.

Customer may place additional food/drink orders from their phone while the Dining Session is active. Additional orders remain associated with the same active dining context and its single customer Table.

Customer cannot self-transfer to another Table after the dining context is active. Any operational correction/reassignment is a Merchant/POS responsibility.

When the active Dining Session is completed, its Table becomes available again, subject to independent reservation or blocking state.

## 9. Reservation Boundary

`dine_in` and `reservation` remain separate `order_type` semantics.

- `dine_in` = active table-based dining transaction.
- `reservation` = future booking of a table/time and is not an active Dine-in order.
- A reservation that has actually allocated a Table makes that Table unavailable to Dine-in walk-ins for the applicable reservation context.
- A reservation that has not allocated a Table does not by itself require arbitrary Table blocking.

Reservation must not be implemented as merely a scheduled Dine-in order.

## 10. Table / Session / Order Boundary

```text
Branch
  ↓
Table(s)
  ↓
Dining Session / active dining context
  ↓
Order(s) (`order_type = dine_in`)
```

The system must preserve the distinction between physical Tables and transaction context. A Table may receive additional orders during the same active dining context.

The exact persistence shape for Dining Session and advanced table operations must follow the implementation contract; do not invent additional table lifecycle rules without an approved decision.

## 11. Layout Editor and Permissions

A Branch visual table-layout editor may support positioning, sizing, shape/orientation, labeling, and capacity configuration while preserving operational integrity.

The canonical layout uses a Branch-scoped coordinate system so the same layout can be rendered responsively on customer devices.

Owner, Branch Manager, and Staff with the appropriate permission may configure/edit Branch table layout and configuration. Permission controls access; not every Staff account automatically receives configuration rights.

## 12. Required Invariants

- `dine_in` is table-aware.
- Every active Dine-in transaction has a Branch and at least one Table context.
- Each Branch may have an independently configured table layout.
- Table layout is Branch-owned operational configuration.
- Table layout and table operational state are separate.
- Customer UI never becomes authoritative for table availability.
- Availability is validated server-side at confirmation/assignment.
- Concurrent customer/staff assignment of the same Table must fail safely.
- Table capacity is authoritative.
- Recommendation uses guest count, availability, and floor-plan spatial proximity.
- Customer receives one best visual recommendation but may change selection manually.
- Customer-started Dine-in context uses exactly one customer-selected Table.
- Payment belongs to the Order, not to the Table.
- Where applicable, Table hold begins at payment stage and expires after 15 minutes unless payment state resolves earlier; hold is distinct from Active Dining Session.
- `dine_in` and `reservation` remain separate order types.
- Table identity remains stable when visual layout changes or Table properties are edited.
- `order_channel` remains separate from `order_type`.
- Checkout orchestrates the flow but does not own table business logic.

## 13. Explicit Non-Goals / Do Not Invent

Do not invent customer-initiated table transfer workflows, post-start automatic table reassignment, multi-table customer selection, GPS proof-of-presence requirements, or other table lifecycle policies not defined here.

Customer-side Multi-Table Dine-in is explicitly **not** a feature for the current MVP/business contract.
