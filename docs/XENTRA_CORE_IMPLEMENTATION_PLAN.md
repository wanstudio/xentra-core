# Xentra-Core Implementation Plan

**Status:** ACTIVE PLAN
**Scope:** Xentra-Core implementation
**Authority:** Current Notion decisions + repository contracts
**Companion contract:** `docs/XENTRA_CODING_CONTRACT.md`

## 1. Planning Principle

Xentra-Core is implemented specification-first.

The implementation sequence is driven by dependency order, domain ownership, locked business invariants, and runtime safety — not by UI order and not by the order in which individual features happen to be requested.

The plan deliberately separates:

- business/architecture decisions;
- domain contracts;
- foundational infrastructure;
- domain implementation;
- integration/runtime wiring;
- verification and hardening.

A milestone is complete only when its contract, implementation, runtime path, tests, and relevant integrity/security checks are coherent.

## 2. Authority and Execution Rules

Before each milestone/task:

1. Read the relevant current Notion decision(s).
2. Read the relevant repository snapshots under `docs/notion/`.
3. Read the relevant agent skills.
4. Inspect current Git state and affected implementation.
5. Identify existing domain ownership and reusable services.
6. Implement only the approved scope.

If a business rule is missing or contradictory:

- do not invent a rule;
- do not silently choose a fallback policy;
- stop at the affected decision boundary and report the gap.

## 3. Target Architecture Flow

```text
Business Authority
        ↓
Domain Contracts / Invariants
        ↓
Core Domain State
        ↓
Application Services / Orchestration
        ↓
API / Integration Adapters
        ↓
Client / External Systems
```

Client state is never authoritative.

Operational truth is produced at the appropriate operational domain boundary and enforced by Xentra-Core. Reporting consumes authoritative data and does not replace operational ownership.

## 4. Dependency-Ordered Roadmap

### Phase 0 — Contract and Repository Readiness

**Goal:** Make the repository deterministic for implementation agents.

Tasks:

- keep `docs/XENTRA_CODING_CONTRACT.md` current;
- keep relevant Notion snapshots current;
- identify domain owners and locked invariants;
- verify existing runtime architecture and entry points;
- establish task-specific contract format;
- establish test/verification expectations.

**Exit criteria:**

- coding agent can execute a task from repository contracts without reconstructing business intent;
- relevant authority sources are identified;
- no unresolved architecture decision blocks the next phase.

---

### Phase A — Core Event Infrastructure

**Goal:** Establish deterministic event infrastructure before dependent domain work.

Primary scope:

- event registration/discovery;
- event contracts;
- deterministic dispatch;
- handler boundaries;
- error behavior;
- observability/instrumentation;
- component and integration tests.

**Exit criteria:**

- event infrastructure is deterministic;
- routing and failure behavior are tested;
- domain events can be introduced without creating ad-hoc event mechanisms.

---

### Phase B — Organization, Brand, and Branch Operational Foundation

**Goal:** Establish the organizational and operational truth boundaries.

Primary scope:

- organization/brand relationships;
- branch identity and scope;
- branch operational state;
- operating schedules;
- branch capabilities;
- branch-level operational configuration;
- role/scope enforcement for Owner and Branch Manager;
- operational events/activity.

Locked conceptual boundary:

```text
Organization
    ↓
Brand
    ↓
Branch
    ├── identity
    ├── operational state
    ├── product assignment
    ├── inventory state
    ├── availability
    ├── fulfillment capability
    ├── operating schedule
    └── operational events/activity
```

Branch is the operational truth boundary, not the ultimate business-policy authority.

**Exit criteria:**

- branch scope is explicit;
- operational facts have an authoritative owner;
- permissions cannot cross branch scope accidentally;
- branch state can be consumed safely by downstream domains.

---

### Phase C — Product Assignment and Branch Inventory

**Goal:** Establish authoritative branch-scoped product availability and stock.

Primary scope:

- product master boundary;
- product-to-branch assignment;
- branch inventory records;
- stock mutation ownership;
- availability state;
- stock consistency/concurrency;
- inventory audit trail;
- inventory tests.

Conceptual flow:

```text
Product Master
      ↓
Branch Product Assignment
      ↓
Branch Inventory
      ↓
Operational Availability
```

**Exit criteria:**

- branch stock is authoritative where applicable;
- client stock cannot become authoritative;
- concurrent stock mutations are safe;
- inventory mutations are auditable and idempotent where required;
- downstream checkout can consume branch inventory safely.

---

### Phase D — Availability and Branch Eligibility

**Goal:** Determine whether a branch is operationally eligible for a requested operation.

Eligibility must be evaluated before optimization.

For customer fulfillment, eligibility may include:

1. branch is active;
2. branch is operationally open;
3. requested products are assigned;
4. required inventory is available;
5. requested fulfillment capability is active;
6. delivery/service constraints are satisfied;
7. other approved policy constraints are satisfied.

Only after eligibility is established may the system optimize among eligible candidates using approved factors such as distance, ETA, cost, or policy.

Core invariant (SUPERSEDED 2026-09-04 by the Xentra-Core R1 locked decision —
matching/eligibility here remain per CHECKOUT scope):

```text
CART (multi-branch allowed: cart lines carry branch provenance)
        ↓
group cart lines into per-branch CHECKOUT scopes
        ↓
CHECKOUT is SINGLE-BRANCH (mixed scopes → CHECKOUT_SINGLE_BRANCH_REQUIRED)
        ↓
ORDER is SINGLE-BRANCH (1 order → 1 fulfillment branch)
```

Split fulfillment is not part of the Core v1 order model (one order, one
branch). A cart may span branches, but each checkout/order must not — item
provenance is never authority; server eligibility/validation stays
authoritative per checkout scope.

**Important:** Detailed recovery/rematching policy remains subject to its own approved business contract before implementation.

**Exit criteria:**

- eligibility is server authoritative;
- full-cart eligibility is evaluated where required;
- no client-selected branch can bypass eligibility;
- optimization does not substitute for eligibility;
- no automatic split fulfillment exists.

---

### Phase E — Purchase Types, Order Channels, and Fulfillment

**Goal:** Establish clear order semantics before checkout orchestration.

`order_type` and `order_channel` are separate concepts.

Order types:

- `delivery`
- `pickup`
- `dine_in`
- `reservation`

Order channels represent where/how an order entered the system, for example POS, customer app, website, marketplace, WhatsApp, or kiosk.

Primary scope:

- order type contracts;
- order channel contracts;
- fulfillment capability;
- fulfillment schedules;
- reservation semantics;
- pickup/delivery/dine-in lifecycle boundaries;
- transition rules between reservation and active dine-in where approved.

Reservation is distinct from active dine-in and is for tomorrow or later under the current locked rule.

**Exit criteria:**

- order type and channel cannot be conflated;
- fulfillment state has a clear owner;
- reservation cannot accidentally behave as active dine-in;
- downstream order creation receives normalized, authoritative semantics.

---

### Phase F — Location, Routing, and Delivery Calculation

**Goal:** Provide safe, reusable location/routing primitives and branch-context delivery calculation.

Primary scope:

- coordinate validation;
- route provider boundary;
- routing distance/ETA;
- provider failure handling;
- caching/rate controls where required;
- branch-specific delivery configuration;
- delivery fee calculation;
- radius and eligibility constraints.

Principle:

```text
Customer location
      ↓
Eligible branch
      ↓
Route calculation
      ↓
Delivery policy
      ↓
Authoritative delivery result
```

Client-supplied delivery fee is never authoritative.

**Exit criteria:**

- routing is behind an integration boundary;
- provider failures do not corrupt order state;
- delivery calculation is deterministic for the same authoritative inputs;
- branch context is explicit;
- client cannot override financial delivery values.

---

### Phase G — Commerce Cart and Pricing Validation

**Goal:** Make cart state safe for checkout.

Primary scope:

- cart input normalization;
- server-side product validation;
- server-side price resolution;
- quantity validation;
- branch-aware availability validation;
- pricing calculation;
- cart consistency checks;
- validation warnings/errors.

Rules:

- client cart is untrusted;
- client price is untrusted;
- client stock state is untrusted;
- cart does not become domain authority merely because it exists in browser state.

**Exit criteria:**

- authoritative price and availability are server derived;
- invalid carts cannot enter checkout;
- branch context is derived from Core rules;
- no legacy/global inventory assumption remains in the relevant path.

---

### Phase H — Checkout Orchestration

**Goal:** Make checkout a controlled orchestration boundary rather than a monolithic business owner.

Conceptual flow:

```text
Cart
 ↓
Commerce validation
 ↓
Branch eligibility
 ↓
Inventory availability / approved reservation boundary
 ↓
Fulfillment validation
 ↓
Promotion / pricing
 ↓
Order creation
 ↓
Payment initiation
```

Checkout coordinates domains; it does not absorb their business ownership.

Primary scope:

- checkout request normalization;
- authoritative branch resolution;
- final cart validation;
- approved inventory commitment/reservation behavior;
- fulfillment validation;
- promotion integration;
- order/payment orchestration;
- idempotency;
- replay protection;
- failure-state handling.

**Exit criteria:**

- duplicate checkout requests are safe;
- client cannot override branch, price, fee, payment state, or stock authority;
- failures produce explicit recoverable states;
- order and payment state remain separate;
- orchestration does not duplicate domain logic.

---

### Phase I — Order Domain

**Goal:** Establish an authoritative order aggregate and lifecycle.

Primary scope:

- order identity;
- customer/order data;
- branch/fulfillment context;
- order type/channel;
- line items and authoritative pricing references;
- order state machine;
- cancellation rules;
- audit evidence;
- idempotent mutation paths.

Order must remain independent from payment state.

**Exit criteria:**

- order lifecycle is explicit;
- illegal state transitions are rejected;
- historical order evidence remains auditable;
- order creation cannot create duplicate business orders through retries.

---

### Phase J — Payment and Financial Integrity

**Goal:** Make payment state authoritative, independent, and reconcilable.

Primary scope:

- payment state machine;
- payment intent/transaction identity;
- gateway integration;
- webhook handling;
- idempotency;
- cash operational attribution;
- settlement;
- refund;
- reconciliation;
- financial audit trail.

Rules:

- payment state is server authoritative;
- gateway/client state is not financial truth by itself;
- unsupported payment methods must not silently become another payment method;
- order state and payment state must remain separate.

**Exit criteria:**

- duplicate webhook/event delivery is safe;
- payment retries do not double-charge or create contradictory state;
- refund is explicit and idempotent;
- cash settlement has valid operational attribution;
- financial records are auditable.

---

### Phase K — POS, Delivery Dispatch, and External Integrations

**Goal:** Connect operational domains to external channels without moving domain authority into adapters.

Primary scope:

- POS integration;
- delivery dispatch;
- driver lifecycle;
- payment gateway adapters;
- map/routing providers;
- webhooks;
- hardware integrations;
- event-driven synchronization.

Integration adapters translate external protocols into Core contracts. They do not redefine Core business rules.

**Exit criteria:**

- external failures are isolated;
- retries are idempotent;
- webhook authenticity/integrity is verified where applicable;
- adapters do not bypass authorization or state machines;
- integration events are observable and auditable.

---

### Phase L — Customer and Workspace Experience

**Goal:** Expose the approved domain behavior through stable client flows.

Primary scope:

- Home → Product → Cart → Checkout;
- branch-aware availability presentation;
- customer identity/OTP/trusted-device flows;
- checkout states;
- owner/manager operational views;
- navigation and overlay behavior;
- error/recovery states.

UI must consume authoritative server state rather than create business truth.

Navigation invariant:

```text
Active overlay/modal/sheet
        ↓ Back
Close topmost layer
        ↓
Stay on current page

No active layer
        ↓ Back
Navigate away
```

**Exit criteria:**

- client reflects Core decisions;
- no critical business rule exists only in UI;
- back behavior is consistent across overlays;
- error states do not cause accidental duplicate mutations.

---

### Phase M — Security, Integrity, and System-Wide Hardening

**Goal:** Audit the integrated system for cross-domain failure modes.

Review areas:

- authorization/scope leaks;
- IDOR/BOLA;
- replay and duplicate requests;
- race conditions;
- inventory oversell;
- payment duplication;
- webhook spoofing;
- session/token ownership;
- privilege escalation;
- client-side trust violations;
- state-machine bypasses;
- data leakage;
- integration failure amplification;
- audit trail gaps.

**Exit criteria:**

- critical/high integrity and security findings are resolved or explicitly accepted;
- cross-domain invariants are tested;
- production-like failure scenarios have deterministic outcomes.

---

### Phase N — MVP Release Readiness

**Goal:** Validate the integrated Core MVP as a coherent product, not merely a collection of passing modules.

Verification:

- end-to-end customer ordering;
- POS order entry;
- branch operations;
- inventory mutation;
- delivery/pickup/dine-in flows;
- reservation rules;
- payment success/failure/retry/refund;
- offline/online continuity where supported;
- permissions and scope;
- auditability;
- operational reporting boundaries;
- runtime deployment configuration;
- database migrations and rollback safety;
- observability and error handling.

Release only when all critical invariants have evidence in tests or controlled verification.

## 5. Task Execution Pattern

Each implementation task should follow:

```text
1. Read authority
        ↓
2. Read task contract
        ↓
3. Inspect current Core implementation
        ↓
4. Identify existing ownership
        ↓
5. Implement minimal change
        ↓
6. Add/update tests
        ↓
7. Verify runtime wiring
        ↓
8. Audit invariants/security for affected boundary
        ↓
9. Update durable docs if contract changed
        ↓
10. Commit
```

## 6. Dependency Rules

Do not advance a dependent domain merely because code can technically be written.

Examples:

- Checkout must not become the owner of inventory rules.
- Branch matching must not bypass branch inventory authority.
- Payment must not become the owner of order lifecycle.
- UI must not become the owner of pricing, stock, branch eligibility, or payment state.
- Integration adapters must not become business-policy authorities.
- Reporting must not become operational source of truth.

When a later task exposes a missing earlier contract, stop and resolve the contract boundary first.

## 7. What Is Deliberately Not in the Plan Yet

The plan does not pre-decide business mechanisms that require their own approved contract, including detailed recovery/rematching policies, nuanced customer approval thresholds, complex refund scenarios, or other edge-case policies not yet locked.

Those decisions must be settled before the implementation task that depends on them.

## 8. Definition of Done

A milestone/task is DONE only when:

- approved business contract is satisfied;
- domain ownership is correct;
- locked invariants are enforced;
- API/runtime callers are coherent;
- persistence and concurrency behavior are safe;
- relevant tests pass;
- security/integrity impact is reviewed;
- no unrelated scope was introduced;
- durable documentation is updated when necessary;
- implementation is committed.

## 9. Current Execution Position

The repository currently has the coding contract and the implementation plan established.

Next implementation work should begin with the earliest incomplete dependency in the roadmap, after verifying the current repository state and the latest relevant Notion decisions.
