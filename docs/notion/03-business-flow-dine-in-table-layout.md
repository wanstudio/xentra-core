<!-- SNAPSHOT FROM NOTION — source page: 03-business-flow; locked 2026-09-08 -->

# 🔒 LOCKED — Dine-in Table Layout & Branch Table Configuration

Dine-in Xentra is **table-aware**. A Dine-in purchase is associated with a physical table at the selected fulfillment Branch. The customer selects the table from a visual representation of the Branch's dining layout.

## Customer Flow
`Purchase Type = Dine-in → Select Table → Confirm → Checkout → Order`

The Dine-in selector may render a visual floor-plan/table map rather than a simple table list. Available, unavailable, and selected states are data-driven operational states; the visual layout itself is configuration data.

## Branch-Owned Table Layout
Each Branch may configure its own dining layout independently. Layout is a Branch operational configuration and is not shared as a Brand-wide physical layout.

A Branch layout may contain tables with their own identity/label, position, dimensions, shape/orientation, and seating capacity, plus dining areas or other non-table layout objects where needed for visual context.

There is no fixed table count or fixed physical arrangement across Branches.

## Separation of Concerns
Table identity/configuration and Table operational state are separate.

- Layout/configuration answers where the table is, what it is called, how it is represented, and its seating capacity.
- Operational state answers whether the table is currently available, occupied, reserved, unavailable, or otherwise blocked according to the approved table lifecycle.
- A status change must not modify the underlying layout.
- Table identity must remain stable when its visual position changes.

Customer UI is a renderer of authoritative Branch table data and is not the source of truth for availability.

## Operational Authority
Table availability must be validated server-side when the customer confirms the selected table. A stale customer view must never allow two active assignments to the same table.

POS/staff operations and customer-facing Dine-in selection must converge on the same authoritative operational table state rather than maintaining conflicting independent availability.

## Capacity
Each table has an authoritative seating capacity. Customer guest count must be validated against the selected table capacity before the Dine-in transaction proceeds.

Visual dimensions are presentation data and must never become the capacity rule.

## Dine-in and Reservation
`dine_in` and `reservation` remain separate `order_type` semantics.

- **Dine-in:** active table-based dining transaction.
- **Reservation:** future booking of a table/time; it is not an active Dine-in order.
- A reservation may later enter the operational Dine-in context through the approved reservation lifecycle.

## Table / Session / Order Boundary
```text
Branch
  ↓
Table
  ↓
Dining Session / active dining context
  ↓
Order(s) (`order_type = dine_in`)
```

A table may receive additional orders during the same active dining context. Table identity is not the sole representation of the dining visit.

## Layout Editor Boundary
A Branch may receive a visual table-layout editor. It may support positioning, sizing, shape/orientation, labeling, and capacity configuration while preserving operational integrity.

The canonical layout should use a Branch-scoped coordinate system so the same layout can be rendered responsively on customer devices. Visual coordinates do not replace stable table identity or operational state.

## Invariants
- `dine_in` is table-aware.
- Every active Dine-in transaction has a Branch and table context.
- Each Branch may have an independently configured table layout.
- Table layout is Branch-owned operational configuration.
- Table layout and table operational state are separate.
- Customer UI never becomes authoritative for table availability.
- Availability is validated server-side at confirmation/assignment.
- Concurrent customer/staff assignment of the same table must fail safely.
- Table capacity is authoritative and validated against guest count.
- `dine_in` and `reservation` remain separate order types.
- Table identity remains stable when visual layout changes.
- `order_channel` remains separate from `order_type`.
- Checkout orchestrates the flow but does not own table business logic.

## Non-goals
Detailed policies for table merging/splitting, customer-initiated table transfer, automatic table assignment, exact customer selection hold duration, and advanced seating optimization remain separate decisions.
