# Xentra — Dining / Table / Reservation Domain Contract v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-09-24  
**Repository:** `wanstudio/xentra-core`

## 1 — Purpose

This contract establishes the business/domain boundary for Dining so table/session/reservation rules do not remain mixed inside POS and Commerce.

It is the prerequisite for moving Dining implementation out of `domains/pos`.

This contract is deliberately incremental: it separates authority without requiring an immediate database rewrite or a new reservation storage model.

## 2 — Canonical Ownership

### Dining domain owns
- Branch dining layout used to represent physical tables.
- Table identity within a Branch.
- Table operational state.
- Table availability/concurrency rules.
- Table payment holds.
- Dining Session lifecycle.
- Dining Session ↔ Table association.
- Dining Session ↔ customer ownership checks.
- Staff-authorized table reassignment.
- Dining-specific reservation semantics and check-in/no-show rules once invoked through the Dining boundary.

### POS owns
- Cashier workflow that executes a sale.
- Shift/cashier context.
- POS-specific hold/resume/split/merge sale workflow.
- POS UI/action that asks Dining to assign/reassign/check in a table/session.

POS may call Dining. POS does not become the authority for table/session invariants.

### Commerce owns
- Cart, Checkout, Order lifecycle.
- The commercial Order record remains the transaction representation during incremental migration.
- Reservation booking may continue to be represented by an Order with `order_type = reservation` while the persistence model is not yet extracted.

Commerce must not duplicate Dining table/session invariants.

### Payment owns
- payment processing and settlement.
- Payment success/failure does not itself mean Dining Session completion.

## 3 — Canonical Concepts

### Table
A physical dining table belonging to exactly one Branch.

Scope: Branch.

Identity is stable across customer and staff workflows.

### Table Operational State

Canonical states:

```text
AVAILABLE
HELD
RESERVED
OCCUPIED
BLOCKED
OUT_OF_SERVICE
```

Rules:
- AVAILABLE can be selected/claimed only after server-side validation.
- HELD is a temporary payment hold and is not an Active Dining Session.
- RESERVED means unavailable to normal customer table selection when applicable.
- OCCUPIED means attached to an Active Dining Session.
- BLOCKED is an operational/manual unavailable state.
- OUT_OF_SERVICE is unavailable because the table cannot be used.
- Frontend state is presentation only; Core/Dining validates authoritative state.

### Table Hold
Temporary table reservation used during payment/order finalization.

Current implementation default:
- duration: 15 minutes;
- hold can be released/expired/converted;
- hold does not create an Active Dining Session by itself.

A hold reference is transaction context, not customer identity.

### Dining Session

A Dining Session is the active physical dining context joining:
- Branch;
- customer context;
- one or more Tables at the domain level;
- channel/context metadata;
- opened/closed lifecycle.

Canonical states currently supported by implementation:

```text
ACTIVE
COMPLETED
```

A completed session cannot be reused.

Customer self-transfer is forbidden.

Staff-authorized reassignment is allowed subject to Branch scope and target-table availability.

### Reservation

Reservation is a scheduled dining booking concept.

Important transition rule:

- The canonical business boundary is Dining.
- The current implementation may continue to persist the reservation as a Commerce Order with `order_type = reservation`.
- This contract does **not** require introducing a new Reservation table/model yet.
- Existing same-customer/same-branch/date duplicate prevention and branch reservation-capacity rules remain effective until explicitly replaced.
- Reservation check-in must convert/use the same reservation transaction context rather than create an unrelated secondary order.
- No-show cancellation must not silently mutate inventory.

**Current implementation limitation:** reservation booking currently records the reservation in the Order model and does not establish a dedicated table reservation allocation model. Do not invent table-allocation rules merely as part of this refactor.

## 4 — Active Session Boundary

Customer-selected table != Active Dining Session.

Canonical flow:

```text
QR / Floor Plan
      ↓
1 customer-selected table
      ↓
Dine-in Order
      ↓
Merchant operational acceptance
      ↓
Active Dining Session
      ↓
Additional Orders
      ↓
Merchant / POS completes session
```

Online payment does not require proof of physical presence.

Cash Dine-in remains subject to Merchant operational acceptance/presence verification.

## 5 — Security / Concurrency Invariants

Dining/Core must enforce server-side:

1. One customer has at most one pending/active Dine-in context per Branch.
2. One Table cannot belong to two concurrent Active Dining Sessions.
3. Session ownership must be checked against the authenticated customer context.
4. Branch, Session, Table and Order relationships must remain consistent.
5. Completed Sessions cannot be reused.
6. Customer cannot self-transfer to another table.
7. Staff reassignment must enforce role and Branch scope.
8. Customer-side multi-table selection is not allowed.
9. Table holds must be concurrency-safe and transactional.
10. Duplicate order submission remains idempotent through the Commerce transaction boundary.
11. QR and Floor Plan are table-selection mechanisms, not authorization mechanisms.
12. Payment settlement and Dining Session completion are distinct lifecycle operations.

## 6 — Cross-Domain Boundary

The intended dependency direction is:

```text
Customer / Merchant / POS
          ↓
       Core API
          ↓
       Dining
       ↙     ↘
  Commerce   Payment
```

More precisely:

- Customer selects/requests Dining context through API.
- Merchant operates Branch table/session state.
- POS executes cashier workflow and calls Dining for table/session authority.
- Commerce creates/manages Orders and delegates Dining invariants to Dining.
- Payment settles money and may trigger approved Dining/order transitions, but does not own table state.

No frontend surface is a source of truth.

## 7 — Current Source → Target Boundary

Current implementation:

```text
domains/pos/
├── services/DiningTableService.js
├── services/TableRecommendationService.js
└── templates/Template01.js
```

Target:

```text
domains/dining/
├── index.js
├── services/
│   ├── DiningTableService.js
│   └── TableRecommendationService.js
└── templates/
    └── Template01.js
```

Persistence stays behind Core repository boundary for now:

```text
core/data/repositories/DiningTableRepository.js
```

Do not move the repository merely to make the folder tree look symmetrical.

## 8 — Required Consumer Migration

These consumers currently touch Dining through the old POS boundary and must migrate to the new Dining boundary:

- `server/services/AcceptanceTimeoutService.js`
- `domains/payment/services/CashSettlementService.js`
- `domains/payment/services/PaymentGatewayService.js`
- `domains/commerce/services/OrderPlacementService.js`
- POS exports/consumers currently importing Dining from `domains/pos`

Special rule:

`OrderPlacementService.js` contains Dining/Table validation logic directly. Migration must first identify which rules belong in Dining and remove duplication rather than copying the existing validation into the new location.

## 9 — Table Recommendation

Table recommendation is a Dining capability.

It may consider:
- table availability;
- capacity;
- spatial proximity;
- capacity efficiency.

It is recommendation logic, not authorization. Final table acceptance/assignment remains server-authoritative and concurrency-safe.

## 10 — Floor Plan / Physical Layout Boundary

Physical floor-plan configuration is distinct from daily table operations.

- Administrative configuration may create/update physical table geometry/layout.
- Branch Manager operates daily table state.
- Customer selects from the published table layout.
- POS executes against table/session context.

No surface may infer authorization merely from being able to render the floor plan.

## 11 — Migration Safety

Migration must be incremental:

1. Create `domains/dining/`.
2. Add compatibility exports from old `domains/pos` path.
3. Move Dining implementation without behavior changes.
4. Migrate consumers one by one.
5. Reconcile duplicated Dining logic in Commerce/Payment.
6. Keep compatibility shim until all consumers/tests are migrated.
7. Remove old exports only after regression/security/concurrency tests pass.

Required regression coverage must preserve the existing Dine-in scenario baseline and security tests, including:
- customer/session ownership;
- branch/table/session mismatch;
- completed-session reuse;
- self-transfer rejection;
- concurrent table conflicts;
- customer vs POS channel tracking;
- Merchant acceptance boundary.

## 12 — Explicit Non-Goals

This contract does **not** introduce:
- a new reservation table;
- a new POS state machine;
- customer-side multi-table selection;
- GPS proof-of-presence;
- online-payment presence verification;
- automatic table allocation rules for reservation beyond current behavior;
- separate inventory logic for Dining;
- a new deployment/microservice boundary.

## 13 — Change Rule

Any change to Dining ownership, Table states, Session lifecycle, reservation authority, concurrency invariants, or cross-domain dependency direction requires a new explicit Architecture/Business Decision.

This contract is the authoritative Dining boundary for the refactoring program from 2026-09-24 onward.
