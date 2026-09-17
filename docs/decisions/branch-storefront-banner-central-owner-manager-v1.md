# Xentra — Branch Storefront Banner: Central Owner Manager & Branch Slots v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-17  
**Scope:** Merchant Dashboard / Branch Storefront presentation / media governance

## Decision

Xentra uses a **Branch Storefront Banner** model with exactly **5 banner slots per Branch**.

Banner content is Branch-scoped, while Owner has centralized governance across authorized Branches. Owner does not need to enter each Branch dashboard individually to manage banners.

## Canonical model

```text
Owner Central Banner Manager
        ↓
Authorized Branches
        ↓
Each Branch has exactly 5 slots
        ├── Slot 1
        ├── Slot 2
        ├── Slot 3
        ├── Slot 4
        └── Slot 5
```

Each slot has its own banner content and its own **Owner Lock state**.

```text
Slot
├── media
├── active / empty
└── locked_by_owner
```

## Branch Manager authority

Branch Manager operates only the authenticated assigned Branch.

For each of the Branch's 5 slots, Branch Manager may:

- upload a banner into an empty slot;
- replace the banner when the slot is unlocked;
- delete the banner when the slot is unlocked;
- view locked banners and their locked state.

Branch Manager may **not** unlock a slot locked by Owner and may not edit or delete a locked banner.

## Owner authority

Owner manages Branch Storefront Banners from a **centralized Banner Manager**, without entering Branch dashboards one by one.

Within authorized scope, Owner may:

- select one or more Branches;
- upload a banner to Branch slot(s);
- replace a banner;
- delete a banner;
- lock a slot;
- unlock a slot;
- distribute the same banner operation across multiple selected Branches.

Owner lock is a per-slot governance control. It does not transfer ownership of the Branch banner to a separate Owner Banner entity.

## Lock semantics

```text
UNLOCKED
→ Branch Manager may edit/delete

LOCKED BY OWNER
→ Branch Manager read-only
→ Owner may edit/delete/unlock
```

Lock controls **mutation authority**, not whether the banner is visible to customers.

Locking a slot must not hide, deactivate, or otherwise change its storefront presentation.

## Multi-Branch Owner workflow

Owner can manage banners centrally:

```text
Marketing / Banner Toko
        ↓
Select Branch(es)
        ↓
Select slot(s)
        ↓
Upload / Replace / Delete
        ↓
Optional: Lock / Unlock
```

When an Owner operation targets multiple Branches, every targeted Branch remains independently scoped. The operation must not create a global banner that is implicitly copied to unauthorized Branches.

When a selected Branch slot already contains a banner, replacement/overwrite must be explicit and must not silently destroy existing content.

## Important distinction

**Branch Storefront Banner is distinct from Brand promotional banners/campaign content.** Existing Brand-level banner infrastructure must not be silently reinterpreted or deleted by this decision.

Promotion/campaign governance remains governed by the existing Promotion contract. A storefront banner is a media/presentation slot and is not automatically a Promotion entity.

## Customer presentation

The customer storefront consumes the effective banner set for the selected Branch. Up to 5 Branch slots may contribute to that Branch's banner carousel; empty slots contribute nothing.

Exact fallback/precedence behavior against any existing Brand-level banner fallback must be resolved during implementation before replacing current customer resolution. Do not invent precedence by assumption.

## Media contract

Banner media follows the locked Xentra Media System:

- canonical banner crop target: approximately **1.94:1**;
- upload policy: **20 MB**;
- non-canonical source aspect ratios remain valid inputs;
- server-side media processing remains authoritative;
- only READY media may be attached;
- replacement is process-new → READY → switch reference → old asset ORPHAN;
- media operations remain tenant/brand scoped and subject to RBAC.

## Authorization invariant

```text
Authenticated identity
→ current role / permission
→ authorized Organization / Brand / Branch scope
→ target Branch + slot
→ requested banner mutation
→ lock state check
→ business/media invariants
→ atomic mutation
→ audit where required
→ authoritative response
```

Client-provided Branch identifiers are context/input only and never sufficient authorization.

## Auditability

Owner lock/unlock and protected Branch banner mutations should be auditable using the approved operational/audit mechanism. The audit record should preserve actor, Branch, slot, action, and timestamp.

## Non-goals

- No separate Owner Override Banner entity.
- No unlimited Branch banner slots.
- No global banner silently copied outside the selected authorized Branches.
- No Branch Manager authority to bypass an Owner lock.
- No automatic conversion of Banner into Promotion/Campaign.
- No deletion or silent reinterpretation of existing Brand banner infrastructure solely because this decision is introduced.

## Implementation gate

Implementation must first reconcile the current Brand-level `brands.banners` path with this Branch Storefront Banner contract. Any schema/API change for Branch slots must preserve tenant isolation, media lifecycle guarantees, and explicit per-slot lock semantics.

Do not implement from memory or assume the existing Brand banner field is the final Branch Banner storage model.
