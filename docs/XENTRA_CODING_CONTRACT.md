# Xentra-Core Coding Contract

**Status:** LOCKED
**Purpose:** Define the authoritative contract used by coding agents when implementing Xentra-Core.

## 1. Scope

Xentra-Core is implemented from approved business decisions, architecture boundaries, domain contracts, API contracts, state rules, security requirements, and repository documentation.

Coding agents MUST treat these artifacts as the implementation specification.

A coding agent is an implementation executor, not a business-policy designer.

## 2. Authority Order

When sources disagree, use this order:

1. Current Notion decisions and locked requirements.
2. Pinned Notion snapshots in `docs/notion/`.
3. Xentra-Core architecture and domain contracts in this repository.
4. Explicit task-specific implementation contracts and prompts.
5. Existing Xentra-Core implementation as evidence of current behavior.

Code MUST NOT become a source of new business rules merely because an existing implementation behaves that way.

If a relevant Notion decision may have changed since its repository snapshot, stop and request the current decision rather than guessing.

## 3. Coding-Agent Boundary

Coding agents MUST:

- implement the approved contract;
- preserve locked invariants;
- use the existing Xentra-Core domain ownership and runtime boundaries;
- reuse existing services/contracts where they already own the required behavior;
- add the smallest implementation necessary to satisfy the contract;
- verify affected callers, state transitions, persistence, and runtime wiring;
- add or update tests for contractual behavior and invariant violations;
- report unresolved ambiguity or contract conflict.

Coding agents MUST NOT:

- invent missing business rules;
- redefine domain ownership without an approved decision;
- create parallel services for behavior already owned elsewhere;
- preserve obsolete behavior merely for compatibility unless explicitly required;
- introduce speculative abstractions or dependencies;
- perform unrelated refactors;
- treat client/UI state as domain authority;
- silently weaken validation, authorization, idempotency, consistency, or auditability.

## 4. Ambiguity and Conflict Protocol

When the contract is insufficient to determine behavior:

```text
DO NOT GUESS
DO NOT INVENT A BUSINESS RULE
DO NOT SILENTLY CHOOSE A POLICY
REPORT THE GAP
```

When existing implementation conflicts with an approved contract:

1. identify the conflict;
2. preserve the approved contract;
3. determine the smallest corrective implementation;
4. update tests;
5. document the contract/architecture change if required.

## 5. Domain Truth and Authority

Xentra-Core must maintain explicit authority boundaries.

### Business authority

Owner/Brand-level policy is authoritative for business policy within its defined scope.

### Operational authority

Branch is the **operational truth boundary**. It produces authoritative operational facts within its scope, including:

- inventory state;
- product availability;
- fulfillment capability;
- operating state;
- operational activity;
- operational events.

Branch is not the ultimate authority for organization-wide business policy.

Branch Manager exercises operational authority according to role and scope.

### Core authority

Xentra-Core enforces:

- authorization and scope;
- domain invariants;
- state transitions;
- consistency;
- idempotency;
- transactional integrity;
- auditability.

### Reporting authority

Reporting consumes operational/business data to produce reporting and insight. Reporting does not replace operational source-of-truth ownership.

## 6. Core Business Invariants

The following are implementation invariants unless superseded by a newer locked decision:

### Cart and fulfillment

- One cart resolves to one fulfillment branch.
- Split fulfillment is not part of the Core v1 fulfillment model.
- Branch matching is a consumer of branch operational truth, not the definition of Branch.
- Customer-facing state must reflect server-authoritative decisions.
- A cart must not silently acquire a different business meaning because of client-side state.

### Product and inventory

- Product master and branch operational inventory are separate concerns.
- Inventory authority is branch-scoped where branch stock is applicable.
- Availability must respect product assignment, inventory state, branch operational state, and relevant fulfillment capability.
- Client-supplied stock or price is never financial/domain authority.

### Orders and payments

- Order state and payment state are separate state machines.
- Financial state must be server authoritative.
- Payment transitions must be idempotent.
- Order creation, payment initiation, webhook handling, settlement, and refund behavior must not create contradictory financial states.
- Cash operational confirmation does not by itself imply financial settlement without the required attribution and controls.

### Fulfillment and order semantics

`order_type` and `order_channel` are separate concepts.

Order types include:

- `delivery`
- `pickup`
- `dine_in`
- `reservation`

Order channels describe the source/entry channel, such as POS, customer app, website, marketplace, WhatsApp, or kiosk. A channel is not a fulfillment type.

Reservation is distinct from active dine-in. Same-day reservation is not allowed; reservation is for tomorrow or later unless a newer approved decision explicitly changes this rule.

### Navigation and UI

UI/client state is never domain authority.

When a bottom sheet, modal, or overlay is active, browser/mobile back must close the topmost active layer first and keep the user on the current page. Only when no layer is active may back navigation leave the current page.

## 7. Implementation Discipline

Before coding:

1. Read the relevant Notion snapshot(s).
2. Read the relevant `.agent/skills/*/SKILL.md` files.
3. Inspect current Git status, recent commits, affected files, and existing runtime wiring.
4. Identify the domain owner and locked invariants.
5. Identify existing services/contracts that already own the behavior.
6. Confirm the requested change is within the approved scope.

During coding:

- prefer existing ownership over parallel implementations;
- preserve domain boundaries;
- keep validation server authoritative;
- keep state transitions explicit;
- make mutation paths idempotent where required;
- use transactions/concurrency controls where domain integrity requires them;
- avoid unrelated changes.

After coding:

- run the relevant tests;
- verify runtime wiring and callers;
- inspect changed files for accidental scope expansion;
- verify business invariants remain intact;
- update durable documentation when contracts or architecture change;
- commit the completed implementation.

## 8. Prompt Contract

Every coding task prompt should identify, where applicable:

```text
Authority:
  Which Notion decisions/contracts govern this task?

Target:
  Which Xentra-Core domain/service/API owns the behavior?

Required behavior:
  What must become true?

Invariants:
  What must never be violated?

Existing ownership:
  Which existing services/components/contracts must be reused?

Out of scope:
  What must not be changed?

Verification:
  Which tests, state transitions, security properties, and runtime paths must be verified?
```

A task is not complete merely because code compiles or a happy-path test passes. Completion requires contractual correctness and coherent runtime behavior.

## 9. Specification-First Principle

The approved specification is the bridge between business decisions and implementation.

```text
Business decisions
        ↓
Architecture / domain contracts
        ↓
Task-specific implementation contract
        ↓
Coding agent
        ↓
Xentra-Core implementation
```

The coding agent should not be required to reconstruct business intent from unrelated implementation details.

## 10. Final Rule

> **Implement the approved Xentra-Core contract. Do not invent the contract while coding.**

If implementation reality and specification disagree, surface the disagreement and correct it deliberately. Never hide the conflict behind compatibility behavior, silent fallback, or speculative architecture.
