# Xentra Merchant Operating App — UX / IA Contract v1

**Status:** LOCKED
**Date:** 2026-09-21

## Decision
Xentra Merchant is to be designed at the product/UX level of a modern merchant operating app such as GoFood Merchant / GrabMerchant: mobile-first, operational, action-oriented, and centered on daily restaurant operations.

This is a UX/product benchmark, not a copy of their marketplace business model or exact UI.

## Core IA
Primary navigation:
- **Beranda** — operational overview, attention items, today's business snapshot.
- **Pesanan** — operational order center; mobile cards are the primary mobile pattern.
- **Lainnya** — Menu, Stok, Delivery, Outlet, Penjualan, Keuangan, Promo, Wawasan, Karyawan, Pelanggan, Pengaturan. KDS is not an active Merchant navigation item in MVP; it is an optional future SaaS add-on.

## Product model
Xentra remains a **brand-owned Restaurant Operating System** with multi-branch support. It is not a marketplace.

## Operational UX
- Mobile-first for daily operations; desktop remains fully usable.
- Action-first: surface what needs attention and the next permitted action.
- Order Center is operational, not merely a data table.
- New pending orders use visual attention and audible alert where browser/device policy permits; existing polling is reused rather than duplicated.
- Order lifecycle and Delivery Job lifecycle remain visually distinct.
- Menu and Inventory are first-class operational areas, not merely CRUD screens.
- Outlet/branch selection is first-class.

## Authority remains locked
- Branch Manager: order acceptance/rejection, operational monitoring, driver assignment/dispatch where authorized, and the required cooking-stage actions in MVP when the outlet has no dedicated Kitchen surface.
- Head Kitchen/KDS: confirmed → preparing → ready when the optional KDS capability is enabled for dedicated kitchen staff.
- Driver: pickup → on_delivery → delivered and COD cash collection/custody.
- Cashier/POS: COD handover, cash verification, payment settlement.
- COD settlement remains separate from delivery completion.

Existing Order, Delivery, Kitchen, COD, RBAC, and branch-scope contracts remain authoritative. No duplicate state machine.

## Implementation sequence
1. Merchant IA/navigation shell.
2. Order Center operational UX.
3. Menu/Inventory UX.
4. Delivery/Driver surfaces.
5. Cashier/POS surfaces.
6. Optional KDS add-on only when the SaaS feature entitlement is enabled for a dedicated kitchen workflow.
7. Business analytics/reporting.

## Non-goals
This lock does not authorize changes to Google auth, checkout, promo, customer auth, or unrelated backend behavior. Do not delete/reseed existing business data.


---

# 🔒 VISUAL DESIGN SOURCE OF TRUTH — ADDENDUM v2

**Decision date:** 2026-09-26
**Status:** LOCKED — AUTHORITATIVE FOR MERCHANT APP DESIGN
**Visual reference:** approved Xentra Merchant Home mockup dated 2026-09-26.

This addendum defines the design language, interaction model, information hierarchy, navigation model, and mobile operating philosophy for the entire Xentra Merchant App.

The approved Home mockup is the visual anchor. Future Merchant screens must feel like they belong to the same application even when the domain content changes.

## 1. Product Form

Xentra Merchant is a mobile operating application, not a desktop web dashboard compressed into a phone.

Reference quality:
- GoFood Merchant
- GrabMerchant
- Xentra's approved Home mockup

These are references for interaction quality and merchant ergonomics, not instructions to copy their business model or exact UI.

## 2. Source-of-Truth Hierarchy

When designing or implementing a Merchant screen, apply authority in this order:

1. Locked business/domain contract.
2. Locked Merchant responsibility/IA contract.
3. This Visual Design Source of Truth.
4. Existing Xentra implementation only when it does not conflict with the above.

Existing UI is not authoritative merely because it already exists.

A legacy screen may be redesigned or replaced when it conflicts with the locked UX/domain model.

## 3. Mobile-First Shell

The Merchant shell is defined by the approved Home concept.

### Header
- Branch/outlet identity is immediately visible.
- Branch operational state is immediately visible.
- Online-order availability is immediately visible and independent from branch operational state.
- Notification and account actions remain compact.
- Header does not consume unnecessary vertical space.

### Bottom Navigation
The primary Merchant navigation is a persistent bottom navigation pattern:

Beranda | Pesanan | Menu | Stock | Promo

Exact icons may evolve, but the task-oriented information architecture remains stable.

No sidebar is the primary Merchant navigation pattern.

Desktop is a responsive adaptation of this mobile shell, not a replacement for it.

## 4. Home Philosophy

Home is a glance → understand → act surface.

The approved concept begins with:
1. Branch state.
2. Today's business snapshot.
3. Operational/attention cards.
4. Bottom navigation.

The large visual area after the primary sales card is intentional canvas for additional high-value cards/modules, not empty filler.

Future Home modules are selected by operational value, not by the number of backend metrics available.

Preferred module categories:
- immediate attention/work queue;
- current operational pulse;
- stock exceptions/availability;
- today's reservation/appointment context;
- concise financial/transaction signals;
- other time-sensitive merchant actions.

Avoid turning Home into a KPI wall.

## 5. Information Hierarchy

Every Merchant screen should answer, in order:

What is happening?
Does it need my attention?
What can I do now?

The UI should expose:
- current context;
- current human-readable state;
- next meaningful action.

Technical IDs, internal state-machine names, audit fields, provider details, and implementation metadata belong in deeper detail surfaces.

## 6. Action-First, Not Data-First

Merchant UI is not a database browser.

Do not design a primary Merchant screen as:
- a desktop table squeezed into mobile;
- a collection of generic dropdowns;
- a universal status taxonomy exposed to operators;
- a list of backend entities without context;
- a wall of badges, counters, or controls.

When an environment has a different workflow, its UI must expose the action appropriate to that environment.

Examples:
- Dine-in: table/session-aware operational actions.
- Pickup: pickup-specific next action.
- Delivery: dispatch/handoff-specific next action.
- Reservation: arrival/check-in-specific next action.

Core remains authoritative; UI is an environment-specific human projection.

## 7. Cards and Lists

Cards are the primary mobile presentation pattern for operational work.

A card should normally communicate:

Context
→ current state
→ relevant money or quantity when needed
→ one primary next action
→ detail / secondary action

Do not expose every possible action simultaneously.

Use progressive disclosure:
- primary action on the card;
- secondary actions in detail or overflow;
- full history inside detail.

## 8. Density and Ergonomics

The Merchant App is used during active restaurant work.

Therefore:
- touch targets must be comfortable;
- text hierarchy must be obvious at a glance;
- important information must not compete visually;
- controls should not require precision tapping;
- horizontal scrolling should be rare and purposeful;
- long dense tables are not the default mobile experience;
- spacing separates concepts instead of merely decorating.

The design should feel calm even when the restaurant is busy.

## 9. Status Language

Backend state values are not automatically suitable for display.

Use human operational language.

A single universal status label must not erase differences between Fulfillment Environments.

For example, a backend ready state may require different human-facing wording and action depending on Dine-in, Pickup, or Delivery.

Payment state remains a separate financial signal where relevant.

Fulfillment != Payment != Dining Session.

## 10. Operational Safety

A primary action must not create an irreversible or misleading mental model.

Examples:
- completing fulfillment must not imply that a bill is paid;
- pausing online ordering must not imply that the physical branch is closed;
- an accepted order must not appear editable when the contract says it is immutable;
- additional ordering must be an explicit continuation of the same Dine-in context, not an unexplained second order.

When an action has operational consequences, the UI should make the consequence understandable before the tap.

## 11. Environment-Specific UX

The Purchase Type / Fulfillment Environment Contract remains authoritative.

Merchant UI should project each environment instead of forcing all environments into one generic workflow.

A screen may remain a unified operational inbox, but:
- state labels;
- contextual information;
- available primary action;
- secondary action;
- completion semantics

must be derived from the active Fulfillment Environment.

Do not introduce a second domain state machine merely to make the UI easier.

## 12. Navigation Rule

Navigation is organized around merchant jobs, not backend tables.

Frequent operational work should require minimal navigation depth.

A feature already reachable through primary navigation should not also require a duplicate feature directory unless the duplicate entry genuinely improves discoverability.

## 13. Visual Consistency

Future screens inherit the Home's visual grammar:
- soft card-based surfaces;
- restrained status color;
- strong but compact hierarchy;
- generous but purposeful spacing;
- compact pills/status treatments;
- large primary values/labels when important;
- persistent bottom navigation orientation;
- minimal chrome;
- direct human language.

This is a design grammar, not a demand for pixel-for-pixel duplication.

## 14. Desktop Rule

Desktop may:
- show more content side-by-side;
- use denser layouts when they genuinely improve an operational task;
- use wider cards or panes.

Desktop may not:
- replace the mobile task hierarchy with an admin-dashboard mental model;
- introduce a sidebar merely because there is horizontal space;
- expose additional technical complexity simply because the screen is wider.

## 15. Definition of Done for Merchant UI

A Merchant feature is not UX-complete merely because backend state is represented.

It is complete when:
- correct environment/context is visible;
- operator can understand the situation quickly;
- next action is obvious;
- payment/fulfillment/session semantics are not conflated;
- mobile touch operation is comfortable;
- the screen belongs visually and behaviorally to the approved Merchant shell;
- screen does not depend on knowledge of internal architecture;
- exceptional/problem states remain recoverable and discoverable.

## 16. Superseded Wording

Where the previous UX/IA contract says or implies:
- Lainnya is the primary Merchant navigation pattern;
- Merchant UI may be treated as a desktop-style operational dashboard with mobile support;
- a generic table is the primary Order Center mental model;

those statements are superseded by this addendum.

Existing domain ownership, role, scope, and KDS boundaries are not superseded.

**LOCKED — THIS ADDENDUM IS THE DESIGN SOURCE OF TRUTH FOR THE XENTRA MERCHANT APP.**
