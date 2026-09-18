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

## 🔒 Locked Update — Banner Publication, Scheduling & Visibility Lifecycle v1

**Decision date:** 2026-09-18  
**Status:** LOCKED / AUTHORITATIVE  
**Applies to:** Banner Content publication + Banner Assignment visibility

Xentra adopts a social-publishing-style lifecycle for Banner, while keeping Banner Content and Banner Assignment/Placement as separate concepts.

### Publication boundary

A Banner Content item must support a review boundary before it becomes customer-visible.

```text
CREATE
  ↓
DRAFT
  ↓
REVIEW / PREVIEW
  ↓
PUBLISH NOW
      or
SCHEDULE PUBLISH
  ↓
PUBLISHED
```

- **DRAFT** means the content/revision is not customer-visible.
- **PUBLISHED** means the current content/revision has crossed the publication boundary and may become customer-visible according to its Assignment and visibility controls.
- Publishing may happen immediately (**Publish Now**) or by a future schedule (**Schedule Publish**).
- There is no mandatory human approval chain in v1. The review step is a product workflow boundary before Publish; Owner may review the preview and then publish.
- Editing an already-published Banner must not silently change the customer-visible version. Changes to published content must be represented as a draft revision/change set and become customer-visible only when the updated revision is explicitly published.

### Schedule is optional

Scheduling is not a required mode.

**Without a schedule:**

```text
PUBLISHED + Active ON  → customer-visible
PUBLISHED + Active OFF → not customer-visible (paused)
```

**With a schedule:**

```text
PUBLISHED + Active ON
  + now < starts_at
  → SCHEDULED

PUBLISHED + Active ON
  + starts_at <= now
  + (ends_at is null OR now < ends_at)
  → ACTIVE

PUBLISHED + Active ON
  + ends_at is not null
  + now >= ends_at
  → ENDED
```

`starts_at` is required when scheduling is used. `ends_at` is optional. A schedule with no `ends_at` remains eligible indefinitely after `starts_at`, subject to the Active control.

### Branch timezone

Schedule input and customer-facing schedule evaluation use the target **Branch timezone**.

Persisted timestamps may use the system's canonical timestamp representation, but the effective schedule must be interpreted in the assigned Branch's timezone.

### Active = pause / play visibility control

`active` is a manual visibility control on the Banner Assignment.

- `active = true` means the assignment is allowed to be visible when publication and schedule conditions are satisfied.
- `active = false` means the assignment is paused and must not be customer-visible.
- Turning Active OFF does not unpublish or delete the Banner.
- Turning Active ON resumes the assignment subject to the current publication state and schedule.

Active is therefore **not** a substitute for Publish.

### Effective status

The dashboard may present a derived status such as:

```text
DRAFT
SCHEDULED
ACTIVE
PAUSED
ENDED
```

These labels are derived from publication state, Active state, schedule, and current Branch-local time. They are not all separate mutable database states.

Recommended precedence:

```text
Not published                 → DRAFT
Published + Active OFF        → PAUSED
Published + Active ON + future start → SCHEDULED
Published + Active ON + active window → ACTIVE
Published + Active ON + end reached → ENDED
```

`ENDED` is a schedule condition, not deletion and not permanent retirement of the Banner.

### Ended Banner is reusable

When a schedule reaches `ends_at`, the Banner and Assignment record remain stored.

The record becomes effectively non-visible for the expired schedule, but may be reused by:

- editing its schedule to a new visibility window;
- removing the schedule and using it as an unscheduled Banner;
- publishing a new content revision when content changes;
- changing its Active state.

An ended Banner must not be automatically deleted merely because its visibility window has finished.

### Position conflict with scheduling

Position ordering remains explicit.

For the same:

```text
Branch + Placement + Position
```

two assignments may use the same position at different non-overlapping schedule windows.

A scheduling/publish/activate/resume mutation must be rejected when it would create an effective visibility overlap at the same Branch, Placement, and Position.

Draft content may be prepared without consuming a customer-visible position. A paused assignment does not produce current customer visibility, but re-activation/resume must re-run the conflict check before becoming visible.

Do not auto-shift positions or silently replace another Banner. Return an explicit conflict so the Owner can choose the intended placement/schedule.

### Customer visibility invariant

Customer visibility requires all of the following:

```text
Published content
+
Authorized Assignment
+
Active = true
+
Schedule is absent OR current Branch-local time is inside the schedule window
```

A Banner that is merely drafted, merely scheduled but not yet started, paused, or past its end time must not be treated as customer-visible.

### Lifecycle examples

**Evergreen Banner:**

```text
Publish Now
→ Active ON
→ no schedule
→ customer-visible until Owner pauses it
```

**Ramadan Banner:**

```text
Draft
→ Review / Preview
→ Schedule Publish
→ starts_at = Ramadan start
→ ends_at = Ramadan end
→ Branch timezone
→ Active ON
→ automatic customer visibility during the window
→ ENDED after end time
→ record remains reusable
```

**Temporary pause:**

```text
ACTIVE
→ Active OFF
→ PAUSED
→ Active ON
→ returns to the applicable schedule state
```

### Lifecycle non-goals

- No automatic deletion after `ends_at`.
- No requirement to create a new Banner record for every seasonal campaign.
- No scheduler worker is required merely to flip a persisted state from SCHEDULED to ACTIVE; effective visibility may be calculated from timestamps and Branch timezone.
- No silent position shifting or replacement on conflict.

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
