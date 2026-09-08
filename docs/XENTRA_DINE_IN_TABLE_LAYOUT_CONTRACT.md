# Xentra Dine-in Table & Branch Layout Contract

**Status:** LOCKED BUSINESS/DOMAIN CONTRACT
**Decision Date:** 2026-09-08
**Authority:** Current Notion locked decision — Dine-in Table Layout & Branch Table Configuration

## 1. Scope

Xentra `dine_in` is table-aware. A Dine-in purchase is associated with one or more physical Tables at the selected fulfillment Branch.

Customer-facing Dine-in selection may use a visual floor-plan/table map instead of a simple table list.

```text
Purchase Type = Dine-in
        ↓
Guest Count
        ↓
Table Recommendation / Selection
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

## 6. Multi-Table Dine-in

A Dine-in Order / active Dining Session may use one or multiple existing Table entities.

Multiple Tables are associated with the same dining context; they are not merged into a new Table entity and no merge/split lifecycle is required.

The number of associated Tables is not capped by a fixed business rule.

All Tables associated with the active dining context participate in the same operational lifecycle for that context, subject to independent reservation/blocking state.

## 7. Operational State, QR, and Payment Hold

Browsing or selecting Tables does not create a hold.

A temporary Table hold begins when the Customer enters the payment stage. The Dine-in payment/Table hold expiry is **15 minutes**.

Payment success changes held Tables to occupied for the active Dining Session. Payment failure, cancellation, or expiry releases the temporary hold back to available, subject to authoritative server/payment state.

Frontend timers are not authoritative; backend/payment provider callbacks or webhooks determine payment state.

Each Table has a stable QR identity. QR may be revoked and replaced by Owner/Branch Manager/authorized Staff without changing Table identity or historical records.

Staff may block/unblock a Table temporarily without changing its layout.

## 8. Dining Lifecycle, Corrections, and Additional Orders

Payment completion does not mean the dining session is finished.

A Dine-in Dining Session remains active until staff/POS explicitly completes/finishes it.

Customer may place additional food/drink orders from their phone while the Dining Session is active. Additional orders remain associated with the same active dining context and its Table association, as separate order events/orders as appropriate.

Staff/POS may correct the selected Table or Table combination operationally when necessary, including after a successful online payment. Payment remains attached to the Order and is not invalidated merely because the Table assignment changes.

When the active Dining Session is completed, all Tables associated with that session become available together, subject to any independent reservation or blocking state.

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
- A Dine-in context may associate any number of existing Tables; no merge/split entity is created.
- Payment belongs to the Order, not to the Table.
- Table hold begins at payment stage and expires after 15 minutes unless payment state resolves earlier.
- `dine_in` and `reservation` remain separate order types.
- Table identity remains stable when visual layout changes or Table properties are edited.
- `order_channel` remains separate from `order_type`.
- Checkout orchestrates the flow but does not own table business logic.

## 13. Explicit Non-Goals / Do Not Invent

Do not invent customer-initiated table transfer workflows, post-start automatic table reassignment, advanced seating optimization beyond the stated recommendation priority, or other table lifecycle policies not defined here.

Table merge/split is explicitly **not** a feature. Multi-Table Dine-in is association of existing independent Table entities to the same dining context.
