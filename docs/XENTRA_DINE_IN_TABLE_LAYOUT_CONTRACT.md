# Xentra Dine-in Table & Branch Layout Contract

**Status:** LOCKED BUSINESS/DOMAIN CONTRACT
**Decision Date:** 2026-09-08
**Authority:** Current Notion locked decision — Dine-in Table Layout & Branch Table Configuration

## 1. Scope

Xentra `dine_in` is table-aware. A Dine-in purchase is associated with a physical table at the selected fulfillment Branch.

Customer-facing Dine-in selection may use a visual floor-plan/table map instead of a simple table list.

```text
Purchase Type = Dine-in
        ↓
Select Table
        ↓
Confirm
        ↓
Checkout
        ↓
Order (`order_type = dine_in`)
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

## 3. Layout vs Operational State

Layout configuration and table operational state are separate concerns.

Layout answers:

- where the table is;
- how it is visually represented;
- what it is called;
- its seating capacity.

Operational state answers whether the table is currently available, occupied, reserved, unavailable, or otherwise blocked according to the approved table lifecycle.

A state change must not modify layout configuration.

A table's identity must remain stable when its visual position changes.

## 4. Authority and Concurrency

Customer UI is a renderer of authoritative Branch table data and is never the source of table availability.

When a Customer confirms a table, Xentra must validate current availability server-side. A stale customer view must not permit two active assignments to the same table.

POS/staff operations and Customer Dine-in selection must converge on the same authoritative operational table state rather than maintaining conflicting independent availability state.

## 5. Capacity

Each table has an authoritative seating capacity.

Guest count must be validated against the selected table capacity before the Dine-in transaction proceeds.

Visual dimensions are presentation data and must never be used as the capacity rule.

## 6. Reservation Boundary

`dine_in` and `reservation` remain separate `order_type` semantics.

- `dine_in` = active table-based dining transaction.
- `reservation` = future booking of a table/time and is not an active Dine-in order.
- A reservation may later enter the operational Dine-in context through the approved reservation lifecycle.

Reservation must not be implemented as merely a scheduled Dine-in order.

## 7. Table Identity, Session, and Order

The system should preserve the distinction between the physical table and the transaction context.

```text
Branch
  ↓
Table
  ↓
Dining Session / active dining context
  ↓
Order(s) (`order_type = dine_in`)
```

A table may receive additional orders during the same active dining context. Table identity should not be duplicated as the sole representation of the dining visit.

The exact persistence shape for Dining Session and advanced table operations must follow the implementation contract; do not invent additional table lifecycle rules without an approved decision.

## 8. Layout Editor Boundary

A Branch may receive a visual table-layout editor.

The editor may support positioning, sizing, shape/orientation, labeling, and capacity configuration, but it must preserve operational integrity.

The canonical layout should use a Branch-scoped coordinate system so the same layout can be rendered responsively on customer devices.

Visual coordinates are configuration only and do not replace stable table identity or operational state.

## 9. Required Invariants

- `dine_in` is table-aware.
- Every active Dine-in transaction has a Branch and table context.
- Each Branch may have an independently configured table layout.
- Table layout is Branch-owned operational configuration.
- Table layout and table operational state are separate.
- Customer UI never becomes authoritative for table availability.
- Table availability is validated server-side at confirmation/assignment.
- Concurrent customer/staff assignment of the same table must fail safely.
- Table capacity is authoritative and validated against guest count.
- `dine_in` and `reservation` remain separate order types.
- Table identity remains stable when visual layout changes.
- `order_channel` remains separate from `order_type`.
- Checkout orchestrates the flow but does not own table business logic.

## 10. Non-goals

This contract does not yet define detailed policies for:

- table merging/splitting;
- customer-initiated table transfer;
- automatic table assignment;
- exact hold/timeout duration for customer table selection;
- advanced seating optimization.

Those are separate decisions and must not be invented as part of implementing this contract.
