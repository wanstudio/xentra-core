<!-- SNAPSHOT FROM NOTION — source page: 03-business-flow; locked 2026-09-08 -->

# 🔒 LOCKED — Dine-in Table Layout, Multi-Table Dining & Payment Hold

Dine-in Xentra is **table-aware**. A Dine-in purchase may use one or more physical tables at the selected fulfillment Branch. The customer selects from a visual representation of the Branch dining layout.

## Customer Flow
`Purchase Type = Dine-in → Guest Count → Table Recommendation/Selection → Confirm → Checkout → Order`

The Dine-in selector may render a visual floor-plan/table map. Available, unavailable, held, occupied, reserved, blocked, and selected states are operational data; the visual layout itself is configuration data.

## Branch-Owned Table Layout
Each Branch configures its own dining layout independently. Layout is Branch operational configuration and is not shared as a Brand-wide physical layout.

A Branch layout may contain tables with stable identity/label, position, dimensions, shape/orientation, and seating capacity, plus dining areas or other non-table layout objects where needed for visual context.

There is no fixed table count or fixed physical arrangement across Branches. A Branch may start from a template or blank canvas.

## Table Identity & Lifecycle
- Table identity remains stable when position, dimensions, shape/orientation, label, or capacity changes.
- Removing a Table from active use is a soft-delete/deactivation operation so historical identity remains intact.
- Staff may temporarily block/unblock a Table without changing its layout.
- Each Table has a stable QR identity. QR can be revoked and replaced without changing Table identity or historical records.

## Layout vs Operational State
Table configuration and operational state are separate.

- Layout/configuration answers where the table is, how it is represented, what it is called, and its capacity.
- Operational state answers whether it is available, held, occupied, reserved, blocked/unavailable, or otherwise in an approved lifecycle state.
- State changes must not modify layout.

## Customer Entry / QR
Customer may enter Dine-in through either:
- scanning a Table QR, which resolves Branch + Table; or
- normal application flow, which allows Branch/Table selection through the floor plan.

## Guest Count & Recommendation
Customer enters guest count and receives one best recommendation, visually selected/highlighted on the floor plan. Customer may manually change the selection.

Recommendation priority:
1. Prefer one available Table with sufficient capacity.
2. If no single Table is sufficient, find a combination of available Tables with sufficient combined capacity.
3. There is no fixed maximum number of Tables in a combination; use as many as required when availability permits.
4. Prefer combinations whose Tables are spatially close on the Branch floor plan.
5. Among otherwise suitable candidates, prefer fewer Tables and better capacity efficiency.

“Close” means spatial proximity derived from floor-plan geometry/coordinates/dimensions, not Table number ordering or GPS distance. Recommendations adapt when layout changes.

Capacity is authoritative, but customer-side UI should guide rather than act as the sole authority. Final availability/capacity validation remains server-side.

## Multi-Table Dine-in
One Dine-in Order / active Dining Session may use multiple existing Table entities. The Tables are associated to the same dining context; they are **not merged into a new Table entity**. There is no fixed maximum number of associated Tables.

## Operational Authority & Concurrency
Customer UI is never the source of truth for availability. Server validates current availability at confirmation/assignment. A stale customer view must not allow duplicate active assignment.

POS/staff and customer Dine-in selection converge on the same authoritative operational Table state.

## Payment Hold
- Browsing/selecting does not hold Tables.
- Temporary Table hold begins when Customer enters the payment stage.
- Dine-in payment/Table hold expiry is **15 minutes**.
- Payment success changes held Tables to occupied for the active Dining Session.
- Payment failure/cancellation/expiry releases the temporary hold to available, subject to authoritative payment/server state.
- Frontend timers are not authoritative; backend/payment provider callbacks or webhooks determine payment state.
- Payment belongs to the Order, not to the Table.
- Staff/POS may correct the selected Table or Table combination even after successful online payment without invalidating the payment.

## Dining Lifecycle & Additional Orders
Payment completion does not mean dining is finished. The Dining Session remains active until staff/POS explicitly completes/finishes it.

Customer can place additional food/drink orders from their phone while the Dining Session is active. Additional orders remain associated with the same active dining context and Table association.

When the active Dining Session is completed, all Tables associated with it become available together, subject to independent reservation/blocking state.

## Reservation Boundary
`dine_in` and `reservation` remain separate `order_type` semantics. A reservation that has actually allocated a Table makes that Table unavailable to Dine-in walk-ins for the applicable reservation context. A reservation without an allocated Table does not require arbitrary Table blocking.

## Permissions
Owner, Branch Manager, and Staff with the appropriate permission may configure/edit Branch table layout and configuration. Permission controls access; not every Staff account automatically receives configuration rights.

## Invariants
- `dine_in` is table-aware.
- Every active Dine-in transaction has a Branch and at least one Table context.
- Each Branch has an independently configured table layout.
- Table layout and operational state are separate.
- Customer UI never becomes authoritative for availability.
- Availability is validated server-side at confirmation/assignment.
- Concurrent assignment conflicts fail safely.
- Table capacity is authoritative.
- Recommendation uses guest count, availability, and floor-plan spatial proximity.
- One best recommendation is visually highlighted; customer can change it.
- A Dine-in context can use any number of existing independent Tables; no merge/split entity exists.
- Payment belongs to the Order, not the Table.
- Table hold begins at payment stage and expires after 15 minutes unless payment state resolves earlier.
- `dine_in` and `reservation` remain separate order types.
- `order_channel` remains separate from `order_type`.
- Checkout orchestrates the flow but does not own Table business logic.

## Explicit Non-Goals / Do Not Invent
Table merge/split is not a feature. Do not invent customer-initiated table transfer, post-start automatic table reassignment, or advanced seating optimization beyond the stated recommendation priority.
