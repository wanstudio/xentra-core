# Xentra — KDS Add-on / Feature Entitlement Decision v1

**Status:** LOCKED — Architecture / Product / UX Direction
**Decision date:** 2026-09-22

## Final Decision

**KDS is an optional SaaS add-on / capability, not a mandatory part of Xentra Merchant App and not a mandatory standalone product surface.**

For the Xentra MVP, the Branch Manager handles the full required operational order flow from Merchant App. The kitchen does not require a dedicated software screen, login, device, or mode switch.

## Decision Evolution

### 1. Initial MVP direction

The earlier locked kitchen decision established that Xentra MVP does not require a KDS interface. Physical kitchen printing and direct coordination are sufficient.

Canonical MVP flow:

```
Customer
→ Order
→ Merchant App
→ Branch Manager accepts
→ Kitchen / Merchant copy printed
→ Kitchen prepares / packs
→ Branch Manager continues dispatch
→ Driver
```

### 2. Separate Kitchen surface was evaluated

A dedicated Kitchen surface was considered, similar to the Owner Dashboard vs Merchant App separation.

The separation is technically valid for a future dedicated kitchen workforce, but it creates unnecessary operational friction for a small outlet where the same person is both Manager and Kitchen.

That person must not be forced to:
- log out and log in again;
- switch account;
- switch into Kitchen Mode;
- navigate through a second application;
just to change a kitchen-stage order status.

### 3. Final MVP operating model

For outlets without dedicated kitchen staff:

```
Merchant App
└── Pesanan
    ├── Diterima
    ├── Dimasak
    └── Siap Diantar
```

The Branch Manager may operate the applicable kitchen-stage actions because the Manager is the single operational actor for the outlet.

This is a UX simplification only. The Core order state machine remains the single authority.

### 4. Future KDS trigger

KDS becomes relevant only when a Branch has dedicated kitchen personnel and needs a dedicated preparation workflow.

```
Merchant App
└── Manager / outlet operations

KDS Add-on
└── Kitchen staff / dedicated kitchen workflow
```

The future KDS surface may be separate in UI/UX while continuing to use the same Xentra Core authority.

## Product Model

KDS is a **SaaS feature entitlement**, not a WordPress-style plugin that merchants install into the runtime.

Conceptual model:

```
Xentra SaaS
→ Plan / Subscription
→ Feature Entitlement
→ KDS enabled for tenant / brand / branch
→ KDS surface becomes available
```

The KDS code may exist in the Xentra codebase before activation. Activation controls availability; it does not require a separate plugin-installation runtime.

## Shared Core

KDS must reuse the existing Xentra Core foundations:

- OrderStateMachine
- RBAC / permissions
- tenant / brand / branch scope
- Order and Delivery domains
- persistence
- audit trail
- printing / hardware integration boundaries
- existing API contracts where retained

There must be **one order state machine**. KDS must never introduce a second kitchen-specific order lifecycle.

## Authority Boundary

```
Branch Manager
→ accept / reject
→ operational monitoring
→ dispatch / driver assignment

Kitchen / future KDS
→ preparing
→ ready

Driver
→ pickup
→ on_delivery
→ delivered

Payment / POS
→ settlement / cash lifecycle
```

The exact server-side authority remains enforced by Core. UI visibility is never authorization.

## Current Source-Code Fit

The current repository already contains most of the technical primitives needed for a future KDS capability:

- dedicated `kitchen` role;
- kitchen preparation permissions;
- `/kitchen/queue` endpoint;
- `/kitchen/orders/:id/status` endpoint;
- existing standalone `apps/kitchen-display` implementation;
- Core Domain Capability metadata;
- SaaS architecture documentation defining plan/subscription/feature-entitlement concepts.

The repository does **not** yet contain a generic runtime add-on/entitlement framework.

Therefore:

**Do not build a generic plugin framework solely for KDS.**

When SaaS monetization/entitlement work is implemented later, introduce the smallest platform-level feature entitlement contract that can serve KDS and future optional capabilities.

## Current MVP Boundary

For the current MVP:

- Merchant App remains the required daily operational surface for Branch Manager.
- No separate KDS login.
- No Manager → Kitchen Mode switching.
- No mandatory kitchen tablet/device.
- Physical kitchen printing remains the default kitchen workflow.
- Existing KDS source may remain as held/future implementation, but must not be treated as an active mandatory product surface.

## Non-goals

Do not build now:

- mandatory KDS UI for every merchant;
- mandatory kitchen login/device;
- Manager → Kitchen Mode switching;
- WordPress-style plugin installation;
- generic plugin marketplace;
- advanced multi-station / expediter KDS;
- second order state machine;
- unrelated POS or Driver architecture changes.

## Relationship to Earlier Kitchen Decision

The earlier document `docs/decisions/kitchen-operations-printing-model-v1.md` remains valid for the MVP physical kitchen workflow.

This decision adds the future product boundary:

**KDS = optional SaaS add-on/capability for dedicated kitchen operations.**

Where older wording implies KDS is an active mandatory surface or a required Merchant navigation item, this document supersedes that interpretation.

## Locked Product Structure

```
Xentra SaaS
└── Xentra Core
    ├── Owner Dashboard
    ├── Merchant App
    ├── Customer PWA
    └── Optional Capabilities
        └── KDS Add-on
```
