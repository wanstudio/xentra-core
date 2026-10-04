# Xentra UI-First Product Development Mental Model

**Status:** LOCKED WORKING RULE  
**Decision date:** 2026-10-05  
**Scope:** Merchant App, Owner Dashboard, POS, Customer-facing operational/product flows, and any feature where UX/UI is part of the work.

## 1. Core Rule

> **UI FIRST. UX LOGIC FIRST. BACKEND AFTER.**

For user-facing feature work, Xentra must establish the user-facing flow and interaction model **before** designing or refactoring backend structures.

The implementation order is:

```
Real user task / business goal
        ↓
Reference / benchmark research
        ↓
User flow + IA
        ↓
UI screens / states
        ↓
UX behavior + interaction rules
        ↓
UX contract / acceptance criteria
        ↓
Minimum backend data/API contract needed by the UI
        ↓
Backend implementation
        ↓
Wiring / integration
        ↓
Tests + runtime verification
```

**Backend structure is an implementation detail. It must not dictate an unintuitive merchant workflow.**

## 2. What This Changes

The previous failure mode was:

```
Database / Product model
        ↓
Backend contract
        ↓
Force the UI to expose that model
```

That is **not** the default Xentra workflow anymore.

The correct direction is:

```
Merchant/customer task
        ↓
What the user needs to see and do
        ↓
Simplest coherent UI/UX
        ↓
What data and rules the system must support
        ↓
Backend / API / persistence
```

Existing backend models may be audited or reused as constraints, but they are **not allowed to become the UX simply because they already exist**.

## 3. Merchant Mental Model

The primary merchant-facing object should be the thing the merchant is actually trying to operate.

For menu management:

> **Merchant thinks: "Saya mau jual Es Teh Manis."**

The UI should therefore let the merchant create a sellable menu without requiring knowledge of:

- Product entity internals;
- SKU modeling;
- Composition tables;
- Branch adoption mechanics;
- resolver architecture;
- database normalization;
- migration strategy.

Those concepts may exist internally and remain important for inventory, reporting, ordering, and consistency.

They are not required knowledge for the basic merchant flow.

### Es Teh Manis test

Every menu/product-entry redesign must pass this sanity test:

> A normal merchant can add **Es Teh Manis**, set its price, assign a sensible category, save it, and make it sellable without first creating a chain of technical entities manually.

If this cannot be achieved, the UI/UX is not ready.

## 4. Progressive Disclosure

Complex capability must appear **only when the user's task requires it**.

Default path:

```
Simple task → Simple UI → Done
```

Advanced path:

```
User needs more control
        ↓
Reveal advanced options
        ↓
Configure only the additional complexity required
```

Examples of optional complexity include:

- variations / flavors;
- add-ons / complements;
- package composition;
- stock tracking;
- recipe/component consumption;
- branch-specific operational rules.

Do not force all of these into the first screen merely because the backend can model them.

## 5. UI Is the First Design Source of Truth

For a user-facing feature, the implementation discussion starts by answering:

1. What is the user trying to accomplish?
2. What is the simplest successful flow?
3. What screens/surfaces are required?
4. What are the empty, loading, success, error, disabled, and edge states?
5. What information is required versus optional?
6. Which complexity is progressive disclosure?
7. What should the user never need to understand?

Only after those are coherent should backend contracts be derived.

Figma, implemented UI prototypes, or another explicit visual/interaction artifact should be used to settle the flow before deep backend implementation begins when the feature materially changes UX.

## 6. Research Before Designing Novel UX

When a mature product solves the same merchant problem, research it first.

For merchant/product/menu workflows, established products such as GoFood/GoBiz are **benchmarks for interaction principles and proven task structure**, not templates to copy blindly.

The question is:

> "What makes this task easy for a real merchant?"

not:

> "How do we reproduce their screens?"

Use research to reduce unnecessary decisions, steps, terminology, and cognitive load.

## 7. Backend Follows the UX Contract

Once the UI/UX flow is coherent:

- identify the minimum data the flow requires;
- map UI concepts to existing authoritative domain concepts;
- reuse existing ownership boundaries where appropriate;
- add or change backend behavior only where the UI/business flow requires it;
- preserve security, financial, inventory, and consistency invariants.

If the existing backend cannot cleanly support the approved UI flow:

> **Report the contract/data gap and adapt the backend. Do not make the UI worse just to avoid backend work.**

## 8. Backend Audit Is Not a Substitute for UX Work

Backend inspection is useful for:

- understanding current capabilities;
- finding reusable services;
- identifying constraints;
- preventing duplicate authority;
- planning migration/wiring.

Backend inspection is **not** a reason to delay UX until the backend is perfectly modeled.

Do not spend an open-ended cycle refactoring, normalizing, or auditing backend entities when the corresponding user flow is still unresolved.

**UI/UX uncertainty is a product-design problem first, not a database problem.**

## 9. Exceptions

This rule does not mean "never touch backend first."

Backend-first work is appropriate when the task is purely infrastructural or non-user-facing, such as:

- security hardening;
- data integrity fixes;
- persistence corruption fixes;
- performance/infrastructure work;
- migrations required independently of a UI change;
- API reliability fixes;
- background jobs/events with no new UX.

Even in these cases, do not invent a user-facing workflow from backend convenience.

## 10. Definition of Done for User-Facing Features

A user-facing feature is not considered ready when the endpoint works.

It is ready when:

- the primary user task is clear;
- the happy path is simple;
- UI states are defined;
- terminology is understandable to the intended user;
- complexity is progressively disclosed;
- the UI does not expose unnecessary implementation concepts;
- backend behavior supports the approved flow;
- wiring is complete;
- relevant tests cover the contractual behavior;
- runtime verification confirms the actual flow.

## 11. Agent Guardrails

Before making a backend-heavy change to a user-facing flow, the coding agent must be able to point to the approved UI/UX flow.

If no coherent UI/UX flow exists yet:

> **STOP BACKEND EXPANSION. DESIGN THE FLOW FIRST.**

Do not:

- create entities solely because "the database should have one";
- expose technical taxonomy because it already exists;
- force a merchant to perform backend setup manually;
- multiply screens to mirror normalized tables;
- continue backend refactoring indefinitely while UX remains undecided;
- treat an existing implementation as proof that the UX is correct.

Do:

- simplify the user task;
- benchmark mature products;
- use progressive disclosure;
- keep technical complexity behind the UI;
- derive backend requirements from the agreed experience;
- keep authoritative domain rules server-side.

## 12. Relationship to Other Xentra Contracts

This mental model governs **work sequencing and UX decision-making**.

It does not remove or weaken:

- domain authority;
- security;
- RBAC;
- financial invariants;
- inventory correctness;
- state-machine rules;
- auditability;
- API contracts;
- persistence integrity.

Those remain authoritative.

The change is the **order in which we solve the problem**:

> **First make the experience make sense. Then make the system support it.**

## 13. Final Rule

> **For user-facing work: UI → UX behavior → UX contract → backend contract → backend → wiring → tests.**

> **Never reverse this order merely because the backend already exists.**
