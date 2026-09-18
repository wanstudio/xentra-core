# Xentra — Storefront Banner, Placement & Promotion Boundary v2

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-18  
**Supersedes:** Branch Storefront Banner — Central Owner Manager & Branch Slots v1  
**Scope:** Marketing / Storefront presentation / Branch placement / Promotion boundary

## Decision

Xentra separates **Banner Content**, **Banner Placement/Assignment**, and **Promotion** into distinct concepts.

A **Banner is a storefront communication/content object**. A **Placement/Assignment** determines where, for which Branch, when, and under what presentation/governance rules that banner is displayed. A **Promotion** remains the business mechanic that defines eligibility, benefit, validity, scope, and redemption.

A Banner may reference a Promotion, but a Promotion does not own or require a Banner.

The previous decision's **exactly 5 banner slots per Branch is superseded**. A fixed number of slots is an implementation/UI presentation constraint, not a business/domain invariant.

## Canonical Marketing model

```text
MARKETING
├── Promotions
│   └── Promotion
│       ├── rules
│       ├── eligibility
│       ├── rewards / discount mechanics
│       ├── validity
│       ├── branch scope
│       └── redemption
│
├── Storefront Content
│   └── Banner
│       ├── content
│       ├── media
│       ├── CTA
│       └── optional promotion reference
│
├── Placements
│   └── Banner Assignment
│       ├── branch / storefront scope
│       ├── placement
│       ├── position / ordering
│       ├── schedule / visibility window
│       └── governance / lock state
│
└── Campaigns
    └── future orchestration layer
        ├── promotion
        ├── banner
        ├── audience
        └── channel
```

**Campaign is not introduced as a required domain in this decision.** If/when Xentra needs campaign orchestration, it should coordinate existing marketing objects rather than collapse them into one object.

## Banner contract

A Banner represents **what Xentra wants to communicate**, not where it is shown.

A Banner may be:

- promotional;
- informational;
- operational/announcement content;
- feature or service communication;
- linked to a menu/product/category;
- linked to a URL or other supported CTA;
- linked to a Promotion through an optional reference.

Examples:

- "QRIS sekarang tersedia" → Banner without Promotion.
- "Diskon 20% makan siang" → Banner + Promotion reference.
- "LUNCH20" exists as a valid promo code → Promotion without Banner.

The presence of a promotion reference does not make the Banner itself the Promotion.

## Placement / Assignment contract

Placement determines **where and how a Banner is presented**.

The placement layer may define:

- target Branch or authorized storefront scope;
- storefront placement/location;
- display ordering/position;
- active schedule or visibility window;
- whether the assignment is enabled;
- governance such as Owner lock where applicable.

A Branch can therefore receive different Banner content without duplicating the underlying Banner object, and the same Banner may be assigned to multiple authorized Branches where permitted.

### Branch scope

Branch targeting is an explicit placement/assignment concern.

The system must not infer that every Banner is intrinsically owned by one Branch merely because it is displayed at that Branch.

A Banner may be:

- assigned to one Branch;
- assigned to selected authorized Branches;
- assigned at a broader storefront scope where the product contract explicitly permits it.

Any broader scope must still respect Organization/Brand authorization boundaries and must never leak content into unauthorized Branches.

## Owner / Branch Manager governance

The previous **central Owner management** concept remains valid, but it now operates on **Banner Assignments/Placements**, not on a hard-coded five-slot Branch entity.

### Owner

Within authorized Organization/Brand/Branch scope, Owner may:

- create/edit Banner content;
- assign a Banner to authorized Branches;
- remove assignments;
- change placement/order;
- manage schedule/visibility;
- apply or remove governance locks where the implementation exposes such control;
- perform bulk assignment across explicitly selected authorized Branches.

### Branch Manager

Branch Manager remains branch-scoped.

Where Branch Manager is granted storefront-content authority, the Manager may operate only assignments/content within the authenticated Branch scope and may not mutate outside that scope.

An Owner governance lock may make a Banner Assignment read-only for Branch Manager. The lock controls **mutation authority**, not customer visibility.

The exact UI mechanism for lock/unlock is an implementation detail; the business invariant is that Branch Manager cannot bypass Owner governance.

## Position / slot rule

Xentra does **not** lock a business rule of "exactly 5 slots per Branch."

The storefront UI may still expose a finite number of visible banner positions in v1 for usability and layout reasons. If the first implementation uses 5 positions, those positions are a **presentation/placement constraint**, not a domain invariant.

Therefore:

- do not model five slots as five permanent business entities;
- do not reject future expansion solely because the domain was defined as five slots;
- do not make Banner identity depend on a slot number;
- placement/order may change without redefining the Banner itself.

## Promotion boundary

Promotion remains the authoritative business mechanic.

Promotion owns concepts such as:

- eligibility;
- discount/reward rules;
- validity;
- redemption constraints;
- branch scope;
- usage limits and related business rules.

Banner owns presentation/content.

Therefore:

```text
Promotion
    ↑ optional reference
Banner
    ↓ assigned through
Placement / Assignment
    ↓ displayed at
Branch Storefront
```

A Banner must never be treated as proof that a customer is eligible for a Promotion. Checkout/order validation remains authoritative.

## Campaign boundary

Campaigns are a future orchestration concept.

A future Campaign may coordinate:

- one or more Promotions;
- one or more Banners;
- audience/targeting;
- channels such as storefront, email, SMS, or other supported channels.

Campaign must not duplicate Promotion rules or turn Banner into a discount object.

No separate Campaign domain is required merely to implement Banner v2.

## Customer presentation

Customer storefront resolution should calculate the **effective Banner Assignments** for the selected Branch/storefront.

The resolver should consider:

1. authorized scope;
2. assignment target;
3. active/visibility window;
4. placement/order;
5. enabled state;
6. applicable governance state.

The resolver must not depend on a fixed five-slot business invariant.

Any legacy Brand-level banner fallback/precedence must be explicitly reconciled during implementation. Do not invent precedence by assumption.

## Media contract

Banner media continues to use the existing locked Xentra Media System:

- canonical banner crop target: approximately **1.94:1**;
- upload policy: **20 MB**;
- non-canonical source aspect ratios remain valid inputs;
- server-side media processing remains authoritative;
- only READY media may be attached;
- replacement is process-new → READY → switch reference → old asset ORPHAN;
- media operations remain tenant/brand scoped and subject to RBAC.

The media pipeline is reusable; this decision changes the business ownership/reference model, not the media lifecycle itself.

## Authorization invariant

```text
Authenticated identity
→ current role / permission
→ authorized Organization / Brand / Branch scope
→ target Banner / Assignment
→ requested mutation
→ governance/lock check
→ business/media invariants
→ atomic mutation
→ audit where required
→ authoritative response
```

Client-provided Branch identifiers are context/input only and never sufficient authorization.

## Auditability

Protected Banner and Assignment mutations should use the approved operational/audit mechanism.

Where relevant, evidence should preserve:

- actor;
- Organization/Brand/Branch scope;
- Banner/Assignment reference;
- action;
- previous/new state;
- timestamp.

Human-readable presentation belongs to the established semantic log/read-model layer; raw IDs and internal constants are not the primary customer/merchant activity sentence.

## Legacy infrastructure reconciliation

The existing Brand-level `brands.banners` path is **legacy infrastructure and must not be silently deleted or reinterpreted**.

Before implementation changes customer banner resolution:

1. map current `brands.banners` data and API consumers;
2. identify which legacy content is Banner Content versus placement/assignment information;
3. define an explicit migration/reconciliation path;
4. preserve customer-visible behavior unless the new contract intentionally changes it;
5. remove legacy storage only after all authoritative consumers have migrated and verification passes.

The existing media pipeline should be reused where technically appropriate.

## Non-goals

- No Banner = Promotion coupling.
- No requirement that every Banner belongs intrinsically to one Branch.
- No "exactly 5 slots per Branch" business invariant.
- No separate Owner Override Banner entity.
- No automatic Campaign domain implementation.
- No global content silently copied outside authorized scope.
- No Branch Manager authority to bypass Owner governance.
- No deletion or silent reinterpretation of legacy `brands.banners` infrastructure.

## Implementation gate

Implementation must begin with an architecture/data-flow reconciliation of:

```text
Legacy Brand Banner
        ↓
Banner Content
        +
Placement / Assignment
        ↓
Branch Storefront Resolver
        ↓
Customer Storefront
```

Only after that mapping is verified should schema/API/UI changes be implemented.

**Source-of-truth rule:** this v2 decision supersedes the v1 decision. Any worker implementing Banner must follow v2 unless a newer locked decision explicitly supersedes it.
